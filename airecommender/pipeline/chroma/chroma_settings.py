"""
ChromaDB client helpers with lazy caching.

Only one HttpClient and one collection handle per name are ever created
within a process lifetime — subsequent calls return the cached instances.
"""

import chromadb
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

# ── Lazy cache ─────────────────────────────────────────────────────────────────
_client = None
_collections: dict[str, object] = {}


def _get_client():
    """Return the cached ChromaDB HttpClient, creating it on first call."""
    global _client
    if _client is None:
        _client = chromadb.HttpClient(
            host=settings.CHROMA_HOST,
            port=settings.CHROMA_PORT,
        )
        logger.info(f"[Chroma] Created HttpClient → {settings.CHROMA_HOST}:{settings.CHROMA_PORT}")
    return _client


def get_chroma_client(collection_name: str = None):
    """
    Return a cached ChromaDB collection handle.

    The underlying HttpClient is also cached, so repeated calls reuse the
    same connection pool rather than creating a new client each time.
    """
    name = collection_name or settings.COLLECTION_NAME
    if name not in _collections:
        client = _get_client()
        _collections[name] = client.get_collection(name=name, embedding_function=None)
        logger.info(f"[Chroma] Cached collection '{name}'")
    return _collections[name]


def get_client():
    """Return the cached HttpClient (e.g. for admin / direct access)."""
    return _get_client()


def create_chroma_collection(collection_name: str = None):
    """Create a collection (or retrieve if it already exists), then cache it."""
    name = collection_name or settings.COLLECTION_NAME
    if name in _collections:
        return _collections[name]

    client = _get_client()
    try:
        collection = client.create_collection(name=name, embedding_function=None)
        logger.info(f"[Chroma] Created collection: {name}")
    except chromadb.errors.CollectionAlreadyExistsError:
        logger.warning(f"[Chroma] Collection already exists: {name}, retrieving.")
        collection = client.get_collection(name=name, embedding_function=None)

    _collections[name] = collection
    return collection


def clear_chroma_cache():
    """Reset the cached client and collections (useful for testing)."""
    global _client, _collections
    _client = None
    _collections = {}
