"""
Tests for recycling live arXiv papers into the ChromaDB collection.

No ChromaDB, no Ollama, no network.  The collection and the embedder are
fakes with the same call signatures, so these tests pin down the write
contract that matters on a shared external store.  Existing records are never
overwritten or re-embedded.  Vectors only go to the connected store, in the
collection's own vector space.  A failure never escapes into a request.
"""

import copy
import io
import json
import threading
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import SimpleTestCase

from airecommender.pipeline.errors import EmbeddingUnavailable, VectorStoreUnavailable
from airecommender.pipeline.sources import recycle
from airecommender.pipeline.sources.arxiv_api import (
    ArxivUnavailable,
    format_document,
    parse_atom_feed,
)
from airecommender.pipeline.sources.recycle import (
    INGESTED_WITH,
    ArxivRecycler,
    build_record,
    build_records,
)
from airecommender.tests_arxiv import FEED

NOW = "2026-11-02T12:00:00+00:00"


# ── Fakes ────────────────────────────────────────────────────────────────────


def live_paper(
    arxiv_id="2301.12345v1",
    title="Transformers for Medical Imaging",
    abstract="We survey transformer architectures.",
    authors="Ada Lovelace, Alan Turing",
    **extra,
):
    """A candidate shaped exactly as the live parser emits one."""
    meta = {
        "id": arxiv_id,
        "arxiv_id": arxiv_id,
        "title": title,
        "abstract": abstract,
        "authors": authors,
        "categories": "cs.CV cs.LG",
        "primary_category": "cs.CV",
        "source": "arxiv_api",
        "url": f"http://arxiv.org/abs/{arxiv_id}",
        "pdf_url": f"http://arxiv.org/pdf/{arxiv_id}",
        "published": "2023-01-24T00:00:00Z",
        "updated": "2023-02-01T00:00:00Z",
        "update_date": "2023-02-01",
        "authors_parsed": json.dumps([["Lovelace", "Ada", ""], ["Turing", "Alan", ""]]),
        **extra,
    }
    return {
        "document": format_document(title, abstract),
        "meta": meta,
        "source": "arxiv_api",
        "arxiv_rank": 1,
    }


class FakeCollection:
    """The slice of a chromadb Collection the recycler uses."""

    def __init__(self, existing=(), metadata=None, get_error=None, upsert_error=None):
        self.name = "arxiv_embeddings"
        self.metadata = metadata
        self.stored = {record_id: None for record_id in existing}
        self.get_error = get_error
        self.upsert_error = upsert_error
        self.get_calls = []
        self.upsert_calls = []

    def count(self):
        return len(self.stored)

    def get(self, ids=None, include=None):
        self.get_calls.append({"ids": list(ids), "include": include})
        if self.get_error:
            raise self.get_error
        return {"ids": [record_id for record_id in ids if record_id in self.stored]}

    def upsert(self, ids, documents, embeddings, metadatas):
        self.upsert_calls.append(
            {"ids": list(ids), "documents": list(documents),
             "embeddings": list(embeddings), "metadatas": list(metadatas)}
        )
        if self.upsert_error:
            raise self.upsert_error
        for record_id, document, metadata in zip(ids, documents, metadatas):
            self.stored[record_id] = (document, metadata)


class FakeEmbedder:
    """Returns one 3-d vector per text; can fail, fall short, or hold."""

    def __init__(self, error=None, short_by=0, gate=None):
        self.error = error
        self.short_by = short_by
        self.gate = gate
        self.entered = threading.Event()
        self.calls = []

    def __call__(self, texts):
        self.calls.append(list(texts))
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(5)
        if self.error:
            raise self.error
        return [[0.1, 0.2, 0.3] for _ in texts[: len(texts) - self.short_by]]


def make_recycler(collection=None, embedder=None, model="embeddinggemma", ephemeral=False, **kwargs):
    collection = collection if collection is not None else FakeCollection()
    embedder = embedder if embedder is not None else FakeEmbedder()
    recycler = ArxivRecycler(
        collection_fn=lambda: collection,
        embed_fn=embedder,
        embedding_model=model,
        is_ephemeral_fn=lambda: ephemeral,
        **kwargs,
    )
    return recycler, collection, embedder


