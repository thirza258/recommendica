"""
Tests for the pipeline's two boundary checks.

The query check's contract is asymmetric and that is what most of these assert:
it may stop the pipeline, but only on a confident verdict, and every way the
check itself can fail has to let the query through.  The result check has no
such tension — it is arithmetic — so its tests are about the numbers being
right and the warnings being the ones a user would want.
"""

import json

from django.test import SimpleTestCase

from airecommender.pipeline.agent.grading import GradeStatus
from airecommender.pipeline.agent.loop import AgentOutcome, AgentResult
from airecommender.pipeline.verification.query_check import (
    CheckStatus,
    deterministic_verdict,
    parse_query_check,
    verify_query,
)
from airecommender.pipeline.verification.result_check import verify_results


class FakeLLM:
    def __init__(self, response="", error=None):
        self.response = response
        self.error = error
        self.calls = []

    def generate_response(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        if self.error:
            raise self.error
        return self.response


def candidate(text="doc", *, distance=None, source=None, **extra):
    meta = {}
    if source:
        meta["source"] = source
    item = {"document": text, "meta": meta, **extra}
    if distance is not None:
        item["distance"] = distance
    return item


# ── Deterministic guards ─────────────────────────────────────────────────────


class QueryGuardTests(SimpleTestCase):
    def test_empty_query_is_rejected(self):
        verdict = deterministic_verdict("   ")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.kind, "empty")
        self.assertIs(verdict.status, CheckStatus.DETERMINISTIC)

    def test_too_short_is_rejected_with_an_example(self):
        verdict = deterministic_verdict("a")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.kind, "too_short")
        self.assertTrue(verdict.suggestion)

    def test_too_long_is_rejected(self):
        verdict = deterministic_verdict("x" * 2000, max_chars=1000)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.kind, "too_long")
        self.assertEqual(verdict.data["length"], 2000)

    def test_query_without_letters_is_rejected(self):
        self.assertEqual(deterministic_verdict("12345678 --- 999").kind, "no_topic")

    def test_a_normal_question_fires_no_guard(self):
        self.assertIsNone(
            deterministic_verdict("What is the impact of COVID-19 on the economy?")
        )

    def test_a_bare_topic_fires_no_guard(self):
        self.assertIsNone(deterministic_verdict("graph neural networks"))

    def test_short_real_topics_survive_the_guards(self):
        """A length rule cannot tell "AI" from "hi" — only the model can, so
        the guard stays out of the way and lets it decide."""
        for topic in ("AI", "RAG", "BERT", "LLM"):
            self.assertIsNone(deterministic_verdict(topic), topic)


# ── Classification parsing ───────────────────────────────────────────────────


class QueryCheckParsingTests(SimpleTestCase):
    def test_parses_an_acceptance(self):
        verdict = parse_query_check('{"ok": true, "kind": "research"}')
        self.assertTrue(verdict.ok)
        self.assertIs(verdict.status, CheckStatus.CHECKED)

    def test_parses_a_rejection_with_its_reason(self):
        raw = json.dumps(
            {
                "ok": False,
                "kind": "greeting",
                "reason": "This is a greeting, not a research topic.",
                "suggestion": "Try: attention mechanisms in vision models",
            }
        )
        verdict = parse_query_check(raw)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.kind, "greeting")
        self.assertIn("greeting", verdict.reason)
        self.assertIn("attention", verdict.suggestion)

    def test_accepts_string_booleans_and_aliases(self):
        self.assertTrue(parse_query_check('{"searchable": "yes"}').ok)
        self.assertFalse(parse_query_check('{"ok": "no", "reason": "no topic"}').ok)

    def test_unexplained_rejection_is_not_trusted(self):
        # An unexplained "no" is what a confused model returns, and it gives the
        # user nothing to act on.
        self.assertIsNone(parse_query_check('{"ok": false}'))

    def test_unusable_responses_return_none(self):
        self.assertIsNone(parse_query_check("I cannot classify that."))
        self.assertIsNone(parse_query_check(""))
        self.assertIsNone(parse_query_check('{"kind": "research"}'))
        self.assertIsNone(parse_query_check("[1, 2, 3]"))


# ── verify_query end to end ──────────────────────────────────────────────────


class VerifyQueryTests(SimpleTestCase):
    def test_guards_run_before_the_model(self):
        llm = FakeLLM('{"ok": true}')
        verdict = verify_query("a", llm)
        self.assertFalse(verdict.ok)
        self.assertEqual(llm.calls, [])

    def test_model_rejection_is_honoured(self):
        llm = FakeLLM(
            json.dumps({"ok": False, "kind": "greeting", "reason": "just a greeting"})
        )
        verdict = verify_query("hello there, how are you?", llm)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.kind, "greeting")

    def test_provider_failure_lets_the_query_through(self):
        verdict = verify_query("protein folding", FakeLLM(error=RuntimeError("down")))
        self.assertTrue(verdict.ok)
        self.assertIs(verdict.status, CheckStatus.UNAVAILABLE)
        self.assertIn("down", verdict.data["error"])

    def test_unparseable_response_lets_the_query_through(self):
        verdict = verify_query("protein folding", FakeLLM("no idea"))
        self.assertTrue(verdict.ok)
        self.assertIs(verdict.status, CheckStatus.UNAVAILABLE)

    def test_no_llm_means_guards_only(self):
        verdict = verify_query("protein folding methods", None)
        self.assertTrue(verdict.ok)
        self.assertIs(verdict.status, CheckStatus.SKIPPED)

    def test_check_never_retries(self):
        llm = FakeLLM('{"ok": true}')
        verify_query("protein folding methods", llm, timeout=9)
        _, kwargs = llm.calls[0]
        self.assertEqual(kwargs["max_retries"], 0)
        self.assertEqual(kwargs["timeout"], 9)

    def test_payload_shape_is_json_safe(self):
        payload = verify_query("a", None).as_payload()
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["status"], "deterministic")
        json.dumps(payload)


