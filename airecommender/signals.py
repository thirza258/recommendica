from django.db.models.signals import post_migrate
from django.dispatch import receiver
from .main import rag_index

@receiver(post_migrate)
def load_faiss_index(sender, **kwargs):
    """Load FAISS index setelah Django selesai melakukan migrasi."""
    rag_index.load_data()
