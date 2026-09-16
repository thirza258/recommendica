"""Adaptive routing, evidence-driven expansion, request isolation and APIs."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from django.test import SimpleTestCase, override_settings

from airecommender.pipeline.adaptive import plan_research
from airecommender.pipeline.agent.loop import RelevanceAgent, run_to_completion
from airecommender.tests_pipeline import (
    FakeArxivClient, FakeDenseRAG, FakeLLMService, PipelineTestCase, arxiv_paper,
)


class ResearchPlanTests(SimpleTestCase):
    def test_steps_are_selected_individually(self):
        cases = [
            ("What is self-attention?", (False, False, False)),
            ("Compare attention versus recurrence", (False, True, True)),
            ("Why does attention help?", (True, True, False)),
            ("What are the clinical safety findings?", (False, False, True)),
            ("A comprehensive literature review of attention", (True, True, True)),
            ("How does attention work? What are its limitations?", (False, True, True)),
        ]
        for query, expected in cases:
            with self.subTest(query=query):
                plan = plan_research(query)
                self.assertEqual((plan.hyde, plan.step_back, plan.fusion), expected)
                self.assertIn("evidence_review", plan.as_payload()["steps"])

    def test_expansion_does_not_mutate_the_initial_plan(self):
        initial = plan_research("What is attention?")
        expanded = initial.broaden()
        self.assertFalse(initial.expanded)
        self.assertFalse(initial.escalated)
        self.assertTrue(expanded.expanded)
        self.assertTrue(expanded.escalated)

    def test_expired_refinement_cannot_start_an_expanded_search(self):
        now = [0]
        retrieve, grade, fallback = mock.Mock(return_value=[]), mock.Mock(), mock.Mock()

        def refine(*args):
            now[0] = 31
            return "refined question"

        agent = RelevanceAgent(
            retrieve, grade, refine, fallback,
            clock=lambda: now[0], deadline_seconds=30, needs_more_fn=lambda docs: True,
        )
        result = run_to_completion(agent, "original question")
        self.assertEqual(retrieve.call_count, 1)
        self.assertTrue(result.deadline_hit)
        grade.assert_not_called()
        fallback.assert_not_called()


@override_settings(MAX_CONTEXT_DOCS=12, CHUNK_SIZE=5, AGENT_MIN_RELEVANT_DOCS=3)
class AdaptivePipelineTests(PipelineTestCase):
    def test_focused_search_skips_transforms_but_audits_the_answer(self):
        hyde, step_back, fusion = mock.Mock(), mock.Mock(), mock.Mock()
        index = self.make_index(hyde=hyde, step_back=step_back, fusion=fusion)
        with mock.patch.object(self.llm, "generate_response", wraps=self.llm.generate_response) as call:
            events = list(index.main_pipeline_stream("What is attention?", mode="adaptive"))
        for transform in (hyde, step_back, fusion):
            transform.assert_not_called()
        self.assertEqual(self.dense.retrieve_calls, [["What is attention?"]])
        self.assertEqual(call.call_count, 2)  # relevance + full answer audit, no planner call
        self.assertEqual(len(self.llm.stream_calls), 1)
        self.assertEqual(self.arxiv.calls, [])
        self.assertEqual(events[0]["research_plan"]["strategy"], "focused")
        self.assertEqual(events[-1]["mode"], "adaptive")
        self.assertEqual(events[-1]["answer_review"]["checked"], 1)
        self.assertEqual(events[-1]["research_plan"], events[0]["research_plan"])
        self.assertLess(self.types(events).index("chunk_end"), self.types(events).index("chunk_evaluation"))

    def test_comparison_uses_only_the_selected_transforms(self):
        index = self.make_index()
        result = index.main_pipeline("Compare attention versus recurrence", mode="adaptive")
        self.assertEqual(self.dense.retrieve_calls, [[
            "Compare attention versus recurrence", "broader question", "variant one", "variant two",
        ]])
        self.assertEqual(result["research_plan"]["strategy"], "expanded")
        self.assertNotIn("concept_search", result["research_plan"]["steps"])
        self.assertFalse(result["research_plan"]["escalated"])

    def test_scarce_evidence_broadens_and_keeps_previously_accepted_papers(self):
        class ChangingCollection(FakeDenseRAG):
            def retrieve_many(self, queries, **kwargs):
                first = not self.retrieve_calls
                self.retrieve_calls.append(list(queries))
                docs = (
                    [{"document": "First accepted paper", "meta": {}}] if first else
                    [{"document": f"Additional paper {i}", "meta": {}} for i in range(4)]
                )
                return [docs for _ in queries]

        index = self.make_index(dense=ChangingCollection())
        events = list(index.main_pipeline_stream("What is attention?", mode="adaptive"))
        plans = [event["research_plan"] for event in events if event.get("step") == "adaptive"]
        self.assertEqual([p["strategy"] for p in plans], ["focused", "expanded"])
        self.assertTrue(plans[-1]["escalated"])
        self.assertEqual(len(self.dense.retrieve_calls), 2)
        self.assertGreater(len(self.dense.retrieve_calls[1]), 1)
        self.assertEqual(len(self.llm.refine_calls), 1)
        self.assertEqual(len(self.llm.grade_calls), 2)
        self.assertEqual(events[-1]["total_docs_retrieved"], 5)
        self.assertEqual(self.arxiv.calls, [])
        served = [doc["document"] for e in events if e["type"] == "chunk_end" for doc in e["docs"]]
        self.assertIn("First accepted paper", served)
        self.assertIn("Additional paper 3", served)

    def test_enough_papers_still_expand_when_both_retrieval_signals_are_weak(self):
        dense = FakeDenseRAG(per_query_docs=[[
            {"document": f"Other subject {i}", "meta": {}, "distance": 0.99} for i in range(5)
        ]] * 5)
        index = self.make_index(dense=dense)
        result = index.main_pipeline("What is attention?", mode="adaptive")
        self.assertEqual(len(dense.retrieve_calls), 2)
        self.assertTrue(result["research_plan"]["escalated"])
        self.assertEqual(len(self.arxiv.calls), 1)
        self.assertTrue(result["verification"]["fallback_used"])

    def test_expansion_does_not_pay_to_regrade_accepted_papers(self):
        dense = FakeDenseRAG(per_query_docs=[[{"document": "One accepted paper", "meta": {}}]] * 5)
        index = self.make_index(dense=dense)
        result = index.main_pipeline("What is attention?", mode="adaptive")
        self.assertEqual(len(dense.retrieve_calls), 2)
        self.assertEqual(len(self.llm.grade_calls), 1)
        self.assertEqual(result["total_docs_retrieved"], 1)
        self.assertTrue(result["research_plan"]["escalated"])

    def test_keyword_mismatch_alone_does_not_force_extra_searches(self):
        index = self.make_index()  # No distances, low word overlap, all papers graded related.
        result = index.main_pipeline("Different terminology", mode="adaptive")
        self.assertEqual(len(self.dense.retrieve_calls), 1)
        self.assertFalse(result["research_plan"]["escalated"])
        self.assertEqual(self.arxiv.calls, [])

    def test_live_fallback_is_graded_after_two_insufficient_local_rounds(self):
        llm = FakeLLMService(unrelated=["doc-"])
        arxiv = FakeArxivClient(results=[arxiv_paper("A related live paper")])
        index = self.make_index(llm=llm, arxiv=arxiv)
        result = index.main_pipeline("What is attention?", mode="adaptive")
        self.assertEqual(len(self.dense.retrieve_calls), 2)
        self.assertEqual(len(arxiv.calls), 1)
        self.assertEqual(len(llm.grade_calls), 3)
        self.assertEqual(result["verification"]["fallback_kept"], 1)
        self.assertEqual(result["answer_review"]["checked"], 1)

    def test_configured_reranking_is_used_only_when_the_search_expands(self):
        index = self.make_index()
        self.dense.rerank_model = "fixture"
        with mock.patch.object(self.dense, "rerank_candidates", wraps=self.dense.rerank_candidates) as rerank:
            index.main_pipeline("What is attention?", mode="adaptive")
            rerank.assert_not_called()
            index.main_pipeline("Compare attention and recurrence", mode="adaptive")
            self.assertEqual(rerank.call_count, 1)

    def test_focused_review_failure_withholds_the_draft(self):
        index = self.make_index()
        original = self.llm.generate_response

        def reply(prompt, system_instruction_string="", **kwargs):
            if "You verify a research answer" in system_instruction_string:
                return "unusable audit"
            return original(prompt, system_instruction_string, **kwargs)

        with mock.patch.object(self.llm, "generate_response", reply):
            result = index.main_pipeline("What is attention?", mode="adaptive")
        self.assertEqual(result["research_plan"]["strategy"], "focused")
        self.assertEqual(result["answer_review"]["withheld"], 1)
        self.assertIsNone(result["aggregate_faithfulness"])
        self.assertEqual(result["responses"][0]["answer_review"]["status"], "unverified")

    def test_concurrent_questions_keep_independent_plans(self):
        index = self.make_index()
        original = (index.enable_hyde, index.max_context_docs, index.agent_max_iterations)
        with ThreadPoolExecutor(max_workers=2) as pool:
            focused = pool.submit(index.main_pipeline, "What is attention?", mode="adaptive")
            comparison = pool.submit(index.main_pipeline, "Compare attention and recurrence", mode="adaptive")
            focused, comparison = focused.result(), comparison.result()
        self.assertEqual(focused["research_plan"]["strategy"], "focused")
        self.assertEqual(comparison["research_plan"]["strategy"], "expanded")
        self.assertEqual(original, (index.enable_hyde, index.max_context_docs, index.agent_max_iterations))
        self.assertIsNone(index.research_plan)
        self.assertEqual(index.generation_options, {})

    def test_cancellation_at_expansion_prevents_another_retrieval(self):
        index = self.make_index(llm=FakeLLMService(unrelated=["doc-"]))
        cancelled = threading.Event()
        events = []
        for event in index.main_pipeline_stream("What is attention?", mode="adaptive", cancel_event=cancelled):
            events.append(event)
            if event.get("step") == "adaptive" and event["research_plan"]["escalated"]:
                cancelled.set()
        self.assertEqual(len(self.dense.retrieve_calls), 1)
        self.assertEqual(self.llm.stream_calls, [])
        self.assertEqual(self.arxiv.calls, [])
        self.assertNotIn("complete", self.types(events))

    def test_both_api_shapes_default_to_adaptive_and_include_the_final_plan(self):
        index = self.make_index()
        with mock.patch("airecommender.views.get_rag_index", return_value=index):
            for endpoint in ("/api/v1/prompt/", "/api/v1/prompt/stream/"):
                with self.subTest(endpoint=endpoint):
                    response = self.client.post(endpoint, data=json.dumps({
                        "input_prompt": "What is attention?",
                    }), content_type="application/json")
                    self.assertEqual(response.status_code, 200)
                    if response.streaming:
                        events = [json.loads(line[6:]) for line in b"".join(response.streaming_content).decode().splitlines() if line.startswith("data: ")]
                        result = events[-1]
                    else:
                        result = response.json()
                    self.assertEqual(result["mode"], "adaptive")
                    self.assertEqual(result["research_plan"]["strategy"], "focused")
                    self.assertEqual(result["answer_review"]["checked"], 1)
                    response.close()
