"""
Query refinement: the agent's action when retrieval came back off-topic.

This is what separates the agent from a filter.  When grading rejects the
candidates, the rejection *reasons* are fed back to the model so the next search
is informed by what went wrong ("returned optimisation theory papers, not
protein folding") rather than being a blind re-roll of the same query.

Pure prompt building + a thin LLM wrapper; failures return ``None`` so the loop
simply stops refining instead of breaking the request.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from airecommender.pipeline.agent.parsing import strip_fences

logger = logging.getLogger(__name__)

REFINE_SYSTEM = """You repair failed academic search queries.

You are given a user's research question, the search query that was used, and
the reasons the retrieved papers were judged off-topic.

Write ONE improved search query that avoids the observed failure:
- Keep the user's actual intent; do not answer the question
- Add the precise technical terms a relevant paper would use
- Drop wording that pulled in the wrong field
- 4-15 words, no quotes, no explanation, no preamble

Output only the query text.
"""

#: Reasons are short; this bounds a pathological one and keeps the prompt small.
MAX_REASON_CHARS = 160
MAX_REASONS = 8


def build_refine_prompt(
    original_query: str,
    attempted_query: str,
    reasons: Sequence[str],
) -> str:
    """Build the refinement prompt from the observed rejection reasons."""
    lines = [
        f"User's research question: {original_query}",
        f"Search query that was used: {attempted_query}",
        "",
        "Why the retrieved papers were rejected:",
    ]

    seen: set[str] = set()
    listed = 0
    for reason in reasons:
        text = " ".join(str(reason or "").split())[:MAX_REASON_CHARS]
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        lines.append(f"- {text}")
        listed += 1
        if listed >= MAX_REASONS:
            break

    if not listed:
        lines.append("- none of the retrieved papers addressed the question")

    lines.append("")
    lines.append("Improved search query:")
    return "\n".join(lines)


def refine_query(
    original_query: str,
    attempted_query: str,
    reasons: Sequence[str],
    llm_service,
    *,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
) -> Optional[str]:
    """
    Ask the model for a better search query, or return ``None``.

    ``None`` means "stop refining": either the call failed or the model gave
    back something unusable or unchanged.
    """
    prompt = build_refine_prompt(original_query, attempted_query, reasons)

    try:
        raw = llm_service.generate_response(
            prompt=prompt,
            model=model,
            system_instruction_string=REFINE_SYSTEM,
            response_mime_type_param="text/plain",
            timeout=timeout,
            max_retries=0,
        )
    except Exception as exc:
        logger.error("[AGENT] Query refinement call failed: %s", exc)
        return None

    return clean_refined_query(raw, {original_query, attempted_query})


def clean_refined_query(raw: str, already_tried: set[str]) -> Optional[str]:
    """Normalise a refined query, rejecting empty/duplicate/degenerate output."""
    text = strip_fences(raw or "")
    # Models sometimes answer with a label or several lines; take the first
    # non-empty line and strip any "Improved query:" style prefix.
    for line in text.splitlines():
        candidate = line.strip().strip('"').strip("'").strip()
        if not candidate:
            continue
        if ":" in candidate[:32]:
            head, _, tail = candidate.partition(":")
            if len(head.split()) <= 4 and tail.strip():
                candidate = tail.strip().strip('"').strip()
        if len(candidate) < 3 or len(candidate.split()) > 40:
            continue
        if candidate.lower() in {q.lower() for q in already_tried}:
            return None
        return candidate
    return None
