"""
Checks at the pipeline's two boundaries.

:mod:`query_check` runs *before* any work is done: an input that cannot be
answered by searching a paper corpus ("hi", a 4000-character paste, a request
with no topic in it) otherwise costs three query-transform calls, a retrieval
round trip, a grading call and a generation call before producing an answer
built from whatever the embedding happened to match.

:mod:`result_check` runs *after* documents are selected and before they are
answered from, and reports what the selection actually consists of — how many
papers, where they came from, how confident retrieval was, how much of the
query they cover.

Both are advisory in opposite directions.  The query check may stop the
pipeline, but only on a clear verdict, and it fails open: a checker that is
down must never block a legitimate question.  The result check never stops
anything — it is deterministic reporting, so the caller (and the user) can see
the basis of an answer instead of inferring it.
"""

from airecommender.pipeline.verification.query_check import (
    CheckStatus,
    QueryVerdict,
    verify_query,
)
from airecommender.pipeline.verification.result_check import verify_results

__all__ = [
    "CheckStatus",
    "QueryVerdict",
    "verify_query",
    "verify_results",
]
