import json
import requests
import numpy as np
from typing import List, Dict, Optional
from ollama import Client
from django.conf import settings
from airecommender.pipeline.chroma.chroma_settings import get_chroma_client
import logging
from math import ceil

logger = logging.getLogger(__name__)

class DenseRAG:
    def __init__(self):
        if not settings.OPENROUTER_API_KEY:
            raise ValueError("OPENROUTER_API_KEY not found in environment variables.")

        self.api_key = settings.OPENROUTER_API_KEY
        self.embedding_model = settings.EMBEDDING_MODEL

        self.client = Client(
            host=settings.OLLAMA_BASE_URL  # e.g. http://localhost:11434
        )

        self.llm_model = settings.DENSE_LLM_MODEL
        self.top_k = settings.TOP_K
        self.candidate_multiplier = settings.CANDIDATE_MULTIPLIER

        # Rerank settings
        self.rerank_model = settings.RERANK_MODEL
        self.rerank_top_n = int(settings.RERANK_TOP_N) if settings.RERANK_TOP_N else settings.TOP_K
        self.site_url = None
        self.site_title = None

        self.documents: List[str] = []
        self.cross_encoder = None  # placeholder for optional local cross-encoder
        self.collection = get_chroma_client(collection_name=settings.COLLECTION_NAME)

    def _get_embeddings(self, texts: List[str], batch_size: Optional[int] = None) -> List[List[float]]:
        if batch_size is None:
            batch_size = settings.EMBEDDING_BATCH_SIZE

        cleaned_texts = [text.replace("\n", " ") for text in texts]
        all_embeddings = []
        logger.info(f"[DENSE] Fetching embeddings for {len(cleaned_texts)} texts using model {self.embedding_model}...")

        for i in range(0, len(cleaned_texts), batch_size):
            batch = cleaned_texts[i : i + batch_size]
            try:
                response = self.client.embed(
                    input=batch,
                    model=self.embedding_model,
                )
                if not response.get('embeddings'):
                        logger.warning(f"Warning: No embedding data received from Ollama for batch {i // batch_size}")
                        continue
                        
                all_embeddings.extend(response['embeddings'])
                logger.info(f"[DENSE] Embedded batch {i // batch_size + 1} / {ceil(len(cleaned_texts) / batch_size)}")
            except Exception as e:
                logger.error(f"[DENSE] Error fetching embeddings for batch {i // batch_size}: {e}")
                continue

        if len(all_embeddings) != len(texts):
            logger.warning(f"[DENSE] Warning: expected {len(texts)} embeddings, got {len(all_embeddings)}")
        return all_embeddings

    def index_documents(self, documents: List[str]) -> None:
        self.documents = list(documents)
        # Optional: you could store embeddings in Chroma here; we assume it's already populated.
        # For a fresh index, you'd add documents + embeddings to the collection.
        logger.info(f"[DENSE] Indexed {len(self.documents)} documents in memory.")

    def _openrouter_rerank(self, query: str, candidates: List[Dict]) -> List[Dict]:
        """
        Re-rank candidates using OpenRouter's /rerank endpoint.
        Returns top self.rerank_top_n candidates sorted by relevance.
        Each candidate dict must contain a "document" key.
        """
        if not self.rerank_model or not candidates:
            return candidates[:self.top_k]

        documents = [c["document"] for c in candidates]
        payload = {
            "model": self.rerank_model,
            "query": query,
            "documents": documents,
            "top_n": self.rerank_top_n
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        if self.site_url:
            headers["HTTP-Referer"] = self.site_url
        if self.site_title:
            headers["X-OpenRouter-Title"] = self.site_title

        try:
            response = requests.post(
                url=f"{settings.OPENROUTER_BASE_URL}/rerank",
                headers=headers,
                data=json.dumps(payload),
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            reranked = []
            for result in data.get("results", []):
                idx = result["index"]
                score = result["relevance_score"]
                if idx < len(candidates):
                    cand = candidates[idx].copy()
                    cand["rerank_score"] = score
                    reranked.append(cand)
            # The API returns top_n sorted; we'll return them
            return reranked[:self.rerank_top_n]
        except Exception as e:
            logger.error(f"[RERANK] OpenRouter rerank failed: {e}")
            # Fallback to local cross-encoder if available
            if self.cross_encoder:
                logger.info("[RERANK] Falling back to local cross-encoder.")
                return self._cross_encoder_rerank(query, candidates)[:self.top_k]
            # Otherwise, just cut to top_k
            return candidates[:self.top_k]

    def _cross_encoder_rerank(self, query: str, candidates: List[Dict]) -> List[Dict]:
        """Re-rank candidates using local cross-encoder."""
        if not self.cross_encoder or not candidates:
            return candidates
        pairs = [(query, cand["document"]) for cand in candidates]
        scores = self.cross_encoder.predict(pairs)
        for i, cand in enumerate(candidates):
            cand["cross_score"] = float(scores[i])
        candidates.sort(key=lambda x: x["cross_score"], reverse=True)
        return candidates

    def retrieve(self, query: str, keyword: str = None, where_filter: Dict = None) -> tuple[List[str], List[Dict]]:
        logger.info(f"[RETRIEVE] Query: '{query[:80]}' | where_filter={where_filter} | keyword={keyword}")
        if hasattr(self, 'emitter') and self.emitter:
            self.emitter.emit("dense_retrieval", f"Starting retrieval for query: '{query[:80]}'")

        collection_count = self.collection.count()
        logger.info(f"[RETRIEVE] Collection '{self.collection.name}' has {collection_count} documents.")

        if collection_count == 0:
            logger.warning(f"[RETRIEVE] Collection '{self.collection.name}' is empty. Returning empty result.")
            return [], []

        # Dense retrieval – fetch more candidates than needed
        dense_n = self.top_k * self.candidate_multiplier
        logger.info(f"[RETRIEVE] Dense retrieval: fetching {dense_n} candidates.")
        query_embeddings = self._get_embeddings([query])
        if not query_embeddings:
            logger.warning(f"[RETRIEVE] Embedding returned empty for query: '{query[:80]}'")
            return [], []

        # Apply where_filter if any
        count = collection_count
        if where_filter:
            available_docs = self.collection.get(where=where_filter)["documents"]
            available = len(available_docs)
            logger.info(f"[RETRIEVE] Docs matching where_filter: {available} / {collection_count}")
            if available == 0:
                logger.warning(f"[RETRIEVE] No documents match where_filter={where_filter}. Falling back to full count.")
                where_filter = None
            else:
                count = available

        n_results = min(dense_n, count)
        results = self.collection.query(
            query_embeddings=query_embeddings,
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"]
        )

        dense_docs = results["documents"][0] if results["documents"] else []
        dense_metas = results["metadatas"][0] if results["metadatas"] else []
        dense_distances = results["distances"][0] if results["distances"] else []

        candidates = []
        for idx, doc in enumerate(dense_docs):
            candidates.append({
                "document": doc,
                "meta": dense_metas[idx] if idx < len(dense_metas) else {},
                "dense_score": 1.0 / (1 + dense_distances[idx]) if idx < len(dense_distances) else 0.0
            })

        # ---- Re-ranking ----
        if self.rerank_model:
            logger.info("[RETRIEVE] Re-ranking with OpenRouter rerank API.")
            final_candidates = self._openrouter_rerank(query, candidates)
        elif self.cross_encoder:
            logger.info("[RETRIEVE] Re-ranking with local cross-encoder.")
            final_candidates = self._cross_encoder_rerank(query, candidates)[:self.top_k]
        else:
            final_candidates = candidates[:self.top_k]

        # Extract documents and metadata
        docs = [item["document"] for item in final_candidates]
        metas = [item.get("meta", {}) for item in final_candidates]

        logger.info(f"[RETRIEVE] Returning {len(docs)} chunks after reranking.")
        return docs, metas

    def set_collection(self, collection_name: str):
        """Swap collection at runtime without reinitializing."""
        self.collection_name = collection_name
        self.collection = get_chroma_client(collection_name=collection_name)
        logger.info(f"[DenseRAG] Switched to collection: {collection_name}")

    def set_emitter(self, emitter):
        self.emitter = emitter

    def rerank(self, query: str, retrieved_docs: List[str], retrieved_metas: List[Dict]) -> List[Dict]:
        """Legacy placeholder; actual reranking is integrated into retrieve."""
        return [{"doc": doc, "meta": meta} for doc, meta in zip(retrieved_docs, retrieved_metas)]
