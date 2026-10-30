"""
Tests for the paper assistant endpoint (POST /api/v1/assistant/).

Runs without network access: the LLM service is patched at
``airecommender.main.get_llm_service``, the same seam the pipeline tests use.
"""

import json
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.throttling import ScopedRateThrottle

from airecommender import views
from airecommender.assistant import ASSISTANT_SYSTEM_PROMPT, build_prompt
from airecommender.pipeline.errors import LLMUnavailable


class FakeAssistantService:
    """Stands in for OpenRouterService, recording what it was asked."""

    def __init__(self, tokens=("Hello", " world"), error=None):
        self.tokens = list(tokens)
        self.error = error
        self.calls = []
        self.cancel_event = None

    def generate_response_stream(self, prompt, system_instruction_string, **kwargs):
        self.calls.append({"prompt": prompt, "system": system_instruction_string})
        self.cancel_event = kwargs.get("cancel_event")
        for token in self.tokens:
            if self.cancel_event is not None and self.cancel_event.is_set():
                return
            yield token
        if self.error is not None:
            raise self.error


def patch_service(service):
    return mock.patch("airecommender.main.get_llm_service", return_value=service)


class BuildPromptTests(TestCase):
    def test_prompt_carries_document_history_and_question(self):
        prompt = build_prompt(
            "My paper",
            "\\section{Intro}",
            [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
            "What is this about?",
        )

        self.assertIn('Paper "My paper"', prompt)
        self.assertIn("<document>", prompt)
        self.assertIn("\\section{Intro}", prompt)
        self.assertIn("User: hi", prompt)
        self.assertIn("Assistant: hello", prompt)
        self.assertIn("New request: What is this about?", prompt)

    def test_empty_document_gets_a_placeholder(self):
        prompt = build_prompt("", "", [], "hello")

        self.assertIn("(The paper is empty.)", prompt)


class AssistantSerializerTests(TestCase):
    def _post(self, **overrides):
        body = {"question": "What is this about?", "document_text": "\\section{Intro}"}
        body.update(overrides)
        return self.client.post(
            "/api/v1/assistant/", data=json.dumps(body), content_type="application/json"
        )

    def test_rejects_over_long_document(self):
        response = self._post(document_text="x" * 60001)

        self.assertEqual(response.status_code, 400)

    def test_rejects_bad_history_role(self):
        response = self._post(history=[{"role": "system", "content": "nope"}])

        self.assertEqual(response.status_code, 400)

    def test_rejects_non_string_history_content(self):
        response = self._post(history=[{"role": "user", "content": 42}])

        self.assertEqual(response.status_code, 400)


@override_settings(OPENROUTER_API_KEY="")
class AssistantStreamTests(TestCase):
    def setUp(self):
        cache.clear()

    def _post(self, **overrides):
        body = {"question": "What is this about?", "document_text": "\\section{Intro}"}
        body.update(overrides)
        return self.client.post(
            "/api/v1/assistant/", data=json.dumps(body), content_type="application/json"
        )

    def _events(self, response):
        self.assertTrue(response.streaming)
        frames = []
        for chunk in response.streaming_content:
            text = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            for line in text.split("\n"):
                if line.startswith("data: "):
                    frames.append(json.loads(line[6:]))
        return frames

    def test_streams_tokens_then_complete(self):
        service = FakeAssistantService(tokens=("Hello", " there"))
        with patch_service(service):
            response = self._post(document_title="My paper")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "text/event-stream")
            events = self._events(response)

        self.assertEqual(
            [event["type"] for event in events],
            ["token", "token", "complete"],
        )
        self.assertEqual(events[0]["text"], "Hello")
        self.assertEqual(events[-1], {"type": "complete"})

        # The model must see the document, the system protocol and the question.
        call = service.calls[0]
        self.assertEqual(call["system"], ASSISTANT_SYSTEM_PROMPT)
        self.assertIn("My paper", call["prompt"])
        self.assertIn("\\section{Intro}", call["prompt"])
        self.assertIn("What is this about?", call["prompt"])

    def test_llm_failure_emits_error_event(self):
        service = FakeAssistantService(error=LLMUnavailable("provider down"))
        with patch_service(service):
            response = self._post()
            events = self._events(response)

        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("provider down", events[-1]["message"])

    def test_unexpected_failure_emits_generic_error_event(self):
        service = FakeAssistantService(error=RuntimeError("boom"))
        with patch_service(service):
            response = self._post()
            events = self._events(response)

        self.assertEqual(events[-1]["type"], "error")
        self.assertNotIn("boom", events[-1]["message"])

    def test_abandoning_the_response_cancels_and_releases_the_slot(self):
        service = FakeAssistantService(tokens=("a", "b", "c", "d"))
        before = views._assistant_slots._value
        with patch_service(service):
            response = self._post()

            iterator = iter(response.streaming_content)
            next(iterator)
            # A disconnecting WSGI server closes the response, which closes
            # the generator and runs its finally block.
            response.close()

        self.assertTrue(service.cancel_event.is_set())
        self.assertEqual(views._assistant_slots._value, before)


@override_settings(OPENROUTER_API_KEY="")
class AssistantThrottleTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_second_request_within_rate_is_rejected(self):
        body = json.dumps({"question": "hi", "document_text": ""})
        with patch_service(FakeAssistantService(tokens=())), mock.patch.dict(
            ScopedRateThrottle.THROTTLE_RATES, {"assistant": "1/min"}
        ):
            first = self.client.post(
                "/api/v1/assistant/", data=body, content_type="application/json"
            )
            second = self.client.post(
                "/api/v1/assistant/", data=body, content_type="application/json"
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
