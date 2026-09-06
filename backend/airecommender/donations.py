"""
Paddle-backed donations.

Recommendica has no accounts and sells nothing: a donation buys no entitlement,
so nothing here grants access to anything.  What it does do is talk to a payment
provider from an unauthenticated endpoint, which is why the money-handling rules
live in this module rather than in the view:

* amounts are validated and converted to Paddle's minor units *here*, so a view
  can never forward a client-supplied string to the API untouched;
* the currency must be on an allowlist — Paddle rejects unsupported codes with
  an opaque 400, and the exponent (how many minor units make one unit) differs
  per currency, so guessing is wrong twice over;
* webhook signatures are verified against the raw request body, which is the
  only thing standing between an unauthenticated public URL and forged
  "donation completed" rows.

Configuration is optional.  With no Paddle credentials the API answers a plain
"donations are not configured" instead of failing at import time or leaking a
traceback, so the project still runs for anyone who just wants the search.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

#: Paddle serves sandbox and live from different hosts, and a key issued for one
#: is rejected by the other.  Both the API host and the Paddle.js `environment`
#: option are derived from a single PADDLE_ENVIRONMENT setting so they cannot
#: drift apart — a live token against the sandbox host is a confusing 403.
LIVE_API_BASE = "https://api.paddle.com"
SANDBOX_API_BASE = "https://sandbox-api.paddle.com"

#: Minor units per major unit, as an exponent: USD 2 → "$5.00" is "500".
#: Most currencies are 2; the exceptions below are the ones Paddle actually
#: supports, and getting one wrong charges 100× or 1/100× the intended amount.
CURRENCY_EXPONENTS = {
    "JPY": 0,
    "KRW": 0,
    "CLP": 0,
    "ISK": 0,
    "TWD": 0,
    "HUF": 0,
    "UGX": 0,
    "VND": 0,
    "KWD": 3,
    "BHD": 3,
    "OMR": 3,
}
DEFAULT_EXPONENT = 2


class DonationError(Exception):
    """Base class for donation failures that are safe to report to a caller."""

    default_message = "The donation could not be processed."

    def user_message(self) -> str:
        return str(self) or self.default_message


class DonationsNotConfigured(DonationError):
    """Paddle credentials are missing — the feature is off, not broken."""

    default_message = "Donations are not configured on this server."


class DonationAmountInvalid(DonationError):
    """The requested amount or currency failed validation (a 400, not a 500)."""

    default_message = "The donation amount is not valid."


class PaddleUnavailable(DonationError):
    """Paddle could not be reached, or answered with an error."""

    default_message = "The payment provider is unavailable. Please try again."


@dataclass(frozen=True)
class PaddleConfig:
    """Resolved Paddle settings for one request."""

    environment: str
    api_base: str
    api_key: str
    client_token: str
    product_id: str
    webhook_secret: str
    currencies: tuple[str, ...]
    default_currency: str
    #: Preset buttons offered by the UI, in major units.
    presets: tuple[Decimal, ...]
    min_amount: Decimal
    max_amount: Decimal
    request_timeout: float
    webhook_tolerance: int

    @property
    def is_sandbox(self) -> bool:
        return self.environment == "sandbox"

    @property
    def checkout_configured(self) -> bool:
        """Whether a donation checkout can actually be created."""
        return bool(self.api_key and self.client_token and self.product_id)

    @property
    def webhook_configured(self) -> bool:
        return bool(self.webhook_secret)


def _decimal_setting(name: str, default: str) -> Decimal:
    raw = str(getattr(settings, name, "") or default)
    try:
        return Decimal(raw)
    except InvalidOperation:
        logger.warning("[DONATE] %s=%r is not a number — falling back to %s", name, raw, default)
        return Decimal(default)


def get_config() -> PaddleConfig:
    """
    Build the Paddle configuration from settings.

    Read per call rather than cached at import so tests (and a reloaded
    process) can override any of it with ``override_settings``.
    """
    environment = str(getattr(settings, "PADDLE_ENVIRONMENT", "sandbox")).strip().lower()
    if environment not in {"sandbox", "production"}:
        logger.warning(
            "[DONATE] PADDLE_ENVIRONMENT=%r is not 'sandbox' or 'production' — "
            "treating it as sandbox",
            environment,
        )
        environment = "sandbox"

    currencies = tuple(
        code.strip().upper()
        for code in str(getattr(settings, "PADDLE_DONATION_CURRENCIES", "USD")).split(",")
        if code.strip()
    ) or ("USD",)

    presets = []
    for raw in str(getattr(settings, "PADDLE_DONATION_PRESETS", "5,15,50")).split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            presets.append(Decimal(raw))
        except InvalidOperation:
            logger.warning("[DONATE] Ignoring unparseable preset amount %r", raw)

    return PaddleConfig(
        environment=environment,
        api_base=SANDBOX_API_BASE if environment == "sandbox" else LIVE_API_BASE,
        api_key=str(getattr(settings, "PADDLE_API_KEY", "") or "").strip(),
        client_token=str(getattr(settings, "PADDLE_CLIENT_TOKEN", "") or "").strip(),
        product_id=str(getattr(settings, "PADDLE_DONATION_PRODUCT_ID", "") or "").strip(),
        webhook_secret=str(getattr(settings, "PADDLE_WEBHOOK_SECRET", "") or "").strip(),
        currencies=currencies,
        default_currency=currencies[0],
        presets=tuple(presets),
        min_amount=_decimal_setting("PADDLE_DONATION_MIN_AMOUNT", "1"),
        max_amount=_decimal_setting("PADDLE_DONATION_MAX_AMOUNT", "1000"),
        request_timeout=float(getattr(settings, "PADDLE_REQUEST_TIMEOUT", 15)),
        webhook_tolerance=int(getattr(settings, "PADDLE_WEBHOOK_TOLERANCE", 300)),
    )


# ── Amounts ──────────────────────────────────────────────────────────────────

def to_minor_units(amount: Decimal, currency: str) -> int:
    """
    Convert a major-unit amount ("5.00") to Paddle's minor units (500).

    Raises :class:`DonationAmountInvalid` when the amount has more precision
    than the currency can express — silently rounding someone's donation is
    worse than telling them the number was wrong.
    """
    exponent = CURRENCY_EXPONENTS.get(currency.upper(), DEFAULT_EXPONENT)
    scaled = amount * (10 ** exponent)
    if scaled != scaled.to_integral_value():
        raise DonationAmountInvalid(
            f"{currency} amounts support at most {exponent} decimal place(s)."
        )
    return int(scaled)


def from_minor_units(amount_minor: int, currency: str) -> Decimal:
    """Inverse of :func:`to_minor_units`, for display and for API responses."""
    exponent = CURRENCY_EXPONENTS.get(currency.upper(), DEFAULT_EXPONENT)
    return Decimal(amount_minor) / (10 ** exponent)


def format_amount(amount_minor: int, currency: str) -> str:
    """
    Render a minor-unit amount the way the currency is written: 1250 USD is
    "12.50", 500 JPY is "500".

    Echoing the client's own string back would report whatever precision it
    happened to send ("12.500"), which reads as a different amount.
    """
    exponent = CURRENCY_EXPONENTS.get(currency.upper(), DEFAULT_EXPONENT)
    return f"{from_minor_units(amount_minor, currency):.{exponent}f}"


# ── Transactions ─────────────────────────────────────────────────────────────

def create_donation_transaction(
    amount_minor: int,
    currency: str,
    message: str = "",
    config: PaddleConfig | None = None,
) -> dict:
    """
    Create a draft Paddle transaction for a one-off donation of any amount.

    Donations are pay-what-you-want, so this uses a *custom* (ad-hoc) price
    against the configured donation product rather than a catalogue price: a
    fixed set of price IDs would cap the amounts a supporter can choose.

    The transaction comes back in ``draft`` status, which is expected — the
    checkout is what collects the customer and address details that move it to
    ``ready``.  Returns the parsed ``data`` object from Paddle.
    """
    config = config or get_config()
    if not config.checkout_configured:
        raise DonationsNotConfigured()

    payload = {
        "items": [
            {
                "quantity": 1,
                "price": {
                    "product_id": config.product_id,
                    "name": "Donation",
                    "description": "Supporting Recommendica",
                    "unit_price": {
                        "amount": str(amount_minor),
                        "currency_code": currency,
                    },
                    # One donation per checkout: without this Paddle allows a
                    # quantity stepper, which multiplies the chosen amount.
                    "quantity": {"minimum": 1, "maximum": 1},
                },
            }
        ],
        "currency_code": currency,
        "custom_data": {"kind": "donation", "source": "recommendica"},
    }
    if message:
        payload["custom_data"]["message"] = message

    url = f"{config.api_base}/transactions"
    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                # Pin the API version so a future default cannot reshape the
                # response under a deployment that was never redeployed.
                "Paddle-Version": "1",
            },
            timeout=config.request_timeout,
        )
    except requests.RequestException as exc:
        logger.error("[DONATE] Paddle request failed: %s", exc)
        raise PaddleUnavailable() from exc

    if response.status_code >= 400:
        # Paddle's error body carries the actionable detail (bad product_id,
        # unsupported currency, wrong environment) — log it, but answer the
        # caller with a stable message rather than the provider's wording.
        logger.error(
            "[DONATE] Paddle returned %s for %s: %s",
            response.status_code,
            url,
            response.text[:500],
        )
        raise PaddleUnavailable()

    try:
        data = response.json()["data"]
    except (ValueError, KeyError, TypeError) as exc:
        logger.error("[DONATE] Unparseable Paddle response: %s", response.text[:500])
        raise PaddleUnavailable() from exc

    return data


# ── Webhook signatures ───────────────────────────────────────────────────────

def _parse_signature_header(header: str) -> dict[str, list[str]]:
    """
    Parse ``ts=1671552777;h1=abc...`` into ``{"ts": [...], "h1": [...]}``.

    Values are collected into lists on purpose: during a secret rotation Paddle
    sends several ``h1`` values in one header, and a parser that assumes exactly
    two parts rejects every event for the length of the rotation.
    """
    parsed: dict[str, list[str]] = {}
    for part in header.split(";"):
        key, _, value = part.partition("=")
        key = key.strip()
        value = value.strip()
        if key and value:
            parsed.setdefault(key, []).append(value)
    return parsed


def verify_webhook_signature(
    raw_body: bytes,
    signature_header: str,
    secret: str,
    tolerance: int = 300,
) -> bool:
    """
    Check a ``Paddle-Signature`` header against the raw request body.

    *raw_body* must be the bytes exactly as received.  Re-serialising the parsed
    JSON changes key order and whitespace, and the signature will never match.

    *tolerance* is the replay window in seconds; pass 0 to skip the freshness
    check.  Paddle's own example uses 5 seconds, which is far too tight in
    practice — it rejects legitimate retries and any event that crosses a
    slightly skewed clock.
    """
    if not secret or not signature_header:
        return False

    parts = _parse_signature_header(signature_header)
    timestamps = parts.get("ts") or []
    signatures = parts.get("h1") or []
    if not timestamps or not signatures:
        logger.warning("[DONATE] Paddle-Signature header is missing ts or h1")
        return False

    timestamp = timestamps[0]
    if tolerance:
        try:
            age = int(time.time()) - int(timestamp)
        except ValueError:
            logger.warning("[DONATE] Paddle-Signature ts=%r is not an integer", timestamp)
            return False
        # Negative age means Paddle's clock is ahead of ours; only staleness is
        # a replay signal, so allow the skew in that direction.
        if age > tolerance:
            logger.warning("[DONATE] Rejecting webhook — event is %ss old", age)
            return False

    signed_payload = timestamp.encode() + b":" + raw_body
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, candidate) for candidate in signatures)
