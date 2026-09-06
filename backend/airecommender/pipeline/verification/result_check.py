"""
Result verification: what is this answer actually going to be built on?

By the time documents reach generation they have survived retrieval, fusion and
relevance grading — but the user sees only the answer, and "here are five
papers" reads identically whether those five were near-perfect vector matches
from the indexed corpus or the leftovers of a live search that barely cleared
the relevance bar.

This module states the basis of the answer, in numbers, before the answer
exists: how many papers, where they came from, how confident retrieval was, and
how much of the query's vocabulary they actually cover.

Deliberately **deterministic and free**.  Two LLM checks already exist on
either side of this point — relevance grading scores every paper against the
query, and answer evaluation audits each answer against its sources — so a
third model opinion here would be the grader's question asked again with less
information, on the critical path.  Everything below is arithmetic over
signals the pipeline already computed, which also means it cannot fail open
into a wrong reassurance.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from airecommender.pipeline.evaluation import ConfidenceGate

logger = logging.getLogger(__name__)

#: Source label used for anything that came out of the indexed vector store.
LOCAL_SOURCE = "collection"


def _sources(candidates: Sequence[dict]) -> dict[str, int]:
    """Count selected documents by where they came from."""
    counts: dict[str, int] = {}
    for candidate in candidates:
        meta = candidate.get("meta") or {}
        source = str(meta.get("source") or candidate.get("source") or LOCAL_SOURCE)
        counts[source] = counts.get(source, 0) + 1
    return counts


def _distances(candidates: Sequence[dict]) -> list[float]:
    """
    Vector distances of the documents that have one, best first.

    Live-source results never do — nothing was embedded — so confidence is
    reported over the local documents only, rather than being diluted by
    entries that have no distance to contribute.
    """
    distances = [
        float(candidate["distance"])
        for candidate in candidates
        if candidate.get("distance") is not None
    ]
    return sorted(distances)


def verify_results(
    query: str,
    candidates: Sequence[dict],
    *,
    agent_result=None,
    min_relevant: int = 3,
    confidence_threshold: Optional[float] = None,
) -> dict:
    """
    Describe the document set an answer is about to be generated from.

    *candidates* must be the unstripped candidates (retrieval scores still
    attached); this is why the check runs before the documents are reduced to
    the wire shape.  Never raises — a verification step that can break the
    request it is verifying is worse than no verification.
    """
    try:
        return _report(
            query, candidates, agent_result, min_relevant, confidence_threshold
        )
    except Exception as exc:  # noqa: BLE001 — reporting must not break answering
        logger.exception("[RESULT-CHECK] Report failed: %s", exc)
        return {"docs": len(candidates), "error": f"{type(exc).__name__}: {exc}"}


def _report(
    query: str,
    candidates: Sequence[dict],
    agent_result,
    min_relevant: int,
    confidence_threshold: Optional[float],
) -> dict:
    documents = [candidate.get("document", "") for candidate in candidates]
    sources = _sources(candidates)
    distances = _distances(candidates)

    gate = ConfidenceGate(threshold=confidence_threshold)
    confidence = (
        gate.compute_score(query, documents, distances) if documents and distances else None
    )
    coverage = round(ConfidenceGate._keyword_overlap(query, documents), 4) if documents else 0.0

    report = {
        "docs": len(candidates),
        "sources": sources,
        "min_relevant": min_relevant,
        "min_relevant_met": len(candidates) >= min_relevant,
        # None when nothing carried a vector distance — a live-source-only
        # answer, or a backend that did not report distances. Reported as
        # unknown rather than as zero, which would read as "no confidence".
        "retrieval_confidence": confidence,
        "confidence_threshold": gate.threshold,
        "query_term_coverage": coverage,
        "warnings": [],
    }

    if agent_result is not None:
        report["agent_outcome"] = getattr(
            getattr(agent_result, "outcome", None), "value", None
        )
        report["graded"] = bool(getattr(agent_result, "filtered", False))
        report["rejected"] = int(getattr(agent_result, "rejected", 0) or 0)
        if getattr(agent_result, "fallback_used", False):
            report["fallback_used"] = True
            report["fallback_kept"] = int(getattr(agent_result, "fallback_kept", 0) or 0)
            # Present only when the live source was consulted and did not
            # answer, so a thin result set can be read as "arXiv was down"
            # rather than "arXiv had nothing".
            fallback_error = getattr(agent_result, "fallback_error", None)
            if fallback_error:
                report["fallback_error"] = str(fallback_error)

    report["warnings"] = _warnings(report)
    logger.info(
        "[RESULT-CHECK] %s doc(s) from %s | confidence=%s coverage=%.2f warnings=%s",
        report["docs"],
        report["sources"],
        report["retrieval_confidence"],
        report["query_term_coverage"],
        len(report["warnings"]),
    )
    return report


def _warnings(report: dict) -> list[str]:
    """The parts of the report a user would want said out loud."""
    warnings = []

    docs = report["docs"]
    if docs == 0:
        warnings.append("No papers were selected for this query.")
        return warnings

    if not report["min_relevant_met"]:
        warnings.append(
            f"Only {docs} paper{'s' if docs != 1 else ''} cleared the relevance "
            f"bar; {report['min_relevant']} were wanted."
        )

    confidence = report["retrieval_confidence"]
    if confidence is not None and confidence < report["confidence_threshold"]:
        warnings.append(
            f"Retrieval confidence is {confidence:.2f}, below the "
            f"{report['confidence_threshold']:.2f} the collection usually "
            f"reaches for a well-covered topic."
        )

    if report["query_term_coverage"] < 0.5:
        warnings.append(
            f"The selected papers use only "
            f"{report['query_term_coverage'] * 100:.0f}% of the query's terms, "
            f"so they may address it indirectly."
        )

    live = sum(count for source, count in report["sources"].items() if source != LOCAL_SOURCE)
    if live and live >= docs / 2:
        warnings.append(
            f"{live} of {docs} papers came from a live arXiv search rather than "
            f"the indexed collection."
        )

    if not report.get("graded", True):
        warnings.append(
            "Papers were ranked by retrieval score only — the relevance check "
            "did not run."
        )

    if report.get("fallback_error"):
        warnings.append(
            "arXiv could not be reached, so these papers come from the indexed "
            "collection alone."
        )

    return warnings
