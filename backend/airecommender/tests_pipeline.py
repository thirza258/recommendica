"""
End-to-end tests for the streaming pipeline and the API layer.

These use fakes for ChromaDB, Ollama and the LLM, so they assert the pipeline's
*shape*: the SSE contract, event ordering under concurrency, the document cap,
error propagation, cancellation and back-pressure.
"""

import json
import re
import threading
import time
from unittest import mock

from django.test import TestCase, override_settings

from airecommender.main import RAGIndex
from airecommender.pipeline import prompting
from airecommender.pipeline.errors import LLMUnavailable, VectorStoreUnavailable
from airecommender.pipeline.sources.arxiv_api import ArxivUnavailable


# ── Fakes ────────────────────────────────────────────────────────────────────


class FakeDenseRAG:
    """Stands in for DenseRAG with deterministic, network-free retrieval."""

    def __init__(self, per_query_docs=None, total=None, count_error=None, query_error=None):
        # One ranked list per query variant.
        self.per_query_docs = per_query_docs
        self.total = 25 if total is None else total
        self.count_error = count_error
        self.query_error = query_error
        self.collection_name = "test_collection"
        self.rerank_model = None
        self.cross_encoder = None
        self.top_k = 5
        self.retrieve_calls = []

    def count(self):
        if self.count_error:
            raise self.count_error
        return self.total

    def retrieve_many(self, queries, where_filter=None, n_results=None, total=None):
        self.retrieve_calls.append(list(queries))
        if self.query_error:
            raise self.query_error
        if self.per_query_docs is not None:
            return [list(docs) for docs in self.per_query_docs[: len(queries)]] + [
                [] for _ in range(max(0, len(queries) - len(self.per_query_docs)))
            ]
        # Default: every variant returns the same five documents.
        return [
            [
                {"document": f"doc-{i}", "meta": {"i": i}, "dense_score": 1.0 - i / 10}
                for i in range(5)
            ]
            for _ in queries
        ]

    def rerank_candidates(self, query, candidates):
        return candidates

    def probe_embedder(self):
        return {"ok": True, "model": "fake", "error": None}


class FakeLLMService:
    """
    Stands in for OpenRouterService.

    Recognises the agent's prompts by their system instruction, so the pipeline
    exercises the real grading / refinement / evaluation code paths (including
    the JSON parsers) rather than bypassing them.
    """

    def __init__(
        self,
        tokens=("answer",),
        barrier=None,
        fail_for_chunk=None,
        delay=0.0,
        unrelated=(),
        grader_error=None,
        grader_response=None,
        refined_query=None,
        claims=None,
    ):
        self.tokens = list(tokens)
        self.barrier = barrier
        self.fail_for_chunk = fail_for_chunk
        self.delay = delay
        self.unrelated = set(unrelated)
        self.grader_error = grader_error
        self.grader_response = grader_response
        self.refined_query = refined_query
        self.claims = claims
        self.model = "fake/model"
        self.stream_calls = []
        self.grade_calls = []
        self.refine_calls = []
        self.evaluation_calls = []
        self.lock = threading.Lock()

    def _chunk_index_from_prompt(self, prompt):
        marker = "(chunk "
        if marker in prompt:
            return int(prompt.split(marker, 1)[1].split(")", 1)[0])
        return None

    def _grades_for(self, prompt):
        """Grade the papers listed in the prompt; anything in *unrelated* fails."""
        entries = []
        listed = []
        for line in prompt.splitlines():
            match = re.match(r"^(\d+)\.\s+(.*)$", line)
            if match:
                index, text = int(match.group(1)), match.group(2).strip()
                listed.append(text)
                is_unrelated = any(name in text for name in self.unrelated)
                entries.append(
                    {
                        "i": index,
                        "v": "unrelated" if is_unrelated else "relevant",
                        "s": 0.05 if is_unrelated else 0.92,
                        "r": "off topic for this query" if is_unrelated else "",
                    }
                )
        with self.lock:
            self.grade_calls.append(listed)
        return json.dumps(entries)

    def generate_response(self, prompt, system_instruction_string="", **kwargs):
        if "You judge whether retrieved arxiv papers" in system_instruction_string:
            if self.grader_error:
                raise self.grader_error
            if self.grader_response is not None:
                with self.lock:
                    self.grade_calls.append(prompt)
                return self.grader_response
            return self._grades_for(prompt)

        if "You repair failed academic search queries" in system_instruction_string:
            with self.lock:
                self.refine_calls.append(prompt)
            return self.refined_query or ""

        if "You audit whether an AI answer" in system_instruction_string:
            with self.lock:
                self.evaluation_calls.append(prompt)
            claims = self.claims or [
                {"claim": "the answer cites a paper", "verdict": "YES"},
                {"claim": "a second claim", "verdict": "PARTIALLY"},
            ]
            return json.dumps({"claims": claims})

        # Answer generation (non-streaming path).
        if self.delay:
            time.sleep(self.delay)
        return "".join(self.tokens)

    def generate_response_stream(self, prompt, system_instruction_string=None, cancel_event=None, **kwargs):
        chunk_index = self._chunk_index_from_prompt(prompt)
        with self.lock:
            self.stream_calls.append(chunk_index)

        if self.barrier is not None:
            # Blocks until every concurrently-generated chunk has arrived.
            self.barrier.wait(timeout=10)
        if self.delay:
            time.sleep(self.delay)
        if self.fail_for_chunk == chunk_index:
            raise LLMUnavailable("provider exploded")

        for token in self.tokens:
            if cancel_event is not None and cancel_event.is_set():
                return
            yield f"{token}{chunk_index}"


