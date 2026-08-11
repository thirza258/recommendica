"""
Answer grounding: is the generated answer actually supported by the papers?

Relevance grading (see :mod:`grading`) asks whether the *retrieved papers* fit
the query.  This asks the complementary question about the *generated text* —
each claim in the answer is checked against the documents that chunk was built
from, producing the ``faithfulness_score`` and per-claim verdicts the UI
already knows how to render.

Off by default (``ENABLE_ANSWER_EVALUATION``): it costs one extra LLM call per
chunk and it lands on the critical path, since a chunk's ``chunk_end`` event
carries its evaluation.  Relevance filtering is what keeps answers on topic;
this measures how well an answer sticks to its sources.

Output shape matches the frontend's ``ChunkEval`` type exactly.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from airecommender.pipeline.agent.parsing import as_list, extract_json
from airecommender.pipeline.prompting import format_candidate

logger = logging.getLogger(__name__)

SUPPORTED = "YES"
UNSUPPORTED = "NO"
PARTIAL = "PARTIALLY"
UNKNOWN = "UNKNOWN"

_VERDICTS = {SUPPORTED, UNSUPPORTED, PARTIAL, UNKNOWN}

#: A partially supported claim counts as half credit.
_WEIGHTS = {SUPPORTED: 1.0, PARTIAL: 0.5, UNSUPPORTED: 0.0, UNKNOWN: 0.0}

FAITHFULNESS_SYSTEM = """You audit whether an AI answer is supported by its source papers.

Steps:
1. Split the answer into its distinct factual claims (at most 8, the most
   substantive ones).
2. For each claim, decide whether the provided papers support it:
   "YES"       — directly stated or clearly implied by a paper
   "PARTIALLY" — partly supported, or supported with different scope
   "NO"        — contradicted by, or absent from, the papers
   "UNKNOWN"   — the claim is not checkable against these papers

Judge only against the papers given. Outside knowledge does not count as support.

Respond with ONLY this JSON, no preamble:
{"claims": [{"claim": "the claim, under 20 words", "verdict": "YES"}]}
"""

MAX_ANSWER_CHARS = 4000
MAX_CLAIMS = 12


def build_evaluation_prompt(
    query: str,
    answer: str,
    docs: Sequence[dict],
    max_doc_chars: int = 400,
) -> str:
    """Build the grounding-check prompt for one chunk."""
    sources = []
    for position, doc in enumerate(docs, start=1):
        sources.append(
            f"{position}. {format_candidate(doc.get('document', ''), max_doc_chars)}"
        )

    trimmed_answer = answer if len(answer) <= MAX_ANSWER_CHARS else (
        answer[:MAX_ANSWER_CHARS] + " …[truncated]"
    )

    return (
        f"User query: {query}\n\n"
        f"Source papers:\n" + "\n".join(sources) + "\n\n"
        f"AI answer to audit:\n{trimmed_answer}\n\n"
        f"Extract the claims and judge each against the source papers."
    )


def normalize_verdict(value) -> str:
    """Map a model verdict onto YES / NO / PARTIALLY / UNKNOWN."""
    if isinstance(value, bool):
        return SUPPORTED if value else UNSUPPORTED

    text = str(value or "").strip().upper()
    if text in _VERDICTS:
        return text
    if text.startswith("PART"):
        return PARTIAL
    if text in {"TRUE", "SUPPORTED", "Y"}:
        return SUPPORTED
    if text in {"FALSE", "UNSUPPORTED", "N", "CONTRADICTED"}:
        return UNSUPPORTED
    return UNKNOWN


def parse_evaluation(raw_text: str) -> Optional[dict]:
    """
    Parse a grounding response into the frontend's ``ChunkEval`` shape.

    Returns ``None`` when the response is unusable, so the caller can report a
    missing score instead of inventing one.
    """
    payload = extract_json(raw_text)
    entries = as_list(payload, "claims", "results", "verdicts")
    if entries is None:
        return None

    claims = []
    for entry in entries[:MAX_CLAIMS]:
        if isinstance(entry, dict):
            text = str(entry.get("claim", entry.get("text", ""))).strip()
            verdict = normalize_verdict(
                entry.get("verdict", entry.get("supported", entry.get("v")))
            )
        elif isinstance(entry, str):
            text, verdict = entry.strip(), UNKNOWN
        else:
            continue

        if not text:
            continue
        claims.append(
            {
                "claim": text[:400],
                "verdict": verdict,
                "supported": verdict == SUPPORTED,
            }
        )

    if not claims:
        return None

    weighted = sum(_WEIGHTS[claim["verdict"]] for claim in claims)
    return {
        "faithfulness_score": round(weighted / len(claims), 4),
        "total_claims": len(claims),
        "supported_claims": sum(1 for claim in claims if claim["supported"]),
        "claims": claims,
    }


def evaluate_answer(
    query: str,
    answer: str,
    docs: Sequence[dict],
    llm_service,
    *,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
    max_doc_chars: int = 400,
) -> dict:
    """
    Audit *answer* against *docs*.

    Never raises — an unavailable evaluator yields
    ``{"faithfulness_score": None, "error": ...}``, which the UI renders as
    "—" rather than as a bad score.
    """
    if not answer.strip() or not docs:
        return {
            "faithfulness_score": None,
            "reason": "nothing to evaluate",
        }

    prompt = build_evaluation_prompt(query, answer, docs, max_doc_chars)

    try:
        raw = llm_service.generate_response(
            prompt=prompt,
            model=model,
            system_instruction_string=FAITHFULNESS_SYSTEM,
            response_mime_type_param="application/json",
            timeout=timeout,
            max_retries=0,
        )
    except Exception as exc:
        logger.error("[EVAL] Faithfulness call failed: %s", exc)
        return {
            "faithfulness_score": None,
            "error": f"{type(exc).__name__}: {exc}",
        }

    evaluation = parse_evaluation(raw)
    if evaluation is None:
        logger.warning(
            "[EVAL] Faithfulness response was unparseable (len=%s)", len(raw or "")
        )
        return {
            "faithfulness_score": None,
            "error": "evaluator response was not valid JSON",
        }

    return evaluation


def aggregate_faithfulness(evaluations: Sequence[Optional[dict]]) -> Optional[float]:
    """Mean faithfulness across chunks, ignoring chunks that could not be scored."""
    scores = [
        evaluation["faithfulness_score"]
        for evaluation in evaluations
        if isinstance(evaluation, dict)
        and isinstance(evaluation.get("faithfulness_score"), (int, float))
    ]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 4)
