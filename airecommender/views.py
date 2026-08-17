import json
import logging
import queue
import threading
import time

from django.conf import settings
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .main import get_rag_index
from .models import ResearchInfo
from .pipeline.errors import PipelineError
from .serializers import ResearchInfoSerializer

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
