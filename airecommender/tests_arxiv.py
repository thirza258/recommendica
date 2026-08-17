"""
Tests for the live arXiv fallback source.

No network: the HTTP layer is mocked and the parser is fed a fixture with the
real Atom + arXiv namespaces, which is where a hand-rolled feed parser actually
breaks.  The query-building tests cover the escaping contract — arXiv's
``search_query`` grammar gives meaning to quotes, parentheses, colons and the
AND/OR keywords, so a raw user question must not reach it intact.
"""

from unittest import mock

from django.test import SimpleTestCase, override_settings

from airecommender.pipeline.prompting import format_candidate
from airecommender.pipeline.sources import arxiv_api
from airecommender.pipeline.sources.arxiv_api import (
    ArxivClient,
    ArxivUnavailable,
    build_search_query,
    extract_terms,
    parse_atom_feed,
)

# ── Fixtures ─────────────────────────────────────────────────────────────────

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:arxiv="http://arxiv.org/schemas/atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.0/">
  <opensearch:totalResults>2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <updated>2023-02-01T00:00:00Z</updated>
    <published>2023-01-24T00:00:00Z</published>
    <title>Transformers for Medical
      Imaging</title>
    <summary>  We survey transformer architectures applied to
      medical image analysis.  </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <link href="http://arxiv.org/abs/2301.12345v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.12345v1" rel="related"
          type="application/pdf"/>
    <arxiv:primary_category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2302.00001v2</id>
    <published>2023-02-01T00:00:00Z</published>
    <title>Attention Is Still All You Need</title>
    <summary>A follow-up study.</summary>
    <author><name>Grace Hopper</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
"""

EMPTY_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.0/"
    >0</opensearch:totalResults>
</feed>
"""


class FakeResponse:
    """Minimal stand-in for a streamed ``requests`` response."""

    def __init__(self, body: bytes = b"", status_error=None):
        self.body = body
        self.status_error = status_error

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def raise_for_status(self):
        if self.status_error:
            raise self.status_error

    def iter_content(self, size):
        for start in range(0, len(self.body), size):
            yield self.body[start : start + size]


# ── Query construction ───────────────────────────────────────────────────────


class QueryBuildingTests(SimpleTestCase):
    def test_strips_characters_that_are_arxiv_syntax(self):
        """Colons, quotes and parens are grammar to arXiv — none may survive."""
        expression = build_search_query('transformers: "attention" (2017)')
        self.assertEqual(expression, "all:transformers AND all:attention AND all:2017")
        for char in (":", '"', "(", ")"):
            self.assertNotIn(char, expression.replace("all:", ""))

    def test_user_words_are_never_read_as_operators(self):
        # "and"/"or"/"not" typed by a user must not become search operators.
        self.assertEqual(
            build_search_query("robotics and or not vision"),
            "all:robotics AND all:vision",
        )

    def test_drops_question_scaffolding_but_keeps_the_topic(self):
        self.assertEqual(
            extract_terms("What papers explain the impact of AI on healthcare?"),
            ["ai", "healthcare"],
        )

    def test_deduplicates_and_preserves_order(self):
        self.assertEqual(
            extract_terms("climate change and climate policy"),
            ["climate", "change", "policy"],
        )

    def test_respects_the_term_cap(self):
        terms = extract_terms("alpha beta gamma delta epsilon zeta eta theta", max_terms=3)
        self.assertEqual(terms, ["alpha", "beta", "gamma"])

    def test_all_stopwords_falls_back_to_longest_tokens(self):
        # Nothing survives the stopword filter, but the search should still be
        # about something rather than about everything — and the ordering must
        # be stable, not set-iteration order.
        self.assertEqual(
            extract_terms("what are the most recent papers"),
            ["recent", "papers", "what", "most", "are", "the"],
        )

    def test_term_extraction_is_deterministic(self):
        query = "what are the most recent papers"
        self.assertEqual(extract_terms(query), extract_terms(query))

    def test_empty_query_produces_no_expression(self):
        self.assertEqual(build_search_query("   "), "")
        self.assertEqual(build_search_query("!!! ??? ..."), "")

    def test_or_operator_is_selectable(self):
        self.assertEqual(
            build_search_query("quantum computing", operator="or"),
            "all:quantum AND all:computing".replace(" AND ", " OR "),
        )


# ── Atom parsing ─────────────────────────────────────────────────────────────


