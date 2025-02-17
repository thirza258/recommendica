from rest_framework import serializers
from .models import ResearchInfo

class ResearchInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResearchInfo
        fields = '__all__'  # Or specify fields explicitly
