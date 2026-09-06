"""
Tests for the RAG pipeline's stability and concurrency behaviour.

Everything here runs without ChromaDB, without Ollama and without an API key —
the pieces that matter are either pure functions or exercised through fakes.
That is deliberate: these are exactly the conditions under which the service
used to fail to start at all.
"""

import json
import threading
import time
from unittest import mock

from django.test import TestCase, override_settings

from airecommender.pipeline import prompting
from airecommender.pipeline.errors import (
    EmbeddingUnavailable,
    LLMUnavailable,
    VectorStoreUnavailable,
)
from airecommender.pipeline.fusion import reciprocal_rank_fusion
from airecommender.pipeline.llm_service import (
    OpenRouterService,
    is_retryable_error,
    response_status_code,
)
from airecommender.pipeline.ordered_stream import ProducerError, stream_in_order


# ── Fakes ────────────────────────────────────────────────────────────────────


class FakeChunk:
    """Mimics a LangChain message chunk."""

    def __init__(self, text):
        self.content = text


class FakeLLM:
    """Stands in for ChatOpenAI."""

    def __init__(self, tokens=("a", "b", "c"), fail_at=None, error=None, on_stream=None):
        self.tokens = list(tokens)
        self.fail_at = fail_at
        self.error = error or ConnectionError("connection reset by peer")
        self.on_stream = on_stream
        self.stream_calls = 0
        self.invoke_calls = 0

    def stream(self, messages, **kwargs):
        self.stream_calls += 1
        if self.on_stream is not None:
            self.on_stream()
        for index, token in enumerate(self.tokens):
            if self.fail_at is not None and index == self.fail_at:
                raise self.error
            yield FakeChunk(token)

    def invoke(self, messages, **kwargs):
        self.invoke_calls += 1
        if self.fail_at == 0:
            raise self.error
        return FakeChunk("".join(self.tokens))


def build_llm_service(fake_llm):
    """Construct an OpenRouterService whose client is *fake_llm*."""
    with mock.patch(
        "airecommender.pipeline.llm_service.ChatOpenAI", return_value=fake_llm
    ):
        service = OpenRouterService(api_key="test-key")
    return service


class HttpError(Exception):
    """Exception carrying an HTTP status code, like the OpenAI SDK's."""

    def __init__(self, status_code, message="http error"):
        super().__init__(message)
        self.status_code = status_code


# ── Health / startup ─────────────────────────────────────────────────────────


