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


def extract_paper_fields(doc_or_text, meta: Optional[dict] = None) -> dict:
    """
    Extract title, category, summary, authors, and raw_text from a document.

    Supports:
      - New Chroma schema ("Title: ...\n\nAbstract: ..." + meta)
      - Legacy JSON document string ({"title", "category", "summary", "authors"})
      - Document dict ({"document": str, "meta": dict})
      - Plain text fallback
    """
    if isinstance(doc_or_text, dict):
        item_meta = doc_or_text.get("meta")
        if isinstance(item_meta, dict):
            meta = {**item_meta, **(meta or {})}
        doc_text = str(doc_or_text.get("document", ""))
    else:
        doc_text = str(doc_or_text or "")
        meta = meta or {}

    title = ""
    category = ""
    summary = ""
    authors = ""

    # 1. Try legacy JSON decode on doc_text
    try:
        record = json.loads(doc_text)
        if isinstance(record, dict):
            title = str(record.get("title") or "").strip()
            category = str(record.get("category") or record.get("categories") or "").strip()
            summary = str(record.get("summary") or record.get("abstract") or "").strip()
            authors = str(record.get("authors") or "").strip()
    except (json.JSONDecodeError, TypeError):
        pass

    # 2. Extract from doc_text if formatted as "Title: ...\n\nAbstract: ..."
    if not title and doc_text.startswith("Title:"):
        if "\n\nAbstract:" in doc_text:
            parts = doc_text.split("\n\nAbstract:", 1)
            title = parts[0][len("Title:"):].strip()
            if not summary:
                summary = parts[1].strip()
        elif "\nAbstract:" in doc_text:
            parts = doc_text.split("\nAbstract:", 1)
            title = parts[0][len("Title:"):].strip()
            if not summary:
                summary = parts[1].strip()
        else:
            title = doc_text[len("Title:"):].strip()

    # 3. Fill in from meta
    if isinstance(meta, dict):
        if not title and meta.get("title"):
            title = str(meta["title"]).strip()
        if not summary and (meta.get("abstract") or meta.get("summary")):
            summary = str(meta.get("abstract") or meta.get("summary")).strip()
        if not category and (meta.get("categories") or meta.get("category")):
            category = str(meta.get("categories") or meta.get("category")).strip()
        if not authors:
            if meta.get("authors"):
                authors = str(meta["authors"]).strip()
            elif meta.get("authors_parsed"):
                try:
                    raw_parsed = meta["authors_parsed"]
                    parsed = (
                        json.loads(raw_parsed)
                        if isinstance(raw_parsed, str)
                        else raw_parsed
                    )
                    if isinstance(parsed, list):
                        names = []
                        for item in parsed:
                            if isinstance(item, list):
                                parts = [p for p in item if p]
                                if len(parts) >= 2:
                                    names.append(f"{parts[1]} {parts[0]}")
                                elif len(parts) == 1:
                                    names.append(parts[0])
                            elif isinstance(item, str) and item:
                                names.append(item)
                        if names:
                            authors = ", ".join(names)
                except Exception:
                    pass

    return {
        "title": title,
        "category": category,
        "summary": summary,
        "authors": authors,
        "raw_text": doc_text,
    }


def format_document(
    doc_or_text, max_chars: int = DEFAULT_MAX_DOC_CHARS, meta: Optional[dict] = None
) -> str:
    """
    Render one retrieved document as compact labelled text.

    Falls back to truncated raw text when the document is plain text with no
    metadata.
    """
    info = extract_paper_fields(doc_or_text, meta)
    title = info["title"]
    category = info["category"]
    authors = info["authors"]
    summary = info["summary"]

    lines = []
    if title:
        lines.append(f"Title: {truncate(title, 300)}")
    if category:
        lines.append(f"Category: {truncate(category, 300)}")
    if authors:
        lines.append(f"Authors: {truncate(authors, 300)}")
    if summary:
        used = sum(len(line) + 1 for line in lines)
        lines.append(f"Abstract: {truncate(summary, max(200, max_chars - used))}")

    if not lines:
        return truncate(info["raw_text"], max_chars)

    return "\n".join(lines)


def document_title(doc_or_text, meta: Optional[dict] = None) -> str:
    """
    The record's title, whitespace-normalised, or ``""``.

    Used to recognise the same paper arriving from two different sources (the
    indexed collection and a live search), where the serialised documents
    differ character by character but the paper does not.
    """
    info = extract_paper_fields(doc_or_text, meta)
    return " ".join(str(info["title"] or "").split())


#: Per-candidate budget when the relevance agent grades a batch of papers.
#: Grading only needs the title, category and enough abstract to judge topic —
#: 20 candidates of untruncated JSON would be a large, wasteful input.
DEFAULT_MAX_CANDIDATE_CHARS = 400


def format_candidate(
    doc_or_text, max_chars: int = DEFAULT_MAX_CANDIDATE_CHARS, meta: Optional[dict] = None
) -> str:
    """Render one retrieved document compactly, for relevance grading."""
    info = extract_paper_fields(doc_or_text, meta)
    title = info["title"]
    category = info["category"]
    summary = info["summary"]

    if not title and not summary and not category:
        return truncate(" ".join(str(info["raw_text"]).split()), max_chars)

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
        body = format_document(doc.get("document", ""), budget, meta=doc.get("meta"))
        entries.append(f"--- Document {position} ---\n{body}\n")

    context = "\n".join(entries)

    user_prompt = (
        f"User query: {query}\n\n"
        f"Research documents (chunk {chunk_index}):\n"
        f"{context}\n\n"
        f"Please provide a comprehensive answer grounded in these documents."
    )
    return SYSTEM_PROMPT, user_prompt
