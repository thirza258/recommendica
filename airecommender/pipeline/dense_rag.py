import hashlib
import json
import logging
import threading
import time
from math import ceil
from typing import Dict, List, Optional

import requests
from django.conf import settings
from ollama import Client

from airecommender.pipeline.chroma.chroma_settings import get_chroma_collection
from airecommender.pipeline.errors import EmbeddingUnavailable, VectorStoreUnavailable

logger = logging.getLogger(__name__)


def _setting(name: str, default):
    return getattr(settings, name, default)


class DenseRAG:
    """
    Dense retrieval over a ChromaDB collection.

    The important performance property here is :meth:`retrieve_many`: the
    pipeline searches with several query variants, and doing that one variant at
    a time costs one Ollama round trip *and* one ChromaDB round trip each.
    Embedding every variant in a single Ollama call and passing all the
    resulting vectors to a single ``collection.query`` collapses 2N network
    round trips into 2.
    """

    def __init__(self):
        # Reranking is the only thing here that needs an OpenRouter key, and it
        # is off by default — retrieval must not refuse to start without it.
        self.api_key = settings.OPENROUTER_API_KEY

        # ``EMBEDDING_MODEL`` is easy to point at a non-Ollama model name (the
        # shipped .env.example used an OpenAI model id), and Ollama answers an
        # unknown model with an error, which used to degrade silently into "no
        # documents found".  Prefer the explicitly Ollama-scoped setting.
        self.embedding_model = (
            _setting("OLLAMA_EMBEDDING_MODEL", None) or settings.EMBEDDING_MODEL
        )

        self.embedding_timeout = int(_setting("EMBEDDING_TIMEOUT", 60))
        self.client = Client(
            host=settings.OLLAMA_BASE_URL,
            timeout=self.embedding_timeout,
        )

        self.top_k = settings.TOP_K
        self.candidate_multiplier = settings.CANDIDATE_MULTIPLIER

        # Rerank settings
        self.rerank_model = settings.RERANK_MODEL
        self.rerank_top_n = int(settings.RERANK_TOP_N) if settings.RERANK_TOP_N else settings.TOP_K
        self.rerank_timeout = int(_setting("RERANK_TIMEOUT", 15))
        self.site_url = None
        self.site_title = None

        # Rerank circuit breaker — a reranker that is down (or an endpoint that
        # does not exist) must not add its timeout to every single request.
        self._rerank_failures = 0
        self._rerank_blocked_until = 0.0
        self._rerank_breaker_threshold = int(_setting("RERANK_BREAKER_THRESHOLD", 3))
        self._rerank_breaker_cooldown = int(_setting("RERANK_BREAKER_COOLDOWN", 300))

        self.documents: List[str] = []
        self.cross_encoder = None  # placeholder for optional local cross-encoder
        self.emitter = None

        # Resolved on first use so that a ChromaDB outage surfaces as a clean
        # per-request error instead of taking the whole process down at import.
        self.collection_name = settings.COLLECTION_NAME
        self._collection = None
        self._collection_lock = threading.Lock()

        # Small embedding cache — the user's original query is embedded on every
        # request, and repeat/refined searches share most of their variants.
        self._embedding_cache: dict[str, List[float]] = {}
        self._embedding_cache_lock = threading.Lock()
        self._embedding_cache_max = int(_setting("EMBEDDING_CACHE_MAX_SIZE", 1024))

        if self.rerank_model and not self.api_key:
            logger.warning(
                "[DENSE] RERANK_MODEL=%r is set but OPENROUTER_API_KEY is empty — "
                "reranking will be skipped.",
                self.rerank_model,
            )

        logger.info(
            "[DENSE] Initialized — ollama=%s embedding_model=%r collection=%r "
            "top_k=%s candidate_multiplier=%s rerank=%s",
            settings.OLLAMA_BASE_URL,
            self.embedding_model,
            self.collection_name,
            self.top_k,
            self.candidate_multiplier,
            self.rerank_model or "disabled",
        )

    # ── Collection access ─────────────────────────────────────────────────────

    @property
    def collection(self):
        """The ChromaDB collection handle, resolved on first use."""
        if self._collection is None:
            with self._collection_lock:
                if self._collection is None:
                    self._collection = get_chroma_collection(self.collection_name)
        return self._collection

    def set_collection(self, collection_name: str):
        """Swap collection at runtime without reinitializing."""
        with self._collection_lock:
            self.collection_name = collection_name
            self._collection = None
        logger.info(f"[DenseRAG] Switched to collection: {collection_name}")

    def count(self) -> int:
        """Number of documents in the collection."""
        try:
            return self.collection.count()
        except VectorStoreUnavailable:
            raise
        except Exception as exc:
            raise VectorStoreUnavailable(
                f"Could not count collection '{self.collection_name}': {exc}"
            ) from exc

    # ── Embeddings ────────────────────────────────────────────────────────────

    def _cache_key(self, text: str) -> str:
        raw = f"{self.embedding_model}|{text}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _embedding_cache_get(self, text: str) -> Optional[List[float]]:
        with self._embedding_cache_lock:
            return self._embedding_cache.get(self._cache_key(text))

    def _embedding_cache_set(self, text: str, embedding: List[float]):
        with self._embedding_cache_lock:
            if len(self._embedding_cache) >= self._embedding_cache_max:
                # dicts preserve insertion order — drop the oldest entry.
                self._embedding_cache.pop(next(iter(self._embedding_cache)), None)
            self._embedding_cache[self._cache_key(text)] = embedding

    def _embed_batch(self, batch: List[str], attempts: int = 2) -> List[List[float]]:
        """Embed one batch, retrying transient Ollama failures."""
        last_exc: Optional[BaseException] = None
        for attempt in range(attempts):
            try:
                try:
                    response = self.client.embed(
                        input=batch, model=self.embedding_model, truncate=True
                    )
                except TypeError:
                    response = self.client.embed(input=batch, model=self.embedding_model)
                embeddings = response.get("embeddings") or []
                if len(embeddings) != len(batch):
                    raise EmbeddingUnavailable(
                        f"Ollama returned {len(embeddings)} embeddings for "
                        f"{len(batch)} inputs (model={self.embedding_model!r})"
                    )
                return list(embeddings)
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "[DENSE] Embedding attempt %s/%s failed (batch=%s, model=%r): %s",
                    attempt + 1,
                    attempts,
                    len(batch),
                    self.embedding_model,
                    exc,
                )
                if attempt < attempts - 1:
                    time.sleep(1)

        raise EmbeddingUnavailable(
            f"Ollama embedding failed for model {self.embedding_model!r} at "
            f"{settings.OLLAMA_BASE_URL} ({type(last_exc).__name__}: {last_exc})"
        ) from last_exc

    def _get_embeddings(
        self, texts: List[str], batch_size: Optional[int] = None
    ) -> List[List[float]]:
        """
        Embed *texts*, preserving order and length.

        Raises :class:`EmbeddingUnavailable` rather than returning a short list:
        a partial result silently misaligns every downstream document/metadata
        pair, which is far worse than a clear failure.
        """
        if not texts:
            return []

        if batch_size is None:
            batch_size = settings.EMBEDDING_BATCH_SIZE

        cleaned = [text.replace("\n", " ") for text in texts]
        embeddings: List[Optional[List[float]]] = [None] * len(cleaned)

        pending_indices = []
        for i, text in enumerate(cleaned):
            cached = self._embedding_cache_get(text)
            if cached is not None:
                embeddings[i] = cached
            else:
                pending_indices.append(i)

        if pending_indices:
            logger.info(
                "[DENSE] Embedding %s text(s) (%s cached) with model %r",
                len(pending_indices),
                len(cleaned) - len(pending_indices),
                self.embedding_model,
            )

        total_batches = ceil(len(pending_indices) / batch_size) if pending_indices else 0
        for batch_no, start in enumerate(range(0, len(pending_indices), batch_size), start=1):
            index_slice = pending_indices[start : start + batch_size]
            batch_texts = [cleaned[i] for i in index_slice]

            t0 = time.monotonic()
            batch_embeddings = self._embed_batch(batch_texts)
            logger.info(
                "[DENSE] Embedded batch %s/%s (%s texts) in %.1fs",
                batch_no,
                total_batches,
                len(batch_texts),
                time.monotonic() - t0,
            )

            for i, embedding in zip(index_slice, batch_embeddings):
                embeddings[i] = embedding
                self._embedding_cache_set(cleaned[i], embedding)

        missing = [i for i, embedding in enumerate(embeddings) if embedding is None]
        if missing:
            raise EmbeddingUnavailable(
                f"Missing embeddings for {len(missing)}/{len(cleaned)} inputs "
                f"(model={self.embedding_model!r})"
            )

        return embeddings  # type: ignore[return-value]

    def index_documents(self, documents: List[str]) -> None:
        self.documents = list(documents)
        logger.info(f"[DENSE] Indexed {len(self.documents)} documents in memory.")

    # ── Reranking ─────────────────────────────────────────────────────────────

    def _rerank_available(self) -> bool:
        if not self.rerank_model or not self.api_key:
            return False
        if time.monotonic() < self._rerank_blocked_until:
            return False
        return True

    def _record_rerank_failure(self):
        self._rerank_failures += 1
        if self._rerank_failures >= self._rerank_breaker_threshold:
            self._rerank_blocked_until = time.monotonic() + self._rerank_breaker_cooldown
            self._rerank_failures = 0
            logger.error(
                "[RERANK] Disabled for %ss after %s consecutive failures.",
                self._rerank_breaker_cooldown,
                self._rerank_breaker_threshold,
            )

    def rerank_candidates(self, query: str, candidates: List[Dict]) -> List[Dict]:
        """
        Rerank *candidates* for *query*, best first.

        Called once on the fused candidate list rather than once per query
        variant, so enabling reranking costs one extra HTTP call per request
        instead of N.

        When no reranker is usable the candidates come back in their existing
        order and *untruncated* — the caller owns the final cap, so a reranker
        outage cannot quietly shrink how many documents reach the answer.
        """
        if not candidates:
            return []

        if self._rerank_available():
            reranked = self._openrouter_rerank(query, candidates)
            if reranked:
                return reranked
        elif self.rerank_model:
            logger.info("[RERANK] Skipped (circuit breaker open or no API key).")

        if self.cross_encoder:
            logger.info("[RETRIEVE] Re-ranking with local cross-encoder.")
            return self._cross_encoder_rerank(query, candidates)[: self.rerank_top_n]

        return candidates

    def _openrouter_rerank(self, query: str, candidates: List[Dict]) -> List[Dict]:
        """
        Re-rank candidates using OpenRouter's /rerank endpoint.

        Returns an empty list on failure so the caller can fall back.
        """
        payload = {
            "model": self.rerank_model,
            "query": query,
            "documents": [c["document"] for c in candidates],
            "top_n": self.rerank_top_n,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.site_url:
            headers["HTTP-Referer"] = self.site_url
        if self.site_title:
            headers["X-OpenRouter-Title"] = self.site_title

        t0 = time.monotonic()
        try:
            response = requests.post(
                url=f"{settings.OPENROUTER_BASE_URL}/rerank",
                headers=headers,
                data=json.dumps(payload),
                timeout=self.rerank_timeout,
            )
            response.raise_for_status()
            data = response.json()

            reranked = []
            for result in data.get("results", []):
                idx = result.get("index")
                if isinstance(idx, int) and 0 <= idx < len(candidates):
                    candidate = dict(candidates[idx])
                    candidate["rerank_score"] = result.get("relevance_score")
                    reranked.append(candidate)

            if not reranked:
                logger.warning("[RERANK] Response contained no usable results.")
                self._record_rerank_failure()
                return []

            self._rerank_failures = 0
            logger.info(
                "[RERANK] Reranked %s → %s candidates in %.1fs",
                len(candidates),
                len(reranked),
                time.monotonic() - t0,
            )
            return reranked[: self.rerank_top_n]

        except Exception as exc:
            logger.error(
                "[RERANK] OpenRouter rerank failed after %.1fs: %s",
                time.monotonic() - t0,
                exc,
            )
            self._record_rerank_failure()
            return []

    def _cross_encoder_rerank(self, query: str, candidates: List[Dict]) -> List[Dict]:
        """Re-rank candidates using local cross-encoder."""
        if not self.cross_encoder or not candidates:
            return candidates
        pairs = [(query, cand["document"]) for cand in candidates]
        scores = self.cross_encoder.predict(pairs)
        ranked = [dict(cand) for cand in candidates]
        for i, cand in enumerate(ranked):
            cand["cross_score"] = float(scores[i])
        ranked.sort(key=lambda x: x["cross_score"], reverse=True)
        return ranked

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def _candidates_from_results(self, results: dict, n_queries: int) -> List[List[Dict]]:
        """Turn a (possibly batched) Chroma query result into candidate lists."""
        ids = results.get("ids") or []
        documents = results.get("documents") or []
        metadatas = results.get("metadatas") or []
        distances = results.get("distances") or []

        per_query: List[List[Dict]] = []
        for q in range(n_queries):
            docs = documents[q] if q < len(documents) else []
            metas = metadatas[q] if q < len(metadatas) else []
            dists = distances[q] if q < len(distances) else []
            query_ids = ids[q] if q < len(ids) else []

            candidates = []
            for idx, doc in enumerate(docs):
                distance = dists[idx] if idx < len(dists) else None
                meta = dict(metas[idx]) if idx < len(metas) and isinstance(metas[idx], dict) else {}
                doc_id = query_ids[idx] if idx < len(query_ids) else None
                if doc_id:
                    if not meta.get("id"):
                        meta["id"] = str(doc_id)
                    if not meta.get("arxiv_id"):
                        meta["arxiv_id"] = str(doc_id)
                candidates.append(
                    {
                        "document": doc,
                        "meta": meta,
                        "dense_score": (
                            1.0 / (1 + distance) if distance is not None else 0.0
                        ),
                        "distance": distance,
                    }
                )
            per_query.append(candidates)
        return per_query

    def retrieve_many(
        self,
        queries: List[str],
        where_filter: Optional[Dict] = None,
        n_results: Optional[int] = None,
        total: Optional[int] = None,
    ) -> List[List[Dict]]:
        """
        Retrieve candidates for several queries with two network round trips.

        Returns one ranked candidate list per input query, in input order.
        Duplicate queries are embedded and searched once.  Pass *total* when the
        caller already knows the collection size, to skip a redundant count.
        """
        if not queries:
            return []

        t_start = time.monotonic()
        if total is None:
            total = self.count()
        if total == 0:
            logger.warning(
                "[RETRIEVE] Collection '%s' is empty — nothing to retrieve.",
                self.collection_name,
            )
            return [[] for _ in queries]

        # De-duplicate while preserving order.
        unique_queries: List[str] = []
        position: Dict[str, int] = {}
        for query in queries:
            if query not in position:
                position[query] = len(unique_queries)
                unique_queries.append(query)

        t_embed = time.monotonic()
        embeddings = self._get_embeddings(unique_queries)
        embed_elapsed = time.monotonic() - t_embed

        limit = n_results or (self.top_k * self.candidate_multiplier)
        limit = max(1, min(limit, total))

        t_query = time.monotonic()
        try:
            results = self.collection.query(
                query_embeddings=embeddings,
                n_results=limit,
                where=where_filter,
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:
            message = str(exc)
            if "dimension" in message.lower():
                raise VectorStoreUnavailable(
                    f"Embedding dimension mismatch querying '{self.collection_name}': "
                    f"{message}. The collection was indexed with a different "
                    f"embedding model than {self.embedding_model!r}."
                ) from exc
            raise VectorStoreUnavailable(
                f"ChromaDB query on '{self.collection_name}' failed: {message}"
            ) from exc
        query_elapsed = time.monotonic() - t_query

        per_unique = self._candidates_from_results(results, len(unique_queries))

        logger.info(
            "[RETRIEVE] %s quer%s (%s unique) → %s candidates | embed %.1fs, "
            "chroma %.1fs, total %.1fs",
            len(queries),
            "y" if len(queries) == 1 else "ies",
            len(unique_queries),
            sum(len(c) for c in per_unique),
            embed_elapsed,
            query_elapsed,
            time.monotonic() - t_start,
        )

        return [per_unique[position[query]] for query in queries]

    def retrieve(
        self,
        query: str,
        keyword: str = None,  # noqa: ARG002 — kept for API compatibility
        where_filter: Dict = None,
    ) -> tuple[List[str], List[Dict]]:
        """Retrieve the top documents for a single query (rerank included)."""
        if self.emitter:
            self.emitter.emit(
                "dense_retrieval", f"Starting retrieval for query: '{query[:80]}'"
            )

        candidate_lists = self.retrieve_many([query], where_filter=where_filter)
        candidates = candidate_lists[0] if candidate_lists else []
        if not candidates:
            return [], []

        if self.rerank_model or self.cross_encoder:
            final = self.rerank_candidates(query, candidates)[: self.rerank_top_n]
        else:
            final = candidates[: self.top_k]

        return [c["document"] for c in final], [c.get("meta", {}) for c in final]

    def set_emitter(self, emitter):
        self.emitter = emitter

    # ── Readiness ─────────────────────────────────────────────────────────────

    def probe_embedder(self) -> dict:
        """
        Report embedding-backend health for the readiness endpoint.

        Also verifies that the *configured* model is actually present in Ollama:
        a model name Ollama does not know produces an error on every query,
        which otherwise looks exactly like "no documents matched".
        Never raises.
        """
        info = {
            "ok": False,
            "base_url": settings.OLLAMA_BASE_URL,
            "model": self.embedding_model,
            "model_available": None,
            "error": None,
        }
        try:
            # A dedicated short-timeout client: the shared one is tuned for
            # embedding batches (60s), and a health check that can block for a
            # minute is worse than no health check at all.
            probe_client = Client(
                host=settings.OLLAMA_BASE_URL,
                timeout=int(_setting("READINESS_PROBE_TIMEOUT", 5)),
            )
            listed = probe_client.list()
            models = listed.get("models") if isinstance(listed, dict) else getattr(listed, "models", [])
            names = []
            for entry in models or []:
                name = (
                    entry.get("model") or entry.get("name")
                    if isinstance(entry, dict)
                    else getattr(entry, "model", None) or getattr(entry, "name", None)
                )
                if name:
                    names.append(str(name))

            wanted = str(self.embedding_model)
            info["model_available"] = any(
                name == wanted or name.split(":", 1)[0] == wanted.split(":", 1)[0]
                for name in names
            )
            info["ok"] = bool(info["model_available"])
            if not info["model_available"]:
                info["error"] = (
                    f"Ollama is reachable but has no model matching "
                    f"{self.embedding_model!r} (available: {', '.join(names) or 'none'})."
                )
        except Exception as exc:
            info["error"] = f"{type(exc).__name__}: {exc}"
        return info

    def rerank(self, query: str, retrieved_docs: List[str], retrieved_metas: List[Dict]) -> List[Dict]:
        """Legacy placeholder; actual reranking is integrated into retrieve."""
        return [{"doc": doc, "meta": meta} for doc, meta in zip(retrieved_docs, retrieved_metas)]
