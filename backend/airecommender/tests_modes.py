"""Mode isolation, complete deep flow, and regressions in perceived latency."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from django.test import override_settings

from airecommender.pipeline.errors import LLMUnavailable
from airecommender.pipeline.verification import QueryVerdict
from airecommender.tests_pipeline import (
    FakeArxivClient, FakeLLMService, PipelineTestCase, arxiv_paper,
)


@override_settings(MAX_CONTEXT_DOCS=12, CHUNK_SIZE=5, ENABLE_ANSWER_EVALUATION=False)
class SearchModeTests(PipelineTestCase):
    def test_fast_uses_one_search_grade_and_answer_without_extra_stages(self):
        index = self.make_index()
        with mock.patch.object(self.llm, "generate_response", wraps=self.llm.generate_response) as calls:
            events = list(index.main_pipeline_stream("research topic", mode="fast"))
        self.assertEqual(self.dense.retrieve_calls, [["research topic"]])
        self.assertEqual(len(self.llm.grade_calls), 1)
        self.assertEqual(len(self.llm.stream_calls), 1)
        self.assertEqual(calls.call_count, 1)  # only relevance, no LLM query check
        self.assertEqual(self.llm.refine_calls, [])
        self.assertEqual(self.arxiv.calls, [])
        self.assertEqual(self.llm.evaluation_calls, [])
        self.assertEqual(events[-1]["mode"], "fast")
        self.assertEqual(events[-1]["num_chunks"], 1)
        self.assertIn("verification", events[-1])

    def test_fast_still_rejects_unrelated_papers(self):
        index = self.make_index(llm=FakeLLMService(unrelated=[f"doc-{i}" for i in range(5)]))
        result = index.main_pipeline("research topic", mode="fast")
        self.assertEqual(result["total_docs_retrieved"], 0)
        self.assertEqual(result["agent_outcome"], "no_relevant")

    def test_deep_runs_all_transforms_and_grounding_even_when_legacy_flags_are_off(self):
        with override_settings(ENABLE_HYDE=False, ENABLE_STEP_BACK=False,
                               ENABLE_RAG_FUSION=False, ENABLE_RELEVANCE_AGENT=False,
                               ENABLE_QUERY_VERIFICATION=False, ENABLE_RESULT_VERIFICATION=False,
                               ENABLE_ARXIV_FALLBACK=False):
            index = self.make_index()
        events = list(index.main_pipeline_stream("research topic", mode="deep"))
        self.assertEqual(self.dense.retrieve_calls[0], [
            "research topic", "hypothetical abstract", "broader question", "variant one", "variant two",
        ])
        self.assertEqual(len(self.llm.grade_calls), 1)
        self.assertEqual(len(self.llm.evaluation_calls), 1)
        self.assertIn("verification", events[-1])
        self.assertEqual(events[-1]["aggregate_faithfulness"], 1.0)
        self.assertEqual(events[-1]["mode"], "deep")
        self.assertLess(self.types(events).index("chunk_end"), self.types(events).index("chunk_evaluation"))

    def test_deep_refines_then_grades_live_fallback(self):
        llm = FakeLLMService(unrelated=[f"doc-{i}" for i in range(5)], refined_query="refined question")
        arxiv = FakeArxivClient(results=[arxiv_paper("Related live paper")])
        index = self.make_index(llm=llm, arxiv=arxiv)
        result = index.main_pipeline("research topic", mode="deep")
        self.assertEqual(len(self.dense.retrieve_calls), 2)
        self.assertEqual(len(llm.refine_calls), 1)
        self.assertEqual(len(arxiv.calls), 1)
        self.assertEqual(len(llm.grade_calls), 3)
        self.assertEqual(len(llm.evaluation_calls), 1)
        self.assertEqual(result["verification"]["fallback_kept"], 1)

    def test_modes_do_not_mutate_each_other_or_the_shared_index(self):
        index = self.make_index()
        original = (index.enable_answer_evaluation, index.agent_max_iterations, index.max_context_docs)
        with ThreadPoolExecutor(max_workers=2) as pool:
            fast = pool.submit(index.main_pipeline, "fast topic", mode="fast")
            deep = pool.submit(index.main_pipeline, "deep topic", mode="deep")
            fast, deep = fast.result(), deep.result()
        self.assertIsNone(fast["aggregate_faithfulness"])
        self.assertEqual(deep["aggregate_faithfulness"], 1.0)
        self.assertEqual(original, (index.enable_answer_evaluation, index.agent_max_iterations, index.max_context_docs))
        self.assertEqual(index.generation_options, {})

    def test_deep_preparation_overlaps_all_three_independent_calls(self):
        index = self.make_index()
        profile = index.for_mode("deep")
        barrier = threading.Barrier(3)

        def finish(value):
            barrier.wait(timeout=3)
            return value

        with mock.patch.object(profile, "check_query", lambda query: finish(QueryVerdict())), \
             mock.patch.object(profile, "_build_query_variants", lambda query: finish([query])), \
             mock.patch.object(self.dense, "count", lambda: finish(25)):
            events = list(profile.main_pipeline_stream("research topic"))
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)

    def test_invalid_input_costs_no_deep_calls(self):
        index = self.make_index()
        with mock.patch.object(self.llm, "generate_response") as call, \
             mock.patch.object(self.dense, "count") as count:
            for mode in ("adaptive", "fast", "deep"):
                events = list(index.main_pipeline_stream("1234", mode=mode))
                self.assertEqual(events[-1]["query_check"]["ok"], False)
                self.assertEqual(events[-1]["mode"], mode)
        call.assert_not_called()
        count.assert_not_called()

    @override_settings(CHUNK_SIZE=2, GENERATION_MAX_WORKERS=3)
    def test_slow_deep_chunk_does_not_block_other_answers_or_documents(self):
        index = self.make_index()
        release = threading.Event()
        self.addCleanup(release.set)
        original = self.llm.generate_response_stream

        def stream(prompt, **kwargs):
            if "(chunk 1)" in prompt:
                if not release.wait(3):
                    raise AssertionError("Chunk 2 was held behind chunk 1")
            yield from original(prompt, **kwargs)

        with mock.patch.object(self.llm, "generate_response_stream", stream):
            events = []
            for event in index.main_pipeline_stream("research topic", mode="deep"):
                events.append(event)
                if event["type"] == "chunk_end" and event["chunk_index"] == 2:
                    release.set()
        ends = [event for event in events if event["type"] == "chunk_end"]
        self.assertNotEqual(ends[0]["chunk_index"], 1)
        self.assertTrue(all("error" not in event for event in ends))
        self.assertEqual(events[-1]["num_chunks"], 3)
        self.assertEqual(events[-1]["aggregate_faithfulness"], 1.0)

    def test_deep_sources_are_emitted_before_slow_evaluation_completes(self):
        index = self.make_index()
        release = threading.Event()
        self.addCleanup(release.set)

        def evaluate(query, answer, docs, *args, **kwargs):
            yield {"status": "checking", "message": "Checking the evidence"}
            self.assertTrue(release.wait(3), "Sources were hidden behind evaluation")
            return {"generated_response": answer, "evaluation": {"faithfulness_score": 1.0},
                    "answer_review": {"status": "checked"}}

        with mock.patch("airecommender.main.review_answer", evaluate):
            for event in index.main_pipeline_stream("research topic", mode="deep"):
                if event["type"] == "chunk_end":
                    self.assertTrue(event["docs"])
                    release.set()
        self.assertEqual(event["aggregate_faithfulness"], 1.0)

    def test_fast_generation_has_one_bounded_attempt(self):
        index = self.make_index()
        with mock.patch.object(self.llm, "generate_response_stream", wraps=self.llm.generate_response_stream) as call:
            list(index.main_pipeline_stream("research topic", mode="fast"))
        self.assertEqual(call.call_args.kwargs["timeout"], 60)
        self.assertEqual(call.call_args.kwargs["max_retries"], 0)

    def test_failed_non_streaming_generation_is_not_grounded(self):
        index = self.make_index().for_mode("deep")
        with mock.patch.object(self.llm, "generate_response", side_effect=LLMUnavailable("offline")):
            chunk = index._generate_chunk_response("research topic", [{"document": "paper"}], 1)
        self.assertIn("error", chunk)
        self.assertEqual(self.llm.evaluation_calls, [])

    def test_api_modes_work_for_streaming_and_json(self):
        index = self.make_index()
        with mock.patch("airecommender.views.get_rag_index", return_value=index):
            for endpoint in ("/api/v1/prompt/", "/api/v1/prompt/stream/"):
                for mode in ("fast", "deep"):
                    response = self.client.post(endpoint, data=json.dumps({"input_prompt": "research topic", "mode": mode}), content_type="application/json")
                    self.assertEqual(response.status_code, 200)
                    if response.streaming:
                        events = [json.loads(line[6:]) for line in b"".join(response.streaming_content).decode().splitlines() if line.startswith("data: ")]
                        result = events[-1]
                    else:
                        result = response.json()
                    self.assertEqual(result["mode"], mode)
                    self.assertEqual(result["aggregate_faithfulness"], 1.0 if mode == "deep" else None)
                    response.close()

    def test_bad_modes_and_non_object_bodies_are_rejected_before_pipeline_setup(self):
        with mock.patch("airecommender.views.get_rag_index") as build:
            for endpoint in ("/api/v1/prompt/", "/api/v1/prompt/stream/"):
                for payload in (["question"], {"input_prompt": "question", "mode": "invalid"}, {"input_prompt": {"nested": "question"}}):
                    response = self.client.post(endpoint, data=json.dumps(payload), content_type="application/json")
                    self.assertEqual(response.status_code, 400)
        build.assert_not_called()

    def test_default_api_mode_is_adaptive(self):
        index = self.make_index()
        with mock.patch("airecommender.views.get_rag_index", return_value=index):
            response = self.client.post("/api/v1/prompt/", data=json.dumps({"input_prompt": "research topic"}), content_type="application/json")
        self.assertEqual(response.json()["mode"], "adaptive")
        self.assertEqual(response.json()["research_plan"]["strategy"], "focused")
        self.assertEqual(response.json()["answer_review"]["checked"], 1)