# ── Record shaping ───────────────────────────────────────────────────────────


class RecordTests(SimpleTestCase):
    def test_record_matches_the_collection_schema(self):
        record = build_record(live_paper(), NOW)

        self.assertEqual(record.id, "2301.12345")
        self.assertEqual(
            record.document,
            "Title: Transformers for Medical Imaging\n\nAbstract: We survey transformer architectures.",
        )
        meta = record.metadata
        self.assertEqual(meta["id"], "2301.12345")
        self.assertEqual(meta["title"], "Transformers for Medical Imaging")
        self.assertEqual(meta["abstract"], "We survey transformer architectures.")
        self.assertEqual(meta["authors"], "Ada Lovelace and Alan Turing")
        self.assertEqual(meta["categories"], "cs.CV cs.LG")
        self.assertEqual(meta["update_date"], "2023-02-01")
        self.assertEqual(meta["authors_parsed"], '[["Lovelace","Ada",""],["Turing","Alan",""]]')
        self.assertEqual(meta["ingested_with"], INGESTED_WITH)
        self.assertEqual(meta["ingested_at"], NOW)

    def test_live_only_fields_are_not_stored(self):
        """
        ``source == "arxiv_api"`` labels a paper as fetched live for *this*
        answer.  Stored, it would mislabel the paper on every later search.
        """
        meta = build_record(live_paper(), NOW).metadata
        for key in ("source", "url", "pdf_url", "arxiv_id", "arxiv_rank"):
            self.assertNotIn(key, meta)

    def test_metadata_is_primitive_and_never_empty(self):
        meta = build_record(live_paper(comments="", doi=None), NOW).metadata
        self.assertNotIn("comments", meta)
        self.assertNotIn("doi", meta)
        for key, value in meta.items():
            with self.subTest(key=key):
                self.assertIsInstance(value, (str, int, float, bool))
                self.assertNotEqual(value, "")

    def test_unknown_snapshot_fields_are_not_invented(self):
        meta = build_record(live_paper(), NOW).metadata
        for key in ("submitter", "license", "versions", "report-no"):
            self.assertNotIn(key, meta)

    def test_the_candidate_is_left_untouched(self):
        candidates = [live_paper(), live_paper("2302.00001v2", title="Other")]
        before = copy.deepcopy(candidates)

        build_records(candidates)

        self.assertEqual(candidates, before)

    def test_old_style_ids_keep_their_archive(self):
        record = build_record(live_paper("hep-th/9901001v3"), NOW)
        self.assertEqual(record.id, "hep-th/9901001")
        self.assertEqual(record.metadata["id"], "hep-th/9901001")

    def test_unusable_candidates_are_skipped(self):
        for candidate in (
            None,
            "not a dict",
            {"document": "Title: X"},
            live_paper("line-42"),
            live_paper(title="", abstract=""),
        ):
            with self.subTest(candidate=candidate):
                self.assertIsNone(build_record(candidate, NOW))

    def test_one_record_per_paper(self):
        records = build_records(
            [live_paper("2301.12345v1", title="First"), live_paper("2301.12345v2", title="Second")]
        )
        self.assertEqual([r.id for r in records], ["2301.12345"])
        self.assertEqual(records[0].metadata["title"], "First")

    def test_author_string_follows_the_snapshot_style(self):
        def authors(value):
            return build_record(live_paper(authors=value), NOW).metadata.get("authors")

        self.assertEqual(authors("Ada Lovelace"), "Ada Lovelace")
        self.assertEqual(authors("A One, B Two, C Three"), "A One, B Two and C Three")
        self.assertIsNone(authors(""))

    def test_a_parsed_live_feed_becomes_records(self):
        records = build_records(parse_atom_feed(FEED))
        self.assertEqual([r.id for r in records], ["2301.12345", "2302.00001"])
        self.assertTrue(records[0].document.startswith("Title: Transformers for Medical Imaging"))


# ── Writing ──────────────────────────────────────────────────────────────────


