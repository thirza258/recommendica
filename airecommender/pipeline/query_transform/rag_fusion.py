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
def generate_query_variants(
    query: str,
    n: int | None = None,
    llm_service: "OpenRouterService | None" = None,
    model: str | None = None,
) -> list[str]:
    """
    Generate N query variants from a single user query.

    Always includes the original query as the first entry so we never
    lose its signal, then appends LLM-generated variants.

    Pass an existing *llm_service* instance to reuse a cached client
    (e.g. from RAGIndex).  When omitted a module-level lazy singleton
    is used instead.
    Use *n* and *model* to override the defaults from settings.
    """
    effective_n = n if n is not None else settings.RAG_FUSION_N_VARIANTS

    if llm_service is None:
        llm_service = _get_llm()

    try:
        response = llm_service.generate_response(
            prompt=f"Original query: {query}",
            model=model or settings.RAG_FUSION_MODEL,
            system_instruction_string=FUSION_SYSTEM.format(n=effective_n),
            response_mime_type_param="application/json",
        )
    except Exception as exc:
        logger.error(f"[RAG Fusion] LLM call failed: {exc}")
        return [query]

    # Clean up the response and parse JSON
    text = response.strip()
    text = text.replace("```json", "").replace("```", "").strip()

    try:
        variants = json.loads(text)
        if not isinstance(variants, list):
            raise ValueError("not a list")
    except (json.JSONDecodeError, ValueError):
        logger.warning("[RAG Fusion] Failed to parse variants; falling back to original query only")
        variants = []

    # always keep original query, deduplicate
    all_queries = [query] + [v for v in variants if v != query]
    return all_queries[: effective_n + 1]  # original + n variants
