"""
ChromaDB client helpers with lazy caching.

Only one client and one collection handle per name are ever created within a
process lifetime — subsequent calls return the cached instances.

Failures are *loud* by design.  The previous behaviour fell back to an
in-memory ``EphemeralClient`` whenever the HTTP client could not be built,
which left the service looking perfectly healthy while every search returned
"no documents found" against an empty in-process collection.  A clear
:class:`VectorStoreUnavailable` is far easier to operate.  Set
``CHROMA_ALLOW_EPHEMERAL_FALLBACK=True`` to opt back into the old behaviour
(useful for local demos with no Chroma server).
"""

import logging
import threading

import chromadb
import httpx
from chromadb.config import Settings
from django.conf import settings

from airecommender.pipeline.errors import VectorStoreUnavailable

logger = logging.getLogger(__name__)

# ── Lazy cache ─────────────────────────────────────────────────────────────────
_client = None
_client_is_ephemeral = False
_collections: dict[str, object] = {}
_lock = threading.Lock()


def _allow_ephemeral_fallback() -> bool:
    return bool(getattr(settings, "CHROMA_ALLOW_EPHEMERAL_FALLBACK", False))


def _request_timeout() -> float:
    return float(getattr(settings, "CHROMA_TIMEOUT", 30))


def _bind_http_timeout(client, timeout: float) -> bool:
    """
    Bound the timeout on ChromaDB's HTTP session.

    chromadb builds its session as ``httpx.Client(timeout=None)``, and
    ``HttpClient()`` exposes no timeout parameter — so a Chroma server that
    accepts a connection and then stalls would hang the calling thread forever,
    with no request-level bound anywhere in the stack.  httpx does allow the
    timeout to be replaced after construction, so we reach in and set it.

    Best effort by design: if a future chromadb release moves the session, we
    log and carry on rather than refusing to start.
    """
    owners = [client]
    for attr in ("_server", "_admin_client"):
        owner = getattr(client, attr, None)
        if owner is not None:
            owners.append(owner)
            nested = getattr(owner, "_server", None)
            if nested is not None:
                owners.append(nested)

    applied = 0
    for owner in owners:
        session = getattr(owner, "_session", None)
        if isinstance(session, httpx.Client):
            try:
                session.timeout = httpx.Timeout(timeout)
                applied += 1
            except Exception as exc:  # pragma: no cover — defensive
                logger.debug("[Chroma] Could not set timeout on %r: %s", owner, exc)

    if applied:
        logger.info("[Chroma] Bound HTTP request timeout to %ss", timeout)
    else:
        logger.warning(
            "[Chroma] Could not bind an HTTP request timeout — a stalled Chroma "
            "server may block requests until the client gives up."
        )
    return bool(applied)


def _build_client():
    """Build a ChromaDB client, or raise :class:`VectorStoreUnavailable`."""
    global _client_is_ephemeral

    host = settings.CHROMA_HOST
    port = settings.CHROMA_PORT

    if host and port:
        try:
            client = chromadb.HttpClient(
                host=host,
                port=port,
                settings=Settings(anonymized_telemetry=False),
            )
            # Bound requests *before* the first one we make ourselves.
            _bind_http_timeout(client, _request_timeout())
            # Prove the server is actually reachable now, rather than
            # discovering it on the first user query.
            client.heartbeat()
            logger.info("[Chroma] Connected to HttpClient → %s:%s", host, port)
            _client_is_ephemeral = False
            return client
        except Exception as exc:
            if not _allow_ephemeral_fallback():
                raise VectorStoreUnavailable(
                    f"Cannot reach ChromaDB at {host}:{port} ({type(exc).__name__}: {exc}). "
                    f"Check RE_CHROMA_HOST / RE_CHROMA_PORT, or set "
                    f"CHROMA_ALLOW_EPHEMERAL_FALLBACK=True to run without a "
                    f"vector store."
                ) from exc
            logger.error(
                "[Chroma] UNREACHABLE at %s:%s (%s) — falling back to an EMPTY "
                "in-memory collection because CHROMA_ALLOW_EPHEMERAL_FALLBACK is "
                "enabled. Searches will return no documents.",
                host,
                port,
                exc,
            )
    elif not _allow_ephemeral_fallback():
        raise VectorStoreUnavailable(
            "ChromaDB host/port are not configured (RE_CHROMA_HOST / RE_CHROMA_PORT)."
        )

    _client_is_ephemeral = True
    return chromadb.EphemeralClient(settings=Settings(anonymized_telemetry=False))


