"""
rag_fusion.py
-------------
RAG Fusion for arxiv paper search.

Flow:
  user query
      → LLM generates N query variants (different angles on the same topic)
      → dense retrieve top-k from ChromaDB for EACH variant
      → merge all ranked lists using Reciprocal Rank Fusion (RRF)
      → return consensus-ranked results

Why: one query misses papers that use different terminology.
     "efficient transformers" vs "reducing attention complexity" vs
     "lightweight self-attention" all refer to the same research area
     but retrieve different papers. RRF surfaces papers that show up
     consistently across all variants — those are the most relevant.

Paper: Raudaschl 2023 — github.com/raudaschl/rag-fusion
       RRF: Cormack et al. 2009
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

# ── prompts ────────────────────────────────────────────────────────────────────
FUSION_SYSTEM = """You are a research assistant helping search arxiv papers.

Given a user query, generate {n} different search queries that approach
the same topic from different angles — different terminology, different
framings, different levels of specificity.

Respond ONLY with a JSON array of strings. No preamble, no explanation.
Example: ["query one", "query two", "query three"]

Rules:
- Each query must be meaningfully different from the others
- Cover: technical terms, application domains, method names, problem framing
- Keep each query concise (5–12 words)
- Do NOT repeat the original query verbatim — rewrite it as one of the variants
"""


# ── core functions ─────────────────────────────────────────────────────────────
def generate_query_variants(query: str, n: int = 4) -> list[str]:
    """
    Generate N query variants from a single user query.

    Always includes the original query as the first entry so we never
    lose its signal, then appends LLM-generated variants.
    """
    response = anthropic.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=FUSION_SYSTEM.format(n=n),
        messages=[{"role": "user", "content": f"Original query: {query}"}],
    )

    text = response.content[0].text.strip()
    # strip markdown fences if model adds them
    text = text.replace("```json", "").replace("```", "").strip()

    try:
        variants = json.loads(text)
        if not isinstance(variants, list):
            raise ValueError("not a list")
    except (json.JSONDecodeError, ValueError):
        # fallback: just use original query if parsing fails
        variants = []

    # always keep original query, deduplicate
    all_queries = [query] + [v for v in variants if v != query]
    return all_queries[:n + 1]  # original + n variants


def retrieve_per_variant(
    variants: list[str],
    candidates_per_variant: int = 50,
    where: dict | None = None,
) -> list[dict]:
    """
    Run dense retrieval for each query variant independently.

    Returns a list of result sets — one per variant.
    Each result set has ids, documents, metadatas, distances.
    """
    query_kwargs = {
        "query_texts": variants,
        "n_results": candidates_per_variant,
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        query_kwargs["where"] = where

    raw = collection.query(**query_kwargs)

    # split flat batch response into per-variant dicts
    per_variant = []
    for i in range(len(variants)):
        per_variant.append(
            {
                "query": variants[i],
                "ids": raw["ids"][i],
                "documents": raw["documents"][i],
                "metadatas": raw["metadatas"][i],
                "distances": raw["distances"][i],
            }
        )
    return per_variant


def reciprocal_rank_fusion(
    per_variant_results: list[dict],
    k: int = 60,
    top_n: int = 20,
) -> list[dict]:
    """
    Merge multiple ranked lists using Reciprocal Rank Fusion.

    RRF score for document d = Σ_i  1 / (k + rank_i(d))
    where rank_i(d) is d's position (0-indexed) in result list i.

    A document appearing at rank 3, 5, 8 across 3 variants scores:
        1/(60+3) + 1/(60+5) + 1/(60+8) = 0.0159 + 0.0154 + 0.0147 = 0.0460
    vs a document appearing only at rank 1 in one variant:
        1/(60+1) = 0.0164

    Consensus across variants beats a single top hit.
    """
    rrf_scores: dict[str, float] = defaultdict(float)
    appearances: dict[str, int] = defaultdict(int)
    doc_store: dict[str, dict] = {}

    for variant_result in per_variant_results:
        for rank, (doc_id, doc, meta, dist) in enumerate(
            zip(
                variant_result["ids"],
                variant_result["documents"],
                variant_result["metadatas"],
                variant_result["distances"],
            )
        ):
            rrf_scores[doc_id] += 1.0 / (k + rank + 1)
            appearances[doc_id] += 1

            # store doc data on first encounter
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
                # track best individual similarity seen across variants
                doc_store[doc_id]["best_distance"] = min(
                    doc_store[doc_id]["best_distance"], dist
                )

    # rank by RRF score descending
    ranked = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)

    results = []
    for doc_id, rrf_score in ranked[:top_n]:
        entry = doc_store[doc_id].copy()
        entry["rrf_score"] = round(rrf_score, 6)
        entry["appeared_in_variants"] = appearances[doc_id]
        entry["best_similarity"] = round(1 - doc_store[doc_id]["best_distance"], 4)
        results.append(entry)

    return results


def rag_fusion_retrieve(
    query: str,
    n_variants: int = 4,
    candidates_per_variant: int = 50,
    top_n: int = 10,
    where: dict | None = None,
) -> dict:
    """
    Full RAG Fusion pipeline.

    Args:
        query:                  raw user query
        n_variants:             number of query variants to generate
        candidates_per_variant: how many candidates to pull per variant
        top_n:                  final results to return after RRF
        where:                  optional ChromaDB metadata filter

    Returns:
        dict with keys:
            query           — original query
            variants        — all query variants used
            results         — RRF-ranked list of papers
    """
    # step 1: generate query variants
    variants = generate_query_variants(query, n=n_variants)

    # step 2: retrieve candidates for each variant
    per_variant_results = retrieve_per_variant(
        variants,
        candidates_per_variant=candidates_per_variant,
        where=where,
    )

    # step 3: merge with RRF
    fused_results = reciprocal_rank_fusion(
        per_variant_results,
        top_n=top_n,
    )

    return {
        "query": query,
        "variants": variants,
        "results": fused_results,
    }


def print_results(output: dict) -> None:
    print(f"\n{'='*70}")
    print(f"Query: {output['query']}")
    print(f"\nQuery variants ({len(output['variants'])}):")
    for i, v in enumerate(output["variants"]):
        label = "(original)" if i == 0 else f"(variant {i})"
        print(f"  {i+1}. {v}  {label}")
    print(f"\nTop {len(output['results'])} papers after RRF merge:")
    for i, r in enumerate(output["results"], 1):
        print(f"\n  [{i}] {r['title']}")
        print(f"       RRF: {r['rrf_score']}  |  appeared in {r['appeared_in_variants']} variants")
        print(f"       Best similarity: {r['best_similarity']}  |  Categories: {r['categories']}")
        print(f"       Abstract: {r['abstract'][:120]}...")


# ── example usage ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    queries = [
        "efficient attention mechanisms for long sequences",
        "graph neural networks for molecular property prediction",
        "continual learning without forgetting",
    ]

    for query in queries:
        output = rag_fusion_retrieve(
            query,
            n_variants=4,
            candidates_per_variant=50,
            top_n=5,
        )
        print_results(output)
        print()