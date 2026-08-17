"""
Retrieval sources other than the local vector store.

The pipeline's primary source is the indexed ChromaDB collection.  Anything in
this package is a *fallback*: consulted only when the local collection cannot
supply enough related papers, and always fed through the same relevance grading
as local results, so a live source can never smuggle unverified papers into an
answer.
"""

from airecommender.pipeline.sources.arxiv_api import (
    ArxivClient,
    build_search_query,
    parse_atom_feed,
)

__all__ = [
    "ArxivClient",
    "build_search_query",
    "parse_atom_feed",
]
