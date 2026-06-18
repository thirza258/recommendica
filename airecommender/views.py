from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import ResearchInfo
from .serializers import ResearchInfoSerializer
from .main import rag_index
import logging

logger = logging.getLogger(__name__)


class GetAllResearch(ListAPIView):
    queryset = ResearchInfo.objects.all()
    serializer_class = ResearchInfoSerializer


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
            "data": [
                {
                    "chunk_index": 1,
                    "num_docs_in_chunk": 5,
                    "docs": [ ... ],
                    "generated_response": "...",
                },
                ...
            ]
        }

    When total_docs_retrieved > chunk_size, the response contains multiple
    entries in "data" — one per chunk — each with its own set of documents
    and LLM-generated answer grounded in that chunk.
    """

    def post(self, request):
        try:
            input_prompt = request.data.get("input_prompt")
            if not input_prompt:
                return Response(
                    {"error": "input_prompt is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Run the full pipeline — returns chunked results
            pipeline_result = rag_index.main_pipeline(input_prompt)

            return Response(
                {
                    "status": 200,
                    "message": "Success",
                    "query": pipeline_result["query"],
                    "total_docs_retrieved": pipeline_result["total_docs_retrieved"],
                    "num_chunks": pipeline_result["num_chunks"],
                    "chunk_size": pipeline_result["chunk_size"],
                    "data": pipeline_result["responses"],
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            logger.exception(f"RecommendationSystem error: {e}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )