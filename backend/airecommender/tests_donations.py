"""
Tests for the Paddle donation endpoints.

No network: the Paddle API call is mocked, and webhooks are posted to the view
with signatures computed the same way Paddle computes them.  The parts worth
testing here are the ones that fail silently in production —

* the signature check, over the *raw* body, including secret rotation (several
  ``h1`` values) and a tampered payload;
* idempotency, because Paddle retries and a redelivered event must not create a
  second donation row;
* the amount conversion, where a wrong currency exponent charges 100× or 1/100×.
"""

import hashlib
import hmac
import json
import time
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import Client
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from rest_framework.throttling import ScopedRateThrottle

from airecommender import donations
from airecommender.models import Donation

# ── Fixtures ─────────────────────────────────────────────────────────────────

WEBHOOK_SECRET = "pdl_ntfset_test_secret"

PADDLE_SETTINGS = dict(
    PADDLE_ENVIRONMENT="sandbox",
    PADDLE_API_KEY="pdl_sdbx_apikey_test",
    PADDLE_CLIENT_TOKEN="test_clienttoken",
    PADDLE_DONATION_PRODUCT_ID="pro_01test",
    PADDLE_WEBHOOK_SECRET=WEBHOOK_SECRET,
    PADDLE_DONATION_CURRENCIES="USD,EUR",
    PADDLE_DONATION_PRESETS="5,15,50",
    PADDLE_DONATION_MIN_AMOUNT="1",
    PADDLE_DONATION_MAX_AMOUNT="500",
)

TRANSACTION_ID = "txn_01hj3rtynv8rdn1zbcjk42z05j"


def transaction_response(status="draft", checkout_url="https://pay.example.com/?_ptxn=txn_01"):
    """A trimmed POST /transactions response, shaped like Paddle's."""
    return {
        "data": {
            "id": TRANSACTION_ID,
            "status": status,
            "currency_code": "USD",
            "checkout": {"url": checkout_url},
        }
    }


def webhook_event(event_type="transaction.completed", **overrides):
    event = {
        "event_id": "evt_01test",
        "event_type": event_type,
        "occurred_at": "2026-08-23T10:00:00.000000Z",
        "data": {
            "id": TRANSACTION_ID,
            "status": event_type.split(".")[-1],
            "currency_code": "USD",
            "custom_data": {"kind": "donation", "message": "keep it up"},
            # Real transaction events identify the payer this way; the expanded
            # customer object is only present when the destination includes it.
            "customer_id": "ctm_01test",
            "details": {"totals": {"grand_total": "1500", "currency_code": "USD"}},
        },
    }
    event.update(overrides)
    return event


def sign(body: bytes, secret: str = WEBHOOK_SECRET, timestamp: int | None = None) -> str:
    """Build a Paddle-Signature header the way Paddle does."""
    timestamp = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(
        secret.encode(), f"{timestamp}:".encode() + body, hashlib.sha256
    ).hexdigest()
    return f"ts={timestamp};h1={digest}"


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


# ── Amount conversion ────────────────────────────────────────────────────────


class MinorUnitTests(SimpleTestCase):
    def test_two_decimal_currency(self):
        self.assertEqual(donations.to_minor_units(Decimal("15.00"), "USD"), 1500)
        self.assertEqual(donations.to_minor_units(Decimal("0.99"), "EUR"), 99)

    def test_zero_decimal_currency_is_not_multiplied(self):
        # JPY has no minor unit; ¥500 is "500", not "50000".
        self.assertEqual(donations.to_minor_units(Decimal("500"), "JPY"), 500)

    def test_excess_precision_is_rejected(self):
        with self.assertRaises(donations.DonationAmountInvalid):
            donations.to_minor_units(Decimal("1.005"), "USD")
        with self.assertRaises(donations.DonationAmountInvalid):
            donations.to_minor_units(Decimal("1.5"), "JPY")

    def test_round_trip(self):
        self.assertEqual(donations.from_minor_units(1500, "USD"), Decimal("15"))
        self.assertEqual(donations.from_minor_units(500, "JPY"), Decimal("500"))

    def test_formatting_follows_the_currency(self):
        self.assertEqual(donations.format_amount(1250, "USD"), "12.50")
        self.assertEqual(donations.format_amount(500, "JPY"), "500")


