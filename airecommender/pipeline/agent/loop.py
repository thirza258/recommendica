"""
The relevance agent: an observe → decide → act loop around retrieval.

Plain RAG retrieves once and hands whatever came back to the model, so an
off-topic collection or an awkwardly worded question produces a confident answer
built on unrelated papers.  This agent closes that loop:

    retrieve  →  grade each paper against the user's real question
              →  keep the related ones
              →  if that is not enough, ask *why* they were rejected,
                 rewrite the query with those reasons, and search again
              →  stop when enough related papers are found, the attempt budget
                 is spent, or the wall-clock deadline is reached

Related papers accumulate across rounds, so a second search adds to the first
rather than replacing it.

The three side-effecting steps are injected (``retrieve_fn``, ``grade_fn``,
``refine_fn``), so the decision logic is testable with no ChromaDB, no Ollama
and no API key.  Nothing here raises: every failure path resolves to an outcome
the caller can report.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Iterator, Optional, Sequence

from airecommender.pipeline.agent.grading import (
    UNRELATED,
    DocGrade,
    GradeStatus,
    GradingResult,
)

logger = logging.getLogger(__name__)


class AgentOutcome(str, Enum):
    """Why the agent stopped — each maps to a different thing to tell the user."""

    ACCEPTED = "accepted"                      # related papers found
    NO_CANDIDATES = "no_candidates"            # retrieval returned nothing at all
    NO_RELEVANT = "no_relevant"                # papers found, none on topic
    GRADER_UNAVAILABLE = "grader_unavailable"  # could not judge; returned unfiltered
    CANCELLED = "cancelled"                    # client went away


@dataclass
class AgentEvent:
    """Progress signal from the loop; the API layer renders these to SSE."""

    status: str
    message: str
    data: dict = field(default_factory=dict)


@dataclass
class AgentResult:
    docs: list[dict] = field(default_factory=list)
    outcome: AgentOutcome = AgentOutcome.ACCEPTED
    iterations: int = 0
    queries_tried: list[str] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)
    grader_status: GradeStatus = GradeStatus.GRADED
    kept: int = 0
    rejected: int = 0
    deadline_hit: bool = False
    notice: Optional[str] = None

    @property
    def filtered(self) -> bool:
        """True when verdicts were actually used to reject papers."""
        return self.grader_status.is_trustworthy


RetrieveFn = Callable[[Sequence[str]], Sequence[dict]]
GradeFn = Callable[[str, Sequence[dict]], GradingResult]
RefineFn = Callable[[str, str, Sequence[str]], Optional[str]]


class RelevanceAgent:
    """Bounded retrieve-grade-refine loop over a retrieval backend."""

    def __init__(
        self,
        retrieve_fn: RetrieveFn,
        grade_fn: GradeFn,
        refine_fn: RefineFn,
        *,
        min_relevant: int = 3,
        max_iterations: int = 2,
        threshold: float = 0.5,
        max_docs: int = 12,
        deadline_seconds: float = 90.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.retrieve_fn = retrieve_fn
        self.grade_fn = grade_fn
        self.refine_fn = refine_fn
        self.min_relevant = max(1, min_relevant)
        self.max_iterations = max(1, max_iterations)
        self.threshold = threshold
        self.max_docs = max(1, max_docs)
        self.deadline_seconds = deadline_seconds
        self.clock = clock

    # ── Selection helpers ────────────────────────────────────────────────────

    def _split_by_verdict(
        self, candidates: Sequence[dict], grades: Sequence[DocGrade]
    ) -> tuple[list[tuple[dict, DocGrade]], list[tuple[dict, DocGrade]]]:
        """Partition candidates into (kept, rejected), best first."""
        kept: list[tuple[dict, DocGrade]] = []
        rejected: list[tuple[dict, DocGrade]] = []

        for grade in sorted(grades, key=lambda g: g.rank_key):
            if not 0 <= grade.index < len(candidates):
                continue
            candidate = candidates[grade.index]
            if grade.verdict == UNRELATED or grade.score < self.threshold:
                rejected.append((candidate, grade))
            else:
                kept.append((candidate, grade))

        return kept, rejected

    @staticmethod
    def _rank_only(
        candidates: Sequence[dict], grades: Sequence[DocGrade]
    ) -> list[dict]:
        """Order candidates by grade without rejecting any of them."""
        if not grades:
            return list(candidates)
        ordered = []
        for grade in sorted(grades, key=lambda g: g.rank_key):
            if 0 <= grade.index < len(candidates):
                ordered.append(candidates[grade.index])
        # Anything the grader never mentioned keeps its retrieval order.
        seen = {id(doc) for doc in ordered}
        ordered.extend(doc for doc in candidates if id(doc) not in seen)
        return ordered

    # ── Main loop ────────────────────────────────────────────────────────────

    def run(
        self,
        query: str,
        queries: Optional[Sequence[str]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> Iterator[AgentEvent]:
        """
        Run the loop, yielding :class:`AgentEvent` progress signals.

        Returns an :class:`AgentResult` as the generator's return value, so
        callers use ``result = yield from agent.run(...)`` (or
        :func:`run_to_completion`).
        """
        started = self.clock()

        def cancelled() -> bool:
            return cancel_event is not None and cancel_event.is_set()

        def out_of_time() -> bool:
            return (self.clock() - started) >= self.deadline_seconds

        # Related papers accumulate across rounds: a refined search adds to
        # what the first one found instead of discarding it.
        pool: dict[str, tuple[DocGrade, dict]] = {}
        trace: list[dict] = []
        queries_tried: list[str] = []
        primary_query = query
        search_queries = list(queries or [query])
        grader_status = GradeStatus.GRADED
        total_rejected = 0
        deadline_hit = False
        saw_candidates = False
        iteration = 0

        while iteration < self.max_iterations:
            iteration += 1
            grading: Optional[GradingResult] = None

            if cancelled():
                return AgentResult(
                    docs=self._pool_docs(pool),
                    outcome=AgentOutcome.CANCELLED,
                    iterations=iteration - 1,
                    queries_tried=queries_tried,
                    trace=trace,
                    grader_status=grader_status,
                )

            queries_tried.append(primary_query)

            yield AgentEvent(
                "searching",
                (
                    f"Searching for candidate papers (attempt {iteration}"
                    f" of {self.max_iterations})..."
                ),
                {"iteration": iteration, "query": primary_query},
            )

            candidates = list(self.retrieve_fn(search_queries) or [])
            if candidates:
                saw_candidates = True

            if not candidates:
                trace.append(
                    {"iteration": iteration, "query": primary_query, "candidates": 0}
                )
                yield AgentEvent(
                    "empty",
                    "That search returned no candidate papers.",
                    {"iteration": iteration},
                )
            else:
                # Always grade against the *original* question — the refined
                # query is a search tool, not the user's intent.
                grading = self.grade_fn(query, candidates)
                grader_status = grading.status

                if not grading.trustworthy:
                    # Heuristics may rank but must never reject: keyword overlap
                    # would drop relevant papers that use other terminology.
                    logger.error(
                        "[AGENT] Relevance grader unusable (%s: %s) — returning "
                        "unfiltered results for %s candidate(s)",
                        grading.status.value,
                        grading.error,
                        len(candidates),
                    )
                    ranked = self._rank_only(candidates, grading.grades)
                    yield AgentEvent(
                        "grader_unavailable",
                        (
                            "Relevance check unavailable — showing the best "
                            "retrieval matches without filtering."
                        ),
                        {"reason": grading.error, "grader_status": grading.status.value},
                    )
                    return AgentResult(
                        docs=ranked[: self.max_docs],
                        outcome=AgentOutcome.GRADER_UNAVAILABLE,
                        iterations=iteration,
                        queries_tried=queries_tried,
                        trace=trace
                        + [
                            {
                                "iteration": iteration,
                                "query": primary_query,
                                "candidates": len(candidates),
                                "grader": grading.status.value,
                            }
                        ],
                        grader_status=grading.status,
                        kept=min(len(ranked), self.max_docs),
                        notice=(
                            "Papers were ranked by retrieval score only: the "
                            "relevance check could not run."
                        ),
                    )

                kept, rejected = self._split_by_verdict(candidates, grading.grades)
                total_rejected += len(rejected)

                for candidate, grade in kept:
                    key = candidate.get("document", "")
                    existing = pool.get(key)
                    if existing is None or grade.score > existing[0].score:
                        pool[key] = (grade, candidate)

                trace.append(
                    {
                        "iteration": iteration,
                        "query": primary_query,
                        "candidates": len(candidates),
                        "kept": len(kept),
                        "rejected": len(rejected),
                        "pool": len(pool),
                    }
                )

                yield AgentEvent(
                    "graded",
                    (
                        f"Kept {len(kept)} of {len(candidates)} papers as related"
                        f" ({len(pool)} so far)"
                    ),
                    {
                        "iteration": iteration,
                        "kept": len(kept),
                        "rejected": len(rejected),
                        "related_total": len(pool),
                    },
                )

                if len(pool) >= self.min_relevant:
                    break

            # ── Not enough related papers: decide whether to act again ──────
            if iteration >= self.max_iterations:
                break

            if out_of_time():
                deadline_hit = True
                logger.warning(
                    "[AGENT] Deadline of %.0fs reached after %s attempt(s)",
                    self.deadline_seconds,
                    iteration,
                )
                yield AgentEvent(
                    "deadline",
                    "Relevance search deadline reached — using what was found.",
                    {"iteration": iteration},
                )
                break

            if cancelled():
                return AgentResult(
                    docs=self._pool_docs(pool),
                    outcome=AgentOutcome.CANCELLED,
                    iterations=iteration,
                    queries_tried=queries_tried,
                    trace=trace,
                    grader_status=grader_status,
                )

            reasons = (
                self._rejection_reasons(candidates, grading.grades) if grading else []
            )
            refined = self.refine_fn(query, primary_query, reasons)
            if not refined:
                logger.info("[AGENT] No usable refined query — stopping the loop.")
                break

            yield AgentEvent(
                "refining",
                f"Too few related papers — retrying with: {refined}",
                {"iteration": iteration, "refined_query": refined},
            )
            primary_query = refined
            search_queries = [refined]

        docs = self._pool_docs(pool)

        if docs:
            outcome = AgentOutcome.ACCEPTED
            notice = None
            if len(docs) < self.min_relevant:
                notice = (
                    f"Only {len(docs)} clearly related paper"
                    f"{'s' if len(docs) != 1 else ''} were found for this query."
                )
        elif not saw_candidates:
            outcome = AgentOutcome.NO_CANDIDATES
            notice = (
                "No papers matched this query in the collection. Try different "
                "or broader terms."
            )
        else:
            outcome = AgentOutcome.NO_RELEVANT
            notice = (
                f"Found {total_rejected} candidate paper"
                f"{'s' if total_rejected != 1 else ''}, but none were related "
                f"enough to answer this query. Nothing was generated from "
                f"unrelated papers."
            )

        logger.info(
            "[AGENT] Outcome=%s after %s attempt(s) — %s related, %s rejected, "
            "queries=%s",
            outcome.value,
            iteration,
            len(docs),
            total_rejected,
            queries_tried,
        )

        return AgentResult(
            docs=docs,
            outcome=outcome,
            iterations=iteration,
            queries_tried=queries_tried,
            trace=trace,
            grader_status=grader_status,
            kept=len(docs),
            rejected=total_rejected,
            deadline_hit=deadline_hit,
            notice=notice,
        )

    def _pool_docs(self, pool: dict[str, tuple[DocGrade, dict]]) -> list[dict]:
        """Best-first documents from the accumulated pool, capped."""
        ordered = sorted(pool.values(), key=lambda pair: (-pair[0].score, pair[0].index))
        return [candidate for _, candidate in ordered][: self.max_docs]

    @staticmethod
    def _rejection_reasons(
        candidates: Sequence[dict], grades: Sequence[DocGrade]
    ) -> list[str]:
        """Reasons the rejected papers were judged off-topic, best-scoring first."""
        reasons = []
        for grade in sorted(grades, key=lambda g: -g.score):
            if grade.verdict == UNRELATED and grade.reason:
                reasons.append(grade.reason)
        return reasons


def run_to_completion(
    agent: RelevanceAgent,
    query: str,
    queries: Optional[Sequence[str]] = None,
    cancel_event: Optional[threading.Event] = None,
    on_event: Optional[Callable[[AgentEvent], None]] = None,
) -> AgentResult:
    """Drive :meth:`RelevanceAgent.run` without streaming, for non-SSE callers."""
    generator = agent.run(query, queries=queries, cancel_event=cancel_event)
    while True:
        try:
            event = next(generator)
        except StopIteration as stop:
            return stop.value or AgentResult()
        if on_event is not None:
            on_event(event)
