"""
Tests for the relevance agent.

The loop's three side-effecting steps are injected, so every decision path is
exercised with no ChromaDB, no Ollama and no API key: accept, refine-then-accept,
exhaust-and-report, and the grader-unavailable fallback (which must never reject
a paper).
"""

import json
import threading
from unittest import mock

from django.test import TestCase

from airecommender.pipeline.agent import faithfulness, grading, refine
from airecommender.pipeline.agent.grading import (
    PARTIAL,
    RELEVANT,
    UNRELATED,
    DocGrade,
    GradeStatus,
    GradingResult,
)
from airecommender.pipeline.agent.loop import (
    AgentOutcome,
    RelevanceAgent,
    run_to_completion,
)
from airecommender.pipeline.agent.parsing import as_list, clamp_score, extract_json


def doc(name, **extra):
    return {"document": name, "meta": {"name": name}, **extra}


def grade(index, verdict=RELEVANT, score=0.9, reason=""):
    return DocGrade(index=index, verdict=verdict, score=score, reason=reason)


# ── Forgiving JSON parsing ───────────────────────────────────────────────────


class ParsingTests(TestCase):
    def test_extracts_plain_json(self):
        self.assertEqual(extract_json('[{"i": 0}]'), [{"i": 0}])

    def test_extracts_fenced_json(self):
        raw = '```json\n[{"i": 1, "v": "relevant"}]\n```'
        self.assertEqual(extract_json(raw), [{"i": 1, "v": "relevant"}])

    def test_extracts_json_wrapped_in_prose(self):
        raw = 'Sure! Here are the grades:\n[{"i": 0, "v": "unrelated"}]\nHope that helps.'
        self.assertEqual(extract_json(raw), [{"i": 0, "v": "unrelated"}])

    def test_ignores_brackets_inside_strings(self):
        raw = '[{"r": "mentions [1] and ]["}]'
        self.assertEqual(extract_json(raw), [{"r": "mentions [1] and ]["}])

    def test_returns_none_for_unusable_text(self):
        self.assertIsNone(extract_json("I cannot grade these papers."))
        self.assertIsNone(extract_json(""))
        self.assertIsNone(extract_json('[{"i": 0,'))

    def test_as_list_unwraps_objects(self):
        self.assertEqual(as_list({"grades": [1, 2]}, "grades"), [1, 2])
        self.assertEqual(as_list({"anything": [3]}, "grades"), [3])
        self.assertEqual(as_list([4], "grades"), [4])
        self.assertIsNone(as_list({"a": 1, "b": 2}, "grades"))

    def test_clamp_score_handles_percentages_and_junk(self):
        self.assertEqual(clamp_score(0.5), 0.5)
        self.assertEqual(clamp_score(90), 0.9)
        self.assertEqual(clamp_score(200), 1.0)
        self.assertEqual(clamp_score(-3), 0.0)
        self.assertEqual(clamp_score("nope", default=0.25), 0.25)


# ── Grade parsing ────────────────────────────────────────────────────────────


