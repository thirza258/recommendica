from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.HealthCheck.as_view(), name="health"),
    path("health/ready/", views.ReadinessCheck.as_view(), name="health-ready"),
    path("stats/", views.CorpusStats.as_view(), name="stats"),
    path("research/", views.GetAllResearch.as_view(), name="research"),
    path("prompt/", views.RecommendationSystem.as_view(), name="prompt"),
    path("prompt/stream/", views.RecommendationSystemStream.as_view(), name="prompt-stream"),
    path("donate/config/", views.DonationConfig.as_view(), name="donate-config"),
    path("donate/checkout/", views.DonationCheckout.as_view(), name="donate-checkout"),
    # Paddle posts here; the URL is public but every request must carry a valid
    # signature, so it is never routed through DRF's parsers.
    path("donate/webhook/", views.paddle_webhook, name="donate-webhook"),
]
