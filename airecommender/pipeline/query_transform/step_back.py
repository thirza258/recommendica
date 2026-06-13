"""
step_back.py
------------
Step-Back prompting for arxiv paper search.

Flow:
  user query
      → LLM abstracts it into a broader research question (step-back)
      → LLM maps the abstracted question to arxiv category codes
      → ChromaDB query uses:
            - original query     (specific retrieval)
            - abstracted query   (broader retrieval)
            - category filter    (precision gate, if confidence is high)
      → merge both result sets with RRF + return

Why: "make my BERT model faster" is too specific and colloquial.
     Step-back abstracts it to "model compression and efficient inference
     for transformer architectures" which retrieves foundational papers
     the user needs but didn't know to search for.
     The category hint cs.LG / cs.CL also prevents off-topic matches.

Paper: Zheng et al. 2023 — arXiv:2310.06117
"""

import json
from collections import defaultdict
from anthropic import Anthropic
import chromadb
from chromadb.utils import embedding_functions

# ── clients ────────────────────────────────────────────────────────────────────
anthropic = Anthropic()

chroma_client = chromadb.PersistentClient(path="./chroma_db")

embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="BAAI/bge-small-en-v1.5"
)

collection = chroma_client.get_or_create_collection(
    name="arxiv_papers",
    embedding_function=embed_fn,
    metadata={
        "hnsw:space": "cosine",
        "hnsw:construction_ef": 200,
        "hnsw:M": 32,
        "hnsw:search_ef": 150,
    },
)

# ── arxiv category map ─────────────────────────────────────────────────────────
# subset of most common categories in a typical arxiv ML/CS dataset
ARXIV_CATEGORIES = {
    "cs.LG":    "Machine Learning",
    "cs.CV":    "Computer Vision and Pattern Recognition",
    "cs.CL":    "Computation and Language / NLP",
    "cs.AI":    "Artificial Intelligence",
    "cs.RO":    "Robotics",
    "cs.IR":    "Information Retrieval",
    "cs.NE":    "Neural and Evolutionary Computing",
    "cs.DC":    "Distributed, Parallel, and Cluster Computing",
    "cs.CR":    "Cryptography and Security",
    "cs.HC":    "Human-Computer Interaction",
    "cs.SE":    "Software Engineering",
    "cs.DS":    "Data Structures and Algorithms",
    "stat.ML":  "Statistics — Machine Learning",
    "stat.AP":  "Statistics — Applications",
    "math.OC":  "Mathematics — Optimization and Control",
    "eess.SP":  "Signal Processing",
    "eess.IV":  "Image and Video Processing",
    "quant-ph": "Quantum Physics",
    "physics.data-an": "Physics — Data Analysis",
}

CATEGORY_LIST = "\n".join(f"  {k}: {v}" for k, v in ARXIV_CATEGORIES.items())

# ── prompts ────────────────────────────────────────────────────────────────────
STEP_BACK_SYSTEM = f"""You are a research librarian specializing in academic paper classification.

Given a user query, do TWO things:

1. ABSTRACT the query into a broader, more general research question.
   - Remove colloquialisms and implementation details
   - Use formal academic language
   - Capture the underlying research problem, not the surface request

2. MAP the abstracted question to 1–3 arxiv category codes.

Available categories:
{CATEGORY_LIST}

Respond ONLY in this exact JSON format, no preamble, no markdown:
{{
  "abstracted_query": "the broader, formal research question",
  "categories": ["cs.LG"],
  "confidence": "high",
  "reasoning": "one sentence explaining the category choice"
}}

Confidence rules:
- "high":   query clearly belongs to specific categories (≥80% certain)
- "medium": query spans multiple areas or is somewhat ambiguous
- "low":    query is very vague, cross-disciplinary, or unclear

Category rules:
- Return 1–3 categories max, ordered by relevance
- If the query is not arxiv-relevant: return "categories": []
- Prefer specific over broad: cs.CL > cs.AI for NLP tasks
- A paper can span categories — use $or logic, not $and
"""


# ── core functions ─────────────────────────────────────────────────────────────
def step_back(query: str) -> dict:
    """
    Abstract the user query and extract arxiv category hints.

    Returns:
        {
            abstracted_query: str,
            categories: list[str],
            confidence: "high" | "medium" | "low",
            reasoning: str
        }
    """
    response = anthropic.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=256,
        system=STEP_BACK_SYSTEM,
        messages=[{"role": "user", "content": f"User query: {query}"}],
    )

    text = response.content[0].text.strip()
    text = text.replace("```json", "").replace("```", "").strip()

    try:
        result = json.loads(text)
        # validate required keys
        assert "abstracted_query" in result
        assert "categories" in result
        assert "confidence" in result
    except (json.JSONDecodeError, AssertionError, KeyError):
        # safe fallback — no category filter, use query as-is
        result = {
            "abstracted_query": query,
            "categories": [],
            "confidence": "low",
            "reasoning": "parse error — falling back to no category filter",
        }

    return result