class FakeArxivClient:
    """
    Stands in for the live arXiv source.

    Patched in by default with nothing to offer, so tests that are not about
    the fallback keep the behaviour they had before it existed — and, more
    importantly, so no test ever reaches the real arxiv.org.
    """

    def __init__(self, results=None, error=None):
        self.results = list(results or [])
        self.error = error
        self.calls = []

    def search(self, query, max_results=None, budget=None):
        self.calls.append({"query": query, "budget": budget})
        if self.error:
            raise self.error
        return [dict(result) for result in self.results]


def arxiv_paper(title, summary="a summary"):
    """A live-source candidate, shaped exactly like a collection document."""
    return {
        "document": f"Title: {title}\n\nAbstract: {summary}",
        "meta": {
            "source": "arxiv_api",
            "arxiv_id": "1234.5678",
            "id": "1234.5678",
            "title": title,
            "abstract": summary,
            "authors": "A. Author",
            "categories": "cs.LG",
        },
        "source": "arxiv_api",
    }


class PipelineTestCase(TestCase):
    """Base class that patches the query transforms for the duration of a test."""

    hyde = staticmethod(lambda query, **kwargs: "hypothetical abstract")
    step_back = staticmethod(
        lambda query, **kwargs: {
            "abstracted_query": "broader question",
            "categories": [],
            "confidence": "high",
        }
    )
    fusion = staticmethod(lambda query, **kwargs: ["variant one", "variant two"])

    def make_index(
        self, dense=None, llm=None, hyde=None, step_back=None, fusion=None, arxiv=None
    ):
        self.dense = dense or FakeDenseRAG()
        self.llm = llm or FakeLLMService()
        self.arxiv = arxiv or FakeArxivClient()

        patches = [
            mock.patch("airecommender.main.DenseRAG", return_value=self.dense),
            mock.patch("airecommender.main.get_llm_service", return_value=self.llm),
            mock.patch("airecommender.main.ArxivClient", return_value=self.arxiv),
            mock.patch("airecommender.main.generate_hypothetical_abstract", hyde or self.hyde),
            mock.patch("airecommender.main.step_back", step_back or self.step_back),
            mock.patch("airecommender.main.generate_query_variants", fusion or self.fusion),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        return RAGIndex()

    @staticmethod
    def collect(index, query="my query", cancel_event=None):
        return list(index.main_pipeline_stream(query, cancel_event=cancel_event))

    @staticmethod
    def types(events):
        return [event["type"] for event in events]


# ── Event contract ───────────────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=5, CHUNK_SIZE=5, GENERATION_MAX_WORKERS=3)
class StreamContractTests(PipelineTestCase):
    def test_event_sequence_matches_the_documented_contract(self):
        index = self.make_index()

        events = self.collect(index)
        kinds = self.types(events)

        self.assertEqual(kinds[0], "progress")
        self.assertEqual(kinds.count("chunk_start"), 1)
        self.assertEqual(kinds.count("chunk_end"), 1)
        self.assertEqual(kinds[-1], "complete")
        self.assertLess(kinds.index("chunk_start"), kinds.index("chunk_token"))
        self.assertLess(kinds.index("chunk_token"), kinds.index("chunk_end"))

    def test_chunk_end_carries_docs_and_full_text(self):
        index = self.make_index()

        end = [e for e in self.collect(index) if e["type"] == "chunk_end"][0]

        self.assertEqual(end["generated_response"], "answer1")
        self.assertEqual(end["num_docs_in_chunk"], len(end["docs"]))
        self.assertTrue(all({"document", "meta"} == set(d) for d in end["docs"]))

    def test_complete_reports_totals(self):
        index = self.make_index()

        complete = self.collect(index)[-1]

        self.assertEqual(complete["total_docs_retrieved"], 5)
        self.assertEqual(complete["num_chunks"], 1)
        self.assertIn("elapsed_ms", complete)

    def test_all_query_variants_reach_retrieval_in_one_call(self):
        index = self.make_index()

        self.collect(index)

        self.assertEqual(len(self.dense.retrieve_calls), 1, "one batched retrieval")
        queries = self.dense.retrieve_calls[0]
        self.assertEqual(queries[0], "my query", "original query keeps priority")
        self.assertIn("hypothetical abstract", queries)
        self.assertIn("broader question", queries)
        self.assertIn("variant one", queries)
        self.assertEqual(len(queries), len(set(queries)), "variants are deduplicated")


# ── Concurrency ──────────────────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=15, CHUNK_SIZE=5, GENERATION_MAX_WORKERS=3)
class ConcurrentGenerationTests(PipelineTestCase):
    @staticmethod
    def wide_dense():
        """15 distinct documents, so CHUNK_SIZE=5 produces three chunks."""
        return FakeDenseRAG(
            per_query_docs=[
                [
                    {"document": f"doc-{group}-{i}", "meta": {}, "dense_score": 0.5}
                    for i in range(5)
                ]
                for group in range(3)
            ],
            total=100,
        )

    def test_chunks_generate_concurrently_and_emit_in_order(self):
        """
        Every chunk's generation waits on a 3-party barrier before producing a
        token.  Sequential generation would deadlock (and fail on the barrier
        timeout), so passing proves the calls overlap — while the emitted events
        must still be strictly chunk-ordered.
        """
        barrier = threading.Barrier(3)
        index = self.make_index(dense=self.wide_dense(), llm=FakeLLMService(barrier=barrier))

        events = self.collect(index)

        chunk_events = [e for e in events if e["type"].startswith("chunk_")]
        self.assertEqual(len(self.llm.stream_calls), 3)

        # Order check: all of chunk 1's events, then chunk 2's, then chunk 3's.
        seen_order = [e["chunk_index"] for e in chunk_events]
        self.assertEqual(seen_order, sorted(seen_order))
        self.assertEqual(
            [e["chunk_index"] for e in chunk_events if e["type"] == "chunk_start"],
            [1, 2, 3],
        )
        for index_number in (1, 2, 3):
            tokens = [
                e for e in chunk_events
                if e["type"] == "chunk_token" and e["chunk_index"] == index_number
            ]
            self.assertTrue(tokens, f"chunk {index_number} produced no tokens")

    def test_wall_clock_is_the_slowest_chunk_not_the_sum(self):
        index = self.make_index(
            dense=self.wide_dense(), llm=FakeLLMService(delay=0.4)
        )

        started = time.monotonic()
        self.collect(index)
        elapsed = time.monotonic() - started

        # Sequential would be ~1.2s for three 0.4s chunks.
        self.assertLess(elapsed, 1.0, f"generation did not overlap (took {elapsed:.2f}s)")

    def test_query_transforms_run_concurrently(self):
        barrier = threading.Barrier(3)

        def blocking_hyde(query, **kwargs):
            barrier.wait(timeout=10)
            return "hyde text"

        def blocking_step_back(query, **kwargs):
            barrier.wait(timeout=10)
            return {"abstracted_query": "step back text", "categories": []}

        def blocking_fusion(query, **kwargs):
            barrier.wait(timeout=10)
            return ["fusion text"]

        index = self.make_index(
            hyde=blocking_hyde, step_back=blocking_step_back, fusion=blocking_fusion
        )

        variants = index._build_query_variants("q")

        self.assertEqual(variants, ["q", "hyde text", "step back text", "fusion text"])

    def test_one_failing_chunk_does_not_lose_the_others(self):
        index = self.make_index(
            dense=self.wide_dense(), llm=FakeLLMService(fail_for_chunk=2)
        )

        events = self.collect(index)

        ends = {e["chunk_index"]: e for e in events if e["type"] == "chunk_end"}
        self.assertEqual(sorted(ends), [1, 2, 3])
        self.assertIn("Error generating response", ends[2]["generated_response"])
        self.assertIn("error", ends[2])
        self.assertEqual(ends[1]["generated_response"], "answer1")
        self.assertEqual(ends[3]["generated_response"], "answer3")
        self.assertEqual(self.types(events)[-1], "complete")


# ── Document cap ─────────────────────────────────────────────────────────────


class DocumentCapTests(PipelineTestCase):
    @staticmethod
    def many_docs(count):
        return FakeDenseRAG(
            per_query_docs=[
                [
                    {"document": f"doc-{group}-{i}", "meta": {}, "dense_score": 0.5}
                    for i in range(count)
                ]
                for group in range(4)
            ],
            total=1000,
        )

    @override_settings(MAX_CONTEXT_DOCS=12, CHUNK_SIZE=5, GENERATION_MAX_WORKERS=3)
    def test_cap_limits_generation_calls(self):
        """
        40 unique documents used to become 8 sequential generation calls.  RRF
        plus the cap keeps the best 12, i.e. three chunks that run concurrently.
        """
        index = self.make_index(dense=self.many_docs(10))

        events = self.collect(index)

        self.assertEqual(events[-1]["total_docs_retrieved"], 12)
        self.assertEqual(events[-1]["num_chunks"], 3)
        self.assertEqual(len(self.llm.stream_calls), 3)

    @override_settings(MAX_CONTEXT_DOCS=3, CHUNK_SIZE=5)
    def test_documents_arrive_in_fused_order(self):
        # "shared" is retrieved by every variant, so RRF must rank it first even
        # though each list has a different document at rank 1.
        dense = FakeDenseRAG(
            per_query_docs=[
                [{"document": "solo-a", "meta": {}}, {"document": "shared", "meta": {}}],
                [{"document": "solo-b", "meta": {}}, {"document": "shared", "meta": {}}],
                [{"document": "solo-c", "meta": {}}, {"document": "shared", "meta": {}}],
            ],
            total=100,
        )
        index = self.make_index(dense=dense)

        end = [e for e in self.collect(index) if e["type"] == "chunk_end"][0]

        self.assertEqual(end["docs"][0]["document"], "shared")


# ── Failure reporting ────────────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=5, CHUNK_SIZE=5)
class FailureReportingTests(PipelineTestCase):
    def test_empty_collection_reports_an_error_not_a_success(self):
        index = self.make_index(dense=FakeDenseRAG(total=0))

        events = self.collect(index)

        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("empty", events[-1]["message"].lower())

    def test_unreachable_vector_store_reports_an_error(self):
        index = self.make_index(
            dense=FakeDenseRAG(count_error=VectorStoreUnavailable("chroma is down"))
        )

        events = self.collect(index)

        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("chroma is down", events[-1]["message"])

    def test_no_matches_still_completes(self):
        index = self.make_index(dense=FakeDenseRAG(per_query_docs=[[], [], [], []]))

        events = self.collect(index)

        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["total_docs_retrieved"], 0)

    def test_slow_transform_is_dropped_at_the_stage_deadline(self):
        def slow_hyde(query, **kwargs):
            time.sleep(1.0)
            return "too late"

        with override_settings(VARIANT_STAGE_TIMEOUT=0.3):
            index = self.make_index(hyde=slow_hyde)
            variants = index._build_query_variants("q")

        self.assertNotIn("too late", variants)
        self.assertIn("broader question", variants)

    def test_cancel_event_stops_the_pipeline(self):
        cancel = threading.Event()
        index = self.make_index()

        events = []
        for event in index.main_pipeline_stream("quantum error correction", cancel_event=cancel):
            events.append(event)
            if event["type"] == "chunk_token":
                cancel.set()

        self.assertNotIn("complete", self.types(events))


