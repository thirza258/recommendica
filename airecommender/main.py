import logging
import time
import chromadb
from chromadb.config import Settings
from langchain_ollama import OllamaEmbeddings
from django.conf import settings

from airecommender.pipeline.llm_service import OpenRouterService
from airecommender.pipeline.query_transform.hyde_rag import generate_hypothetical_abstract
from airecommender.pipeline.query_transform.step_back import step_back
from airecommender.pipeline.query_transform.rag_fusion import generate_query_variants

from airecommender.pipeline.dense_rag import DenseRAG

logger = logging.getLogger(__name__)


class RAGIndex:
    def __init__(self):
        self.embeddings = OllamaEmbeddings(
            model=settings.OLLAMA_EMBEDDING_MODEL,
            base_url=settings.OLLAMA_BASE_URL,
        )

        self.chroma_client = None
        self.collection = None
        self._init_chroma_client()

        self.dense_rag = DenseRAG()

        self.llm_service = OpenRouterService()

    def _init_chroma_client(self):
        """Initialize ChromaDB client — remote if host/port are set, otherwise in-memory."""
        try:
            if settings.CHROMA_HOST and settings.CHROMA_PORT:
                print(f"Initializing ChromaDB HTTP client at {settings.CHROMA_HOST}:{settings.CHROMA_PORT}")
                self.chroma_client = chromadb.HttpClient(
                    host=settings.CHROMA_HOST,
                    port=settings.CHROMA_PORT,
                    settings=Settings(anonymized_telemetry=False),
                )
            else:
                raise ValueError("Chroma host/port not configured")
        except Exception as exc:
            logger.warning(
                "[CHROMA] Falling back to EphemeralClient because the HTTP client could not be initialized: %s",
                exc,
            )
            self.chroma_client = chromadb.EphemeralClient(
                settings=Settings(anonymized_telemetry=False),
            )

        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.COLLECTION_NAME,
        )

    # ── Query-generation helpers ──────────────────────────────────────────────

    def _build_query_variants(self, query: str) -> list[str]:
        """
        Generate diverse query representations from the original user query.

        Sources:
          • HyDE        — a hypothetical arxiv abstract that would answer the query
          • Step-back   — a broader, more formal research question
          • RAG Fusion  — multiple query angles (different terminology / framing)

        Returns a deduplicated list of queries, preserving semantic priority.
        """
        variants: list[str] = []

        # 1) Original query — always keep the user's exact intent
        variants.append(query)

        # 2) HyDE — fake abstract that looks like a real paper
        t0 = time.monotonic()
        try:
            hypo = generate_hypothetical_abstract(query, llm_service=self.llm_service)
            if hypo and hypo.strip():
                variants.append(hypo.strip())
            logger.info("[PIPELINE]   HyDE: generated in %.1fs", time.monotonic() - t0)
        except Exception as exc:
            logger.warning("[PIPELINE]   HyDE failed after %.1fs: %s", time.monotonic() - t0, exc)

        # 3) Step-back — broader research question + category hints
        t0 = time.monotonic()
        try:
            sb = step_back(query, llm_service=self.llm_service)
            elapsed = time.monotonic() - t0
            if isinstance(sb, dict):
                abstracted = sb.get("abstracted_query", "").strip()
                if abstracted and abstracted != query:
                    variants.append(abstracted)
            logger.info("[PIPELINE]   Step-back: generated in %.1fs", elapsed)
        except Exception as exc:
            logger.warning("[PIPELINE]   Step-back failed after %.1fs: %s", time.monotonic() - t0, exc)

        # 4) RAG Fusion — multiple search angles
        t0 = time.monotonic()
        try:
            fusion = generate_query_variants(query, llm_service=self.llm_service)
            elapsed = time.monotonic() - t0
            if isinstance(fusion, list):
                for v in fusion:
                    v = v.strip()
                    if v and v not in variants:
                        variants.append(v)
            logger.info("[PIPELINE]   RAG Fusion: %s variants in %.1fs", len(fusion) if isinstance(fusion, list) else 0, elapsed)
        except Exception as exc:
            logger.warning("[PIPELINE]   RAG Fusion failed after %.1fs: %s", time.monotonic() - t0, exc)

        return variants

    # ── Main pipeline ─────────────────────────────────────────────────────────

    def main_pipeline(self, query: str) -> dict:
        """
        End-to-end pipeline for a single user query.

        Flow
        ----
        1. Generate query variants   (HyDE, step-back, rag-fusion)
        2. Dense retrieval           (one call per unique variant, deduplicate)
        3. Chunk documents           (groups of settings.CHUNK_SIZE)
        4. Generate LLM response     (one per chunk — context window aware)
        5. Return structured result

        The caller receives *multiple* response blocks when there are > settings.CHUNK_SIZE
        documents — one block per chunk, each with its own LLM-generated answer
        grounded in that chunk's documents.
        """
        logger.info(f"[PIPELINE] === Starting main_pipeline for query: '{query[:100]}' ===")
        pipeline_start = time.monotonic()

        # Step 1: Build query variants
        t0 = time.monotonic()
        queries = self._build_query_variants(query)
        logger.info(
            "[PIPELINE] Step 1/4 — query variants: %s generated in %.1fs",
            len(queries),
            time.monotonic() - t0,
        )

        # Step 2: Retrieve + deduplicate across all variants
        t0 = time.monotonic()
        all_docs: list[dict] = []
        seen_contents: set[str] = set()

        for q in queries:
            try:
                docs, metas = self.dense_rag.retrieve(q)
                for doc_text, meta in zip(docs, metas):
                    if doc_text not in seen_contents:
                        seen_contents.add(doc_text)
                        all_docs.append({
                            "document": doc_text,
                            "meta": meta,
                        })
            except Exception as exc:
                logger.warning(f"[PIPELINE] Retrieval failed for query '{q[:60]}': {exc}")
                continue

        logger.info(
            "[PIPELINE] Step 2/4 — retrieval: %s unique docs across %s variants in %.1fs",
            len(all_docs),
            len(queries),
            time.monotonic() - t0,
        )

        if not all_docs:
            logger.info(
                "[PIPELINE] === Pipeline complete (no docs found) in %.1fs ===",
                time.monotonic() - pipeline_start,
            )
            return {
                "query": query,
                "total_docs_retrieved": 0,
                "num_chunks": 0,
                "chunk_size": settings.CHUNK_SIZE,
                "responses": [],
            }

        # Step 3: Chunk into groups of CHUNK_SIZE
        chunks = [
            all_docs[i : i + settings.CHUNK_SIZE]
            for i in range(0, len(all_docs), settings.CHUNK_SIZE)
        ]
        logger.info(f"[PIPELINE] Step 3/4 — chunking: {len(chunks)} chunk(s) of ≤{settings.CHUNK_SIZE}")

        # Step 4: Generate LLM response per chunk
        t0 = time.monotonic()
        responses: list[dict] = []

        for i, chunk in enumerate(chunks):
            chunk_t0 = time.monotonic()
            chunk_response = self._generate_chunk_response(
                query=query,
                chunk=chunk,
                chunk_index=i + 1,
            )
            responses.append(chunk_response)
            logger.info(
                "[PIPELINE]   Chunk %s/%s (%s docs) generated in %.1fs",
                i + 1,
                len(chunks),
                len(chunk),
                time.monotonic() - chunk_t0,
            )

        logger.info(
            "[PIPELINE] Step 4/4 — LLM generation: %s chunk(s) in %.1fs",
            len(responses),
            time.monotonic() - t0,
        )
        logger.info(
            "[PIPELINE] === Pipeline complete — total %.1fs ===",
            time.monotonic() - pipeline_start,
        )

        return {
            "query": query,
            "total_docs_retrieved": len(all_docs),
            "num_chunks": len(chunks),
            "chunk_size": settings.CHUNK_SIZE,
            "responses": responses,
        }

    def _build_chunk_prompt(self, query: str, chunk: list[dict], chunk_index: int):
        """Build the system + user prompt strings for a chunk.

        Shared by streaming and non-streaming generation helpers."""
        doc_entries: list[str] = []
        for j, doc in enumerate(chunk):
            doc_entries.append(
                f"--- Document {j + 1} ---\n"
                f"{doc['document']}\n"
            )
        context = "\n".join(doc_entries)

        system_prompt = (
            "You are a research assistant helping a user understand academic papers. "
            "Answer the user's query using ONLY the provided research documents. "
            "Cite specific papers by title or content when relevant. "
            "If the documents do not contain enough information to fully answer, "
            "say so clearly, then give the best partial answer you can. "
            "Be thorough but concise."
        )

        user_prompt = (
            f"User query: {query}\n\n"
            f"Research documents (chunk {chunk_index}):\n"
            f"{context}\n\n"
            f"Please provide a comprehensive answer grounded in these documents."
        )
        return system_prompt, user_prompt

    def _generate_chunk_response(
        self,
        query: str,
        chunk: list[dict],
        chunk_index: int,
    ) -> dict:
        """Non-streaming chunk generation — used by main_pipeline()."""
        system_prompt, user_prompt = self._build_chunk_prompt(query, chunk, chunk_index)

        try:
            response_text = self.llm_service.generate_response(
                prompt=user_prompt,
                system_instruction_string=system_prompt,
                response_mime_type_param="text/plain",
            )
        except Exception as exc:
            logger.error(f"[PIPELINE] LLM generation failed for chunk {chunk_index}: {exc}")
            response_text = f"[Error generating response for chunk {chunk_index}]"

        return {
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
            "docs": chunk,
            "generated_response": response_text,
        }

    # ── Streaming pipeline ──────────────────────────────────────────────────

    def main_pipeline_stream(self, query: str):
        """
        Streaming version of main_pipeline.

        Yields SSE-style event dicts so the caller can relay progress and
        partial results to the browser as they happen.  This keeps the HTTP
        connection alive and eliminates proxy/gateway timeouts even when the
        full pipeline takes minutes.

        Event types
        -----------
        ``progress``     — pipeline stage started or completed
        ``chunk_start``  — a new chunk's LLM generation is about to begin
        ``chunk_token``  — one text token from the chunk's LLM stream
        ``chunk_end``    — chunk generation finished (docs attached)
        ``complete``     — entire pipeline finished with summary stats
        """
        pipeline_start = time.monotonic()

        # ── Step 1: Build query variants ──────────────────────────────────
        yield {
            "type": "progress",
            "step": "variants",
            "status": "start",
            "message": "Generating query variants (HyDE, step-back, RAG fusion)...",
        }

        t0 = time.monotonic()
        queries = self._build_query_variants(query)
        variants_elapsed = time.monotonic() - t0

        yield {
            "type": "progress",
            "step": "variants",
            "status": "done",
            "message": f"Generated {len(queries)} query variants",
            "count": len(queries),
            "elapsed_ms": round(variants_elapsed * 1000),
        }

        # ── Step 2: Retrieve + deduplicate across all variants ────────────
        yield {
            "type": "progress",
            "step": "retrieval",
            "status": "start",
            "message": f"Retrieving documents across {len(queries)} queries...",
        }

        t0 = time.monotonic()
        all_docs: list[dict] = []
        seen_contents: set[str] = set()

        for q in queries:
            try:
                docs, metas = self.dense_rag.retrieve(q)
                for doc_text, meta in zip(docs, metas):
                    if doc_text not in seen_contents:
                        seen_contents.add(doc_text)
                        all_docs.append({
                            "document": doc_text,
                            "meta": meta,
                        })
            except Exception as exc:
                logger.warning(f"[PIPELINE] Retrieval failed for query '{q[:60]}': {exc}")
                continue

        retrieval_elapsed = time.monotonic() - t0

        yield {
            "type": "progress",
            "step": "retrieval",
            "status": "done",
            "message": f"Retrieved {len(all_docs)} unique documents",
            "count": len(all_docs),
            "elapsed_ms": round(retrieval_elapsed * 1000),
        }

        if not all_docs:
            yield {
                "type": "complete",
                "total_docs_retrieved": 0,
                "num_chunks": 0,
                "elapsed_ms": round((time.monotonic() - pipeline_start) * 1000),
            }
            return

        # ── Step 3: Chunk into groups of CHUNK_SIZE ───────────────────────
        chunks = [
            all_docs[i : i + settings.CHUNK_SIZE]
            for i in range(0, len(all_docs), settings.CHUNK_SIZE)
        ]

        yield {
            "type": "progress",
            "step": "chunking",
            "status": "done",
            "message": (
                f"Split {len(all_docs)} docs into {len(chunks)} chunk(s) "
                f"of at most {settings.CHUNK_SIZE}"
            ),
            "num_chunks": len(chunks),
        }

        # ── Step 4: Generate LLM response per chunk (streamed) ────────────
        for i, chunk in enumerate(chunks):
            chunk_index = i + 1
            try:
                yield from self._generate_chunk_response_stream(
                    query=query,
                    chunk=chunk,
                    chunk_index=chunk_index,
                )
            except Exception as exc:
                logger.error(
                    "[PIPELINE] Chunk %s/%s generation failed: %s",
                    chunk_index,
                    len(chunks),
                    exc,
                )
                yield {
                    "type": "chunk_end",
                    "chunk_index": chunk_index,
                    "num_docs_in_chunk": len(chunk),
                    "docs": chunk,
                    "generated_response": (
                        f"[Error generating response for chunk {chunk_index}]"
                    ),
                    "error": str(exc),
                }

        # ── Final summary ─────────────────────────────────────────────────
        total_elapsed = time.monotonic() - pipeline_start
        logger.info(
            "[PIPELINE] === Streaming pipeline complete — total %.1fs ===",
            total_elapsed,
        )

        yield {
            "type": "complete",
            "total_docs_retrieved": len(all_docs),
            "num_chunks": len(chunks),
            "chunk_size": settings.CHUNK_SIZE,
            "elapsed_ms": round(total_elapsed * 1000),
        }

    def _generate_chunk_response_stream(
        self,
        query: str,
        chunk: list[dict],
        chunk_index: int,
    ):
        """
        Stream a chunk's LLM response token by token.

        Yields ``chunk_start``, then one ``chunk_token`` per text token,
        then ``chunk_end`` with the full accumulated response and docs.
        """
        system_prompt, user_prompt = self._build_chunk_prompt(query, chunk, chunk_index)

        yield {
            "type": "chunk_start",
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
        }

        accumulated_tokens: list[str] = []
        try:
            for token in self.llm_service.generate_response_stream(
                prompt=user_prompt,
                system_instruction_string=system_prompt,
            ):
                accumulated_tokens.append(token)
                yield {
                    "type": "chunk_token",
                    "chunk_index": chunk_index,
                    "token": token,
                }
        except Exception as exc:
            logger.error(
                "[PIPELINE] LLM stream failed for chunk %s: %s",
                chunk_index,
                exc,
            )
            if not accumulated_tokens:
                accumulated_tokens.append(
                    f"[Error generating response for chunk {chunk_index}]"
                )

        full_response = "".join(accumulated_tokens)

        yield {
            "type": "chunk_end",
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
            "docs": chunk,
            "generated_response": full_response,
        }


rag_index = RAGIndex()