def build_where_clause(categories: list[str], confidence: str) -> dict | None:
    """
    Build a ChromaDB where clause from category hints.

    Only apply filter when confidence is high or medium.
    Low confidence → no filter (don't risk excluding relevant papers).
    Empty categories → no filter (query is out-of-scope or unclear).
    """
    if not categories or confidence == "low":
        return None

    if len(categories) == 1:
        # single category — simple contains check
        return {"categories": {"$contains": categories[0]}}

    # multiple categories — $or so paper only needs to match ONE
    return {
        "$or": [
            {"categories": {"$contains": cat}}
            for cat in categories
        ]
    }


def rrf_merge(
    results_a: dict,
    results_b: dict,
    k: int = 60,
    top_n: int = 20,
) -> list[dict]:
    """
    Merge two ranked result sets (original query + abstracted query) with RRF.

    This gives papers that are relevant to both the specific query AND
    the broader research question a higher combined score.
    """
    rrf_scores: dict[str, float] = defaultdict(float)
    doc_store: dict[str, dict] = {}

    for result_set in [results_a, results_b]:
        ids       = result_set["ids"][0]
        docs      = result_set["documents"][0]
        metas     = result_set["metadatas"][0]
        distances = result_set["distances"][0]

        for rank, (doc_id, doc, meta, dist) in enumerate(
            zip(ids, docs, metas, distances)
        ):
            rrf_scores[doc_id] += 1.0 / (k + rank + 1)

            if doc_id not in doc_store:
                doc_store[doc_id] = {
                    "id": doc_id,
                    "title": meta.get("title", ""),
                    "abstract": doc,
                    "categories": meta.get("categories", ""),
                    "year": meta.get("year", ""),
                    "best_distance": dist,
                }
            else:
                doc_store[doc_id]["best_distance"] = min(
                    doc_store[doc_id]["best_distance"], dist
                )

    ranked = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)

    return [
        {
            **doc_store[doc_id],
            "rrf_score": round(score, 6),
            "best_similarity": round(1 - doc_store[doc_id]["best_distance"], 4),
        }
        for doc_id, score in ranked[:top_n]
    ]


def step_back_retrieve(
    query: str,
    top_k: int = 10,
    candidates: int = 50,
) -> dict:
    """
    Full Step-Back retrieval pipeline.

    Args:
        query:      raw user query
        top_k:      number of final results to return
        candidates: how many candidates to pull per query (before RRF)

    Returns:
        dict with keys:
            query               — original
            abstracted_query    — step-back abstraction
            categories          — inferred arxiv categories
            confidence          — how confident the category mapping is
            reasoning           — why those categories were chosen
            filter_applied      — True if ChromaDB filter was used
            results             — final RRF-ranked papers
    """
    # step 1: abstract query and extract category hints
    sb = step_back(query)
    abstracted   = sb["abstracted_query"]
    categories   = sb["categories"]
    confidence   = sb["confidence"]
    where_clause = build_where_clause(categories, confidence)

    # step 2: retrieve using BOTH original and abstracted query
    shared_kwargs = {
        "n_results": candidates,
        "include": ["documents", "metadatas", "distances"],
    }
    if where_clause:
        shared_kwargs["where"] = where_clause

    results_original   = collection.query(query_texts=[query],       **shared_kwargs)
    results_abstracted = collection.query(query_texts=[abstracted],   **shared_kwargs)

    # step 3: merge with RRF
    fused = rrf_merge(results_original, results_abstracted, top_n=top_k)

    return {
        "query":            query,
        "abstracted_query": abstracted,
        "categories":       categories,
        "confidence":       confidence,
        "reasoning":        sb.get("reasoning", ""),
        "filter_applied":   where_clause is not None,
        "results":          fused,
    }


def print_results(output: dict) -> None:
    print(f"\n{'='*70}")
    print(f"Query:            {output['query']}")
    print(f"Abstracted:       {output['abstracted_query']}")
    print(f"Categories:       {output['categories']}  [{output['confidence']}]")
    print(f"Reasoning:        {output['reasoning']}")
    print(f"Category filter:  {'applied' if output['filter_applied'] else 'skipped (low confidence)'}")
    print(f"\nTop {len(output['results'])} papers:")
    for i, r in enumerate(output["results"], 1):
        print(f"\n  [{i}] {r['title']}")
        print(f"       RRF: {r['rrf_score']}  |  similarity: {r['best_similarity']}")
        print(f"       Categories: {r['categories']}")
        print(f"       Abstract: {r['abstract'][:120]}...")


# ── example usage ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    queries = [
        # colloquial / vague
        "make my BERT model smaller and faster",
        # cross-domain
        "use AI to discover new drug compounds",
        # specific technique
        "LoRA fine-tuning for large language models",
        # out-of-scope test
        "best recipe for sourdough bread",
    ]

    for query in queries:
        output = step_back_retrieve(query, top_k=5, candidates=50)
        print_results(output)
        print()