class ParseGradesTests(TestCase):
    def test_parses_well_formed_response(self):
        raw = json.dumps(
            [
                {"i": 0, "v": "relevant", "s": 0.95, "r": ""},
                {"i": 1, "v": "unrelated", "s": 0.05, "r": "different field"},
            ]
        )
        grades = grading.parse_grades(raw, 2)

        self.assertEqual([g.verdict for g in grades], [RELEVANT, UNRELATED])
        self.assertEqual(grades[1].reason, "different field")

    def test_orders_by_index_regardless_of_response_order(self):
        raw = json.dumps([{"i": 2, "v": "relevant"}, {"i": 0, "v": "unrelated"}])
        grades = grading.parse_grades(raw, 3)

        self.assertEqual([g.index for g in grades], [0, 1, 2])
        self.assertEqual(grades[0].verdict, UNRELATED)
        self.assertEqual(grades[2].verdict, RELEVANT)

    def test_missing_entries_default_to_partial_not_rejected(self):
        """An incomplete response must not silently drop unmentioned papers."""
        grades = grading.parse_grades(json.dumps([{"i": 0, "v": "relevant"}]), 3)

        self.assertEqual(len(grades), 3)
        self.assertEqual(grades[1].verdict, PARTIAL)
        self.assertEqual(grades[2].verdict, PARTIAL)

    def test_positional_fallback_when_index_missing(self):
        raw = json.dumps([{"v": "unrelated"}, {"v": "relevant"}])
        grades = grading.parse_grades(raw, 2)

        self.assertEqual([g.verdict for g in grades], [UNRELATED, RELEVANT])

    def test_verdict_aliases(self):
        raw = json.dumps(
            [{"i": 0, "v": "YES"}, {"i": 1, "v": "irrelevant"}, {"i": 2, "v": "maybe"}]
        )
        grades = grading.parse_grades(raw, 3)

        self.assertEqual(
            [g.verdict for g in grades], [RELEVANT, UNRELATED, PARTIAL]
        )

    def test_score_only_response_derives_a_verdict(self):
        raw = json.dumps([{"i": 0, "s": 0.9}, {"i": 1, "s": 0.1}])
        grades = grading.parse_grades(raw, 2)

        self.assertEqual([g.verdict for g in grades], [RELEVANT, UNRELATED])

    def test_out_of_range_indices_are_ignored(self):
        raw = json.dumps([{"i": 9, "v": "relevant"}, {"i": 0, "v": "unrelated"}])
        grades = grading.parse_grades(raw, 1)

        self.assertEqual(len(grades), 1)
        self.assertEqual(grades[0].verdict, UNRELATED)

    def test_unusable_response_returns_none(self):
        self.assertIsNone(grading.parse_grades("no idea, sorry", 2))
        self.assertIsNone(grading.parse_grades("[]", 2))

    def test_grading_prompt_sends_trimmed_text_not_raw_json(self):
        """Grading 20 raw JSON blobs is exactly the input waste we cap."""
        record = json.dumps(
            {
                "title": "Sparse Attention",
                "category": "cs.LG",
                "authors": "A. Author",
                "summary": "word " * 2000,
            }
        )
        prompt = grading.build_grading_prompt("q", [doc(record)], max_candidate_chars=300)

        self.assertIn("0. Sparse Attention [cs.LG]", prompt)
        self.assertNotIn('"summary"', prompt)
        self.assertLess(len(prompt), 900)


class GradeCandidatesTests(TestCase):
    class FakeLLM:
        def __init__(self, response=None, error=None):
            self.response = response
            self.error = error
            self.kwargs = None

        def generate_response(self, prompt, **kwargs):
            self.kwargs = kwargs
            if self.error:
                raise self.error
            return self.response

    def test_successful_grading_is_trustworthy(self):
        llm = self.FakeLLM(json.dumps([{"i": 0, "v": "relevant", "s": 0.9}]))
        result = grading.grade_candidates("q", [doc("a")], llm)

        self.assertIs(result.status, GradeStatus.GRADED)
        self.assertTrue(result.trustworthy)

    def test_grading_never_retries(self):
        llm = self.FakeLLM(json.dumps([{"i": 0, "v": "relevant"}]))
        grading.grade_candidates("q", [doc("a")], llm, timeout=17)

        self.assertEqual(llm.kwargs["max_retries"], 0)
        self.assertEqual(llm.kwargs["timeout"], 17)

    def test_llm_failure_falls_back_without_raising(self):
        llm = self.FakeLLM(error=RuntimeError("provider down"))
        result = grading.grade_candidates("q", [doc("a"), doc("b")], llm)

        self.assertIs(result.status, GradeStatus.LLM_UNAVAILABLE)
        self.assertFalse(result.trustworthy)
        self.assertEqual(len(result.grades), 2)

    def test_unparseable_response_is_reported_as_parse_failed(self):
        llm = self.FakeLLM("I'm not able to help with that.")
        result = grading.grade_candidates("q", [doc("a")], llm)

        self.assertIs(result.status, GradeStatus.PARSE_FAILED)
        self.assertFalse(result.trustworthy)

    def test_heuristic_fallback_never_marks_anything_unrelated(self):
        """Heuristics rank; only the LLM may reject."""
        grades = grading.heuristic_grades(
            "protein folding", [doc("a", dense_score=0.9), doc("b", dense_score=0.1)]
        )

        self.assertTrue(all(g.verdict == PARTIAL for g in grades))

    def test_empty_candidates_short_circuits(self):
        llm = self.FakeLLM(error=AssertionError("must not be called"))
        result = grading.grade_candidates("q", [], llm)

        self.assertEqual(result.grades, [])
        self.assertTrue(result.trustworthy)


# ── Query refinement ─────────────────────────────────────────────────────────


