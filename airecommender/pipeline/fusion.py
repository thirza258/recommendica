"""
Rank fusion for multi-query retrieval.

Reciprocal Rank Fusion (RRF) merges the ranked result lists produced by each
query variant into one consensus ranking:

    score(doc) = Σ  1 / (k + rank_in_list)
                lists containing doc

A document that appears near the top of *several* variants outranks one that a
single variant loved.  That is the property the RAG-fusion / step-back
docstrings describe, and it is what lets us cap the number of documents handed
to the LLM without losing the good ones — which is where most of the pipeline's
wall-clock time is spent.

Everything here is a pure function: no network, no clients, no Django settings
read at import time, so it is unit-testable on its own.

RRF: Cormack et al. 2009 — "Reciprocal Rank Fusion outperforms Condorcet".
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

#: Standard RRF damping constant from the paper.  Larger k flattens the
#: contribution of top ranks, making consensus matter more than any single
#: list's ordering.
RRF_DEFAULT_K = 60


def _default_key(candidate: dict) -> str:
    """Identify a candidate by its document text."""
    return candidate.get("document", "")


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[dict]],
    *,
    k: int = RRF_DEFAULT_K,
    key: Optional[Callable[[dict], Any]] = None,
    limit: Optional[int] = None,
) -> list[dict]:
    """
    Merge *ranked_lists* into a single consensus ranking.

    Parameters
    ----------
    ranked_lists:
        One ranked list per query variant, best match first.  Each candidate is
        a dict shaped like ``{"document": str, "meta": dict, ...}``.
    k:
        RRF damping constant.
    key:
        Identity function used to recognise the same document across lists.
        Defaults to the document text.
    limit:
        Keep at most this many fused candidates.

    Returns
    -------
    list[dict]
        Copies of the winning candidates, best first, each annotated with:

        ``rrf_score``    the fused score
        ``rrf_best_rank`` best 1-based rank the document achieved anywhere
        ``rrf_sources``  how many variant lists retrieved it

    Ordering is fully deterministic: score desc, then best rank asc, then order
    of first appearance — so identical inputs always produce identical output.
    """
    identity = key or _default_key

    merged: dict[Any, dict] = {}
    scores: dict[Any, float] = {}
    best_rank: dict[Any, int] = {}
    sources: dict[Any, int] = {}
    first_seen: dict[Any, int] = {}
    order = 0

    for ranked in ranked_lists:
        for rank, candidate in enumerate(ranked, start=1):
            doc_id = identity(candidate)
            if doc_id is None or doc_id == "":
                continue

            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            sources[doc_id] = sources.get(doc_id, 0) + 1

            if doc_id not in merged:
                merged[doc_id] = dict(candidate)
                best_rank[doc_id] = rank
                first_seen[doc_id] = order
                order += 1
            else:
                best_rank[doc_id] = min(best_rank[doc_id], rank)
                # Keep the best dense score seen for this document.
                incoming = candidate.get("dense_score")
                current = merged[doc_id].get("dense_score")
                if incoming is not None and (current is None or incoming > current):
                    merged[doc_id]["dense_score"] = incoming

    fused = []
    for doc_id, candidate in merged.items():
        candidate["rrf_score"] = round(scores[doc_id], 6)
        candidate["rrf_best_rank"] = best_rank[doc_id]
        candidate["rrf_sources"] = sources[doc_id]
        fused.append((doc_id, candidate))

    fused.sort(
        key=lambda pair: (
            -pair[1]["rrf_score"],
            pair[1]["rrf_best_rank"],
            first_seen[pair[0]],
        )
    )

    result = [candidate for _, candidate in fused]
    if limit is not None:
        result = result[:limit]
    return result
