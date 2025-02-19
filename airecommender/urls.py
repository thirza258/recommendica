from django.urls import path
from . import views

urlpatterns = [
    path("research/", views.GetAllResearch.as_view(), name="research"),
    path("prompt/", views.RecommendationSystem.as_view(), name="prompt"),
]