from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import ResearchInfo
from .serializers import ResearchInfoSerializer
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import OpenAIEmbeddings
from langchain.schema import Document
from langchain.docstore.in_memory import InMemoryDocstore
import os
import faiss
import json
import numpy as np
from main import rag_index

class GetAllResearch(ListAPIView):
    queryset = ResearchInfo.objects.all()
    serializer_class = ResearchInfoSerializer
    
class RecommendationSystem(APIView):
    def post(self, request):
        try:
            input_prompt = request.data.get('input_prompt')

            # Retrieve relevant documents
            results = rag_index.retrieve_documents(input_prompt, k=5)

            return Response({'results': results}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)