# ── Non-streaming pipeline ───────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=15, CHUNK_SIZE=5, GENERATION_MAX_WORKERS=3)
class NonStreamingPipelineTests(PipelineTestCase):
    def test_responses_stay_in_chunk_order(self):
        dense = FakeDenseRAG(
            per_query_docs=[
                [
                    {"document": f"doc-{group}-{i}", "meta": {}, "dense_score": 0.5}
                    for i in range(5)
                ]
                for group in range(3)
            ],
            total=100,
        )
        index = self.make_index(dense=dense, llm=FakeLLMService(delay=0.2))

        started = time.monotonic()
        result = index.main_pipeline("quantum error correction")
        elapsed = time.monotonic() - started

        self.assertEqual([r["chunk_index"] for r in result["responses"]], [1, 2, 3])
        self.assertEqual(result["num_chunks"], 3)
        # Sequential generation would be ~0.6s for three 0.2s chunks.
        self.assertLess(elapsed, 0.5, "chunks did not generate concurrently")

    def test_empty_collection_raises_instead_of_returning_empty_success(self):
        index = self.make_index(dense=FakeDenseRAG(total=0))

        with self.assertRaises(VectorStoreUnavailable):
            index.main_pipeline("quantum error correction")


# ── Relevance agent, end to end ──────────────────────────────────────────────


