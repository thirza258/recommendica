"""
Recycle live arXiv results into the connected ChromaDB collection.

The live fallback (:mod:`arxiv_api`) exists because the indexed collection is a
fixed snapshot.  Every paper it fetches is a real arXiv record the collection
could not supply, so instead of being dropped after one answer it is written
back into the collection the app searches.  The next question on that topic is
then answered from ChromaDB directly, with no live round trip.

Records are written the way the original ingestion wrote them
(CHROMA_INGESTION_HANDOVER.md): the bare arXiv ID as the record ID, the
``Title: …\\n\\nAbstract: …`` document, a vector of that same text from the
configured embedding model, and primitive-only metadata.  The collection lives
on an external, shared Chroma server, so the write path is conservative:

* **Never overwrite.**  IDs already in the collection are skipped before
  anything is embedded.  A snapshot record carries metadata the API does not
  return (submitter, license, versions), and replacing it would lose them.
* **One vector space.**  Nothing is written to the in-memory fallback store,
  or to a collection whose ``embedding_model`` metadata names a different
  model than the configured one.  Vectors from another model would sit beside
  the existing ones and quietly degrade every search.
* **Off the request path.**  Writes run on one background thread behind a
  bounded queue.  A slow or failing Chroma or Ollama costs a log line, never a
  user's answer.  When the queue is full the batch is dropped: a later search
  will fetch and offer the same papers again.
* **Provenance, not ``source``.**  Recycled records carry ``ingested_with``
  and ``ingested_at``, and never ``source``.  On the wire,
  ``source == "arxiv_api"`` means "fetched live for this answer"; it drives the
  UI's live badge and the result check's source counts.  Once recycled, a
  paper is an ordinary collection document.

Nothing here imports ChromaDB or Ollama: the collection, the embedder and the
ephemeral-store check are injected, so the logic is testable with fakes.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional, Sequence

from airecommender.pipeline.sources.arxiv_api import canonical_arxiv_id, format_document

logger = logging.getLogger(__name__)

#: ``ingested_with`` on every recycled record.  Downstream readers can filter
#: on it (``where={"ingested_with": INGESTED_WITH}``) to find or remove them.
INGESTED_WITH = "recommendica-arxiv-recycle"

#: Live-search batches waiting for the writer.  A batch is one search, so at
#: most ARXIV_FALLBACK_MAX_RESULTS papers: this bounds memory, not throughput.
MAX_PENDING_BATCHES = 32

#: Records per upsert, inside the handover's 50–200 guidance.
WRITE_BATCH_SIZE = 100

#: Candidate metadata carried onto the stored record unchanged.  Everything
#: else the live parser adds (``source``, ``url``, ``pdf_url``, ``arxiv_id``)
#: describes the live fetch, not the paper, and snapshot records have none of
#: it.  Unknown snapshot fields (``submitter``, ``license``, ``versions``,
#: ``report-no``) are omitted, never synthesised.
_CARRIED_FIELDS = (
    "categories",
    "primary_category",
    "update_date",
    "authors_parsed",
    "doi",
    "journal-ref",
    "comments",
    "published",
    "updated",
)


@dataclass(frozen=True)
class RecycleRecord:
    """One paper, shaped for ``collection.upsert``."""

    id: str
    document: str
    metadata: dict


@dataclass
class RecycleReport:
    """What one write did.  Logged by the worker, printed by the command."""

    offered: int = 0
    already_present: int = 0
    #: IDs the collection did not hold, in write order.  The first
    #: ``written`` of them are stored (all of them, unless ``error`` is set).
    new_ids: list[str] = field(default_factory=list)
    written: int = 0
    collection: str = ""
    #: Set when the batch could not be written; nothing raised.
    error: Optional[str] = None


# ── Record shaping ───────────────────────────────────────────────────────────


def _clean(value) -> str:
    return " ".join(str(value or "").split())


def _join_authors(authors: str) -> str:
    """
    ``"A, B, C"`` → ``"A, B and C"``, the snapshot's author-string style.

    The live parser joins names with ``", "``, so splitting on it recovers
    them.
    """
    names = [name.strip() for name in str(authors or "").split(", ") if name.strip()]
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _primitive(value):
    """
    Chroma accepts only str/int/float/bool metadata (handover §3.4).

    ``None`` and ``""`` are omitted rather than stored, and anything nested
    becomes compact JSON.
    """
    if value is None or value == "":
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_record(candidate: dict, ingested_at: str) -> Optional[RecycleRecord]:
    """
    Turn a live-search candidate into a collection record, or ``None``.

    Reads the candidate and never writes to it.  The same dict is graded and
    streamed to the browser on the request thread, where ``meta.source`` is
    what labels the paper as live.
    """
    meta = candidate.get("meta") if isinstance(candidate, dict) else None
    if not isinstance(meta, dict):
        return None

    record_id = canonical_arxiv_id(
        meta.get("arxiv_id") or meta.get("id") or meta.get("url")
    )
    if not record_id:
        return None

    title = _clean(meta.get("title"))
    abstract = _clean(meta.get("abstract") or meta.get("summary"))
    if not title and not abstract:
        return None

    fields = {
        "id": record_id,
        "title": title,
        "abstract": abstract,
        "authors": _join_authors(meta.get("authors")),
    }
    for key in _CARRIED_FIELDS:
        fields[key] = meta.get(key)
    parsed = fields.get("authors_parsed")
    if isinstance(parsed, str):
        # Re-serialised so it matches the snapshot: compact, UTF-8 names
        # rather than \u escapes.
        try:
            fields["authors_parsed"] = json.loads(parsed)
        except ValueError:
            pass
    fields["ingested_with"] = INGESTED_WITH
    fields["ingested_at"] = ingested_at

    metadata = {}
    for key, value in fields.items():
        value = _primitive(value)
        if value is not None:
            metadata[key] = value

    return RecycleRecord(record_id, format_document(title, abstract), metadata)


def build_records(candidates: Sequence[dict]) -> list[RecycleRecord]:
    """Records for every usable candidate, one per arXiv ID (first wins)."""
    ingested_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    records: list[RecycleRecord] = []
    seen: set[str] = set()
    for candidate in candidates or []:
        record = build_record(candidate, ingested_at)
        if record is None or record.id in seen:
            continue
        seen.add(record.id)
        records.append(record)
    return records


def _model_base(name) -> str:
    """``"embeddinggemma:latest"`` → ``"embeddinggemma"``, as the probe compares."""
    return str(name).split(":", 1)[0].strip().lower()


# ── Writer ───────────────────────────────────────────────────────────────────


class ArxivRecycler:
    """
    Writes live arXiv papers into the connected collection.

    :meth:`submit` is the request-path entry point: it builds the records and
    queues them for a background thread.  :meth:`write` does the work
    synchronously.  The worker calls it, and so does the ``recycle_arxiv``
    management command, so both run the same checks.

    One instance per process.  :class:`~airecommender.main.RAGIndex` owns it,
    and the per-request copies made by ``for_mode`` share it.
    """

    def __init__(
        self,
        collection_fn: Callable[[], object],
        embed_fn: Callable[[list[str]], list[list[float]]],
        *,
        embedding_model: Optional[str] = None,
        is_ephemeral_fn: Callable[[], bool] = lambda: False,
        max_pending: int = MAX_PENDING_BATCHES,
    ):
        self.collection_fn = collection_fn
        self.embed_fn = embed_fn
        self.embedding_model = embedding_model
        self.is_ephemeral_fn = is_ephemeral_fn
        self.max_pending = max(1, int(max_pending))

        self._lock = threading.Lock()
        self._idle = threading.Condition()
        self._pending = 0
        self._queue: queue.Queue = queue.Queue(maxsize=self.max_pending)
        self._worker: Optional[threading.Thread] = None
        self._pid = os.getpid()

    # ── Request path ─────────────────────────────────────────────────────────

    def submit(self, candidates: Sequence[dict]) -> int:
        """
        Queue *candidates* to be written, and return how many were queued.

        Never blocks.  The records are built here, on the caller's thread,
        so the worker never shares a dict with the request.  The network work
        is left to the worker.
        """
        records = build_records(candidates)
        if not records:
            return 0

        self._ensure_worker()
        with self._idle:
            self._pending += 1
        try:
            self._queue.put_nowait(records)
        except queue.Full:
            with self._idle:
                self._pending -= 1
                self._idle.notify_all()
            logger.warning(
                "[RECYCLE] Write queue full (%s batches) — dropped %s arXiv "
                "paper(s); a later search will offer them again.",
                self.max_pending,
                len(records),
            )
            return 0
        return len(records)

    def flush(self, timeout: float) -> bool:
        """Wait up to *timeout* seconds for queued writes; ``True`` once idle."""
        deadline = time.monotonic() + max(0.0, timeout)
        with self._idle:
            while self._pending > 0:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._idle.wait(remaining)
        return True

    def _ensure_worker(self):
        """
        Start the writer thread on first use, in the process that uses it.

        Threads do not survive ``fork``.  If this object was built before a
        fork, the parent's worker does not exist in the child, so the child
        gets a fresh queue and thread of its own.
        """
        with self._lock:
            pid = os.getpid()
            if pid != self._pid:
                self._queue = queue.Queue(maxsize=self.max_pending)
                with self._idle:
                    self._pending = 0
                self._worker = None
                self._pid = pid
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._run, name="arxiv-recycle", daemon=True
            )
            self._worker.start()

    def _run(self):
        # Daemon by design: a queued write is a convenience, and holding a
        # worker's graceful shutdown for one is not worth it.  A paper lost
        # here is fetched and offered again by the next search that needs it.
        while True:
            records = self._queue.get()
            try:
                self.write(records)
            except Exception:  # noqa: BLE001 — write() reports, never raises
                logger.exception("[RECYCLE] Unexpected failure in the writer thread")
            finally:
                with self._idle:
                    self._pending -= 1
                    self._idle.notify_all()

    # ── Write ────────────────────────────────────────────────────────────────

    def _model_mismatch(self, collection) -> Optional[str]:
        """Why this collection must not take our vectors, or ``None``."""
        indexed = (getattr(collection, "metadata", None) or {}).get("embedding_model")
        if not indexed or not self.embedding_model:
            # Nothing recorded to compare against.  Chroma still rejects a
            # vector of the wrong dimension on its own.
            return None
        if _model_base(indexed) == _model_base(self.embedding_model):
            return None
        return (
            f"collection {getattr(collection, 'name', '?')!r} was indexed with "
            f"{indexed!r}, but the configured embedding model is "
            f"{self.embedding_model!r}; refusing to mix vector spaces"
        )

    def write(self, records: Sequence[RecycleRecord], dry_run: bool = False) -> RecycleReport:
        """
        Write the records the collection does not hold yet.

        Order matters for cost.  The existence check runs before any
        embedding, so a paper already present (or a Chroma that cannot be
        reached) costs one ``get`` and no Ollama call.  With *dry_run*,
        everything up to the embedding runs, and nothing is written.

        Never raises.  A failure is logged and returned in ``error``.
        """
        report = RecycleReport(offered=len(records))
        if not records:
            return report

        started = time.monotonic()
        try:
            collection = self.collection_fn()
            report.collection = str(getattr(collection, "name", "") or "")

            if self.is_ephemeral_fn():
                report.error = (
                    "the active Chroma client is the in-memory fallback "
                    "(CHROMA_ALLOW_EPHEMERAL_FALLBACK), not the connected server"
                )
                logger.warning(
                    "[RECYCLE] Not storing %s arXiv paper(s): %s.",
                    len(records),
                    report.error,
                )
                return report

            mismatch = self._model_mismatch(collection)
            if mismatch:
                report.error = mismatch
                logger.error("[RECYCLE] Not storing %s arXiv paper(s): %s.", len(records), mismatch)
                return report

            found = collection.get(ids=[record.id for record in records], include=[])
            existing = set((found or {}).get("ids") or [])
            fresh = [record for record in records if record.id not in existing]
            report.already_present = len(records) - len(fresh)
            report.new_ids = [record.id for record in fresh]

            if dry_run or not fresh:
                if not fresh:
                    logger.info(
                        "[RECYCLE] All %s arXiv paper(s) already in %r.",
                        len(records),
                        report.collection,
                    )
                return report

            for start in range(0, len(fresh), WRITE_BATCH_SIZE):
                batch = fresh[start : start + WRITE_BATCH_SIZE]
                embeddings = self.embed_fn([record.document for record in batch])
                if len(embeddings) != len(batch):
                    raise ValueError(
                        f"embedder returned {len(embeddings)} vectors for "
                        f"{len(batch)} documents"
                    )
                collection.upsert(
                    ids=[record.id for record in batch],
                    documents=[record.document for record in batch],
                    embeddings=[list(vector) for vector in embeddings],
                    metadatas=[record.metadata for record in batch],
                )
                report.written += len(batch)

            logger.info(
                "[RECYCLE] Stored %s new arXiv paper(s) in %r (%s already "
                "present) in %.1fs: %s",
                report.written,
                report.collection,
                report.already_present,
                time.monotonic() - started,
                ", ".join(report.new_ids),
            )
        except Exception as exc:  # noqa: BLE001 — the caller gets a report
            report.error = f"{type(exc).__name__}: {exc}"
            logger.warning(
                "[RECYCLE] Could not store arXiv paper(s) in ChromaDB after "
                "%s of %s were written (%s).",
                report.written,
                len(report.new_ids) or len(records),
                report.error,
            )
        return report