# ── Signature verification ───────────────────────────────────────────────────


class SignatureTests(SimpleTestCase):
    body = b'{"event_type":"transaction.completed"}'

    def test_valid_signature(self):
        header = sign(self.body)
        self.assertTrue(
            donations.verify_webhook_signature(self.body, header, WEBHOOK_SECRET)
        )

    def test_tampered_body_fails(self):
        header = sign(self.body)
        self.assertFalse(
            donations.verify_webhook_signature(self.body + b" ", header, WEBHOOK_SECRET)
        )

    def test_wrong_secret_fails(self):
        header = sign(self.body)
        self.assertFalse(
            donations.verify_webhook_signature(self.body, header, "another_secret")
        )

    def test_accepts_any_h1_during_secret_rotation(self):
        # Paddle sends several h1 values while a secret is being rotated; only
        # one of them is computed with the secret this server holds.
        timestamp = int(time.time())
        valid = sign(self.body, timestamp=timestamp).split("h1=")[1]
        header = f"ts={timestamp};h1={'0' * 64};h1={valid}"
        self.assertTrue(
            donations.verify_webhook_signature(self.body, header, WEBHOOK_SECRET)
        )

    def test_stale_event_is_rejected_within_tolerance(self):
        header = sign(self.body, timestamp=int(time.time()) - 3600)
        self.assertFalse(
            donations.verify_webhook_signature(
                self.body, header, WEBHOOK_SECRET, tolerance=300
            )
        )
        # ...but a zero tolerance disables the freshness check entirely.
        self.assertTrue(
            donations.verify_webhook_signature(
                self.body, header, WEBHOOK_SECRET, tolerance=0
            )
        )

    def test_malformed_headers(self):
        for header in ("", "garbage", "ts=123", f"h1={'0' * 64}"):
            self.assertFalse(
                donations.verify_webhook_signature(self.body, header, WEBHOOK_SECRET),
                msg=header,
            )


# ── Config endpoint ──────────────────────────────────────────────────────────


class DonationConfigTests(TestCase):
    def test_disabled_without_credentials(self):
        with override_settings(PADDLE_API_KEY="", PADDLE_CLIENT_TOKEN="", PADDLE_DONATION_PRODUCT_ID=""):
            response = self.client.get(reverse("donate-config"))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

    @override_settings(**PADDLE_SETTINGS)
    def test_enabled_exposes_only_public_values(self):
        response = self.client.get(reverse("donate-config"))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["client_token"], "test_clienttoken")
        self.assertEqual(payload["currency"], "USD")
        self.assertEqual(payload["presets"], ["5", "15", "50"])
        body = json.dumps(payload)
        self.assertNotIn(PADDLE_SETTINGS["PADDLE_API_KEY"], body)
        self.assertNotIn(WEBHOOK_SECRET, body)


# ── Checkout endpoint ────────────────────────────────────────────────────────


