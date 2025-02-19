from django.apps import AppConfig


class AirecommenderConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "airecommender"
    
    def ready(self):
        import airecommender.signals