@override_settings(
    MAX_CONTEXT_DOCS=12,
    CHUNK_SIZE=5,
    GENERATION_MAX_WORKERS=3,
    ENABLE_RELEVANCE_AGENT=True,
    AGENT_MIN_RELEVANT_DOCS=2,
    AGENT_MAX_ITERATIONS=2,
)
class RelevanceAgentPipelineTests(PipelineTestCase):
    """The whole point: unrelated papers must not reach the answer."""

    def test_unrelated_papers_never_reach_generation(self):
        index = self.make_index(llm=FakeLLMService(unrelated={"doc-1", "doc-3"}))

        events = self.collect(index)

        served = [
            d["document"]
            for event in events
            if event["type"] == "chunk_end"
            for d in event["docs"]
        ]
        self.assertEqual(sorted(served), ["doc-0", "doc-2", "doc-4"])
        self.assertNotIn("doc-1", served)
        self.assertNotIn("doc-3", served)
        self.assertEqual(events[-1]["total_docs_retrieved"], 3)

    def test_grading_sees_trimmed_candidates_and_the_user_query(self):
        index = self.make_index()

        self.collect(index, query="graph neural networks")

        self.assertEqual(len(self.llm.grade_calls), 1)
        listed = self.llm.grade_calls[0]
        self.assertEqual(len(listed), 5, "every candidate is graded in one call")

    def test_relevance_progress_is_reported(self):
        index = self.make_index(llm=FakeLLMService(unrelated={"doc-1"}))

        events = self.collect(index)

        relevance = [
            event
            for event in events
            if event["type"] == "progress" and event["step"] == "relevance"
        ]
        statuses = [event["status"] for event in relevance]
        self.assertIn("searching", statuses)
        self.assertIn("graded", statuses)

        graded = next(e for e in relevance if e["status"] == "graded")
        self.assertEqual(graded["kept"], 4)
        self.assertEqual(graded["rejected"], 1)
        self.assertEqual(events[-1]["agent_outcome"], "accepted")

    def test_no_related_papers_reports_instead_of_answering(self):
        """No answer is better than an answer built from unrelated papers."""
        index = self.make_index(
            llm=FakeLLMService(unrelated={"doc-"})  # rejects every candidate
        )

        events = self.collect(index)
        kinds = self.types(events)

        self.assertNotIn("chunk_start", kinds)
        self.assertNotIn("chunk_token", kinds)
        self.assertEqual(kinds[-1], "complete")
        self.assertEqual(events[-1]["total_docs_retrieved"], 0)
        self.assertEqual(events[-1]["agent_outcome"], "no_relevant")
        self.assertIn("none were related", events[-1]["notice"])

    def test_it_retries_with_a_refined_query_before_giving_up(self):
        index = self.make_index(
            llm=FakeLLMService(unrelated={"doc-"}, refined_query="sparse attention kernels")
        )

        events = self.collect(index)

        self.assertEqual(len(self.llm.refine_calls), 1)
        self.assertIn("off topic for this query", self.llm.refine_calls[0])
        refining = [
            e for e in events
            if e["type"] == "progress" and e.get("status") == "refining"
        ]
        self.assertEqual(len(refining), 1)
        self.assertEqual(refining[0]["refined_query"], "sparse attention kernels")
        self.assertEqual(len(self.dense.retrieve_calls), 2, "it searched again")
        self.assertEqual(self.dense.retrieve_calls[1], ["sparse attention kernels"])

    def test_grader_outage_returns_unfiltered_results_and_says_so(self):
        index = self.make_index(
            llm=FakeLLMService(grader_error=RuntimeError("grader provider down"))
        )

        events = self.collect(index)

        warned = [
            e for e in events
            if e["type"] == "progress" and e.get("status") == "grader_unavailable"
        ]
        self.assertEqual(len(warned), 1)
        self.assertEqual(events[-1]["agent_outcome"], "grader_unavailable")
        self.assertEqual(events[-1]["total_docs_retrieved"], 5, "nothing was dropped")
        self.assertIn("notice", events[-1])

    def test_unparseable_grades_also_pass_through(self):
        index = self.make_index(
            llm=FakeLLMService(grader_response="I can't help with that.")
        )

        events = self.collect(index)

        self.assertEqual(events[-1]["agent_outcome"], "grader_unavailable")
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)

    @override_settings(ENABLE_RELEVANCE_AGENT=False)
    def test_agent_can_be_switched_off(self):
        index = self.make_index(llm=FakeLLMService(unrelated={"doc-1"}))

        events = self.collect(index)

        self.assertEqual(self.llm.grade_calls, [], "no grading when disabled")
        relevance = [
            e for e in events
            if e["type"] == "progress" and e["step"] == "relevance"
        ]
        self.assertEqual(relevance, [])
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)
        self.assertNotIn("agent_outcome", events[-1])

    def test_non_streaming_pipeline_also_filters(self):
        index = self.make_index(llm=FakeLLMService(unrelated={"doc-1", "doc-3"}))

        result = index.main_pipeline("quantum error correction")

        served = [
            d["document"] for response in result["responses"] for d in response["docs"]
        ]
        self.assertEqual(sorted(served), ["doc-0", "doc-2", "doc-4"])
        self.assertEqual(result["total_docs_retrieved"], 3)

    def test_non_streaming_pipeline_reports_when_nothing_is_related(self):
        index = self.make_index(llm=FakeLLMService(unrelated={"doc-"}))

        result = index.main_pipeline("quantum error correction")

        self.assertEqual(result["responses"], [])
        self.assertEqual(result["agent_outcome"], "no_relevant")
        self.assertIn("notice", result)