class WriteTests(SimpleTestCase):
    def setUp(self):
        self.records = build_records(
            [live_paper("2301.12345v1"), live_paper("2302.00001v2", title="Second Paper")]
        )

    def test_only_missing_papers_are_embedded_and_written(self):
        recycler, collection, embedder = make_recycler(FakeCollection(existing={"2301.12345"}))

        report = recycler.write(self.records)

        self.assertIsNone(report.error)
        self.assertEqual(report.already_present, 1)
        self.assertEqual(report.new_ids, ["2302.00001"])
        self.assertEqual(report.written, 1)
        self.assertEqual(embedder.calls, [[self.records[1].document]])
        self.assertEqual(collection.upsert_calls[0]["ids"], ["2302.00001"])

    def test_an_existing_record_is_never_overwritten(self):
        """A snapshot record carries metadata the live API cannot supply."""
        recycler, collection, embedder = make_recycler(
            FakeCollection(existing={"2301.12345", "2302.00001"})
        )

        report = recycler.write(self.records)

        self.assertEqual(report.already_present, 2)
        self.assertEqual(report.written, 0)
        self.assertEqual(embedder.calls, [])
        self.assertEqual(collection.upsert_calls, [])
        self.assertEqual(
            collection.get_calls,
            [{"ids": ["2301.12345", "2302.00001"], "include": []}],
        )

    def test_documents_reach_the_embedder_unaltered(self):
        recycler, _, embedder = make_recycler()

        recycler.write(self.records)

        self.assertIn("\n\nAbstract: ", embedder.calls[0][0])

    def test_upsert_lists_line_up(self):
        recycler, collection, _ = make_recycler()

        recycler.write(self.records)

        call = collection.upsert_calls[0]
        self.assertEqual(call["ids"], ["2301.12345", "2302.00001"])
        self.assertEqual(len(call["documents"]), 2)
        self.assertEqual(len(call["embeddings"]), 2)
        self.assertEqual([m["id"] for m in call["metadatas"]], call["ids"])
        self.assertEqual(call["documents"], [r.document for r in self.records])

    def test_nothing_goes_to_the_in_memory_fallback(self):
        recycler, collection, embedder = make_recycler(ephemeral=True)

        report = recycler.write(self.records)

        self.assertIn("in-memory fallback", report.error)
        self.assertEqual((collection.get_calls, collection.upsert_calls, embedder.calls), ([], [], []))

    def test_a_collection_indexed_with_another_model_is_refused(self):
        recycler, collection, embedder = make_recycler(
            FakeCollection(metadata={"embedding_model": "nomic-embed-text"})
        )

        report = recycler.write(self.records)

        self.assertIn("refusing to mix vector spaces", report.error)
        self.assertEqual((collection.upsert_calls, embedder.calls), ([], []))

    def test_a_model_tag_is_not_a_different_model(self):
        recycler, collection, _ = make_recycler(
            FakeCollection(metadata={"embedding_model": "embeddinggemma"}),
            model="embeddinggemma:latest",
        )

        report = recycler.write(self.records)

        self.assertIsNone(report.error)
        self.assertEqual(report.written, 2)

    def test_a_collection_without_model_metadata_is_written(self):
        recycler, _, _ = make_recycler(FakeCollection(metadata=None))
        self.assertEqual(recycler.write(self.records).written, 2)

    def test_an_unreachable_chroma_is_reported_not_raised(self):
        def unreachable():
            raise VectorStoreUnavailable("Cannot reach ChromaDB at chroma:8000")

        embedder = FakeEmbedder()
        recycler = ArxivRecycler(collection_fn=unreachable, embed_fn=embedder)

        report = recycler.write(self.records)

        self.assertIn("Cannot reach ChromaDB", report.error)
        self.assertEqual(embedder.calls, [])

    def test_a_failing_existence_check_embeds_nothing(self):
        recycler, _, embedder = make_recycler(FakeCollection(get_error=OSError("reset")))

        report = recycler.write(self.records)

        self.assertIn("reset", report.error)
        self.assertEqual(embedder.calls, [])

    def test_an_embedding_failure_writes_nothing(self):
        recycler, collection, _ = make_recycler(
            embedder=FakeEmbedder(error=EmbeddingUnavailable("ollama is down"))
        )

        report = recycler.write(self.records)

        self.assertIn("ollama is down", report.error)
        self.assertEqual(collection.upsert_calls, [])

    def test_a_short_embedding_response_writes_nothing(self):
        recycler, collection, _ = make_recycler(embedder=FakeEmbedder(short_by=1))

        report = recycler.write(self.records)

        self.assertIn("1 vectors for 2 documents", report.error)
        self.assertEqual(collection.upsert_calls, [])

    def test_a_rejected_upsert_is_reported(self):
        recycler, _, _ = make_recycler(
            FakeCollection(upsert_error=ValueError("expecting embedding with dimension of 8"))
        )

        report = recycler.write(self.records)

        self.assertIn("dimension", report.error)
        self.assertEqual(report.written, 0)

    def test_a_dry_run_checks_everything_and_writes_nothing(self):
        recycler, collection, embedder = make_recycler(FakeCollection(existing={"2301.12345"}))

        report = recycler.write(self.records, dry_run=True)

        self.assertEqual(report.new_ids, ["2302.00001"])
        self.assertEqual(report.written, 0)
        self.assertEqual((collection.upsert_calls, embedder.calls), ([], []))

    def test_large_batches_are_split(self):
        records = build_records([live_paper(f"2301.0000{i}v1", title=f"P{i}") for i in range(5)])
        recycler, collection, _ = make_recycler()

        with mock.patch.object(recycle, "WRITE_BATCH_SIZE", 2):
            report = recycler.write(records)

        self.assertEqual(report.written, 5)
        self.assertEqual([len(c["ids"]) for c in collection.upsert_calls], [2, 2, 1])


