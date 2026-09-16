"""Deep answers must earn a passing review; missing evidence cannot certify them."""

import json
import threading
from unittest import mock

from django.test import SimpleTestCase, override_settings

from airecommender.pipeline.agent.answer_review import (
    MAX_ANSWER_CHARS, MISSING_INFORMATION_NOTE, WITHHELD_ANSWER,
    answer_units, parse_review, review_answer,
)
from airecommender.pipeline.prompting import format_document
from airecommender.tests_pipeline import FakeDenseRAG, FakeLLMService, PipelineTestCase

SOURCE = "The trial reported 20% improvement in adults, with uncertain long-term effects."
ANSWER = "The trial reported 20% improvement in adults [1]."
DOCS = [{"document": SOURCE, "meta": {}}]


def audit(answer=ANSWER, *, verdict="YES", quote=SOURCE, source_id=1,
          gaps=None, contradictions=None, addresses_question=True):
    return json.dumps({
        "units": [{"id": unit["id"], "verdict": verdict, "reason": "Review finding",
                   "evidence": [{"source_id": source_id, "quote": quote}]}
                  for unit in answer_units(answer)],
        "addresses_question": addresses_question,
        "gaps": gaps or [], "unresolved_contradictions": contradictions or [],
    })


def finish(generator):
    progress = []
    while True:
        try:
            progress.append(next(generator))
        except StopIteration as stop:
            return progress, stop.value


class EvidenceCheckTests(SimpleTestCase):
    def parse(self, raw, answer=ANSWER, docs=DOCS):
        return parse_review(raw, answer_units(answer), [
            {"source_id": i, "text": format_document(doc)} for i, doc in enumerate(docs, start=1)
        ])

    def test_supported_claim_has_inspectable_source_and_quote(self):
        report = self.parse(audit())
        self.assertTrue(report["passed"])
        self.assertEqual(report["claims"][0]["evidence"], [{"source_id": 1, "quote": SOURCE}])

    def test_fabricated_quote_cannot_receive_a_passing_score(self):
        report = self.parse(audit(quote="An invented result with 20% improvement."))
        self.assertFalse(report["passed"])
        self.assertEqual(report["faithfulness_score"], 0)

    def test_quote_matching_tolerates_line_wraps_but_preserves_case(self):
        self.assertTrue(self.parse(audit(quote=SOURCE.replace(" ", "\n")))["passed"])
        self.assertFalse(self.parse(audit(quote=SOURCE.lower()))["passed"])

    def test_wrong_source_id_and_missing_citation_are_rejected(self):
        for text, raw in [(ANSWER, audit(source_id=2)),
                          (ANSWER.replace("[1]", "[9]"), audit(ANSWER.replace("[1]", "[9]"))),
                          (ANSWER.replace(" [1]", ""), audit(ANSWER.replace(" [1]", "")))]:
            with self.subTest(text=text):
                self.assertFalse(self.parse(raw, text)["passed"])

    def test_every_cited_source_must_have_a_real_passage(self):
        text = ANSWER.replace("[1]", "[1, 2]")
        self.assertFalse(self.parse(audit(text), text, DOCS * 2)["passed"])

    def test_inflated_number_and_percent_unit_cannot_pass(self):
        for text in (ANSWER.replace("20%", "90%"), ANSWER.replace("20%", "20")):
            self.assertFalse(self.parse(audit(text), text)["passed"])

    def test_list_numbers_and_citation_ids_are_not_study_statistics(self):
        text = "1. " + ANSWER
        self.assertTrue(self.parse(audit(text), text)["passed"])

    def test_partial_semantic_support_still_fails_with_a_real_quote(self):
        self.assertFalse(self.parse(audit(verdict="PARTIALLY"))["passed"])

    def test_omitted_duplicated_and_unknown_units_invalidate_the_audit(self):
        text = ANSWER + "\nA second unsupported assertion [1]."
        for entries in ([{"id": 1}], [{"id": 1}, {"id": 1}], [{"id": 1}, {"id": 3}]):
            payload = json.loads(audit(text))
            payload["units"] = entries
            self.assertIsNone(self.parse(json.dumps(payload), text))

    def test_headings_and_table_rows_are_not_silently_omitted(self):
        units = answer_units("## Findings\n\n| Measure | Finding |\n| --- | --- |\n| Effect | 20% [1] |")
        self.assertEqual(len(units), 3)
        self.assertEqual(units[0]["text"], "## Findings")

    def test_factual_text_cannot_be_skipped_by_a_non_claim_verdict_with_citations(self):
        self.assertFalse(self.parse(audit(verdict="NOT_A_CLAIM"))["passed"])

    def test_non_claim_verdict_cannot_skip_uncited_assertions(self):
        for extra in (
            "The treatment prevents relapse.",
            "## The treatment prevents relapse",
            "**The treatment prevents relapse.**",
            "There is no evidence of harm.",
        ):
            with self.subTest(extra=extra):
                text = ANSWER + "\n" + extra
                payload = json.loads(audit(text))
                payload["units"][1].update(verdict="NOT_A_CLAIM", reason="Just a caveat", evidence=[])
                report = self.parse(json.dumps(payload), text)
                self.assertFalse(report["passed"])
                self.assertEqual(report["total_claims"], 2)
                self.assertFalse(report["claims"][1]["supported"])

    def test_neutral_labels_and_generic_gap_do_not_need_citations(self):
        for heading in ("## Findings", "**Summary**", "Limitations:"):
            with self.subTest(heading=heading):
                text = heading + "\n" + ANSWER + "\n" + MISSING_INFORMATION_NOTE
                payload = json.loads(audit(text))
                for i in (0, 2):
                    payload["units"][i].update(verdict="NOT_A_CLAIM", reason="Neutral label or generic gap", evidence=[])
                report = self.parse(json.dumps(payload), text)
                self.assertTrue(report["passed"])
                self.assertEqual(report["total_claims"], 1)
                # The visible caveat cannot be lost if the model forgets gaps.
                self.assertEqual(report["gaps"], [MISSING_INFORMATION_NOTE])

    def test_skipped_label_still_requires_a_nonempty_reason(self):
        text = ANSWER + "\n## Findings"
        payload = json.loads(audit(text))
        payload["units"][1].update(verdict="NOT_A_CLAIM", reason="  ", evidence=[])
        self.assertFalse(self.parse(json.dumps(payload), text)["passed"])

    def test_missing_coverage_has_nonempty_deduplicated_limitations(self):
        for supplied, expected in (
            (["", "   "], [MISSING_INFORMATION_NOTE]),
            (["Long-term data are missing.", " Long-term data are missing. "], ["Long-term data are missing."]),
        ):
            with self.subTest(supplied=supplied):
                report = self.parse(audit(addresses_question=False, gaps=supplied))
                self.assertTrue(report["passed"])
                self.assertEqual(report["gaps"], expected)

    def test_unacknowledged_conflict_blocks_a_passing_verdict(self):
        self.assertFalse(self.parse(audit(contradictions=["Another selected study found no improvement."]))["passed"])

    def test_invented_source_url_is_rejected(self):
        text = ANSWER + " https://invented.example/paper"
        self.assertFalse(self.parse(audit(text), text)["passed"])

    def test_incomplete_or_unparseable_evaluator_schema_is_unavailable(self):
        for raw in ("not JSON", '{"units":[]}', '[]', '{"units":null}'):
            self.assertIsNone(self.parse(raw))


