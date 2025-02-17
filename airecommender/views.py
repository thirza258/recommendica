from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework import status
from .models import ResearchInfo
from .serializers import ResearchInfoSerializer


class GetAllResearch(ListAPIView):
    queryset = ResearchInfo.objects.all()
    serializer_class = ResearchInfoSerializer