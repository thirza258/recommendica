import logging
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

        # DenseRAG for vector retrieval + optional re-rank
        self.dense_rag = DenseRAG()

        # LLM service for query transforms and chunk response generation
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
        try:
            hypo = generate_hypothetical_abstract(query, llm_service=self.llm_service)
            if hypo and hypo.strip():
                variants.append(hypo.strip())
        except Exception as exc:
            logger.warning(f"[PIPELINE] HyDE generation failed: {exc}")

        # 3) Step-back — broader research question + category hints
        try:
            sb = step_back(query, llm_service=self.llm_service)
            if isinstance(sb, dict):
                abstracted = sb.get("abstracted_query", "").strip()
                if abstracted and abstracted != query:
                    variants.append(abstracted)
        except Exception as exc:
            logger.warning(f"[PIPELINE] Step-back generation failed: {exc}")

        # 4) RAG Fusion — multiple search angles
        try:
            fusion = generate_query_variants(query, llm_service=self.llm_service)
            if isinstance(fusion, list):
                for v in fusion:
                    v = v.strip()
                    if v and v not in variants:
                        variants.append(v)
        except Exception as exc:
            logger.warning(f"[PIPELINE] RAG Fusion generation failed: {exc}")

        return variants

    # ── Main pipeline ─────────────────────────────────────────────────────────

    def main_pipeline(self, query: str) -> dict:
        """
        End-to-end pipeline for a single user query.

        Flow
        ────
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

        # ── Step 1: Build query variants ──────────────────────────────────
        queries = self._build_query_variants(query)
        logger.info(f"[PIPELINE] Generated {len(queries)} unique query variants")

        # ── Step 2: Retrieve + deduplicate across all variants ────────────
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

        logger.info(f"[PIPELINE] Retrieved {len(all_docs)} unique documents across all variants")

        if not all_docs:
            return {
                "query": query,
                "total_docs_retrieved": 0,
                "num_chunks": 0,
                "chunk_size": settings.CHUNK_SIZE,
                "responses": [],
            }

        # ── Step 3: Chunk into groups of CHUNK_SIZE ───────────────────────
        chunks = [
            all_docs[i : i + settings.CHUNK_SIZE]
            for i in range(0, len(all_docs), settings.CHUNK_SIZE)
        ]
        logger.info(f"[PIPELINE] Split {len(all_docs)} docs into {len(chunks)} chunk(s) of ≤{settings.CHUNK_SIZE}")

        # ── Step 4: Generate LLM response per chunk ───────────────────────
        responses: list[dict] = []

        for i, chunk in enumerate(chunks):
            chunk_response = self._generate_chunk_response(
                query=query,
                chunk=chunk,
                chunk_index=i + 1,
            )
            responses.append(chunk_response)

        logger.info(f"[PIPELINE] === Pipeline complete — {len(responses)} response chunk(s) ===")

        return {
            "query": query,
            "total_docs_retrieved": len(all_docs),
            "num_chunks": len(chunks),
            "chunk_size": settings.CHUNK_SIZE,
            "responses": responses,
        }

    def _generate_chunk_response(
        self,
        query: str,
        chunk: list[dict],
        chunk_index: int,
    ) -> dict:
        """
        Build a prompt from *chunk*'s documents and ask the LLM to answer
        the user's query based on that context.

        Each chunk is self-contained so that even when we have 15 documents
        (3 chunks of 5) the LLM never sees more than 5 docs at once —
        avoiding context-window / lost-in-the-middle issues.
        """
        # Format documents as a readable context block
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


rag_index = RAGIndex()