@override_settings(**PADDLE_SETTINGS)
class DonationCheckoutTests(TestCase):
    def setUp(self):
        # DRF throttles through the cache, which is process-wide and would
        # otherwise leak counts between tests.
        cache.clear()

    def post(self, payload):
        return self.client.post(
            reverse("donate-checkout"), data=payload, content_type="application/json"
        )

    @mock.patch("airecommender.donations.requests.post")
    def test_creates_transaction_and_records_draft(self, post):
        post.return_value = FakeResponse(transaction_response())

        response = self.post({"amount": "15.00", "currency": "USD", "message": "thanks!"})

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["transaction_id"], TRANSACTION_ID)
        self.assertEqual(payload["client_token"], "test_clienttoken")
        self.assertEqual(payload["environment"], "sandbox")
        # Echoed back in the currency's own precision, not the client's.
        self.assertEqual(payload["amount"], "15.00")

        # The amount reaches Paddle in minor units, against the sandbox host.
        url, kwargs = post.call_args[0][0], post.call_args[1]
        self.assertEqual(url, "https://sandbox-api.paddle.com/transactions")
        item = kwargs["json"]["items"][0]
        self.assertEqual(item["price"]["unit_price"], {"amount": "1500", "currency_code": "USD"})
        self.assertEqual(item["price"]["product_id"], "pro_01test")
        self.assertEqual(item["price"]["quantity"], {"minimum": 1, "maximum": 1})
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer pdl_sdbx_apikey_test")

        donation = Donation.objects.get(paddle_transaction_id=TRANSACTION_ID)
        self.assertEqual(donation.amount_minor, 1500)
        self.assertEqual(donation.status, Donation.STATUS_DRAFT)
        self.assertEqual(donation.message, "thanks!")

    @mock.patch("airecommender.donations.requests.post")
    def test_rejects_out_of_range_and_unsupported_input(self, post):
        for payload in (
            {"amount": "0.50"},          # below the minimum
            {"amount": "5000"},          # above the maximum
            {"amount": "-10"},           # negative
            {"amount": "10", "currency": "XYZ"},  # not on the allowlist
            {"amount": "not-a-number"},
            {},                          # no amount at all
        ):
            with self.subTest(payload=payload):
                response = self.post(payload)
                self.assertEqual(response.status_code, 400)
        post.assert_not_called()

    @mock.patch("airecommender.donations.requests.post")
    def test_paddle_failure_is_a_503_not_a_traceback(self, post):
        post.return_value = FakeResponse({"error": {"code": "forbidden"}}, status_code=403)

        response = self.post({"amount": "15.00"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("Retry-After", response)
        self.assertFalse(Donation.objects.exists())

    @mock.patch("airecommender.donations.requests.post")
    def test_disabled_when_unconfigured(self, post):
        with override_settings(PADDLE_API_KEY=""):
            response = self.post({"amount": "15.00"})
        self.assertEqual(response.status_code, 503)
        post.assert_not_called()

    @mock.patch("airecommender.donations.requests.post")
    def test_throttled_after_the_configured_rate(self, post):
        post.return_value = FakeResponse(transaction_response())
        # DRF reads DEFAULT_THROTTLE_RATES into a class attribute at import
        # time, so override_settings cannot reach it — patch where it lands.
        with mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"donation": "2/hour"}):
            self.assertEqual(self.post({"amount": "5"}).status_code, 201)
            self.assertEqual(self.post({"amount": "5"}).status_code, 201)
            self.assertEqual(self.post({"amount": "5"}).status_code, 429)

    @mock.patch("airecommender.donations.requests.post")
    def test_a_spoofed_forwarded_for_does_not_reset_the_limit(self, post):
        # nginx appends the real address to whatever the client sent, so the
        # last entry is the only one a caller cannot choose. If the throttle
        # keyed on the whole header, varying the prefix would buy an unlimited
        # number of transactions at Paddle.
        post.return_value = FakeResponse(transaction_response())
        with mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"donation": "1/hour"}):
            first = self.client.post(
                reverse("donate-checkout"),
                data={"amount": "5"},
                content_type="application/json",
                HTTP_X_FORWARDED_FOR="1.2.3.4, 10.0.0.9",
            )
            second = self.client.post(
                reverse("donate-checkout"),
                data={"amount": "5"},
                content_type="application/json",
                HTTP_X_FORWARDED_FOR="9.9.9.9, 10.0.0.9",
            )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 429)

    def test_the_donation_scope_has_a_configured_rate(self):
        # A scope with no rate silently disables throttling on the endpoint.
        self.assertIsNotNone(ScopedRateThrottle.THROTTLE_RATES.get("donation"))


# ── Webhook ──────────────────────────────────────────────────────────────────