class ReviewLoopTests(SimpleTestCase):
    def run_review(self, replies, answer=ANSWER, **kwargs):
        service = mock.Mock()
        service.generate_response.side_effect = replies
        progress, result = finish(review_answer("What did the adult trial find?", answer, DOCS, service, **kwargs))
        return service, progress, result

    def test_good_answer_needs_only_one_audit(self):
        service, _, result = self.run_review([audit()])
        self.assertEqual(service.generate_response.call_count, 1)
        self.assertEqual(result["generated_response"], ANSWER)
        self.assertEqual(result["answer_review"]["status"], "checked")
        self.assertFalse(result["answer_review"]["revised"])

    def test_bad_number_is_repaired_then_audited_again(self):
        draft = ANSWER.replace("20%", "90%")
        service, progress, result = self.run_review([audit(draft), ANSWER, audit()], draft)
        self.assertEqual(service.generate_response.call_count, 3)
        self.assertEqual([event["status"] for event in progress], ["checking", "revising", "rechecking"])
        self.assertEqual(result["generated_response"], ANSWER)
        self.assertTrue(result["answer_review"]["revised"])
        self.assertEqual(result["answer_review"]["checks"], 2)
        self.assertIn("90%", service.generate_response.call_args_list[1].kwargs["prompt"])

    def test_mislabelled_assertion_requires_repair_and_a_complete_recheck(self):
        draft = ANSWER + "\nThe treatment prevents relapse."
        payload = json.loads(audit(draft))
        payload["units"][1].update(verdict="NOT_A_CLAIM", reason="Just a caveat", evidence=[])
        service, _, result = self.run_review([json.dumps(payload), ANSWER, audit()], draft)
        self.assertEqual(service.generate_response.call_count, 3)
        self.assertEqual(result["generated_response"], ANSWER)
        self.assertTrue(result["answer_review"]["revised"])
        self.assertEqual(result["answer_review"]["checks"], 2)
        self.assertIn("needs a supporting citation", service.generate_response.call_args_list[1].kwargs["prompt"])

    def test_failed_second_review_withholds_text_and_old_claim_scores(self):
        _, _, result = self.run_review([audit(verdict="NO"), ANSWER, audit(verdict="NO")])
        self.assertEqual(result["generated_response"], WITHHELD_ANSWER)
        self.assertEqual(result["answer_review"]["status"], "withheld")
        self.assertIsNone(result["evaluation"]["faithfulness_score"])
        self.assertEqual(result["evaluation"]["claims"], [])

    def test_reviewer_outage_does_not_release_unverified_draft(self):
        for response in (RuntimeError("offline"), "invalid JSON"):
            service, _, result = self.run_review([response])
            self.assertEqual(service.generate_response.call_count, 1)
            self.assertEqual(result["answer_review"]["status"], "unverified")
            self.assertEqual(result["generated_response"], WITHHELD_ANSWER)

    def test_failed_or_empty_repair_never_releases_the_original(self):
        for repair in (RuntimeError("offline"), None, ""):
            _, _, result = self.run_review([audit(verdict="NO"), repair])
            self.assertEqual(result["generated_response"], WITHHELD_ANSWER)

    def test_supported_partial_answer_keeps_gaps_visible(self):
        service, _, result = self.run_review([audit(addresses_question=False, gaps=["Long-term effects remain uncertain."])])
        self.assertEqual(service.generate_response.call_count, 1)
        self.assertEqual(result["answer_review"]["status"], "limited")
        self.assertEqual(result["answer_review"]["limitations"], ["Long-term effects remain uncertain."])

    def test_oversized_draft_is_repaired_without_a_truncated_passing_audit(self):
        service, _, result = self.run_review([ANSWER, audit()], "x" * (MAX_ANSWER_CHARS + 1))
        self.assertEqual(service.generate_response.call_count, 2)
        self.assertTrue(result["answer_review"]["revised"])

    def test_comparison_sources_include_papers_from_other_chunks(self):
        extra = {"document": "A second trial found no improvement in children."}
        service, _, _ = self.run_review([audit()], comparison_docs=DOCS + [extra])
        sent = json.loads(service.generate_response.call_args.kwargs["prompt"])
        self.assertEqual(sent["comparison_sources"], [extra["document"]])

    def test_review_sees_same_source_excerpt_as_generation_including_late_details(self):
        doc = {"document": "background " * 65 + SOURCE}
        service = mock.Mock(return_value="bad")
        service.generate_response.return_value = "bad"
        finish(review_answer("query", ANSWER, [doc], service, max_doc_chars=1500))
        text = json.loads(service.generate_response.call_args.kwargs["prompt"])["sources"][0]["text"]
        self.assertIn(SOURCE, text)

    def test_cancellation_stops_before_spending_on_audit_or_repair(self):
        stop = threading.Event()
        stop.set()
        service, _, result = self.run_review([], cancel_event=stop)
        service.generate_response.assert_not_called()
        self.assertEqual(result["answer_review"]["status"], "unverified")

    def test_cancelled_audit_does_not_start_a_revision(self):
        stop = threading.Event()
        service = mock.Mock()

        def cancel_in_review(**kwargs):
            stop.set()
            return audit(verdict="NO")

        service.generate_response.side_effect = cancel_in_review
        _, result = finish(review_answer("trial", ANSWER, DOCS, service, cancel_event=stop))
        self.assertEqual(service.generate_response.call_count, 1)
        self.assertEqual(result["answer_review"]["status"], "unverified")

    def test_cancelling_at_any_progress_yield_prevents_the_next_provider_call(self):
        for status, replies in (
            ("checking", []),
            ("revising", [audit(verdict="NO")]),
            ("rechecking", [audit(verdict="NO"), ANSWER]),
        ):
            with self.subTest(status=status):
                stop, service = threading.Event(), mock.Mock()
                service.generate_response.side_effect = replies
                review = review_answer("trial", ANSWER, DOCS, service, cancel_event=stop)
                while next(review)["status"] != status:
                    pass
                stop.set()
                _, result = finish(review)
                self.assertEqual(service.generate_response.call_count, len(replies))
                self.assertEqual(result["generated_response"], WITHHELD_ANSWER)
                self.assertIn("stopped", result["answer_review"]["issues"][0])

    def test_cancellation_during_a_passing_audit_prevents_release(self):
        stop, service = threading.Event(), mock.Mock()

        def cancel_in_review(**kwargs):
            stop.set()
            return audit()

        service.generate_response.side_effect = cancel_in_review
        _, result = finish(review_answer("trial", ANSWER, DOCS, service, cancel_event=stop))
        self.assertEqual(service.generate_response.call_count, 1)
        self.assertEqual(result["generated_response"], WITHHELD_ANSWER)
        self.assertEqual(result["answer_review"]["status"], "unverified")

    def test_expiry_at_any_progress_yield_prevents_the_next_provider_call(self):
        for status, replies in (
            ("checking", []),
            ("revising", [audit(verdict="NO")]),
            ("rechecking", [audit(verdict="NO"), ANSWER]),
        ):
            with self.subTest(status=status):
                clock, service = mock.Mock(return_value=0), mock.Mock()
                service.generate_response.side_effect = replies
                review = review_answer("trial", ANSWER, DOCS, service, deadline_seconds=30, clock=clock)
                while next(review)["status"] != status:
                    pass
                clock.return_value = 30
                _, result = finish(review)
                self.assertEqual(service.generate_response.call_count, len(replies))
                self.assertEqual(result["generated_response"], WITHHELD_ANSWER)
                self.assertIn("time limit", result["answer_review"]["issues"][0])

    def test_provider_timeout_uses_budget_remaining_after_progress_yield(self):
        clock, service = mock.Mock(return_value=0), mock.Mock()
        service.generate_response.return_value = audit()
        review = review_answer("trial", ANSWER, DOCS, service, deadline_seconds=30, clock=clock)
        self.assertEqual(next(review)["status"], "checking")
        clock.return_value = 24
        _, result = finish(review)
        self.assertEqual(service.generate_response.call_args.kwargs["timeout"], 6)
        self.assertEqual(result["answer_review"]["status"], "checked")

    def test_shared_deadline_bounds_every_call_and_does_not_allow_late_pass(self):
        clock, service = mock.Mock(return_value=0), mock.Mock()

        def late_audit(**kwargs):
            clock.return_value = 31
            return audit()

        service.generate_response.side_effect = late_audit
        _, result = finish(review_answer("trial", ANSWER, DOCS, service, deadline_seconds=30, clock=clock))
        self.assertEqual(result["answer_review"]["status"], "unverified")
        self.assertLessEqual(service.generate_response.call_args.kwargs["timeout"], 30)
        self.assertEqual(service.generate_response.call_args.kwargs["max_retries"], 0)