# ── Background writes ────────────────────────────────────────────────────────


class BackgroundTests(SimpleTestCase):
    def test_submitted_papers_are_written_in_the_background(self):
        recycler, collection, _ = make_recycler()

        queued = recycler.submit([live_paper()])

        self.assertEqual(queued, 1)
        self.assertTrue(recycler.flush(5))
        self.assertIn("2301.12345", collection.stored)

    def test_submit_does_not_wait_for_the_write(self):
        gate = threading.Event()
        self.addCleanup(gate.set)
        recycler, collection, embedder = make_recycler(embedder=FakeEmbedder(gate=gate))

        recycler.submit([live_paper()])

        self.assertTrue(embedder.entered.wait(5))  # the worker is mid-write
        self.assertEqual(collection.upsert_calls, [])
        self.assertFalse(recycler.flush(0.05))
        gate.set()
        self.assertTrue(recycler.flush(5))
        self.assertEqual(len(collection.upsert_calls), 1)

    def test_a_full_queue_drops_the_batch_instead_of_blocking(self):
        gate = threading.Event()
        self.addCleanup(gate.set)
        embedder = FakeEmbedder(gate=gate)
        recycler, collection, _ = make_recycler(embedder=embedder, max_pending=1)

        self.assertEqual(recycler.submit([live_paper("2301.00001v1")]), 1)
        self.assertTrue(embedder.entered.wait(5))  # first batch taken by the worker
        self.assertEqual(recycler.submit([live_paper("2301.00002v1")]), 1)  # fills the queue
        with self.assertLogs("airecommender.pipeline.sources.recycle", "WARNING"):
            self.assertEqual(recycler.submit([live_paper("2301.00003v1")]), 0)

        gate.set()
        self.assertTrue(recycler.flush(5))
        self.assertEqual(set(collection.stored), {"2301.00001", "2301.00002"})

    def test_nothing_usable_starts_no_thread(self):
        recycler, _, _ = make_recycler()

        self.assertEqual(recycler.submit([{"meta": {}}, live_paper("not-an-id")]), 0)
        self.assertIsNone(recycler._worker)

    def test_a_forked_process_gets_a_worker_of_its_own(self):
        recycler, collection, _ = make_recycler()
        recycler.submit([live_paper("2301.00001v1")])
        self.assertTrue(recycler.flush(5))
        parent_worker = recycler._worker

        recycler._pid = -1  # as seen from a child after fork()
        recycler.submit([live_paper("2301.00002v1")])

        self.assertTrue(recycler.flush(5))
        self.assertIsNot(recycler._worker, parent_worker)
        self.assertIn("2301.00002", collection.stored)

    def test_a_failing_write_does_not_stop_the_worker(self):
        collection = FakeCollection(upsert_error=OSError("down"))
        recycler, _, _ = make_recycler(collection)

        recycler.submit([live_paper("2301.00001v1")])
        self.assertTrue(recycler.flush(5))
        collection.upsert_error = None
        recycler.submit([live_paper("2301.00002v1")])

        self.assertTrue(recycler.flush(5))
        self.assertIn("2301.00002", collection.stored)


