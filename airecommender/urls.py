from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.HealthCheck.as_view(), name="health"),
    path("research/", views.GetAllResearch.as_view(), name="research"),
    path("prompt/", views.RecommendationSystem.as_view(), name="prompt"),
    path("prompt/stream/", views.RecommendationSystemStream.as_view(), name="prompt-stream"),
]