# ── Answer grounding ─────────────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=5, CHUNK_SIZE=5, ENABLE_RELEVANCE_AGENT=True)
class AnswerEvaluationTests(PipelineTestCase):
    def test_off_by_default(self):
        index = self.make_index()

        events = self.collect(index)

        end = next(e for e in events if e["type"] == "chunk_end")
        self.assertNotIn("evaluation", end)
        self.assertIsNone(events[-1]["aggregate_faithfulness"])
        self.assertEqual(self.llm.evaluation_calls, [])

    @override_settings(ENABLE_ANSWER_EVALUATION=True)
    def test_when_enabled_it_fills_the_ui_contract(self):
        index = self.make_index()

        events = self.collect(index)

        end = next(e for e in events if e["type"] == "chunk_end")
        evaluation = end["evaluation"]
        self.assertEqual(evaluation["faithfulness_score"], 0.75)  # (1 + 0.5) / 2
        self.assertEqual(evaluation["total_claims"], 2)
        self.assertEqual(evaluation["supported_claims"], 1)
        self.assertEqual(len(evaluation["claims"]), 2)
        self.assertEqual(events[-1]["aggregate_faithfulness"], 0.75)

    @override_settings(ENABLE_ANSWER_EVALUATION=True)
    def test_a_failed_chunk_is_not_evaluated(self):
        index = self.make_index(llm=FakeLLMService(fail_for_chunk=1))

        events = self.collect(index)

        end = next(e for e in events if e["type"] == "chunk_end")
        self.assertIn("error", end)
        self.assertNotIn("evaluation", end)
        self.assertIsNone(events[-1]["aggregate_faithfulness"])


# ── API layer ────────────────────────────────────────────────────────────────


