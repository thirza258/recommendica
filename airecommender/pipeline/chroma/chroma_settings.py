"""
ChromaDB client helpers with lazy caching.

Only one client and one collection handle per name are ever created within a
process lifetime — subsequent calls return the cached instances.
"""

import chromadb
from chromadb.config import Settings
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

# ── Lazy cache ─────────────────────────────────────────────────────────────────
_client = None
_collections: dict[str, object] = {}


def _get_client():
    """Return the cached ChromaDB client, creating it on first call."""
    global _client
    if _client is None:
        try:
            _client = chromadb.HttpClient(
                host=settings.CHROMA_HOST,
                port=settings.CHROMA_PORT,
            )
            logger.info(
                f"[Chroma] Created HttpClient → {settings.CHROMA_HOST}:{settings.CHROMA_PORT}"
            )
        except Exception as exc:
            logger.warning(
                "[Chroma] Falling back to EphemeralClient because the HTTP client could not be initialized: %s",
                exc,
            )
            _client = chromadb.EphemeralClient(
                settings=Settings(anonymized_telemetry=False),
            )
    return _client


def get_chroma_client(collection_name: str = None):
    """
    Return a cached ChromaDB collection handle.

    The underlying client is also cached, so repeated calls reuse the same
    connection pool rather than creating a new client each time.
    """
    name = collection_name or settings.COLLECTION_NAME
    if name not in _collections:
        client = _get_client()
        _collections[name] = client.get_or_create_collection(
            name=name,
            embedding_function=None,
        )
        logger.info(f"[Chroma] Cached collection '{name}'")
    return _collections[name]


def get_client():
    """Return the cached Chroma client (e.g. for admin / direct access)."""
    return _get_client()


def create_chroma_collection(collection_name: str = None):
    """Create a collection (or retrieve if it already exists), then cache it."""
    name = collection_name or settings.COLLECTION_NAME
    if name in _collections:
        return _collections[name]

    client = _get_client()
    collection = client.get_or_create_collection(name=name, embedding_function=None)
    logger.info(f"[Chroma] Created or retrieved collection: {name}")

    _collections[name] = collection
    return collection


def clear_chroma_cache():
    """Reset the cached client and collections (useful for testing)."""
    global _client, _collections
    _client = None
    _collections = {}