def _get_client():
    """Return the cached ChromaDB client, creating it on first call."""
    global _client
    if _client is not None:
        return _client

    # chromadb validates tenant/database during construction, and that call is
    # not covered by the timeout we bind afterwards.  Waiting on the lock with a
    # bound means a slow handshake fails one request instead of stacking every
    # concurrent request behind it.
    wait = float(getattr(settings, "CHROMA_CONNECT_WAIT", 20))
    if not _lock.acquire(timeout=wait):
        raise VectorStoreUnavailable(
            f"ChromaDB client initialization did not finish within {wait}s — "
            f"the server at {settings.CHROMA_HOST}:{settings.CHROMA_PORT} is not "
            f"responding."
        )
    try:
        if _client is None:
            # Note: a failure is *not* cached, so a Chroma server that comes
            # back up is picked up by the next request without a restart.
            _client = _build_client()
    finally:
        _lock.release()
    return _client


def get_chroma_collection(collection_name: str = None):
    """
    Return a cached ChromaDB collection handle.

    The underlying client is cached too, so repeated calls reuse the same
    connection pool rather than creating a new client each time.
    """
    name = collection_name or settings.COLLECTION_NAME

    cached = _collections.get(name)
    if cached is not None:
        return cached

    client = _get_client()
    try:
        collection = client.get_or_create_collection(name=name, embedding_function=None)
    except VectorStoreUnavailable:
        raise
    except Exception as exc:
        # This used to sit outside the try/except entirely, so a Chroma outage
        # raised straight out of module import and took the whole app with it.
        raise VectorStoreUnavailable(
            f"Cannot open ChromaDB collection {name!r} "
            f"({type(exc).__name__}: {exc})."
        ) from exc

    with _lock:
        _collections[name] = collection
    logger.info("[Chroma] Cached collection '%s'", name)
    return collection


# Backwards-compatible alias — this returns a *collection*, despite the name.
def get_chroma_client(collection_name: str = None):
    return get_chroma_collection(collection_name)


def get_client():
    """Return the cached Chroma client (e.g. for admin / direct access)."""
    return _get_client()


def create_chroma_collection(collection_name: str = None):
    """Create a collection (or retrieve it if it already exists), then cache it."""
    return get_chroma_collection(collection_name)


def is_ephemeral() -> bool:
    """True when the active client is the in-memory fallback (no real store)."""
    return _client_is_ephemeral


def probe() -> dict:
    """
    Report vector-store health for the readiness endpoint.

    Never raises — returns ``{"ok": False, "error": ...}`` instead.
    """
    name = settings.COLLECTION_NAME
    info = {
        "ok": False,
        "host": settings.CHROMA_HOST,
        "port": settings.CHROMA_PORT,
        "collection": name,
        "ephemeral": False,
        "document_count": None,
        "error": None,
    }
    try:
        collection = get_chroma_collection(name)
        info["document_count"] = collection.count()
        info["ephemeral"] = is_ephemeral()
        # An empty collection is reachable but useless for answering queries.
        info["ok"] = not info["ephemeral"] and info["document_count"] > 0
        if info["ephemeral"]:
            info["error"] = "Using in-memory fallback collection (no Chroma server)."
        elif not info["document_count"]:
            info["error"] = f"Collection {name!r} is reachable but empty."
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def clear_chroma_cache():
    """Reset the cached client and collections (useful for testing)."""
    global _client, _collections, _client_is_ephemeral
    with _lock:
        _client = None
        _collections = {}
        _client_is_ephemeral = False