# ── Result reporting ─────────────────────────────────────────────────────────


class VerifyResultsTests(SimpleTestCase):
    def test_counts_documents_and_sources(self):
        report = verify_results(
            "climate change",
            [
                candidate("a", distance=0.1),
                candidate("b", distance=0.2),
                candidate("c", source="arxiv_api"),
            ],
            min_relevant=3,
        )
        self.assertEqual(report["docs"], 3)
        self.assertEqual(report["sources"], {"collection": 2, "arxiv_api": 1})
        self.assertTrue(report["min_relevant_met"])

    def test_confidence_is_unknown_without_distances(self):
        # A live-source-only selection has nothing embedded to measure, which
        # must read as "unknown", not as zero confidence.
        report = verify_results(
            "climate change",
            [candidate("a", source="arxiv_api"), candidate("b", source="arxiv_api")],
        )
        self.assertIsNone(report["retrieval_confidence"])
        self.assertNotIn(
            "Retrieval confidence", " ".join(report["warnings"])
        )

    def test_confidence_is_computed_from_local_distances(self):
        report = verify_results(
            "climate change",
            [candidate("climate change study", distance=0.05)],
            min_relevant=1,
        )
        self.assertIsNotNone(report["retrieval_confidence"])
        self.assertGreater(report["retrieval_confidence"], 0)

    def test_warns_when_too_few_papers_cleared_the_bar(self):
        report = verify_results("x ray imaging", [candidate("a", distance=0.1)], min_relevant=3)
        self.assertFalse(report["min_relevant_met"])
        self.assertIn("cleared the relevance bar", " ".join(report["warnings"]))

    def test_warns_when_the_answer_leans_on_the_live_source(self):
        report = verify_results(
            "quantum error correction",
            [
                candidate("quantum error correction a", distance=0.1),
                candidate("quantum error correction b", source="arxiv_api"),
                candidate("quantum error correction c", source="arxiv_api"),
            ],
            min_relevant=3,
        )
        self.assertIn("live arXiv search", " ".join(report["warnings"]))

    def test_warns_on_thin_term_coverage(self):
        report = verify_results(
            "photonic crystal waveguide dispersion",
            [candidate("unrelated text about gardening", distance=0.4)],
            min_relevant=1,
        )
        self.assertLess(report["query_term_coverage"], 0.5)
        self.assertIn("query's terms", " ".join(report["warnings"]))

    def test_reports_agent_state_when_available(self):
        agent_result = AgentResult(
            outcome=AgentOutcome.ACCEPTED,
            grader_status=GradeStatus.GRADED,
            rejected=4,
            fallback_used=True,
            fallback_kept=2,
        )
        report = verify_results(
            "topic here",
            [candidate("a", distance=0.1)],
            agent_result=agent_result,
            min_relevant=1,
        )
        self.assertEqual(report["agent_outcome"], "accepted")
        self.assertTrue(report["graded"])
        self.assertEqual(report["rejected"], 4)
        self.assertEqual(report["fallback_kept"], 2)

    def test_reports_an_unreachable_live_source(self):
        agent_result = AgentResult(
            outcome=AgentOutcome.ACCEPTED,
            grader_status=GradeStatus.GRADED,
            fallback_used=True,
            fallback_error="OSError: connection refused",
        )
        report = verify_results(
            "topic here",
            [candidate("a", distance=0.1)],
            agent_result=agent_result,
            min_relevant=1,
        )
        self.assertIn("connection refused", report["fallback_error"])
        self.assertIn("arXiv could not be reached", " ".join(report["warnings"]))

    def test_a_reachable_empty_source_is_not_reported_as_an_outage(self):
        agent_result = AgentResult(
            outcome=AgentOutcome.ACCEPTED,
            grader_status=GradeStatus.GRADED,
            fallback_used=True,
        )
        report = verify_results(
            "topic here",
            [candidate("a", distance=0.1)],
            agent_result=agent_result,
            min_relevant=1,
        )
        self.assertNotIn("fallback_error", report)
        self.assertNotIn("could not be reached", " ".join(report["warnings"]))

    def test_warns_when_nothing_was_graded(self):
        agent_result = AgentResult(
            outcome=AgentOutcome.GRADER_UNAVAILABLE,
            grader_status=GradeStatus.LLM_UNAVAILABLE,
        )
        report = verify_results(
            "topic here",
            [candidate("a", distance=0.1)],
            agent_result=agent_result,
            min_relevant=1,
        )
        self.assertFalse(report["graded"])
        self.assertIn("relevance check did not run", " ".join(report["warnings"]))

    def test_empty_selection_says_so_and_stops(self):
        report = verify_results("anything", [])
        self.assertEqual(report["docs"], 0)
        self.assertEqual(report["warnings"], ["No papers were selected for this query."])

    def test_report_is_json_serialisable(self):
        report = verify_results(
            "topic", [candidate("a", distance=0.1), candidate("b", source="arxiv_api")]
        )
        json.dumps(report)

    def test_a_broken_signal_does_not_break_the_request(self):
        class Hostile(dict):
            def get(self, key, default=None):
                if key == "document":
                    raise ValueError("boom")
                return super().get(key, default)

        report = verify_results("topic", [Hostile()])
        self.assertIn("error", report)
        self.assertEqual(report["docs"], 1)
