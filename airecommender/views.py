from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import ResearchInfo, ResearchReturn, AIResponse
from .serializers import ResearchInfoSerializer
from .main import rag_index
from langchain.chat_models import init_chat_model
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser
import json

class GetAllResearch(ListAPIView):
    queryset = ResearchInfo.objects.all()
    serializer_class = ResearchInfoSerializer
    
class RecommendationSystem(APIView):
    def post(self, request):
        try:
            input_prompt = request.data.get('input_prompt')
            llm = init_chat_model("gpt-4o-mini", model_provider="openai")
            retrieved_docs = rag_index.retrieve_documents(input_prompt, k=5)
            
            # Format retrieved documents as context
            context = "\n\n".join([
                f"Title: {json.loads(doc)['title']}\nCategory: {json.loads(doc)['category']}\n"
                f"Summary: {json.loads(doc)['summary']}\nAuthors: {json.loads(doc)['authors']}"
                for doc in retrieved_docs
            ])
            
            
            parser = JsonOutputParser(pydantic_object=AIResponse)

            # Define the prompt template
            prompt = PromptTemplate(
                template="""
                You are an AI assistant using retrieved research documents to answer user queries.
                Use the provided research results to enhance your response.

                Retrieved Research Documents:
                {context}

                User Query:
                {query}

                Format your response as a JSON object matching this schema:
                {format_instructions}
                """,
                input_variables=["query", "context"],
                partial_variables={"format_instructions": parser.get_format_instructions()},
            )
            chain = prompt | llm | parser
            response = chain.invoke({"query": input_prompt, "context": context})
            return Response({
                "status": 200,
                "message": "Success",
                "data": response
                }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)