@override_settings(MAX_CONTEXT_DOCS=5, CHUNK_SIZE=5, SSE_HEARTBEAT_SECONDS=0.1)
class StreamViewTests(TestCase):
    def setUp(self):
        self.dense = FakeDenseRAG()
        self.llm = FakeLLMService()
        self.arxiv = FakeArxivClient()
        patches = [
            mock.patch("airecommender.main.DenseRAG", return_value=self.dense),
            mock.patch("airecommender.main.get_llm_service", return_value=self.llm),
            mock.patch("airecommender.main.ArxivClient", return_value=self.arxiv),
            mock.patch(
                "airecommender.main.generate_hypothetical_abstract",
                lambda query, **kwargs: "hyde",
            ),
            mock.patch(
                "airecommender.main.step_back",
                lambda query, **kwargs: {"abstracted_query": "broader", "categories": []},
            ),
            mock.patch(
                "airecommender.main.generate_query_variants",
                lambda query, **kwargs: ["v1"],
            ),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        self.index = RAGIndex()
        index_patch = mock.patch("airecommender.views.get_rag_index", return_value=self.index)
        index_patch.start()
        self.addCleanup(index_patch.stop)

    def post_stream(self, prompt="my query"):
        return self.client.post(
            "/api/v1/prompt/stream/",
            data=json.dumps({"input_prompt": prompt}),
            content_type="application/json",
        )

    @staticmethod
    def parse_sse(body: str):
        events = []
        for frame in body.split("\n\n"):
            line = frame.strip()
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
        return events

    def test_stream_emits_sse_frames(self):
        response = self.post_stream()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        self.assertEqual(response["X-Accel-Buffering"], "no")

        body = b"".join(response.streaming_content).decode()
        events = self.parse_sse(body)

        self.assertEqual(events[0]["type"], "progress")
        self.assertEqual(events[-1]["type"], "complete")
        self.assertIn("chunk_token", [e["type"] for e in events])

    def test_heartbeat_is_emitted_while_the_pipeline_is_quiet(self):
        """
        A slow first LLM token must not look like a dead connection: the view
        emits an SSE comment, which clients ignore.
        """
        with mock.patch.object(
            self.index, "main_pipeline_stream", self._slow_pipeline
        ):
            response = self.post_stream()
            body = b"".join(response.streaming_content).decode()

        self.assertIn(": keepalive", body)
        self.assertIn('"type": "complete"', body)

    @staticmethod
    def _slow_pipeline(query, cancel_event=None):
        time.sleep(0.35)  # longer than SSE_HEARTBEAT_SECONDS
        yield {"type": "complete", "total_docs_retrieved": 0, "num_chunks": 0}

    def test_missing_prompt_is_rejected(self):
        response = self.client.post(
            "/api/v1/prompt/stream/",
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_capacity_limit_returns_503_with_retry_after(self):
        from airecommender import views

        # Fill every slot, then confirm the next request is rejected fast rather
        # than piling up behind the others.
        held = [views._acquire_slot() for _ in range(views._MAX_CONCURRENT_QUERIES)]
        try:
            response = self.post_stream()
        finally:
            for slot in held:
                slot.release()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "10")

    def test_slot_is_released_after_a_successful_stream(self):
        from airecommender import views

        response = self.post_stream()
        b"".join(response.streaming_content)
        response.close()

        held = []
        try:
            for _ in range(views._MAX_CONCURRENT_QUERIES):
                slot = views._acquire_slot()
                self.assertIsNotNone(slot, "a slot leaked from the previous request")
                held.append(slot)
        finally:
            for slot in held:
                slot.release()

    def test_slot_is_released_when_the_client_disconnects(self):
        """
        A dropped connection must not leak its capacity permit — otherwise
        MAX_CONCURRENT_QUERIES disconnects wedge the endpoint at 503 forever.
        """
        from airecommender import views

        response = self.post_stream()
        stream = iter(response.streaming_content)
        next(stream)  # consume one frame, then walk away like a closed tab
        response.close()

        held = []
        try:
            for _ in range(views._MAX_CONCURRENT_QUERIES):
                slot = views._acquire_slot()
                self.assertIsNotNone(slot, "a slot leaked on client disconnect")
                held.append(slot)
        finally:
            for slot in held:
                slot.release()

    def test_readiness_times_out_instead_of_hanging(self):
        """A stalled dependency must not hold the health check open."""
        stalled = threading.Event()
        self.addCleanup(stalled.set)

        def hang():
            stalled.wait(30)
            return {"ready": True, "checks": {}}

        with mock.patch.object(self.index, "readiness", hang), override_settings(
            READINESS_TIMEOUT=0.3
        ), mock.patch("airecommender.views.get_rag_index", return_value=self.index):
            started = time.monotonic()
            response = self.client.get("/api/v1/health/ready/")
            elapsed = time.monotonic() - started

        self.assertEqual(response.status_code, 503)
        self.assertIn("timed out", response.json()["error"])
        self.assertLess(elapsed, 5, "readiness blocked on the stalled dependency")

    def test_readiness_probe_is_single_flighted(self):
        """Concurrent probes reuse the last report instead of piling up."""
        entered = threading.Event()
        release = threading.Event()
        self.addCleanup(release.set)
        calls = []

        def slow_probe():
            calls.append(1)
            entered.set()
            release.wait(5)
            return {"ready": True, "checks": {}}

        with mock.patch.object(self.index, "_probe_dependencies", slow_probe):
            first = threading.Thread(
                target=lambda: self.index.readiness(use_cache=False), daemon=True
            )
            first.start()
            entered.wait(5)

            report = self.index.readiness(use_cache=False)
            self.assertTrue(report.get("stale"))
            self.assertEqual(len(calls), 1, "a second probe was started")

            release.set()
            first.join(5)

    def test_transforms_run_without_retries(self):
        """
        Transform retries would let a single stalled call outlive the stage
        deadline, so the pipeline asks for exactly one attempt.
        """
        seen = {}

        def capture_hyde(query, **kwargs):
            seen.update(kwargs)
            return "hyde"

        with mock.patch("airecommender.main.generate_hypothetical_abstract", capture_hyde):
            self.index._build_query_variants("q")

        self.assertEqual(seen.get("max_retries"), 0)
        self.assertEqual(seen.get("timeout"), self.index.transform_timeout)

    def test_pipeline_error_becomes_an_sse_error_event(self):
        def broken(query, cancel_event=None):
            raise RuntimeError("unexpected")
            yield  # pragma: no cover — makes this a generator

        with mock.patch.object(self.index, "main_pipeline_stream", broken):
            response = self.post_stream()
            body = b"".join(response.streaming_content).decode()

        events = self.parse_sse(body)
        self.assertEqual(events[-1]["type"], "error")
        # The raw exception text stays in the log, not in the response.
        self.assertNotIn("unexpected", body)


# ── Live arXiv fallback, end to end ──────────────────────────────────────────


@override_settings(
    MAX_CONTEXT_DOCS=12,
    CHUNK_SIZE=5,
    ENABLE_RELEVANCE_AGENT=True,
    ENABLE_ARXIV_FALLBACK=True,
    ENABLE_QUERY_VERIFICATION=False,
    AGENT_MIN_RELEVANT_DOCS=6,
    AGENT_MAX_ITERATIONS=1,
)
class ArxivFallbackPipelineTests(PipelineTestCase):
    """
    The collection only ever returns five documents here, and the agent wants
    six, so every test in this class runs with the fallback triggered.
    """

    def test_live_papers_join_the_answer_when_the_collection_is_short(self):
        arxiv = FakeArxivClient([arxiv_paper("Live Paper One"), arxiv_paper("Live Paper Two")])
        index = self.make_index(arxiv=arxiv)

        events = self.collect(index)

        self.assertEqual(len(arxiv.calls), 1)
        served = [
            prompting.document_title(d["document"], meta=d.get("meta")) or d["document"]
            for event in events
            if event["type"] == "chunk_end"
            for d in event["docs"]
        ]
        self.assertIn("Live Paper One", served)
        self.assertIn("doc-0", served)
        self.assertEqual(events[-1]["total_docs_retrieved"], 7)

    def test_live_papers_are_labelled_as_such_on_the_wire(self):
        index = self.make_index(arxiv=FakeArxivClient([arxiv_paper("Live Paper")]))

        events = self.collect(index)

        sources = {
            (d.get("meta") or {}).get("source", "collection")
            for event in events
            if event["type"] == "chunk_end"
            for d in event["docs"]
        }
        self.assertEqual(sources, {"collection", "arxiv_api"})

    def test_the_live_search_is_reported_as_progress(self):
        index = self.make_index(arxiv=FakeArxivClient([arxiv_paper("Live Paper")]))

        events = self.collect(index)

        statuses = [
            event["status"]
            for event in events
            if event["type"] == "progress" and event["step"] == "relevance"
        ]
        self.assertIn("fallback_searching", statuses)
        self.assertIn("fallback_graded", statuses)

    def test_live_papers_are_graded_like_local_ones(self):
        # The grader rejects this paper by title, exactly as it would a local one.
        arxiv = FakeArxivClient([arxiv_paper("Irrelevant Live Paper")])
        index = self.make_index(
            llm=FakeLLMService(unrelated={"Irrelevant Live Paper"}), arxiv=arxiv
        )

        events = self.collect(index)

        served = [
            d["document"]
            for event in events
            if event["type"] == "chunk_end"
            for d in event["docs"]
        ]
        self.assertFalse([d for d in served if "Irrelevant Live Paper" in d])
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)

    def test_an_unreachable_arxiv_still_answers_from_the_collection(self):
        """The user's requirement: arXiv down must fall back to ChromaDB."""
        arxiv = FakeArxivClient(error=OSError("connection refused"))
        index = self.make_index(arxiv=arxiv)

        events = self.collect(index)
        kinds = self.types(events)

        self.assertIn("chunk_end", kinds)
        served = [
            d["document"]
            for event in events
            if event["type"] == "chunk_end"
            for d in event["docs"]
        ]
        self.assertEqual(sorted(served), ["doc-0", "doc-1", "doc-2", "doc-3", "doc-4"])
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)
        self.assertEqual(events[-1]["agent_outcome"], "accepted")

    def test_an_unreachable_arxiv_is_reported_rather_than_hidden(self):
        index = self.make_index(arxiv=FakeArxivClient(error=OSError("connection refused")))

        events = self.collect(index)

        statuses = [
            event["status"]
            for event in events
            if event["type"] == "progress" and event["step"] == "relevance"
        ]
        self.assertIn("fallback_unavailable", statuses)
        self.assertIn("arXiv could not be reached", events[-1]["notice"])
        verification = events[-1]["verification"]
        self.assertIn("connection refused", verification["fallback_error"])

    def test_an_arxiv_outage_never_becomes_a_request_failure(self):
        index = self.make_index(arxiv=FakeArxivClient(error=RuntimeError("boom")))

        events = self.collect(index)

        self.assertNotIn("error", self.types(events))
        self.assertEqual(self.types(events)[-1], "complete")

    def test_a_client_that_failed_to_build_claims_nothing_about_arxiv(self):
        """
        A client that failed at startup leaves the fallback off entirely, so
        the run says nothing about arXiv at all — rather than reporting a
        source that was never contacted as one that had nothing to offer.
        """
        index = self.make_index()
        index.arxiv_client = None  # what a failed ArxivClient() leaves behind

        events = self.collect(index)

        self.assertFalse(index._fallback_enabled)
        statuses = [
            event["status"]
            for event in events
            if event["type"] == "progress" and event["step"] == "relevance"
        ]
        self.assertFalse([s for s in statuses if s.startswith("fallback")])
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)

    def test_calling_the_fallback_without_a_client_is_unavailable_not_empty(self):
        # The guard above means the agent never reaches this, but returning []
        # here would be reported to the user as "arXiv had nothing", which is a
        # false statement about a source that was never contacted.
        index = self.make_index()
        index.arxiv_client = None

        with self.assertRaises(ArxivUnavailable):
            index._arxiv_fallback("quantum error correction", 5.0)

    @override_settings(AGENT_MIN_RELEVANT_DOCS=2)
    def test_a_well_stocked_collection_never_calls_out(self):
        arxiv = FakeArxivClient([arxiv_paper("Live Paper")])
        index = self.make_index(arxiv=arxiv)

        self.collect(index)

        self.assertEqual(arxiv.calls, [])

    @override_settings(ENABLE_ARXIV_FALLBACK=False)
    def test_the_fallback_can_be_switched_off(self):
        arxiv = FakeArxivClient([arxiv_paper("Live Paper")])
        index = self.make_index(arxiv=arxiv)

        self.collect(index)

        self.assertEqual(arxiv.calls, [])

    @override_settings(ENABLE_RELEVANCE_AGENT=False)
    def test_no_grader_means_no_live_source(self):
        """Nothing would hold live results to the same standard, so: off."""
        arxiv = FakeArxivClient([arxiv_paper("Live Paper")])
        index = self.make_index(arxiv=arxiv)

        self.collect(index)

        self.assertFalse(index._fallback_enabled)
        self.assertEqual(arxiv.calls, [])