class RefineTests(TestCase):
    def test_prompt_carries_the_rejection_reasons(self):
        prompt = refine.build_refine_prompt(
            "how do I speed up BERT",
            "speed up BERT",
            ["about optimisation theory, not transformers", "hardware paper"],
        )

        self.assertIn("how do I speed up BERT", prompt)
        self.assertIn("- about optimisation theory, not transformers", prompt)
        self.assertIn("- hardware paper", prompt)

    def test_prompt_dedupes_and_caps_reasons(self):
        prompt = refine.build_refine_prompt("q", "q", ["same"] * 5 + ["other"])

        self.assertEqual(prompt.count("- same"), 1)
        self.assertIn("- other", prompt)

    def test_prompt_handles_no_reasons(self):
        prompt = refine.build_refine_prompt("q", "q", [])
        self.assertIn("none of the retrieved papers", prompt)

    def test_cleans_labels_quotes_and_fences(self):
        self.assertEqual(
            refine.clean_refined_query('```\nImproved query: "sparse attention"\n```', set()),
            "sparse attention",
        )

    def test_rejects_repeat_of_a_tried_query(self):
        self.assertIsNone(refine.clean_refined_query("Same Query", {"same query"}))

    def test_rejects_empty_or_rambling_output(self):
        self.assertIsNone(refine.clean_refined_query("", set()))
        self.assertIsNone(refine.clean_refined_query("word " * 50, set()))

    def test_llm_failure_returns_none(self):
        class Boom:
            def generate_response(self, prompt, **kwargs):
                raise RuntimeError("nope")

        self.assertIsNone(refine.refine_query("q", "q", [], Boom()))


# ── The agent loop ───────────────────────────────────────────────────────────