class FeedParsingTests(SimpleTestCase):
    def test_parses_namespaced_entries_in_order(self):
        candidates = parse_atom_feed(FEED)
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0]["arxiv_rank"], 1)
        self.assertEqual(candidates[1]["arxiv_rank"], 2)

    def test_document_matches_the_collection_record_shape(self):
        """A fallback paper must render exactly like an indexed one."""
        import json

        first = parse_atom_feed(FEED)[0]
        record = json.loads(first["document"])
        self.assertEqual(
            set(record),
            {"title", "category", "summary", "authors"},
        )
        self.assertEqual(record["title"], "Transformers for Medical Imaging")
        self.assertEqual(record["category"], "cs.CV")
        self.assertEqual(record["authors"], "Ada Lovelace, Alan Turing")
        self.assertTrue(record["summary"].startswith("We survey transformer"))
        # And the prompt renderer accepts it without falling back to raw text.
        rendered = format_candidate(first["document"])
        self.assertIn("Transformers for Medical Imaging [cs.CV]", rendered)

    def test_metadata_marks_the_source_for_downstream_reporting(self):
        meta = parse_atom_feed(FEED)[0]["meta"]
        self.assertEqual(meta["source"], "arxiv_api")
        self.assertEqual(meta["arxiv_id"], "2301.12345v1")
        self.assertEqual(meta["pdf_url"], "http://arxiv.org/pdf/2301.12345v1")
        self.assertEqual(meta["primary_category"], "cs.CV")
        self.assertEqual(meta["categories"], "cs.CV, cs.LG")

    def test_falls_back_to_plain_category_without_a_primary(self):
        self.assertEqual(parse_atom_feed(FEED)[1]["meta"]["primary_category"], "cs.CL")

    def test_no_dense_score_is_invented_for_api_results(self):
        # Nothing was embedded, so anything blending retrieval signals must not
        # find a similarity here.
        self.assertNotIn("dense_score", parse_atom_feed(FEED)[0])

    def test_malformed_xml_is_an_empty_result_not_an_exception(self):
        self.assertEqual(parse_atom_feed("<feed><entry>"), [])
        self.assertEqual(parse_atom_feed(b""), [])

    def test_empty_feed_yields_no_candidates(self):
        self.assertEqual(parse_atom_feed(EMPTY_FEED), [])


# ── Request pacing ───────────────────────────────────────────────────────────


class PacingTests(SimpleTestCase):
    def setUp(self):
        arxiv_api.reset_pacing()
        self.addCleanup(arxiv_api.reset_pacing)

    def test_first_request_does_not_wait(self):
        with mock.patch.object(arxiv_api.time, "sleep") as sleep:
            self.assertTrue(arxiv_api._reserve_slot(3.0, budget=10))
        sleep.assert_not_called()

    def test_second_request_waits_for_the_interval(self):
        with mock.patch.object(arxiv_api.time, "sleep") as sleep:
            arxiv_api._reserve_slot(3.0, budget=10)
            self.assertTrue(arxiv_api._reserve_slot(3.0, budget=10))
        (waited,), _ = sleep.call_args
        self.assertGreater(waited, 2.5)

    def test_slot_further_away_than_the_budget_is_refused(self):
        with mock.patch.object(arxiv_api.time, "sleep") as sleep:
            arxiv_api._reserve_slot(30.0, budget=10)  # immediate, no wait
            self.assertFalse(arxiv_api._reserve_slot(30.0, budget=1))
        sleep.assert_not_called()

    def test_a_refused_reservation_does_not_consume_the_slot(self):
        arxiv_api._reserve_slot(30.0, budget=10)
        arxiv_api._reserve_slot(30.0, budget=0)
        with mock.patch.object(arxiv_api.time, "sleep") as sleep:
            self.assertTrue(arxiv_api._reserve_slot(30.0, budget=60))
        (waited,), _ = sleep.call_args
        self.assertLess(waited, 31)


# ── Client behaviour ─────────────────────────────────────────────────────────


