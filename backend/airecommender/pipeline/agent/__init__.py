"""
Agentic layer over retrieval.

``RelevanceAgent`` turns one-shot retrieval into an observe → decide → act loop:
grade every retrieved paper against the user's question, drop the unrelated
ones, and — when too few survive — rewrite the query using the rejection
reasons and search again.  See :mod:`airecommender.pipeline.agent.loop`.
"""

from airecommender.pipeline.agent.faithfulness import (
    aggregate_faithfulness,
    evaluate_answer,
)
from airecommender.pipeline.agent.grading import (
    DocGrade,
    GradeStatus,
    GradingResult,
    grade_candidates,
)
from airecommender.pipeline.agent.loop import (
    AgentEvent,
    AgentOutcome,
    AgentResult,
    RelevanceAgent,
    run_to_completion,
)
from airecommender.pipeline.agent.refine import refine_query

__all__ = [
    "AgentEvent",
    "AgentOutcome",
    "AgentResult",
    "DocGrade",
    "GradeStatus",
    "GradingResult",
    "RelevanceAgent",
    "aggregate_faithfulness",
    "evaluate_answer",
    "grade_candidates",
    "refine_query",
    "run_to_completion",
]