# ── Management command ───────────────────────────────────────────────────────


class FakeDense:
    def __init__(self, collection=None, embedder=None, collection_error=None):
        self._collection = collection if collection is not None else FakeCollection()
        self.collection_error = collection_error
        self.embedding_model = "embeddinggemma"
        self.embed_documents = embedder if embedder is not None else FakeEmbedder()

    @property
    def collection(self):
        if self.collection_error:
            raise self.collection_error
        return self._collection


class FakeArxiv:
    def __init__(self, results=(), error=None):
        self.results = list(results)
        self.error = error
        self.calls = []

    def search(self, query, max_results=None, budget=None):
        self.calls.append({"query": query, "max_results": max_results})
        if self.error:
            raise self.error
        return list(self.results)


class CommandTests(SimpleTestCase):
    def run_command(self, dense, arxiv, *args):
        target = "airecommender.management.commands.recycle_arxiv"
        out = io.StringIO()
        with mock.patch(f"{target}.DenseRAG", return_value=dense), mock.patch(
            f"{target}.ArxivClient", return_value=arxiv
        ), mock.patch(f"{target}.chroma_settings.is_ephemeral", return_value=False):
            call_command("recycle_arxiv", "medical imaging", *args, stdout=out)
        return out.getvalue()

    def test_a_dry_run_lists_new_papers_and_writes_nothing(self):
        collection = FakeCollection(existing={"2301.12345"})
        dense = FakeDense(collection)
        arxiv = FakeArxiv([live_paper(), live_paper("2302.00001v1", title="New One")])

        output = self.run_command(dense, arxiv, "--dry-run", "--max-results", "5")

        self.assertIn("2302.00001  New One", output)
        self.assertIn("Dry run: 1 new, 1 already in the collection", output)
        self.assertEqual(collection.upsert_calls, [])
        self.assertEqual(arxiv.calls, [{"query": "medical imaging", "max_results": 5}])

    def test_a_run_writes_and_reports_the_collection_growth(self):
        collection = FakeCollection(existing={"0704.0001"})
        output = self.run_command(FakeDense(collection), FakeArxiv([live_paper()]))

        self.assertIn("Wrote 1 new paper(s), 0 already present. Collection: 1 → 2 records.", output)
        self.assertIn("2301.12345", collection.stored)

    def test_an_unusable_chroma_fails_before_arxiv_is_asked(self):
        arxiv = FakeArxiv([live_paper()])
        dense = FakeDense(collection_error=VectorStoreUnavailable("Cannot reach ChromaDB"))

        with self.assertRaisesMessage(CommandError, "Cannot reach ChromaDB"):
            self.run_command(dense, arxiv)
        self.assertEqual(arxiv.calls, [])

    def test_an_unreachable_arxiv_is_an_error(self):
        with self.assertRaisesMessage(CommandError, "arXiv could not be reached"):
            self.run_command(FakeDense(), FakeArxiv(error=ArxivUnavailable("timeout")))

    def test_a_failed_write_exits_non_zero(self):
        dense = FakeDense(embedder=FakeEmbedder(error=EmbeddingUnavailable("ollama is down")))

        with self.assertRaisesMessage(CommandError, "ollama is down"):
            self.run_command(dense, FakeArxiv([live_paper()]))