@override_settings(
    ARXIV_MIN_REQUEST_INTERVAL=0,
    ARXIV_FALLBACK_TIMEOUT=5,
    ARXIV_BREAKER_THRESHOLD=2,
    ARXIV_BREAKER_COOLDOWN=60,
)
class ClientTests(SimpleTestCase):
    def setUp(self):
        arxiv_api.reset_pacing()
        self.addCleanup(arxiv_api.reset_pacing)

    def test_search_returns_parsed_candidates(self):
        with mock.patch.object(
            arxiv_api.requests, "get", return_value=FakeResponse(FEED.encode())
        ) as get:
            candidates = ArxivClient().search("medical imaging transformers", budget=30)

        self.assertEqual(len(candidates), 2)
        params = get.call_args.kwargs["params"]
        self.assertEqual(
            params["search_query"],
            "all:medical AND all:imaging AND all:transformers",
        )
        self.assertEqual(params["sortBy"], "relevance")
        self.assertIn("Recommendica", get.call_args.kwargs["headers"]["User-Agent"])

    def test_connection_failure_is_reported_as_unavailable(self):
        """Unreachable is not the same as "nothing found" — callers act on it."""
        with mock.patch.object(
            arxiv_api.requests, "get", side_effect=OSError("connection refused")
        ):
            with self.assertRaises(ArxivUnavailable) as caught:
                ArxivClient().search("anything at all", budget=30)
        self.assertIn("connection refused", str(caught.exception))

    def test_http_error_is_reported_as_unavailable(self):
        response = FakeResponse(status_error=RuntimeError("503 Service Unavailable"))
        with mock.patch.object(arxiv_api.requests, "get", return_value=response):
            with self.assertRaises(ArxivUnavailable):
                ArxivClient().search("anything at all", budget=30)

    def test_a_search_that_matched_nothing_is_not_unavailable(self):
        with mock.patch.object(
            arxiv_api.requests, "get", return_value=FakeResponse(EMPTY_FEED.encode())
        ):
            self.assertEqual(ArxivClient().search("obscure topic", budget=30), [])

    def test_breaker_opens_after_repeated_failures(self):
        client = ArxivClient()
        with mock.patch.object(
            arxiv_api.requests, "get", side_effect=OSError("down")
        ) as get:
            for query in ("first query here", "second query here"):
                with self.assertRaises(ArxivUnavailable):
                    client.search(query, budget=30)

            self.assertFalse(client.available())
            with self.assertRaises(ArxivUnavailable) as caught:
                client.search("third query here", budget=30)

        # Two attempts, then the breaker spares the third its timeout.
        self.assertEqual(get.call_count, 2)
        self.assertIn("cooldown", str(caught.exception))

    def test_oversized_response_is_rejected_before_parsing(self):
        huge = b"<feed>" + b"x" * (arxiv_api.MAX_RESPONSE_BYTES + 1)
        with mock.patch.object(
            arxiv_api.requests, "get", return_value=FakeResponse(huge)
        ):
            with self.assertRaises(ArxivUnavailable):
                ArxivClient().search("some topic here", budget=30)

    def test_a_failed_broader_retry_keeps_the_empty_first_result(self):
        # The AND search succeeded with no matches; the OR retry dying must not
        # turn a legitimate "nothing found" into an outage.
        with mock.patch.object(
            arxiv_api.requests,
            "get",
            side_effect=[FakeResponse(EMPTY_FEED.encode()), OSError("dropped")],
        ):
            self.assertEqual(
                ArxivClient().search("protein folding diffusion models", budget=60), []
            )

    def test_empty_and_search_retries_broader_with_or(self):
        responses = [FakeResponse(EMPTY_FEED.encode()), FakeResponse(FEED.encode())]
        with mock.patch.object(
            arxiv_api.requests, "get", side_effect=responses
        ) as get:
            candidates = ArxivClient().search(
                "protein folding diffusion models", budget=60
            )

        self.assertEqual(len(candidates), 2)
        self.assertEqual(get.call_count, 2)
        self.assertIn(" OR ", get.call_args_list[1].kwargs["params"]["search_query"])

    def test_no_broader_retry_when_the_budget_is_spent(self):
        with mock.patch.object(
            arxiv_api.requests, "get", return_value=FakeResponse(EMPTY_FEED.encode())
        ) as get:
            self.assertEqual(
                ArxivClient().search("protein folding diffusion models", budget=2), []
            )
        self.assertEqual(get.call_count, 1)

    def test_a_slot_beyond_the_budget_is_unavailable_not_empty(self):
        client = ArxivClient()
        with override_settings(ARXIV_MIN_REQUEST_INTERVAL=30):
            client = ArxivClient()
            with mock.patch.object(
                arxiv_api.requests, "get", return_value=FakeResponse(FEED.encode())
            ):
                client.search("first topic here", budget=30)
                with self.assertRaises(ArxivUnavailable):
                    client.search("second topic here", budget=1)

    def test_unsearchable_query_makes_no_request(self):
        with mock.patch.object(arxiv_api.requests, "get") as get:
            self.assertEqual(ArxivClient().search("!!!", budget=30), [])
        get.assert_not_called()