@override_settings(**PADDLE_SETTINGS)
class PaddleWebhookTests(TestCase):
    def setUp(self):
        # Paddle posts from outside the browser and carries no CSRF token, so
        # the view must be exempt. The default test client does not check CSRF
        # at all, which would let a missing @csrf_exempt pass every test here
        # and fail on every real delivery.
        self.client = Client(enforce_csrf_checks=True)

    def post(self, body: bytes, header: str | None = None):
        return self.client.post(
            reverse("donate-webhook"),
            data=body,
            content_type="application/json",
            headers={"paddle-signature": sign(body) if header is None else header},
        )

    def test_signed_event_records_a_donation_once(self):
        body = json.dumps(webhook_event()).encode()

        response = self.post(body)

        self.assertEqual(response.status_code, 200)
        donation = Donation.objects.get()
        self.assertEqual(donation.paddle_transaction_id, TRANSACTION_ID)
        self.assertEqual(donation.status, Donation.STATUS_COMPLETED)
        self.assertEqual(donation.amount_minor, 1500)
        self.assertEqual(donation.currency, "USD")
        self.assertEqual(donation.message, "keep it up")
        # No expanded customer in the payload, so no email — the normal case.
        self.assertEqual(donation.email, "")
        self.assertIsNotNone(donation.completed_at)

        # Paddle retries; the redelivery must not add a second row.
        self.assertEqual(self.post(body).status_code, 200)
        self.assertEqual(Donation.objects.count(), 1)

    def test_tampered_body_is_rejected(self):
        body = json.dumps(webhook_event()).encode()
        header = sign(body)

        tampered = body.replace(b'"1500"', b'"999900"')
        response = self.client.post(
            reverse("donate-webhook"),
            data=tampered,
            content_type="application/json",
            headers={"paddle-signature": header},
        )

        self.assertEqual(response.status_code, 401)
        self.assertFalse(Donation.objects.exists())

    def test_unsigned_request_is_rejected(self):
        body = json.dumps(webhook_event()).encode()
        response = self.post(body, header="")
        self.assertEqual(response.status_code, 401)
        self.assertFalse(Donation.objects.exists())

    def test_updates_the_row_created_at_checkout(self):
        Donation.objects.create(
            paddle_transaction_id=TRANSACTION_ID,
            status=Donation.STATUS_DRAFT,
            amount_minor=1500,
            currency="USD",
        )

        self.post(json.dumps(webhook_event()).encode())

        donation = Donation.objects.get()
        self.assertEqual(Donation.objects.count(), 1)
        self.assertEqual(donation.status, Donation.STATUS_COMPLETED)

    def test_out_of_order_event_does_not_revert_status(self):
        completed = webhook_event()
        self.post(json.dumps(completed).encode())

        # A "ready" event that was emitted earlier but arrives later.
        stale = webhook_event(
            event_type="transaction.ready",
            event_id="evt_01earlier",
            occurred_at="2026-08-23T09:00:00.000000Z",
        )
        self.post(json.dumps(stale).encode())

        self.assertEqual(Donation.objects.get().status, Donation.STATUS_COMPLETED)

    def test_email_is_stored_when_the_customer_is_expanded(self):
        event = webhook_event()
        event["data"]["customer"] = {"id": "ctm_01test", "email": "supporter@example.com"}

        self.post(json.dumps(event).encode())

        self.assertEqual(Donation.objects.get().email, "supporter@example.com")

    def test_unhandled_event_types_are_acknowledged(self):
        body = json.dumps(webhook_event(event_type="subscription.created")).encode()

        response = self.post(body)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["handled"])
        self.assertFalse(Donation.objects.exists())

    def test_invalid_json_with_a_valid_signature_is_a_400(self):
        body = b"not json"
        self.assertEqual(self.post(body).status_code, 400)

    def test_get_is_not_allowed(self):
        self.assertEqual(self.client.get(reverse("donate-webhook")).status_code, 405)

    def test_missing_secret_reports_misconfiguration(self):
        body = json.dumps(webhook_event()).encode()
        with override_settings(PADDLE_WEBHOOK_SECRET=""):
            response = self.post(body)
        self.assertEqual(response.status_code, 503)