class AccuracyPipelineTests(PipelineTestCase):
    def test_stream_replaces_draft_with_repaired_text_and_final_evidence(self):
        llm = FakeLLMService()
        index = self.make_index(dense=FakeDenseRAG(per_query_docs=[[{**DOCS[0], "dense_score": 1}]]), llm=llm)
        original = llm.generate_response

        def respond(prompt, system_instruction_string="", **kwargs):
            if "You verify a research answer" in system_instruction_string:
                # Build the first report against the real fake draft units.
                data = json.loads(prompt)
                if data["units"][0]["text"] != ANSWER:
                    return audit(data["units"][0]["text"], verdict="NO")
                return audit()
            if "You revise a research answer" in system_instruction_string:
                return ANSWER
            return original(prompt, system_instruction_string, **kwargs)

        with mock.patch.object(llm, "generate_response", respond):
            events = list(index.main_pipeline_stream("adult clinical trial results", mode="deep"))
            result = index.main_pipeline("adult clinical trial results", mode="deep")
        draft = next(e for e in events if e["type"] == "chunk_end")
        final = next(e for e in events if e["type"] == "chunk_evaluation")
        self.assertEqual(draft["answer_review"]["status"], "checking")
        self.assertNotEqual(draft["generated_response"], final["generated_response"])
        self.assertEqual(final["generated_response"], ANSWER)
        self.assertTrue(final["answer_review"]["revised"])
        self.assertEqual(events[-1]["answer_review"]["revised"], 1)
        self.assertEqual(result["responses"][0]["generated_response"], ANSWER)
        self.assertEqual(result["answer_review"]["revised"], 1)

    @override_settings(CHUNK_SIZE=2)
    def test_withheld_group_prevents_misleading_perfect_aggregate_in_both_apis(self):
        index = self.make_index()
        original = self.llm.generate_response

        def respond(prompt, system_instruction_string="", **kwargs):
            if "You verify a research answer" in system_instruction_string:
                data = json.loads(prompt)
                if data["sources"][0]["text"] == "doc-0":
                    return "unusable audit"
            return original(prompt, system_instruction_string, **kwargs)

        with mock.patch.object(self.llm, "generate_response", respond):
            result = index.main_pipeline("research topic", mode="deep")
            events = list(index.main_pipeline_stream("research topic", mode="deep"))
        for result in (result, events[-1]):
            self.assertEqual(result["answer_review"]["withheld"], 1)
            self.assertEqual(result["answer_review"]["checked"], 2)
            self.assertIsNone(result["aggregate_faithfulness"])
