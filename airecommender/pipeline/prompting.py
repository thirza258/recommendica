"""
Prompt construction for the answer-generation step.

Retrieved documents are stored as JSON blobs (``{"title", "category",
"summary", "authors"}``).  Feeding the raw JSON to the model wastes input
tokens on braces and key names, and an unusually long record can dominate a
chunk's context window.  Rendering the fields as plain labelled text and
capping each record keeps time-to-first-token down and the cost predictable.

Pure functions only — no clients, no settings read at import time.
"""

from __future__ import annotations

import json
from typing import Optional

#: Default per-document budget in characters.  A typical arxiv abstract is
#: ~1000–1500 characters, so this trims outliers without touching normal ones.
DEFAULT_MAX_DOC_CHARS = 1500

SYSTEM_PROMPT = (
    "You are a research assistant helping a user understand academic papers. "
    "Answer the user's query using ONLY the provided research documents. "
    "Cite specific papers by title or content when relevant. "
    "If the documents do not contain enough information to fully answer, "
    "say so clearly, then give the best partial answer you can. "
    "Be thorough but concise."
)


def truncate(text: str, max_chars: int) -> str:
    """Trim *text* to *max_chars*, preferring a word boundary."""
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    boundary = cut.rfind(" ")
    if boundary > max_chars * 0.6:
        cut = cut[:boundary]
    return cut.rstrip() + " …[truncated]"


def format_document(doc_text: str, max_chars: int = DEFAULT_MAX_DOC_CHARS) -> str:
    """
    Render one retrieved document as compact labelled text.

    Falls back to truncated raw text when the document is not the expected JSON
    record, so plain-text collections still work.
    """
    try:
        record = json.loads(doc_text)
    except (json.JSONDecodeError, TypeError):
        record = None

    if not isinstance(record, dict):
        return truncate(doc_text, max_chars)

    lines = []
    for label, field in (
        ("Title", "title"),
        ("Category", "category"),
        ("Authors", "authors"),
    ):
        value = record.get(field)
        if value:
            lines.append(f"{label}: {truncate(str(value).strip(), 300)}")

    summary = record.get("summary") or record.get("abstract")
    if summary:
        # The summary gets whatever budget is left after the metadata lines.
        used = sum(len(line) + 1 for line in lines)
        lines.append(f"Abstract: {truncate(str(summary).strip(), max(200, max_chars - used))}")

    if not lines:
        return truncate(doc_text, max_chars)

    return "\n".join(lines)


#: Per-candidate budget when the relevance agent grades a batch of papers.
#: Grading only needs the title, category and enough abstract to judge topic —
#: 20 candidates of untruncated JSON would be a large, wasteful input.
DEFAULT_MAX_CANDIDATE_CHARS = 400


def format_candidate(doc_text: str, max_chars: int = DEFAULT_MAX_CANDIDATE_CHARS) -> str:
    """Render one retrieved document compactly, for relevance grading."""
    try:
        record = json.loads(doc_text)
    except (json.JSONDecodeError, TypeError):
        record = None

    if not isinstance(record, dict):
        return truncate(" ".join(str(doc_text).split()), max_chars)

    title = str(record.get("title") or "").strip()
    category = str(record.get("category") or "").strip()
    summary = str(record.get("summary") or record.get("abstract") or "").strip()

    head = title or "(untitled)"
    if category:
        head = f"{head} [{category}]"

    remaining = max(80, max_chars - len(head))
    if summary:
        return f"{head} — {truncate(' '.join(summary.split()), remaining)}"
    return head


def build_chunk_prompt(
    query: str,
    chunk: list[dict],
    chunk_index: int,
    max_doc_chars: Optional[int] = None,
) -> tuple[str, str]:
    """
    Build the (system, user) prompt pair for one chunk of documents.

    *chunk* is a list of ``{"document": str, "meta": dict}`` entries.
    """
    budget = DEFAULT_MAX_DOC_CHARS if max_doc_chars is None else max_doc_chars

    entries = []
    for position, doc in enumerate(chunk, start=1):
        body = format_document(doc.get("document", ""), budget)
        entries.append(f"--- Document {position} ---\n{body}\n")

    context = "\n".join(entries)

    user_prompt = (
        f"User query: {query}\n\n"
        f"Research documents (chunk {chunk_index}):\n"
        f"{context}\n\n"
        f"Please provide a comprehensive answer grounded in these documents."
    )
    return SYSTEM_PROMPT, user_prompt