class AgentLoopTests(TestCase):
    def build(self, retrieve, grade_fn, refine_fn=None, **kwargs):
        options = {
            "min_relevant": 2,
            "max_iterations": 2,
            "threshold": 0.5,
            "max_docs": 5,
            "deadline_seconds": 60,
        }
        options.update(kwargs)
        return RelevanceAgent(
            retrieve, grade_fn, refine_fn or (lambda *a: None), **options
        )

    def test_accepts_when_enough_papers_are_related(self):
        candidates = [doc("a"), doc("b"), doc("c")]
        grades = GradingResult([grade(0), grade(1), grade(2, UNRELATED, 0.1, "off topic")])
        agent = self.build(lambda queries: candidates, lambda q, c: grades)

        result = run_to_completion(agent, "query")

        self.assertIs(result.outcome, AgentOutcome.ACCEPTED)
        self.assertEqual([d["document"] for d in result.docs], ["a", "b"])
        self.assertEqual(result.iterations, 1)

    def test_unrelated_papers_never_survive(self):
        candidates = [doc("keep"), doc("drop")]
        grades = GradingResult(
            [grade(0, RELEVANT, 0.8), grade(1, UNRELATED, 0.95, "wrong field")]
        )
        agent = self.build(
            lambda queries: candidates, lambda q, c: grades, min_relevant=1
        )

        result = run_to_completion(agent, "query")

        self.assertEqual([d["document"] for d in result.docs], ["keep"])
        self.assertEqual(result.rejected, 1)

    def test_low_scores_are_dropped_by_the_threshold(self):
        candidates = [doc("a"), doc("b")]
        grades = GradingResult([grade(0, PARTIAL, 0.9), grade(1, PARTIAL, 0.2)])
        agent = self.build(
            lambda queries: candidates, lambda q, c: grades, min_relevant=1, threshold=0.5
        )

        result = run_to_completion(agent, "query")

        self.assertEqual([d["document"] for d in result.docs], ["a"])

    def test_refines_with_the_rejection_reasons_then_accepts(self):
        """The agentic step: the retry is informed by *why* round 1 failed."""
        rounds = {
            "original": [doc("bad-1"), doc("bad-2")],
            "refined query": [doc("good-1"), doc("good-2")],
        }
        seen_queries = []
        refine_calls = []

        def retrieve(queries):
            seen_queries.append(list(queries))
            return rounds.get(queries[0], [])

        def grade_fn(query, candidates):
            if candidates and candidates[0]["document"].startswith("bad"):
                return GradingResult(
                    [
                        grade(0, UNRELATED, 0.1, "optimisation theory, not folding"),
                        grade(1, UNRELATED, 0.1, "hardware benchmark"),
                    ]
                )
            return GradingResult([grade(0), grade(1)])

        def refine_fn(original, attempted, reasons):
            refine_calls.append((original, attempted, list(reasons)))
            return "refined query"

        agent = self.build(retrieve, grade_fn, refine_fn)
        result = run_to_completion(agent, "original")

        self.assertIs(result.outcome, AgentOutcome.ACCEPTED)
        self.assertEqual([d["document"] for d in result.docs], ["good-1", "good-2"])
        self.assertEqual(result.iterations, 2)
        self.assertEqual(result.queries_tried, ["original", "refined query"])
        self.assertEqual(seen_queries, [["original"], ["refined query"]])

        # The refine call must receive the observed rejection reasons.
        self.assertEqual(len(refine_calls), 1)
        original, attempted, reasons = refine_calls[0]
        self.assertEqual((original, attempted), ("original", "original"))
        self.assertIn("optimisation theory, not folding", reasons)
        self.assertIn("hardware benchmark", reasons)

    def test_grades_against_the_original_query_after_refining(self):
        graded_against = []

        def grade_fn(query, candidates):
            graded_against.append(query)
            return GradingResult([grade(0, UNRELATED, 0.1, "nope")])

        agent = self.build(
            lambda queries: [doc("a")], grade_fn, lambda *a: "a refined query"
        )
        run_to_completion(agent, "the user's real question")

        self.assertEqual(
            graded_against,
            ["the user's real question", "the user's real question"],
        )

    def test_related_papers_accumulate_across_rounds(self):
        rounds = {"q1": [doc("a")], "q2": [doc("b")]}

        agent = self.build(
            lambda queries: rounds.get(queries[0], []),
            lambda q, c: GradingResult([grade(0)]),
            lambda *a: "q2",
            min_relevant=2,
        )
        result = run_to_completion(agent, "q1")

        self.assertEqual(sorted(d["document"] for d in result.docs), ["a", "b"])
        self.assertIs(result.outcome, AgentOutcome.ACCEPTED)

    def test_reports_when_nothing_is_related(self):
        agent = self.build(
            lambda queries: [doc("a"), doc("b")],
            lambda q, c: GradingResult(
                [grade(0, UNRELATED, 0.1, "off"), grade(1, UNRELATED, 0.1, "off")]
            ),
            lambda *a: None,
        )
        result = run_to_completion(agent, "query")

        self.assertIs(result.outcome, AgentOutcome.NO_RELEVANT)
        self.assertEqual(result.docs, [])
        self.assertIn("none were related", result.notice)

    def test_reports_when_retrieval_finds_nothing(self):
        agent = self.build(lambda queries: [], lambda q, c: GradingResult([]))
        result = run_to_completion(agent, "query")

        self.assertIs(result.outcome, AgentOutcome.NO_CANDIDATES)
        self.assertIn("No papers matched", result.notice)

    def test_grader_outage_returns_unfiltered_results(self):
        candidates = [doc("a"), doc("b"), doc("c")]
        agent = self.build(
            lambda queries: candidates,
            lambda q, c: GradingResult(
                grading.heuristic_grades(q, c),
                status=GradeStatus.LLM_UNAVAILABLE,
                error="provider down",
            ),
        )

        events = []
        result = run_to_completion(agent, "query", on_event=events.append)

        self.assertIs(result.outcome, AgentOutcome.GRADER_UNAVAILABLE)
        self.assertEqual(len(result.docs), 3, "must not drop papers it could not judge")
        self.assertFalse(result.filtered)
        self.assertIn("grader_unavailable", [event.status for event in events])
        self.assertIn("could not run", result.notice)

    def test_parse_failure_also_passes_through(self):
        agent = self.build(
            lambda queries: [doc("a")],
            lambda q, c: GradingResult(
                grading.heuristic_grades(q, c),
                status=GradeStatus.PARSE_FAILED,
                error="bad json",
            ),
        )
        result = run_to_completion(agent, "query")

        self.assertIs(result.outcome, AgentOutcome.GRADER_UNAVAILABLE)
        self.assertEqual(len(result.docs), 1)

    def test_stops_refining_when_refinement_gives_nothing(self):
        calls = []

        def retrieve(queries):
            calls.append(queries)
            return [doc("a")]

        agent = self.build(
            retrieve,
            lambda q, c: GradingResult([grade(0, UNRELATED, 0.1, "off")]),
            lambda *a: None,
            max_iterations=4,
        )
        result = run_to_completion(agent, "query")

        self.assertEqual(len(calls), 1, "no point re-running the same search")
        self.assertIs(result.outcome, AgentOutcome.NO_RELEVANT)

    def test_deadline_stops_the_loop_before_another_round(self):
        """Each search "takes" 40s on a fake clock, so the 30s budget is spent."""
        now = [0.0]
        calls = []

        def retrieve(queries):
            calls.append(queries)
            now[0] += 40.0
            return [doc("a")]

        agent = self.build(
            retrieve,
            lambda q, c: GradingResult([grade(0, UNRELATED, 0.1, "off")]),
            lambda *a: "another query",
            max_iterations=5,
            deadline_seconds=30,
            clock=lambda: now[0],
        )
        result = run_to_completion(agent, "query")

        self.assertEqual(len(calls), 1, "must not start a round it has no time for")
        self.assertTrue(result.deadline_hit)

    def test_deadline_does_not_stop_a_loop_with_time_left(self):
        now = [0.0]
        calls = []

        def retrieve(queries):
            calls.append(queries)
            now[0] += 1.0
            return [doc("a")]

        agent = self.build(
            retrieve,
            lambda q, c: GradingResult([grade(0, UNRELATED, 0.1, "off")]),
            lambda *a: "another query",
            max_iterations=3,
            deadline_seconds=30,
            clock=lambda: now[0],
        )
        result = run_to_completion(agent, "query")

        self.assertEqual(len(calls), 3)
        self.assertFalse(result.deadline_hit)

    def test_cancellation_stops_immediately(self):
        cancel = threading.Event()
        cancel.set()
        agent = self.build(
            lambda queries: [doc("a")],
            lambda q, c: GradingResult([grade(0)]),
        )

        result = run_to_completion(agent, "query", cancel_event=cancel)

        self.assertIs(result.outcome, AgentOutcome.CANCELLED)

    def test_max_docs_caps_the_selection(self):
        candidates = [doc(f"d{i}") for i in range(10)]
        grades = GradingResult([grade(i, RELEVANT, 0.9 - i / 100) for i in range(10)])
        agent = self.build(
            lambda queries: candidates, lambda q, c: grades, max_docs=3
        )

        result = run_to_completion(agent, "query")

        self.assertEqual([d["document"] for d in result.docs], ["d0", "d1", "d2"])

    def test_progress_events_describe_the_work(self):
        agent = self.build(
            lambda queries: [doc("a"), doc("b")],
            lambda q, c: GradingResult([grade(0), grade(1)]),
        )

        events = []
        run_to_completion(agent, "query", on_event=events.append)

        statuses = [event.status for event in events]
        self.assertIn("searching", statuses)
        self.assertIn("graded", statuses)
        graded = next(e for e in events if e.status == "graded")
        self.assertEqual(graded.data["kept"], 2)
        self.assertEqual(graded.data["rejected"], 0)