# ── Boundary verification, end to end ────────────────────────────────────────


@override_settings(
    MAX_CONTEXT_DOCS=5,
    CHUNK_SIZE=5,
    ENABLE_QUERY_VERIFICATION=True,
    ENABLE_RESULT_VERIFICATION=True,
    ENABLE_ARXIV_FALLBACK=False,
)
class VerificationPipelineTests(PipelineTestCase):
    def test_an_unsearchable_query_costs_nothing(self):
        index = self.make_index()

        events = self.collect(index, query="?")
        kinds = self.types(events)

        self.assertEqual(kinds[-1], "complete")
        self.assertNotIn("chunk_start", kinds)
        # The expensive stages never ran.
        self.assertEqual(self.dense.retrieve_calls, [])
        self.assertEqual(self.llm.grade_calls, [])
        self.assertEqual(self.llm.stream_calls, [])
        self.assertFalse(events[-1]["query_check"]["ok"])
        self.assertIn("notice", events[-1])

    def test_a_real_question_passes_the_check(self):
        index = self.make_index()

        events = self.collect(index, query="graph neural networks for drug discovery")
        checks = [
            event
            for event in events
            if event["type"] == "progress" and event["step"] == "query_check"
        ]

        self.assertEqual([event["status"] for event in checks], ["start", "done"])
        self.assertIn("chunk_end", self.types(events))

    def test_a_broken_checker_never_blocks_a_query(self):
        class Exploding(FakeLLMService):
            def generate_response(self, prompt, system_instruction_string="", **kwargs):
                if "You screen questions" in system_instruction_string:
                    raise RuntimeError("checker down")
                return super().generate_response(
                    prompt, system_instruction_string, **kwargs
                )

        index = self.make_index(llm=Exploding())

        events = self.collect(index, query="graph neural networks")

        self.assertIn("chunk_end", self.types(events))
        done = next(
            event
            for event in events
            if event["type"] == "progress" and event.get("step") == "query_check"
            and event["status"] == "done"
        )
        self.assertEqual(done["query_check"]["status"], "unavailable")

    @override_settings(ENABLE_QUERY_VERIFICATION=False)
    def test_the_query_check_can_be_switched_off(self):
        index = self.make_index()

        events = self.collect(index, query="?")

        self.assertNotIn(
            "query_check", [event.get("step") for event in events]
        )
        self.assertIn("chunk_end", self.types(events))

    def test_the_selection_is_described_before_it_is_answered_from(self):
        index = self.make_index()

        events = self.collect(index, query="graph neural networks")

        verification = next(
            event
            for event in events
            if event["type"] == "progress" and event["step"] == "verification"
        )
        report = verification["verification"]
        self.assertEqual(report["docs"], 5)
        self.assertEqual(report["sources"], {"collection": 5})
        self.assertIn("query_term_coverage", report)
        self.assertEqual(events[-1]["verification"]["docs"], 5)

        # It arrives before generation, not after.
        order = self.types(events)
        self.assertLess(order.index("progress"), order.index("chunk_start"))
        positions = [
            index_
            for index_, event in enumerate(events)
            if event["type"] == "progress" and event.get("step") == "verification"
        ]
        self.assertLess(positions[0], order.index("chunk_start"))

    @override_settings(ENABLE_RESULT_VERIFICATION=False)
    def test_result_verification_can_be_switched_off(self):
        index = self.make_index()

        events = self.collect(index, query="graph neural networks")

        self.assertNotIn("verification", events[-1])

    def test_the_non_streaming_pipeline_reports_the_same_things(self):
        index = self.make_index()

        result = index.main_pipeline("graph neural networks")

        self.assertEqual(result["verification"]["docs"], 5)
        self.assertNotIn("query_check", result)

    def test_a_rejected_query_is_reported_by_the_non_streaming_pipeline(self):
        index = self.make_index()

        result = index.main_pipeline("?")

        self.assertEqual(result["responses"], [])
        self.assertFalse(result["query_check"]["ok"])
        self.assertIn("notice", result)
        self.assertEqual(self.dense.retrieve_calls, [])
