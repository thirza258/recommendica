from django.apps import AppConfig
from main import rag_index

class AirecommenderConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "airecommender"
    
    def ready(self):
        """Ensure FAISS index is initialized when the app starts"""
        rag_index.load_data()
