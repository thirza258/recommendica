from django.db.models.signals import post_migrate
from django.dispatch import receiver
from .main import rag_index

@receiver(post_migrate)
def load_chroma_index(sender, **kwargs):
    """Load ChromaDB index after Django finishes running migrations."""
    rag_index.load_data()
