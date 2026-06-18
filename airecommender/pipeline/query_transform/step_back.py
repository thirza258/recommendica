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

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING
from django.conf import settings

if TYPE_CHECKING:
    from airecommender.pipeline.llm_service import OpenRouterService

logger = logging.getLogger(__name__)

# ── lazy singleton ─────────────────────────────────────────────────────────────
_llm_service: "OpenRouterService | None" = None


def _get_llm():
    """Return the module-level cached OpenRouterService, creating it on first use."""
    global _llm_service
    if _llm_service is None:
        from airecommender.pipeline.llm_service import OpenRouterService

        _llm_service = OpenRouterService()
    return _llm_service


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
def step_back(
    query: str,
    llm_service: "OpenRouterService | None" = None,
    model: str | None = None,
) -> dict:
    """
    Abstract the user query and extract arxiv category hints.

    Pass an existing *llm_service* instance to reuse a cached client
    (e.g. from RAGIndex).  When omitted a module-level lazy singleton
    is used instead.
    Use *model* to override the default step-back model from settings.

    Returns:
        {
            abstracted_query: str,
            categories: list[str],
            confidence: "high" | "medium" | "low",
            reasoning: str
        }
    """
    if llm_service is None:
        llm_service = _get_llm()

    try:
        response = llm_service.generate_response(
            prompt=f"User query: {query}",
            model=model or settings.STEP_BACK_MODEL,
            system_instruction_string=STEP_BACK_SYSTEM,
            response_mime_type_param="application/json",
        )
    except Exception as exc:
        logger.error(f"[Step-back] LLM call failed: {exc}")
        return {
            "abstracted_query": query,
            "categories": [],
            "confidence": "low",
            "reasoning": f"LLM error — falling back: {exc}",
        }

    # Clean up the response and parse JSON
    text = response.strip()
    text = text.replace("```json", "").replace("```", "").strip()

    try:
        result = json.loads(text)
        # validate required keys
        assert "abstracted_query" in result
        assert "categories" in result
        assert "confidence" in result
    except (json.JSONDecodeError, AssertionError, KeyError) as exc:
        logger.warning(f"[Step-back] Parse error: {exc}; falling back")
        # safe fallback — no category filter, use query as-is
        result = {
            "abstracted_query": query,
            "categories": [],
            "confidence": "low",
            "reasoning": "parse error — falling back to no category filter",
        }

    return result
