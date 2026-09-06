import json
import logging
import queue
import threading
import time

from django.conf import settings
from django.db import transaction as db_transaction
from django.http import JsonResponse, StreamingHttpResponse
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import donations
from .main import get_rag_index
from .models import Donation, ResearchInfo
from .pipeline.errors import PipelineError
from .serializers import DonationCheckoutSerializer, ResearchInfoSerializer

logger = logging.getLogger(__name__)

def _heartbeat_seconds() -> float:
    """
    Seconds without a pipeline event before emitting an SSE keep-alive comment.

    Read per request rather than at import so it stays tunable from settings.
    Proxies and load balancers close idle connections, and an answer's first
    token can be tens of seconds out.
    """
    return float(getattr(settings, "SSE_HEARTBEAT_SECONDS", 15))

#: Each in-flight query holds several worker threads and multiple upstream HTTP
#: connections.  Bounding them turns an overload into an immediate, honest 503
#: instead of a pile of requests that all time out.
_MAX_CONCURRENT_QUERIES = int(getattr(settings, "MAX_CONCURRENT_QUERIES", 8))
_query_slots = threading.BoundedSemaphore(_MAX_CONCURRENT_QUERIES)


class _Slot:
    """A concurrency permit that is safe to release exactly once."""

    def __init__(self, semaphore: threading.BoundedSemaphore):
        self._semaphore = semaphore
        self._released = False
        self._lock = threading.Lock()

    def release(self):
        with self._lock:
            if self._released:
                return
            self._released = True
        self._semaphore.release()


def _acquire_slot():
    """Return a :class:`_Slot`, or ``None`` when the server is saturated."""
    if _query_slots.acquire(blocking=False):
        return _Slot(_query_slots)
    return None


