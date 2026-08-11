"""
Relevance grading: does this retrieved paper actually answer the user's query?

Dense retrieval always returns its top-k, however unrelated they are — nothing
in the pipeline ever asked "is this paper on topic?".  The grader is the
agent's observation step: it reads each candidate and returns a verdict, a
score, and a reason.  Unrelated papers are dropped before they reach answer
generation, and the reasons feed the query-refinement step.

Design notes
------------
* One LLM call grades the whole batch. Grading is a cheap, short-output task,
  and per-document calls would multiply latency by the candidate count.
* Candidates are rendered by :func:`prompting.format_candidate` — title,
  category and a short abstract slice, not raw JSON.
* Heuristics **rank**, the LLM **rejects**.  Keyword overlap is substring
  matching, so it would discard relevant papers phrased with different
  terminology — exactly what HyDE and RAG-fusion exist to catch.  If the LLM
  grader is unavailable the caller is told so and nothing is filtered.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Sequence

from airecommender.pipeline.agent.parsing import as_list, clamp_score, extract_json
from airecommender.pipeline.prompting import format_candidate

logger = logging.getLogger(__name__)

RELEVANT = "relevant"
PARTIAL = "partial"
UNRELATED = "unrelated"

_VERDICT_ALIASES = {
    "relevant": RELEVANT,
    "yes": RELEVANT,
    "y": RELEVANT,
    "true": RELEVANT,
    "related": RELEVANT,
    "high": RELEVANT,
    "partial": PARTIAL,
    "partially": PARTIAL,
    "maybe": PARTIAL,
    "somewhat": PARTIAL,
    "medium": PARTIAL,
    "borderline": PARTIAL,
    "unrelated": UNRELATED,
    "no": UNRELATED,
    "n": UNRELATED,
    "false": UNRELATED,
    "irrelevant": UNRELATED,
    "off-topic": UNRELATED,
    "low": UNRELATED,
    "none": UNRELATED,
}

#: Ordering weight so that relevant sorts before partial before unrelated.
_VERDICT_RANK = {RELEVANT: 0, PARTIAL: 1, UNRELATED: 2}


class GradeStatus(str, Enum):
    """How the grades were produced — reported so a broken grader is visible."""

    GRADED = "graded"                    # the LLM graded the batch
    PARSE_FAILED = "parse_failed"        # the LLM answered, unusably
    LLM_UNAVAILABLE = "llm_unavailable"  # the call itself failed

    @property
    def is_trustworthy(self) -> bool:
        """Only a real grading run may be used to reject documents."""
        return self is GradeStatus.GRADED


@dataclass
class DocGrade:
    """A verdict for one candidate document."""

    index: int
    verdict: str = PARTIAL
    score: float = 0.0
    reason: str = ""

    @property
    def rank_key(self) -> tuple:
        return (_VERDICT_RANK.get(self.verdict, 1), -self.score, self.index)


@dataclass
class GradingResult:
    grades: list[DocGrade] = field(default_factory=list)
    status: GradeStatus = GradeStatus.GRADED
    error: Optional[str] = None

    @property
    def trustworthy(self) -> bool:
        return self.status.is_trustworthy


GRADING_SYSTEM = """You judge whether retrieved arxiv papers are relevant to a user's research query.

For EVERY numbered paper, decide:
  "relevant"  — the paper is on-topic and would help answer the query
  "partial"   — related area, but does not directly address the query
  "unrelated" — different topic; would mislead the user

Be strict. A paper that merely shares generic vocabulary with the query is
"unrelated". Judge the subject matter, not the wording.

Respond with ONLY a JSON array, one entry per paper, no preamble:
[{"i": 0, "v": "relevant", "s": 0.9, "r": "reason in under 12 words"}]

  i = the paper's number
  v = "relevant" | "partial" | "unrelated"
  s = confidence that the paper is relevant, 0.0-1.0
  r = a short reason (required for anything not "relevant")
"""


def build_grading_prompt(
    query: str,
    candidates: Sequence[dict],
    max_candidate_chars: int = 400,
) -> str:
    """Build the user prompt listing every candidate to be graded."""
    lines = [f"User query: {query}", "", "Papers:"]
    for index, candidate in enumerate(candidates):
        rendered = format_candidate(candidate.get("document", ""), max_candidate_chars)
        lines.append(f"{index}. {rendered}")
    lines.append("")
    lines.append(
        f"Grade all {len(candidates)} papers. Return exactly "
        f"{len(candidates)} JSON entries."
    )
    return "\n".join(lines)


def normalize_verdict(value, score: Optional[float] = None) -> str:
    """Map a model's verdict wording onto our three verdicts."""
    if isinstance(value, bool):
        return RELEVANT if value else UNRELATED

    text = str(value or "").strip().lower()
    if text in _VERDICT_ALIASES:
        return _VERDICT_ALIASES[text]

    for token in re.split(r"[^a-z-]+", text):
        if token in _VERDICT_ALIASES:
            return _VERDICT_ALIASES[token]

    # No usable verdict: fall back to the score when there is one.
    if score is not None:
        if score >= 0.7:
            return RELEVANT
        if score >= 0.4:
            return PARTIAL
        return UNRELATED
    return PARTIAL