# ── Answer grounding ─────────────────────────────────────────────────────────


class FaithfulnessTests(TestCase):
    def test_score_weights_partial_support(self):
        raw = json.dumps(
            {
                "claims": [
                    {"claim": "one", "verdict": "YES"},
                    {"claim": "two", "verdict": "PARTIALLY"},
                    {"claim": "three", "verdict": "NO"},
                    {"claim": "four", "verdict": "UNKNOWN"},
                ]
            }
        )
        evaluation = faithfulness.parse_evaluation(raw)

        self.assertEqual(evaluation["faithfulness_score"], 0.375)  # (1+0.5)/4
        self.assertEqual(evaluation["total_claims"], 4)
        self.assertEqual(evaluation["supported_claims"], 1)
        self.assertTrue(evaluation["claims"][0]["supported"])
        self.assertFalse(evaluation["claims"][1]["supported"])

    def test_all_supported_scores_one(self):
        raw = json.dumps({"claims": [{"claim": "x", "verdict": "yes"}]})
        self.assertEqual(faithfulness.parse_evaluation(raw)["faithfulness_score"], 1.0)

    def test_unusable_response_returns_none(self):
        self.assertIsNone(faithfulness.parse_evaluation("cannot do that"))
        self.assertIsNone(faithfulness.parse_evaluation('{"claims": []}'))

    def test_evaluate_answer_survives_a_provider_failure(self):
        class Boom:
            def generate_response(self, prompt, **kwargs):
                raise RuntimeError("down")

        evaluation = faithfulness.evaluate_answer("q", "an answer", [doc("a")], Boom())

        self.assertIsNone(evaluation["faithfulness_score"])
        self.assertIn("down", evaluation["error"])

    def test_evaluation_prompt_trims_sources_and_answer(self):
        long_answer = "x" * (faithfulness.MAX_ANSWER_CHARS + 500)
        prompt = faithfulness.build_evaluation_prompt(
            "q", long_answer, [doc(json.dumps({"title": "T", "summary": "s" * 5000}))]
        )

        self.assertIn("truncated", prompt)
        self.assertLess(len(prompt), faithfulness.MAX_ANSWER_CHARS + 2000)

    def test_aggregate_ignores_unscored_chunks(self):
        self.assertEqual(
            faithfulness.aggregate_faithfulness(
                [{"faithfulness_score": 1.0}, {"faithfulness_score": 0.5}, None]
            ),
            0.75,
        )
        self.assertIsNone(faithfulness.aggregate_faithfulness([None, {"error": "x"}]))
        self.assertIsNone(faithfulness.aggregate_faithfulness([]))