def _busy_response():
    response = Response(
        {"error": "The server is at capacity. Please retry in a few seconds."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
    response["Retry-After"] = "10"
    return response


def _not_ready_response(exc: PipelineError):
    logger.error("[VIEW] Pipeline unavailable: %s", exc)
    response = Response(
        {"error": exc.user_message()},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
    response["Retry-After"] = "30"
    return response


class GetAllResearch(ListAPIView):
    # Explicit ordering — paginating an unordered queryset can repeat or skip
    # rows between pages.
    queryset = ResearchInfo.objects.all().order_by("id")
    serializer_class = ResearchInfoSerializer


class CorpusStats(APIView):
    """
    GET /stats/

    Returns live corpus statistics, including the current number of papers
    registered in ChromaDB.
    """

    def get(self, request):
        collection_name = getattr(settings, "COLLECTION_NAME", "arxiv_embeddings")
        try:
            from .pipeline.chroma import chroma_settings

            collection = chroma_settings.get_chroma_collection(collection_name)
            count = collection.count()
            return Response(
                {
                    "status": 200,
                    "total_papers": count,
                    "collection": collection_name,
                },
                status=status.HTTP_200_OK,
            )
        except Exception as exc:
            logger.warning("[VIEW] CorpusStats Chroma count failed: %s", exc)
            return Response(
                {
                    "status": 200,
                    "total_papers": 323300,
                    "collection": collection_name,
                    "fallback": True,
                },
                status=status.HTTP_200_OK,
            )


class HealthCheck(APIView):
    """
    GET /health/ — liveness.

    Deliberately dependency-free and allocation-free: it answers "is this
    process able to serve HTTP", which is the question a restart policy needs.
    Use /health/ready/ to ask whether the pipeline's dependencies are usable.
    """

    def get(self, request):
        return Response(
            {"status": 200, "message": "OK"},
            status=status.HTTP_200_OK,
        )


def _run_with_deadline(func, timeout: float):
    """
    Run *func* in a daemon thread and give up after *timeout* seconds.

    Raises :class:`TimeoutError` on expiry.  The abandoned thread is a daemon
    and cannot hold the request thread (or shutdown) hostage — which matters
    because a health check that blocks is worse than no health check.
    """
    box: dict = {}

    def run():
        try:
            box["value"] = func()
        except BaseException as exc:  # noqa: BLE001 — re-raised on the caller's thread
            box["error"] = exc

    thread = threading.Thread(target=run, name="readiness-probe", daemon=True)
    thread.start()
    thread.join(timeout)

    if thread.is_alive():
        raise TimeoutError(f"probe did not finish within {timeout}s")
    if "error" in box:
        raise box["error"]
    return box["value"]


class ReadinessCheck(APIView):
    """
    GET /health/ready/ — readiness.

    Probes ChromaDB (reachable? collection populated?), Ollama (reachable? is
    the configured embedding model actually installed?) and the LLM
    configuration, and returns 503 when any of them would make a query fail.

    Results are cached for a few seconds, probes are single-flighted, and the
    whole check runs under a deadline, so a stalled dependency answers 503
    quickly instead of tying up a request thread per poll.
    """

    def get(self, request):
        timeout = float(getattr(settings, "READINESS_TIMEOUT", 10))
        try:
            report = _run_with_deadline(lambda: get_rag_index().readiness(), timeout)
        except TimeoutError:
            logger.error("[VIEW] Readiness probe exceeded %.1fs", timeout)
            return Response(
                {
                    "ready": False,
                    "error": f"Readiness probe timed out after {timeout:g}s — a "
                             f"dependency is not responding.",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except PipelineError as exc:
            return Response(
                {"ready": False, "error": exc.user_message()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        http_status = (
            status.HTTP_200_OK if report["ready"] else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        return Response(report, status=http_status)


class RecommendationSystem(APIView):
    """
    POST /prompt/

    Accepts a user query, runs the full RAG pipeline (query transforms →
    dense retrieval → RRF fusion → chunking → LLM generation per chunk), and
    returns structured results.

    Request body:
        { "input_prompt": "your research question here" }

    Response:
        {
            "status": 200,
            "message": "Success",
            "query": "...",
            "total_docs_retrieved": 12,
            "num_chunks": 3,
            "chunk_size": 5,
            "data": [ ... ],
        }
    """

    def post(self, request):
        request_start = time.monotonic()

        input_prompt = request.data.get("input_prompt")
        if not input_prompt or not str(input_prompt).strip():
            return Response(
                {"error": "input_prompt is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        input_prompt = str(input_prompt).strip()

        try:
            rag_index = get_rag_index()
        except PipelineError as exc:
            return _not_ready_response(exc)

        slot = _acquire_slot()
        if slot is None:
            logger.warning("[VIEW] Rejecting request — %s concurrent queries in flight", _MAX_CONCURRENT_QUERIES)
            return _busy_response()

        try:
            logger.info(
                "[VIEW] RecommendationSystem request — prompt_len=%s prompt_head='%s'",
                len(input_prompt),
                input_prompt[:120],
            )

            pipeline_result = rag_index.main_pipeline(input_prompt)

            total_elapsed = time.monotonic() - request_start
            logger.info(
                "[VIEW] RecommendationSystem completed — total_elapsed=%.1fs chunks=%s docs=%s",
                total_elapsed,
                pipeline_result.get("num_chunks", 0),
                pipeline_result.get("total_docs_retrieved", 0),
            )

            payload = {
                "status": 200,
                "message": "Success",
                "query": pipeline_result["query"],
                "total_docs_retrieved": pipeline_result["total_docs_retrieved"],
                "num_chunks": pipeline_result["num_chunks"],
                "chunk_size": pipeline_result["chunk_size"],
                "data": pipeline_result["responses"],
                "aggregate_faithfulness": pipeline_result.get("aggregate_faithfulness"),
                "_elapsed_seconds": round(total_elapsed, 1),
            }
            # Present when there is something to report beyond the answer:
            # the relevance agent's outcome (e.g. nothing related was found),
            # the pre-flight query verdict, or the report describing which
            # papers the answer was built from.
            for key in ("notice", "agent_outcome", "query_check", "verification"):
                if pipeline_result.get(key):
                    payload[key] = pipeline_result[key]

            return Response(payload, status=status.HTTP_200_OK)

        except PipelineError as exc:
            logger.error(
                "[VIEW] RecommendationSystem unavailable after %.1fs: %s",
                time.monotonic() - request_start,
                exc,
            )
            return _not_ready_response(exc)

        except Exception as exc:
            total_elapsed = time.monotonic() - request_start
            logger.exception(
                "[VIEW] RecommendationSystem FAILED after %.1fs — prompt='%s' — error: %s",
                total_elapsed,
                input_prompt[:100],
                exc,
            )
            # The detail is in the log; the client gets a stable message rather
            # than a raw exception string.
            return Response(
                {
                    "error": "Internal error while processing the query.",
                    "_elapsed_seconds": round(total_elapsed, 1),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        finally:
            slot.release()


class RecommendationSystemStream(APIView):
    """
    POST /prompt/stream/

    Same pipeline as /prompt/ but delivers results via Server-Sent Events
    so the browser can render progress and partial results as they arrive.

    The pipeline runs in its own thread and feeds this response through a
    queue.  That lets the response emit an SSE keep-alive comment whenever the
    pipeline is quiet for a while (waiting on an LLM's first token, say), and it
    lets a client disconnect cancel the pipeline instead of leaving it to run to
    completion for nobody.

    SSE event types emitted
    -----------------------
    ``progress``     — pipeline stage started or completed (message + timings)
    ``chunk_start``  — a new chunk's LLM generation is beginning
    ``chunk_token``  — one text token from the chunk's LLM response stream
    ``chunk_end``    — chunk finished, includes full generated_response + docs
    ``complete``     — entire pipeline done with aggregate stats
    ``error``        — unrecoverable error; the stream ends after this

    Request body:
        { "input_prompt": "your research question here" }
    """

    def post(self, request):
        input_prompt = request.data.get("input_prompt")
        if not input_prompt or not str(input_prompt).strip():
            return Response(
                {"error": "input_prompt is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        input_prompt = str(input_prompt).strip()

        try:
            rag_index = get_rag_index()
        except PipelineError as exc:
            return _not_ready_response(exc)

        slot = _acquire_slot()
        if slot is None:
            logger.warning("[VIEW] Rejecting stream — %s concurrent queries in flight", _MAX_CONCURRENT_QUERIES)
            return _busy_response()

        logger.info(
            "[VIEW] RecommendationSystemStream request — prompt_len=%s prompt_head='%s'",
            len(input_prompt),
            input_prompt[:120],
        )

        try:
            response = StreamingHttpResponse(
                self._event_stream(rag_index, input_prompt, slot),
                content_type="text/event-stream",
                status=200,
            )
        except Exception:
            slot.release()
            raise

        # Belt and braces: if this response is closed without ever being
        # iterated, the generator's finally never runs, so release here too.
        response._resource_closers.append(slot.release)

        response["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response["X-Accel-Buffering"] = "no"
        response["Connection"] = "keep-alive"
        return response

    def _event_stream(self, rag_index, input_prompt: str, slot: _Slot):
        """Yield SSE frames, with keep-alives while the pipeline is quiet."""
        request_start = time.monotonic()
        cancel_event = threading.Event()
        events: queue.SimpleQueue = queue.SimpleQueue()
        done = object()

        def run_pipeline():
            pipeline = rag_index.main_pipeline_stream(
                input_prompt, cancel_event=cancel_event
            )
            try:
                for event in pipeline:
                    events.put(event)
                    if cancel_event.is_set():
                        break
            except PipelineError as exc:
                logger.error("[VIEW] Stream pipeline unavailable: %s", exc)
                events.put({"type": "error", "message": exc.user_message()})
            except Exception as exc:
                logger.exception(
                    "[VIEW] RecommendationSystemStream FAILED — prompt='%s' — error: %s",
                    input_prompt[:100],
                    exc,
                )
                events.put(
                    {
                        "type": "error",
                        "message": "Internal error while processing the query.",
                    }
                )
            finally:
                # Explicit close so the pipeline's own cleanup (worker threads,
                # abandoned LLM streams) runs now rather than at GC time.
                pipeline.close()
                events.put(done)

        worker = threading.Thread(
            target=run_pipeline,
            name="rag-pipeline",
            daemon=True,
        )
        worker.start()

        heartbeat = _heartbeat_seconds()
        completed = False
        try:
            while True:
                try:
                    event = events.get(timeout=heartbeat)
                except queue.Empty:
                    # SSE comment frame: keeps proxies and browsers from
                    # dropping an idle connection.  Clients ignore it.
                    yield ": keepalive\n\n"
                    continue

                if event is done:
                    completed = True
                    break

                yield f"data: {json.dumps(event, default=str)}\n\n"
        finally:
            # Reached on normal completion *and* on client disconnect, where
            # Django closes the generator.  Cancelling stops the pipeline's
            # in-flight LLM streams instead of billing for output nobody reads.
            cancel_event.set()
            slot.release()
            logger.info(
                "[VIEW] Stream closed after %.1fs (completed=%s)",
                time.monotonic() - request_start,
                completed,
            )


# ── Donations ────────────────────────────────────────────────────────────────
# Recommendica is free to use and sells nothing; these three endpoints exist so
# people who find it useful can chip in. They grant no entitlement, so nothing
# downstream reads a donation — the only consumers are the admin and whoever
# is paying the OpenRouter bill.


def _donations_off_response(exc: donations.DonationError | None = None):
    """
    Answer for a server with no Paddle credentials.

    503 rather than 404: the route exists and works elsewhere, this deployment
    simply has not configured it, and the UI hides the button on this signal
    instead of showing a donate flow that cannot complete.
    """
    message = exc.user_message() if exc else donations.DonationsNotConfigured().user_message()
    return Response({"enabled": False, "error": message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class DonationConfig(APIView):
    """
    GET /donate/config/

    Everything the browser needs to render the donate flow: the *public*
    Paddle.js client token, which environment it belongs to, the currency
    allowlist and the amount bounds.  The API key and the webhook secret are
    never part of this response.

    Answers 200 with ``{"enabled": false}`` when Paddle is unconfigured — the
    frontend asks this on load, and a missing feature is not an error.
    """

    def get(self, request):
        config = donations.get_config()
        if not config.checkout_configured:
            return Response(
                {"enabled": False, "reason": donations.DonationsNotConfigured().user_message()},
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "enabled": True,
                "environment": config.environment,
                "client_token": config.client_token,
                "currency": config.default_currency,
                "currencies": list(config.currencies),
                "presets": [str(amount) for amount in config.presets],
                "min_amount": str(config.min_amount),
                "max_amount": str(config.max_amount),
            },
            status=status.HTTP_200_OK,
        )


class DonationCheckout(APIView):
    """
    POST /donate/checkout/

    Creates a Paddle transaction for a pay-what-you-want amount and hands back
    its id, which the browser opens as an overlay checkout.

    Request body:
        { "amount": "15.00", "currency": "USD", "message": "optional note" }

    Response (201):
        {
            "transaction_id": "txn_…",
            "client_token": "live_…",
            "environment": "production",
            "amount": "15.00",
            "currency": "USD",
            "checkout_url": "https://…"   // may be null
        }

    Rate-limited: it is unauthenticated and every call creates a resource at
    Paddle, so a loop here would otherwise be free to run up the account's
    transaction list.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "donation"
    serializer_class = DonationCheckoutSerializer

    def post(self, request):
        config = donations.get_config()
        if not config.checkout_configured:
            return _donations_off_response()

        serializer = DonationCheckoutSerializer(data=request.data, paddle_config=config)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        try:
            paddle_transaction = donations.create_donation_transaction(
                amount_minor=validated["amount_minor"],
                currency=validated["currency"],
                message=validated["message"],
                config=config,
            )
        except donations.DonationsNotConfigured as exc:
            return _donations_off_response(exc)
        except donations.PaddleUnavailable as exc:
            response = Response(
                {"error": exc.user_message()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
            response["Retry-After"] = "30"
            return response

        transaction_id = paddle_transaction.get("id")
        if not transaction_id:
            logger.error("[DONATE] Paddle returned a transaction with no id: %s", paddle_transaction)
            return Response(
                {"error": donations.PaddleUnavailable().user_message()},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Recorded before payment so an abandoned checkout is visible as a draft
        # row rather than as nothing at all.  update_or_create keeps a retry of
        # the same transaction id from doubling up.
        Donation.objects.update_or_create(
            paddle_transaction_id=transaction_id,
            defaults={
                "status": paddle_transaction.get("status") or Donation.STATUS_DRAFT,
                "amount_minor": validated["amount_minor"],
                "currency": validated["currency"],
                "message": validated["message"],
            },
        )

        logger.info(
            "[DONATE] Created transaction %s for %s %s",
            transaction_id,
            validated["amount_minor"],
            validated["currency"],
        )

        return Response(
            {
                "transaction_id": transaction_id,
                "client_token": config.client_token,
                "environment": config.environment,
                "amount": donations.format_amount(
                    validated["amount_minor"], validated["currency"]
                ),
                "currency": validated["currency"],
                # Paddle only fills this in when the account has a default
                # payment link configured, so treat it as a bonus: the overlay
                # checkout opened with transaction_id is the supported path.
                "checkout_url": (paddle_transaction.get("checkout") or {}).get("url"),
            },
            status=status.HTTP_201_CREATED,
        )


#: Transaction events we act on. Anything else Paddle sends is acknowledged and
#: dropped — replying with an error would only make Paddle retry an event this
#: application has no use for.
_HANDLED_EVENT_PREFIX = "transaction."


def _extract_email(data: dict) -> str:
    """
    Pull the payer's email out of a transaction payload, when it carries one.

    Usually it does not: ``transaction.*`` events identify the payer by
    ``customer_id`` and only carry the expanded ``customer`` object for
    destinations configured to include it.  A blank email is therefore the
    normal case and not a failure — Paddle owns the receipt, and nothing here
    needs to contact a donor.
    """
    customer = data.get("customer")
    if isinstance(customer, dict) and customer.get("email"):
        return str(customer["email"])[:254]
    return ""


def _apply_transaction_event(event: dict) -> None:
    """
    Fold one ``transaction.*`` event into the matching :class:`Donation` row.

    Paddle guarantees at-least-once delivery and does not guarantee order, so
    this is written to be safe under both: the event id makes a redelivery a
    no-op, and ``occurred_at`` stops a late-arriving earlier event from
    reverting a status a later one already applied.
    """
    data = event.get("data") or {}
    transaction_id = data.get("id")
    if not transaction_id:
        logger.warning("[DONATE] Webhook %s carried no transaction id", event.get("event_type"))
        return

    occurred_at = parse_datetime(event.get("occurred_at") or "") if event.get("occurred_at") else None
    event_id = str(event.get("event_id") or "")[:64]
    event_type = str(event.get("event_type") or "")[:64]
    paddle_status = str(data.get("status") or "")[:32]
    currency = str(data.get("currency_code") or "")[:3]
    custom_data = data.get("custom_data") if isinstance(data.get("custom_data"), dict) else {}
    totals = ((data.get("details") or {}).get("totals") or {})

    with db_transaction.atomic():
        donation, created = Donation.objects.select_for_update().get_or_create(
            paddle_transaction_id=transaction_id,
            defaults={
                "status": paddle_status or Donation.STATUS_DRAFT,
                # A donation started outside this app (a payment link, say) has
                # no row yet, so the payload has to supply the amount.
                "amount_minor": int(totals.get("grand_total") or 0),
                "currency": currency,
                "message": str(custom_data.get("message") or "")[:280],
            },
        )

        if not created:
            if event_id and event_id == donation.last_event_id:
                logger.info("[DONATE] Ignoring redelivered event %s", event_id)
                return
            if occurred_at and donation.last_event_at and occurred_at < donation.last_event_at:
                logger.info(
                    "[DONATE] Ignoring out-of-order %s for %s", event_type, transaction_id
                )
                return

        if paddle_status:
            donation.status = paddle_status
        if currency:
            donation.currency = currency
        # Paddle's total is authoritative once it exists: it accounts for tax
        # and for anything the payer changed during checkout.
        grand_total = totals.get("grand_total")
        if grand_total not in (None, ""):
            donation.amount_minor = int(grand_total)
        email = _extract_email(data)
        if email:
            donation.email = email
        if paddle_status == Donation.STATUS_COMPLETED and donation.completed_at is None:
            donation.completed_at = occurred_at or None

        donation.last_event_id = event_id
        donation.last_event_type = event_type
        donation.last_event_at = occurred_at
        donation.save()

    logger.info(
        "[DONATE] %s → %s is now %s", event_type, transaction_id, donation.status
    )


@csrf_exempt
@require_POST
def paddle_webhook(request):
    """
    POST /donate/webhook/ — Paddle notification destination.

    A plain Django view rather than an ``APIView``: the signature is computed
    over the raw request body, and going through DRF's parsers to get it back
    invites the body being consumed before it can be read.

    Answers 200 as soon as the event is stored.  Any non-2xx makes Paddle retry,
    so an event this app does not care about is acknowledged, not rejected —
    only a failed signature check (401) and an unparseable body (400) refuse.
    """
    config = donations.get_config()
    if not config.webhook_configured:
        logger.error("[DONATE] Webhook called but PADDLE_WEBHOOK_SECRET is not set")
        return JsonResponse({"error": "Webhook is not configured."}, status=503)

    # Read the raw bytes first — before anything can touch request.POST.
    raw_body = request.body

    if not donations.verify_webhook_signature(
        raw_body,
        request.headers.get("Paddle-Signature", ""),
        config.webhook_secret,
        config.webhook_tolerance,
    ):
        logger.warning("[DONATE] Rejected webhook with an invalid signature")
        return JsonResponse({"error": "Invalid signature."}, status=401)

    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("[DONATE] Webhook body was not valid JSON")
        return JsonResponse({"error": "Invalid payload."}, status=400)

    if not isinstance(event, dict):
        return JsonResponse({"error": "Invalid payload."}, status=400)

    event_type = str(event.get("event_type") or "")
    if not event_type.startswith(_HANDLED_EVENT_PREFIX):
        logger.info("[DONATE] Ignoring unhandled event type %r", event_type)
        return JsonResponse({"received": True, "handled": False})

    try:
        _apply_transaction_event(event)
    except Exception:
        # A 500 here makes Paddle retry, which is what we want for a transient
        # database failure — but the detail belongs in the log, not the reply.
        logger.exception("[DONATE] Failed to apply webhook %s", event_type)
        return JsonResponse({"error": "Failed to record the event."}, status=500)

    return JsonResponse({"received": True, "handled": True})