@override_settings(OPENROUTER_API_KEY="")
class HealthCheckTests(TestCase):
    """
    The API must route and answer even with no credentials configured.

    Before the pipeline was made lazy, ``rag_index = RAGIndex()`` ran at import
    time, so an empty OPENROUTER_API_KEY raised inside the URL conf and *every*
    endpoint — including this health check — returned a 500.
    """

    def test_health_check_returns_200(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": 200, "message": "OK"})

    def test_readiness_reports_503_when_unconfigured(self):
        response = self.client.get("/api/v1/health/ready/")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ready"])

    def test_prompt_returns_503_not_500_when_unconfigured(self):
        response = self.client.post(
            "/api/v1/prompt/",
            data=json.dumps({"input_prompt": "anything"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 503)
        self.assertIn("error", response.json())

    def test_stats_endpoint_returns_200(self):
        response = self.client.get("/api/v1/stats/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("total_papers", data)
        self.assertIsInstance(data["total_papers"], int)

    def test_prompt_requires_input(self):
        response = self.client.post(
            "/api/v1/prompt/",
            data=json.dumps({"input_prompt": "   "}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)


# ── Rank fusion ──────────────────────────────────────────────────────────────


class ReciprocalRankFusionTests(TestCase):
    @staticmethod
    def docs(*names):
        return [{"document": name, "meta": {"id": name}} for name in names]

    def test_consensus_beats_a_single_top_hit(self):
        """A doc ranked 2nd by three variants outranks one ranked 1st by one."""
        fused = reciprocal_rank_fusion(
            [
                self.docs("solo", "shared"),
                self.docs("x", "shared"),
                self.docs("y", "shared"),
            ]
        )

        self.assertEqual(fused[0]["document"], "shared")
        self.assertEqual(fused[0]["rrf_sources"], 3)
        self.assertEqual(fused[0]["rrf_best_rank"], 2)

    def test_deduplicates_and_preserves_metadata(self):
        fused = reciprocal_rank_fusion([self.docs("a", "b"), self.docs("b", "a")])

        self.assertEqual(len(fused), 2)
        self.assertEqual(fused[0]["meta"], {"id": "a"})

    def test_deterministic_for_tied_scores(self):
        lists = [self.docs("a", "b", "c")]
        first = [d["document"] for d in reciprocal_rank_fusion(lists)]
        for _ in range(5):
            self.assertEqual(
                [d["document"] for d in reciprocal_rank_fusion(lists)], first
            )

    def test_limit_caps_output(self):
        fused = reciprocal_rank_fusion([self.docs(*"abcdefgh")], limit=3)
        self.assertEqual(len(fused), 3)

    def test_keeps_best_dense_score(self):
        fused = reciprocal_rank_fusion(
            [
                [{"document": "a", "dense_score": 0.2}],
                [{"document": "a", "dense_score": 0.9}],
            ]
        )
        self.assertEqual(fused[0]["dense_score"], 0.9)

    def test_empty_input(self):
        self.assertEqual(reciprocal_rank_fusion([]), [])
        self.assertEqual(reciprocal_rank_fusion([[], []]), [])


# ── Ordered parallel streaming ───────────────────────────────────────────────


class StreamInOrderTests(TestCase):
    def test_output_is_grouped_in_producer_order(self):
        def producer(name, count):
            def run():
                for i in range(count):
                    yield f"{name}{i}"

            return run

        items = list(
            stream_in_order(
                [producer("a", 3), producer("b", 2), producer("c", 1)],
                max_workers=3,
            )
        )

        self.assertEqual(items, ["a0", "a1", "a2", "b0", "b1", "c0"])

    def test_producers_really_run_concurrently(self):
        """
        Each producer waits for all three to arrive before emitting.

        A sequential implementation deadlocks on the barrier and the test fails
        on timeout; concurrency is therefore proven, not assumed.
        """
        barrier = threading.Barrier(3)

        def producer(name):
            def run():
                barrier.wait(timeout=10)
                yield name

            return run

        items = list(
            stream_in_order(
                [producer("a"), producer("b"), producer("c")],
                max_workers=3,
            )
        )

        self.assertEqual(items, ["a", "b", "c"])

    def test_slow_first_producer_does_not_reorder_output(self):
        def slow():
            time.sleep(0.3)
            yield "slow"

        def fast():
            yield "fast"

        items = list(stream_in_order([slow, fast], max_workers=2))
        self.assertEqual(items, ["slow", "fast"])

    def test_failing_producer_is_surfaced_without_losing_others(self):
        def boom():
            yield "partial"
            raise RuntimeError("kaboom")

        def fine():
            yield "ok"

        items = list(stream_in_order([boom, fine], max_workers=2))

        self.assertEqual(items[0], "partial")
        self.assertIsInstance(items[1], ProducerError)
        self.assertEqual(items[1].index, 0)
        self.assertEqual(items[2], "ok")

    def test_cancel_event_stops_the_stream(self):
        cancel = threading.Event()

        def endless():
            i = 0
            while True:
                yield i
                i += 1
                if i > 5:
                    cancel.set()

        items = list(stream_in_order([endless], max_workers=1, cancel_event=cancel))
        self.assertLess(len(items), 50)

    def test_no_producers(self):
        self.assertEqual(list(stream_in_order([])), [])


# ── LLM retry classification ─────────────────────────────────────────────────


class RetryClassificationTests(TestCase):
    def test_permanent_http_errors_are_not_retried(self):
        for code in (400, 401, 403, 404, 422):
            self.assertFalse(
                is_retryable_error(HttpError(code)), f"{code} should be permanent"
            )

    def test_transient_http_errors_are_retried(self):
        for code in (408, 429, 500, 502, 503, 504):
            self.assertTrue(
                is_retryable_error(HttpError(code)), f"{code} should be retryable"
            )

    def test_transport_errors_are_retried(self):
        class APITimeoutError(Exception):
            pass

        class APIConnectionError(Exception):
            pass

        self.assertTrue(is_retryable_error(APITimeoutError("took too long")))
        self.assertTrue(is_retryable_error(APIConnectionError("no route")))
        self.assertTrue(is_retryable_error(Exception("Request timed out")))

    def test_unknown_errors_are_not_retried(self):
        self.assertFalse(is_retryable_error(ValueError("bad model name")))
        self.assertFalse(is_retryable_error(KeyError("choices")))

    def test_status_from_nested_response(self):
        class WithResponse(Exception):
            def __init__(self):
                super().__init__("nope")
                self.response = mock.Mock(status_code=401)

        self.assertEqual(response_status_code(WithResponse()), 401)
        self.assertFalse(is_retryable_error(WithResponse()))


class LLMServiceTests(TestCase):
    def test_permanent_error_is_not_retried(self):
        llm = FakeLLM(fail_at=0, error=HttpError(401, "invalid api key"))
        service = build_llm_service(llm)

        with self.assertRaises(LLMUnavailable):
            service.generate_response("hi", use_cache=False)

        self.assertEqual(llm.invoke_calls, 1)  # no wasted retries

    def test_transient_error_is_retried(self):
        llm = FakeLLM(fail_at=0, error=HttpError(503, "upstream busy"))
        service = build_llm_service(llm)
        service.max_retries = 1

        with self.assertRaises(LLMUnavailable):
            service.generate_response("hi", use_cache=False)

        self.assertEqual(llm.invoke_calls, 2)

    def test_stream_retries_only_before_the_first_token(self):
        """A stream that dies mid-answer must not replay what was sent."""
        llm = FakeLLM(tokens=["Hello", " world", "!"], fail_at=2)
        service = build_llm_service(llm)

        collected = []
        with self.assertRaises(LLMUnavailable):
            for token in service.generate_response_stream("prompt"):
                collected.append(token)

        self.assertEqual(collected, ["Hello", " world"])
        self.assertEqual(llm.stream_calls, 1, "must not restart after partial output")

    def test_stream_retries_when_nothing_was_emitted(self):
        llm = FakeLLM(tokens=["ok"], fail_at=0)
        service = build_llm_service(llm)
        service.max_retries = 1

        with self.assertRaises(LLMUnavailable):
            list(service.generate_response_stream("prompt"))

        self.assertEqual(llm.stream_calls, 2)

    def test_stream_stops_on_cancel(self):
        cancel = threading.Event()
        llm = FakeLLM(tokens=[str(i) for i in range(100)])
        service = build_llm_service(llm)

        collected = []
        for token in service.generate_response_stream("prompt", cancel_event=cancel):
            collected.append(token)
            if len(collected) == 3:
                cancel.set()

        self.assertEqual(len(collected), 3)

    def test_client_is_cached_per_model_and_timeout(self):
        llm = FakeLLM()
        with mock.patch(
            "airecommender.pipeline.llm_service.ChatOpenAI", return_value=llm
        ) as factory:
            service = OpenRouterService(api_key="test-key")
            built_at_init = factory.call_count

            service._get_or_build_llm(service.model, service.request_timeout)
            self.assertEqual(factory.call_count, built_at_init, "should reuse client")

            # A different timeout needs its own client: LangChain drops per-call
            # timeouts, so the only real bound is the one bound at construction.
            service._get_or_build_llm(service.model, service.request_timeout + 1)
            self.assertEqual(factory.call_count, built_at_init + 1)

            kwargs = factory.call_args.kwargs
            self.assertEqual(kwargs["max_retries"], 0, "SDK retries must not stack")

    def test_response_cache_avoids_a_second_call(self):
        llm = FakeLLM(tokens=["cached"])
        service = build_llm_service(llm)

        first = service.generate_response("same prompt", response_mime_type_param="text/plain")
        second = service.generate_response("same prompt", response_mime_type_param="text/plain")

        self.assertEqual(first, second)
        self.assertEqual(llm.invoke_calls, 1)

    def test_coerce_text_skips_non_text_blocks(self):
        service = build_llm_service(FakeLLM())
        chunk = FakeChunk([{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "hi"}])
        self.assertEqual(service.coerce_text(chunk), "hi")


# ── Embeddings ───────────────────────────────────────────────────────────────


class FakeOllama:
    def __init__(self, dim=3, fail_times=0, short_by=0, models=("embeddinggemma:latest",)):
        self.dim = dim
        self.fail_times = fail_times
        self.short_by = short_by
        self.models = list(models)
        self.calls = []

    def embed(self, input, model, **kwargs):  # noqa: A002 — matches the ollama client API
        self.calls.append(list(input))
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError("ollama is down")
        count = max(0, len(input) - self.short_by)
        return {"embeddings": [[0.1] * self.dim for _ in range(count)]}

    def list(self):
        return {"models": [{"model": name} for name in self.models]}


def build_dense_rag(ollama, collection=None):
    from airecommender.pipeline.dense_rag import DenseRAG

    with mock.patch("airecommender.pipeline.dense_rag.Client", return_value=ollama):
        dense = DenseRAG()
    if collection is not None:
        dense._collection = collection
    return dense


class FakeCollection:
    def __init__(self, count=10, results=None, error=None):
        self.name = "test_collection"
        self._count = count
        self._results = results
        self.error = error
        self.query_calls = []
        self.count_calls = 0

    def count(self):
        self.count_calls += 1
        return self._count

    def query(self, query_embeddings, n_results, where=None, include=None):
        self.query_calls.append(
            {"n": len(query_embeddings), "n_results": n_results, "where": where}
        )
        if self.error:
            raise self.error
        if self._results is not None:
            return self._results
        # One result list per query embedding.
        return {
            "documents": [[f"doc{i}"] for i in range(len(query_embeddings))],
            "metadatas": [[{"i": i}] for i in range(len(query_embeddings))],
            "distances": [[0.1] for _ in query_embeddings],
        }


@override_settings(EMBEDDING_BATCH_SIZE=2, OLLAMA_EMBEDDING_MODEL="embeddinggemma")
class EmbeddingTests(TestCase):
    def test_embeddings_keep_input_order_and_length(self):
        ollama = FakeOllama()
        dense = build_dense_rag(ollama)

        result = dense._get_embeddings(["one", "two", "three"])

        self.assertEqual(len(result), 3)
        self.assertEqual(len(ollama.calls), 2)  # batched by EMBEDDING_BATCH_SIZE

    def test_short_response_raises_instead_of_misaligning(self):
        """
        A partial embedding list used to be accepted with a warning, which
        silently paired documents with the wrong metadata downstream.
        """
        dense = build_dense_rag(FakeOllama(short_by=1))

        with self.assertRaises(EmbeddingUnavailable):
            dense._get_embeddings(["one", "two"])

    def test_transient_failure_is_retried(self):
        ollama = FakeOllama(fail_times=1)
        dense = build_dense_rag(ollama)

        result = dense._get_embeddings(["one"])

        self.assertEqual(len(result), 1)
        self.assertEqual(len(ollama.calls), 2)

    def test_persistent_failure_raises(self):
        dense = build_dense_rag(FakeOllama(fail_times=99))

        with self.assertRaises(EmbeddingUnavailable):
            dense._get_embeddings(["one"])

    def test_repeated_text_is_embedded_once(self):
        ollama = FakeOllama()
        dense = build_dense_rag(ollama)

        dense._get_embeddings(["same"])
        dense._get_embeddings(["same"])

        self.assertEqual(len(ollama.calls), 1, "second call should hit the cache")

    def test_prefers_ollama_embedding_model_setting(self):
        """
        EMBEDDING_MODEL is easy to point at a non-Ollama model id (the shipped
        example did), which Ollama rejects on every request.
        """
        with override_settings(
            OLLAMA_EMBEDDING_MODEL="embeddinggemma",
            EMBEDDING_MODEL="openai/text-embedding-3-small",
        ):
            dense = build_dense_rag(FakeOllama())
        self.assertEqual(dense.embedding_model, "embeddinggemma")


@override_settings(TOP_K=2, CANDIDATE_MULTIPLIER=2, OLLAMA_EMBEDDING_MODEL="embeddinggemma")
class RetrieveManyTests(TestCase):
    def test_all_variants_use_one_chroma_query(self):
        collection = FakeCollection(count=100)
        dense = build_dense_rag(FakeOllama(), collection)

        results = dense.retrieve_many(["a", "b", "c"], total=100)

        self.assertEqual(len(results), 3)
        self.assertEqual(len(collection.query_calls), 1, "one batched round trip")
        self.assertEqual(collection.query_calls[0]["n"], 3)

    def test_duplicate_queries_are_searched_once_but_all_returned(self):
        collection = FakeCollection(count=100)
        ollama = FakeOllama()
        dense = build_dense_rag(ollama, collection)

        results = dense.retrieve_many(["a", "b", "a"], total=100)

        self.assertEqual(len(results), 3)
        self.assertEqual(collection.query_calls[0]["n"], 2)
        self.assertEqual(results[0], results[2])

    def test_known_total_skips_the_count_round_trip(self):
        collection = FakeCollection(count=100)
        dense = build_dense_rag(FakeOllama(), collection)

        dense.retrieve_many(["a"], total=100)

        self.assertEqual(collection.count_calls, 0)

    def test_n_results_never_exceeds_collection_size(self):
        collection = FakeCollection(count=3)
        dense = build_dense_rag(FakeOllama(), collection)

        dense.retrieve_many(["a"], total=3)

        self.assertEqual(collection.query_calls[0]["n_results"], 3)

    def test_empty_collection_returns_empty_lists(self):
        dense = build_dense_rag(FakeOllama(), FakeCollection(count=0))

        self.assertEqual(dense.retrieve_many(["a", "b"]), [[], []])

    def test_dimension_mismatch_is_reported_clearly(self):
        collection = FakeCollection(
            count=10, error=RuntimeError("Collection expecting embedding with dimension of 768, got 3")
        )
        dense = build_dense_rag(FakeOllama(), collection)

        with self.assertRaises(VectorStoreUnavailable) as ctx:
            dense.retrieve_many(["a"], total=10)

        self.assertIn("dimension", str(ctx.exception).lower())
        self.assertIn("embeddinggemma", str(ctx.exception))


# ── Prompt construction ──────────────────────────────────────────────────────


class PromptingTests(TestCase):
    def test_json_document_is_rendered_as_labelled_text(self):
        doc = json.dumps(
            {
                "title": "Attention Is All You Need",
                "category": "cs.CL",
                "authors": "Vaswani et al.",
                "summary": "We propose the Transformer.",
            }
        )

        rendered = prompting.format_document(doc)

        self.assertIn("Title: Attention Is All You Need", rendered)
        self.assertIn("Abstract: We propose the Transformer.", rendered)
        self.assertNotIn("{", rendered)

    def test_long_summary_is_truncated(self):
        doc = json.dumps({"title": "T", "summary": "word " * 2000})

        rendered = prompting.format_document(doc, max_chars=200)

        self.assertLess(len(rendered), 400)
        self.assertIn("truncated", rendered)

    def test_plain_text_document_still_works(self):
        rendered = prompting.format_document("just some text", max_chars=100)
        self.assertEqual(rendered, "just some text")

    def test_new_schema_document_is_rendered_as_labelled_text(self):
        doc = "Title: Sparsity-certifying Graph Decompositions\n\nAbstract: We describe a new algorithm."
        meta = {
            "title": "Sparsity-certifying Graph Decompositions",
            "categories": "math.CO cs.CG",
            "authors": "Ileana Streinu and Louis Theran",
            "abstract": "We describe a new algorithm.",
        }

        rendered = prompting.format_document(doc, meta=meta)

        self.assertIn("Title: Sparsity-certifying Graph Decompositions", rendered)
        self.assertIn("Category: math.CO cs.CG", rendered)
        self.assertIn("Authors: Ileana Streinu and Louis Theran", rendered)
        self.assertIn("Abstract: We describe a new algorithm.", rendered)

    def test_new_schema_candidate_formatting(self):
        doc = "Title: Sparsity-certifying Graph Decompositions\n\nAbstract: We describe a new algorithm."
        meta = {"categories": "math.CO cs.CG"}

        rendered = prompting.format_candidate(doc, meta=meta)
        self.assertIn("Sparsity-certifying Graph Decompositions [math.CO cs.CG]", rendered)
        self.assertIn("We describe a new algorithm.", rendered)

    def test_document_title_new_schema(self):
        doc = "Title: Sparsity-certifying Graph Decompositions\n\nAbstract: We describe a new algorithm."
        self.assertEqual(
            prompting.document_title(doc),
            "Sparsity-certifying Graph Decompositions",
        )

    def test_build_chunk_prompt_includes_query_and_every_document(self):
        chunk = [{"document": "one"}, {"document": "two"}]

        system, user = prompting.build_chunk_prompt("my query", chunk, 1)

        self.assertIn("research assistant", system)
        self.assertIn("my query", user)
        self.assertIn("--- Document 1 ---", user)
        self.assertIn("--- Document 2 ---", user)