def parse_grades(raw_text: str, expected: int) -> Optional[list[DocGrade]]:
    """
    Parse a grading response into one :class:`DocGrade` per candidate.

    Returns ``None`` when the response cannot be used at all — the caller must
    then treat the batch as ungraded rather than silently dropping documents.
    Entries are matched by their ``i`` field, falling back to positional order
    when the model omits it.  Missing entries default to ``partial`` so an
    incomplete response never rejects a document it failed to mention.
    """
    if expected <= 0:
        return []

    payload = extract_json(raw_text)
    entries = as_list(payload, "grades", "results", "papers", "verdicts")
    if entries is None:
        return None

    by_index: dict[int, DocGrade] = {}
    for position, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue

        raw_index = entry.get("i", entry.get("index", entry.get("id", position)))
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            index = position
        if not 0 <= index < expected or index in by_index:
            continue

        score = clamp_score(
            entry.get("s", entry.get("score", entry.get("relevance", entry.get("confidence")))),
            default=-1.0,
        )
        verdict = normalize_verdict(
            entry.get("v", entry.get("verdict", entry.get("relevance", entry.get("label")))),
            score if score >= 0 else None,
        )
        if score < 0:
            # No score given: derive one from the verdict so ranking still works.
            score = {RELEVANT: 0.9, PARTIAL: 0.5, UNRELATED: 0.05}[verdict]

        reason = str(entry.get("r", entry.get("reason", entry.get("why", ""))) or "").strip()
        by_index[index] = DocGrade(index=index, verdict=verdict, score=score, reason=reason[:200])

    if not by_index:
        return None

    return [
        by_index.get(
            index,
            DocGrade(
                index=index,
                verdict=PARTIAL,
                score=0.5,
                reason="not graded by the model",
            ),
        )
        for index in range(expected)
    ]


def heuristic_grades(query: str, candidates: Sequence[dict]) -> list[DocGrade]:
    """
    Rank-only grades derived from retrieval signals, used when the LLM grader is
    unavailable.  Everything is ``partial``: these signals are good enough to
    order candidates but not to reject them.
    """
    from airecommender.pipeline.evaluation import ConfidenceGate

    grades = []
    for index, candidate in enumerate(candidates):
        overlap = ConfidenceGate._keyword_overlap(query, [candidate.get("document", "")])
        dense = float(candidate.get("dense_score") or 0.0)
        rrf = float(candidate.get("rrf_score") or 0.0)
        # Weighted blend, clamped — ordering matters, absolute value does not.
        score = clamp_score(0.5 * dense + 0.3 * overlap + 20 * rrf, default=0.0)
        grades.append(
            DocGrade(
                index=index,
                verdict=PARTIAL,
                score=score,
                reason="heuristic ranking (relevance grader unavailable)",
            )
        )
    return grades


def grade_candidates(
    query: str,
    candidates: Sequence[dict],
    llm_service,
    *,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
    max_candidate_chars: int = 400,
) -> GradingResult:
    """
    Grade *candidates* for relevance to *query* in a single LLM call.

    Never raises: a grader outage degrades to heuristic ranking with
    ``status`` set so the caller can refuse to filter (and report it).
    """
    if not candidates:
        return GradingResult(grades=[], status=GradeStatus.GRADED)

    prompt = build_grading_prompt(query, candidates, max_candidate_chars)

    try:
        raw = llm_service.generate_response(
            prompt=prompt,
            model=model,
            system_instruction_string=GRADING_SYSTEM,
            response_mime_type_param="application/json",
            timeout=timeout,
            # Bounded like every other in-loop call: the agent has its own
            # wall-clock deadline and must not spend it on retries.
            max_retries=0,
        )
    except Exception as exc:
        logger.error("[AGENT] Relevance grading call failed: %s", exc)
        return GradingResult(
            grades=heuristic_grades(query, candidates),
            status=GradeStatus.LLM_UNAVAILABLE,
            error=f"{type(exc).__name__}: {exc}",
        )

    grades = parse_grades(raw, len(candidates))
    if grades is None:
        logger.error(
            "[AGENT] Relevance grading response was unparseable (len=%s, head=%r)",
            len(raw or ""),
            (raw or "")[:160].replace("\n", " "),
        )
        return GradingResult(
            grades=heuristic_grades(query, candidates),
            status=GradeStatus.PARSE_FAILED,
            error="grader response was not valid JSON",
        )

    return GradingResult(grades=grades, status=GradeStatus.GRADED)
