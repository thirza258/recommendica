"""
Hypothetical Document Embeddings (HyDE) for arxiv paper search.

Flow:
  user query
      → LLM generates a fake arxiv abstract (the "hypothetical doc")
      → embed the fake abstract (instead of raw query)
      → retrieve from ChromaDB using that embedding
      → rerank + return results

Why: raw queries ("faster transformers") are short and vague.
     Hypothetical abstracts look like real papers and land closer
     to actual paper embeddings in vector space.

Paper: Gao et al. 2022 — arXiv:2212.10496
"""

from __future__ import annotations

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
HYDE_SYSTEM = """You are a researcher writing arxiv paper abstracts.

Given a user's search query, write a single hypothetical arxiv abstract
that would perfectly answer what the user is looking for.

Rules:
- Write ONLY the abstract text, no title, no authors, no preamble
- Match the style and density of real arxiv abstracts
- Include specific technical terms, methods, and results the paper would contain
- Length: 80–150 words
- Do not start with "Abstract:" or any label
"""


# ── core functions ─────────────────────────────────────────────────────────────
def generate_hypothetical_abstract(
    query: str,
    llm_service: "OpenRouterService | None" = None,
    model: str | None = None,
) -> str:
    """
    Ask the LLM to write a fake abstract that answers the query.

    Pass an existing *llm_service* instance to reuse a cached client
    (e.g. from RAGIndex).  When omitted a module-level lazy singleton
    is used instead.
    Use *model* to override the default HyDE model from settings.
    """
    if llm_service is None:
        llm_service = _get_llm()

    try:
        response = llm_service.generate_response(
            prompt=query,
            model=model or settings.HYDE_MODEL,
            system_instruction_string=HYDE_SYSTEM,
            response_mime_type_param="text/plain",
        )
        return response
    except Exception as exc:
        logger.error(f"[HyDE] Failed to generate hypothetical abstract: {exc}")
        return ""
