import json
import logging
import time

from django.http import StreamingHttpResponse
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .models import ResearchInfo
from .serializers import ResearchInfoSerializer
from .main import rag_index

logger = logging.getLogger(__name__)


class GetAllResearch(ListAPIView):
    queryset = ResearchInfo.objects.all()
    serializer_class = ResearchInfoSerializer


class HealthCheck(APIView):
    def get(self, request):
        return Response(
            {"status": 200, "message": "OK"},
            status=status.HTTP_200_OK,
        )


class RecommendationSystem(APIView):
    """
    POST /prompt/

    Accepts a user query, runs the full RAG pipeline (query transforms →
    dense retrieval → chunking → LLM generation per chunk), and returns
    structured results.

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
        input_prompt = ""
        try:
            input_prompt = request.data.get("input_prompt")
            if not input_prompt:
                return Response(
                    {"error": "input_prompt is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

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

            return Response(
                {
                    "status": 200,
                    "message": "Success",
                    "query": pipeline_result["query"],
                    "total_docs_retrieved": pipeline_result["total_docs_retrieved"],
                    "num_chunks": pipeline_result["num_chunks"],
                    "chunk_size": pipeline_result["chunk_size"],
                    "data": pipeline_result["responses"],
                    "_elapsed_seconds": round(total_elapsed, 1),
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            total_elapsed = time.monotonic() - request_start
            logger.exception(
                "[VIEW] RecommendationSystem FAILED after %.1fs — prompt='%s' — error: %s",
                total_elapsed,
                input_prompt[:100] if input_prompt else "<none>",
                e,
            )
            return Response(
                {
                    "error": str(e),
                    "_elapsed_seconds": round(total_elapsed, 1),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class RecommendationSystemStream(APIView):
    """
    POST /prompt/stream/

    Same pipeline as /prompt/ but delivers results via Server-Sent Events
    so the browser can render progress and partial results as they arrive.

    This keeps the HTTP connection alive with incremental data, eliminating
    proxy/gateway timeouts even for long-running multi-step pipelines.

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
        if not input_prompt:
            return Response(
                {"error": "input_prompt is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        logger.info(
            "[VIEW] RecommendationSystemStream request — prompt_len=%s prompt_head='%s'",
            len(input_prompt),
            input_prompt[:120],
        )

        def event_stream():
            """Generator that yields SSE-formatted strings."""
            try:
                for event in rag_index.main_pipeline_stream(input_prompt):
                    data = json.dumps(event, default=str)
                    yield f"data: {data}\n\n"
            except Exception as exc:
                logger.exception(
                    "[VIEW] RecommendationSystemStream FAILED — prompt='%s' — error: %s",
                    input_prompt[:100],
                    exc,
                )
                error_event = json.dumps({
                    "type": "error",
                    "message": str(exc),
                })
                yield f"data: {error_event}\n\n"

        response = StreamingHttpResponse(
            event_stream(),
            content_type="text/event-stream",
            status=200,
        )
        response["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response["X-Accel-Buffering"] = "no"
        return response
