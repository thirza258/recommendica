import functools
import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Optional

from django.conf import settings

from airecommender.pipeline.agent.faithfulness import (
    aggregate_faithfulness,
    evaluate_answer,
)
from airecommender.pipeline.agent.grading import grade_candidates
from airecommender.pipeline.agent.loop import AgentEvent, AgentResult, RelevanceAgent
from airecommender.pipeline.agent.refine import refine_query
from airecommender.pipeline.chroma import chroma_settings
from airecommender.pipeline.dense_rag import DenseRAG
from airecommender.pipeline.errors import (
    DependencyUnavailable,
    PipelineError,
    PipelineNotReady,
    VectorStoreUnavailable,
)
from airecommender.pipeline.fusion import RRF_DEFAULT_K, reciprocal_rank_fusion
from airecommender.pipeline.llm_service import get_llm_service
from airecommender.pipeline.ordered_stream import ProducerError, stream_in_order
from airecommender.pipeline.prompting import build_chunk_prompt
from airecommender.pipeline.query_transform.hyde_rag import generate_hypothetical_abstract
from airecommender.pipeline.query_transform.rag_fusion import generate_query_variants
from airecommender.pipeline.query_transform.step_back import step_back

logger = logging.getLogger(__name__)


def _setting(name: str, default):
    return getattr(settings, name, default)


class RAGIndex:
    """
    The end-to-end retrieval-and-answer pipeline.

    Construction only builds clients; it never performs network I/O, so a
    ChromaDB or Ollama outage surfaces as a clean per-request error instead of
    preventing the process from starting.
    """

    def __init__(self):
        self.dense_rag = DenseRAG()
        self.llm_service = get_llm_service()

        # ── Tunables ──────────────────────────────────────────────────────
        self.enable_hyde = bool(_setting("ENABLE_HYDE", True))
        self.enable_step_back = bool(_setting("ENABLE_STEP_BACK", True))
        self.enable_rag_fusion = bool(_setting("ENABLE_RAG_FUSION", True))

        self.variant_workers = int(_setting("VARIANT_MAX_WORKERS", 3))
        self.variant_stage_timeout = float(_setting("VARIANT_STAGE_TIMEOUT", 45))
        self.transform_timeout = int(_setting("LLM_TRANSFORM_TIMEOUT", 30))

        self.rrf_k = int(_setting("RRF_K", RRF_DEFAULT_K))
        self.max_context_docs = int(_setting("MAX_CONTEXT_DOCS", 12))
        self.max_doc_chars = int(_setting("MAX_DOC_CHARS_IN_PROMPT", 1500))

        self.generation_workers = int(_setting("GENERATION_MAX_WORKERS", 3))
        self.readiness_cache_seconds = float(_setting("READINESS_CACHE_SECONDS", 10))

        # ── Relevance agent ───────────────────────────────────────────────
        self.enable_agent = bool(_setting("ENABLE_RELEVANCE_AGENT", True))
        self.agent_model = _setting("AGENT_MODEL", None) or settings.DEFAULT_LLM_MODEL
        self.agent_timeout = int(_setting("AGENT_TIMEOUT", 30))
        self.agent_max_iterations = int(_setting("AGENT_MAX_ITERATIONS", 2))
        self.agent_min_relevant = int(_setting("AGENT_MIN_RELEVANT_DOCS", 3))
        self.agent_grade_candidates = int(_setting("AGENT_GRADE_CANDIDATES", 20))
        self.agent_threshold = float(_setting("AGENT_RELEVANCE_THRESHOLD", 0.5))
        self.agent_deadline = float(_setting("AGENT_DEADLINE", 90))
        self.agent_candidate_chars = int(_setting("AGENT_MAX_CANDIDATE_CHARS", 400))

        # Answer grounding — off by default: one extra LLM call per chunk, on
        # the critical path (a chunk's evaluation ships with its chunk_end).
        self.enable_answer_evaluation = bool(_setting("ENABLE_ANSWER_EVALUATION", False))
        self.evaluation_timeout = int(_setting("ANSWER_EVALUATION_TIMEOUT", 45))

        self._readiness_cache: Optional[tuple[float, dict]] = None
        self._readiness_lock = threading.Lock()
        self._probe_lock = threading.Lock()

        logger.info(
            "[PIPELINE] RAGIndex ready — transforms(hyde=%s step_back=%s fusion=%s) "
            "max_context_docs=%s chunk_size=%s generation_workers=%s "
            "relevance_agent=%s(model=%r iterations=%s min_relevant=%s) "
            "answer_evaluation=%s",
            self.enable_hyde,
            self.enable_step_back,
            self.enable_rag_fusion,
            self.max_context_docs,
            settings.CHUNK_SIZE,
            self.generation_workers,
            self.enable_agent,
            self.agent_model if self.enable_agent else None,
            self.agent_max_iterations,
            self.agent_min_relevant,
            self.enable_answer_evaluation,
        )

    # ── Query-generation helpers ──────────────────────────────────────────────

    def _variant_tasks(self, query: str):
        """
        The query-transform calls to run, as (name, callable) pairs.

        Transforms get ``max_retries=0``: they are best-effort (a dropped one
        only degrades retrieval), and retries would push a single transform's
        worst case to 93s — past VARIANT_STAGE_TIMEOUT, leaving an abandoned
        thread holding an upstream connection long after the stage gave up.
        With no retries the worst case is one LLM_TRANSFORM_TIMEOUT.
        """
        tasks = []

        if self.enable_hyde:
            def run_hyde():
                hypo = generate_hypothetical_abstract(
                    query,
                    llm_service=self.llm_service,
                    timeout=self.transform_timeout,
                    max_retries=0,
                )
                return [hypo.strip()] if hypo and hypo.strip() else []

            tasks.append(("HyDE", run_hyde))

        if self.enable_step_back:
            def run_step_back():
                result = step_back(
                    query,
                    llm_service=self.llm_service,
                    timeout=self.transform_timeout,
                    max_retries=0,
                )
                if isinstance(result, dict):
                    abstracted = (result.get("abstracted_query") or "").strip()
                    if abstracted:
                        return [abstracted]
                return []

            tasks.append(("Step-back", run_step_back))

        if self.enable_rag_fusion:
            def run_fusion():
                variants = generate_query_variants(
                    query,
                    llm_service=self.llm_service,
                    timeout=self.transform_timeout,
                    max_retries=0,
                )
                if isinstance(variants, list):
                    return [str(v).strip() for v in variants if str(v).strip()]
                return []

            tasks.append(("RAG Fusion", run_fusion))

        return tasks

    def _build_query_variants(self, query: str) -> list[str]:
        """
        Generate diverse query representations from the original user query.

        Sources:
          • HyDE        — a hypothetical arxiv abstract that would answer the query
          • Step-back   — a broader, more formal research question
          • RAG Fusion  — multiple query angles (different terminology / framing)

        The three transforms are independent LLM calls, so they run concurrently:
        the stage costs the slowest one rather than the sum of all three.  A
        transform that misses ``VARIANT_STAGE_TIMEOUT`` is dropped — degraded
        retrieval beats a request that never returns.

        Returns a deduplicated list of queries, preserving semantic priority
        (original query first, then HyDE, step-back, fusion) so the result is
        deterministic regardless of which call finishes first.
        """
        tasks = self._variant_tasks(query)
        results: dict[str, list[str]] = {}

        if tasks:
            stage_start = time.monotonic()
            executor = ThreadPoolExecutor(
                max_workers=max(1, min(self.variant_workers, len(tasks))),
                thread_name_prefix="variant",
            )
            try:
                futures = {executor.submit(task): name for name, task in tasks}
                pending = set(futures)
                deadline = stage_start + self.variant_stage_timeout

                while pending:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    done, pending = wait(pending, timeout=remaining, return_when=FIRST_COMPLETED)
                    for future in done:
                        name = futures[future]
                        try:
                            results[name] = future.result() or []
                            logger.info(
                                "[PIPELINE]   %s: %s variant(s) in %.1fs",
                                name,
                                len(results[name]),
                                time.monotonic() - stage_start,
                            )
                        except Exception as exc:
                            logger.warning("[PIPELINE]   %s failed: %s", name, exc)
                            results[name] = []

                for future in pending:
                    logger.warning(
                        "[PIPELINE]   %s exceeded the %.0fs stage timeout — dropped",
                        futures[future],
                        self.variant_stage_timeout,
                    )
                    future.cancel()
            finally:
                executor.shutdown(wait=False, cancel_futures=True)

        # Fixed assembly order keeps the variant list deterministic.
        variants: list[str] = [query]
        seen = {query}
        for name, _ in tasks:
            for variant in results.get(name, []):
                if variant not in seen:
                    seen.add(variant)
                    variants.append(variant)

        return variants

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def _fuse_documents(
        self,
        query: str,
        queries: list[str],
        total: int,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """
        Retrieve for every variant, then merge the ranked lists with RRF.

        All variants are embedded in one Ollama call and searched with one
        ChromaDB call.  Reciprocal Rank Fusion then promotes the documents that
        several variants agree on, which is what makes the
        ``MAX_CONTEXT_DOCS`` cap safe: the cap removes the tail, not the good
        matches.  That cap is the difference between one or two generation calls
        and eight.

        Returns full candidate dicts (retrieval scores included) so the
        relevance agent can rank with them; use :meth:`_strip_docs` before
        putting them on the wire.
        """
        candidate_lists = self.dense_rag.retrieve_many(queries, total=total)
        fused = reciprocal_rank_fusion(candidate_lists, k=self.rrf_k)

        if not fused:
            return []

        cap = limit or self.max_context_docs

        if self.dense_rag.rerank_model or self.dense_rag.cross_encoder:
            window = max(cap * 2, self.dense_rag.top_k)
            fused = self.dense_rag.rerank_candidates(query, fused[:window])

        selected = fused[:cap]
        logger.info(
            "[PIPELINE] Fusion: %s candidate list(s) → %s unique → keeping %s (cap=%s)",
            len(candidate_lists),
            sum(len(c) for c in candidate_lists),
            len(selected),
            cap,
        )
        return selected

    @staticmethod
    def _strip_docs(candidates: list[dict]) -> list[dict]:
        """Reduce candidates to the shape the API contract promises."""
        return [
            {"document": candidate["document"], "meta": candidate.get("meta", {})}
            for candidate in candidates
        ]

    # ── Relevance agent ───────────────────────────────────────────────────────

    def _build_agent(self, query: str, total: int) -> RelevanceAgent:
        """
        Wire the agent to this request's retrieval, grading and refinement.

        Grading and refinement both run with ``max_retries=0`` and their own
        timeout (see :mod:`agent.grading`): they sit inside a bounded loop, so a
        retry storm would blow the loop's wall-clock deadline.
        """

        def retrieve(queries: list[str]) -> list[dict]:
            return self._fuse_documents(
                query, list(queries), total, limit=self.agent_grade_candidates
            )

        def grade(original_query: str, candidates):
            return grade_candidates(
                original_query,
                candidates,
                self.llm_service,
                model=self.agent_model,
                timeout=self.agent_timeout,
                max_candidate_chars=self.agent_candidate_chars,
            )

        def refine(original_query: str, attempted_query: str, reasons):
            return refine_query(
                original_query,
                attempted_query,
                reasons,
                self.llm_service,
                model=self.agent_model,
                timeout=self.agent_timeout,
            )

        return RelevanceAgent(
            retrieve,
            grade,
            refine,
            min_relevant=self.agent_min_relevant,
            max_iterations=self.agent_max_iterations,
            threshold=self.agent_threshold,
            max_docs=self.max_context_docs,
            deadline_seconds=self.agent_deadline,
        )

    @staticmethod
    def _agent_progress(event: AgentEvent) -> dict:
        """
        Render an agent event as a pipeline ``progress`` event.

        The envelope keys are written last so a data field can never shadow
        them — otherwise a payload carrying its own ``status`` would rewrite the
        event's status and break the client's dispatch.
        """
        payload = dict(event.data)
        payload.update(
            {
                "type": "progress",
                "step": "relevance",
                "status": event.status,
                "message": event.message,
            }
        )
        return payload

    def _select_documents(
        self,
        query: str,
        queries: list[str],
        total: int,
        cancel_event: Optional[threading.Event] = None,
    ):
        """
        Choose the documents to answer from, running the agent when enabled.

        Generator: yields pipeline ``progress`` events, returns
        ``(docs, AgentResult | None)``.
        """
        if not self.enable_agent:
            docs = self._strip_docs(self._fuse_documents(query, queries, total))
            return docs, None

        agent = self._build_agent(query, total)
        generator = agent.run(query, queries=queries, cancel_event=cancel_event)

        result = AgentResult()
        while True:
            try:
                event = next(generator)
            except StopIteration as stop:
                result = stop.value or AgentResult()
                break
            yield self._agent_progress(event)

        return self._strip_docs(result.docs), result

    def _chunk_documents(self, docs: list[dict]) -> list[list[dict]]:
        size = max(1, settings.CHUNK_SIZE)
        return [docs[i : i + size] for i in range(0, len(docs), size)]

    # ── Answer generation ─────────────────────────────────────────────────────

    def _build_chunk_prompt(self, query: str, chunk: list[dict], chunk_index: int):
        """Build the system + user prompt strings for a chunk."""
        return build_chunk_prompt(query, chunk, chunk_index, self.max_doc_chars)

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

        response = {
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
            "docs": chunk,
            "generated_response": response_text,
        }
        evaluation = self._evaluate_answer(query, response_text, chunk, chunk_index)
        if evaluation is not None:
            response["evaluation"] = evaluation
        return response

    def _evaluate_answer(
        self,
        query: str,
        answer: str,
        chunk: list[dict],
        chunk_index: int,
    ) -> Optional[dict]:
        """
        Audit an answer against its source papers, when enabled.

        Returns ``None`` when answer evaluation is switched off, so the event
        payload stays exactly as it was.
        """
        if not self.enable_answer_evaluation:
            return None

        t0 = time.monotonic()
        evaluation = evaluate_answer(
            query,
            answer,
            chunk,
            self.llm_service,
            model=self.agent_model,
            timeout=self.evaluation_timeout,
            max_doc_chars=self.agent_candidate_chars,
        )
        logger.info(
            "[PIPELINE]   Chunk %s faithfulness=%s (%.1fs)",
            chunk_index,
            evaluation.get("faithfulness_score"),
            time.monotonic() - t0,
        )
        return evaluation

    def _generate_chunk_response_stream(
        self,
        query: str,
        chunk: list[dict],
        chunk_index: int,
        cancel_event: Optional[threading.Event] = None,
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

        t0 = time.monotonic()
        accumulated_tokens: list[str] = []
        error: Optional[str] = None

        try:
            for token in self.llm_service.generate_response_stream(
                prompt=user_prompt,
                system_instruction_string=system_prompt,
                cancel_event=cancel_event,
            ):
                accumulated_tokens.append(token)
                yield {
                    "type": "chunk_token",
                    "chunk_index": chunk_index,
                    "token": token,
                }
        except Exception as exc:
            logger.error(
                "[PIPELINE] LLM stream failed for chunk %s: %s", chunk_index, exc
            )
            error = str(exc)
            if not accumulated_tokens:
                accumulated_tokens.append(
                    f"[Error generating response for chunk {chunk_index}]"
                )

        logger.info(
            "[PIPELINE]   Chunk %s (%s docs) generated in %.1fs",
            chunk_index,
            len(chunk),
            time.monotonic() - t0,
        )

        full_response = "".join(accumulated_tokens)

        event = {
            "type": "chunk_end",
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
            "docs": chunk,
            "generated_response": full_response,
        }
        if error:
            event["error"] = error
        else:
            # Runs inside this chunk's own worker thread, so evaluations for
            # different chunks overlap rather than adding up.
            evaluation = self._evaluate_answer(
                query, full_response, chunk, chunk_index
            )
            if evaluation is not None:
                event["evaluation"] = evaluation
        yield event

    # ── Main pipeline (non-streaming) ─────────────────────────────────────────

    def main_pipeline(self, query: str) -> dict:
        """
        End-to-end pipeline for a single user query.

        Flow
        ----
        1. Generate query variants   (HyDE, step-back, rag-fusion — concurrent)
        2. Dense retrieval           (one batched call, fused with RRF)
        3. Relevance agent           (grade, drop unrelated, refine and retry)
        4. Chunk documents           (groups of settings.CHUNK_SIZE)
        5. Generate LLM response     (chunks generated concurrently)
        6. Return structured result
        """
        logger.info(f"[PIPELINE] === Starting main_pipeline for query: '{query[:100]}' ===")
        pipeline_start = time.monotonic()

        t0 = time.monotonic()
        queries = self._build_query_variants(query)
        logger.info(
            "[PIPELINE] Step 1/4 — query variants: %s generated in %.1fs",
            len(queries),
            time.monotonic() - t0,
        )

        t0 = time.monotonic()
        total = self.dense_rag.count()
        if total == 0:
            # Reachable but unusable — say so instead of returning an
            # empty result that looks like "nothing matched".
            raise VectorStoreUnavailable(
                f"The document collection '{self.dense_rag.collection_name}' is "
                f"empty. Index documents before searching."
            )
        all_docs, agent_result = self._collect_documents(query, queries, total)
        logger.info(
            "[PIPELINE] Step 2-3/6 — retrieval + relevance: %s docs from %s "
            "variants in %.1fs",
            len(all_docs),
            len(queries),
            time.monotonic() - t0,
        )

        if not all_docs:
            logger.info(
                "[PIPELINE] === Pipeline complete (no related docs) in %.1fs ===",
                time.monotonic() - pipeline_start,
            )
            empty = {
                "query": query,
                "total_docs_retrieved": 0,
                "num_chunks": 0,
                "chunk_size": settings.CHUNK_SIZE,
                "responses": [],
                "aggregate_faithfulness": None,
            }
            if agent_result is not None and agent_result.notice:
                empty["notice"] = agent_result.notice
                empty["agent_outcome"] = agent_result.outcome.value
            return empty

        chunks = self._chunk_documents(all_docs)
        logger.info(
            f"[PIPELINE] Step 4/6 — chunking: {len(chunks)} chunk(s) of ≤{settings.CHUNK_SIZE}"
        )

        t0 = time.monotonic()
        if len(chunks) == 1:
            responses = [self._generate_chunk_response(query, chunks[0], 1)]
        else:
            with ThreadPoolExecutor(
                max_workers=max(1, min(self.generation_workers, len(chunks))),
                thread_name_prefix="generate",
            ) as pool:
                # pool.map preserves input order, so responses stay chunk-ordered.
                responses = list(
                    pool.map(
                        lambda item: self._generate_chunk_response(query, item[1], item[0] + 1),
                        enumerate(chunks),
                    )
                )

        logger.info(
            "[PIPELINE] Step 5/6 — LLM generation: %s chunk(s) in %.1fs",
            len(responses),
            time.monotonic() - t0,
        )
        logger.info(
            "[PIPELINE] === Pipeline complete — total %.1fs ===",
            time.monotonic() - pipeline_start,
        )

        result = {
            "query": query,
            "total_docs_retrieved": len(all_docs),
            "num_chunks": len(chunks),
            "chunk_size": settings.CHUNK_SIZE,
            "responses": responses,
            "aggregate_faithfulness": aggregate_faithfulness(
                [response.get("evaluation") for response in responses]
            ),
        }
        if agent_result is not None and agent_result.notice:
            result["notice"] = agent_result.notice
            result["agent_outcome"] = agent_result.outcome.value
        return result

    def _collect_documents(self, query: str, queries: list[str], total: int):
        """Non-streaming document selection: drains :meth:`_select_documents`."""
        selection = self._select_documents(query, queries, total)
        while True:
            try:
                event = next(selection)
            except StopIteration as stop:
                return stop.value
            logger.info("[AGENT] %s", event.get("message"))

    # ── Streaming pipeline ────────────────────────────────────────────────────

    def main_pipeline_stream(
        self,
        query: str,
        cancel_event: Optional[threading.Event] = None,
    ):
        """
        Streaming version of main_pipeline.

        Yields SSE-style event dicts so the caller can relay progress and
        partial results to the browser as they happen.  This keeps the HTTP
        connection alive and eliminates proxy/gateway timeouts even when the
        full pipeline takes minutes.

        Event types
        -----------
        ``progress``     — pipeline stage started or completed.  ``step`` is
                           ``variants``, ``relevance`` (the agent's searching /
                           graded / refining / grader_unavailable signals),
                           ``retrieval`` or ``chunking``.
        ``chunk_start``  — a new chunk's LLM generation is about to begin
        ``chunk_token``  — one text token from the chunk's LLM stream
        ``chunk_end``    — chunk generation finished (docs attached, plus
                           ``evaluation`` when answer evaluation is enabled)
        ``complete``     — entire pipeline finished with summary stats,
                           ``aggregate_faithfulness`` and, when the agent has
                           something to report, ``notice`` + ``agent_outcome``
        ``error``        — unrecoverable error; the stream ends after this

        Chunks are generated concurrently but emitted strictly in chunk order,
        so the event sequence is identical to a sequential run while the wall
        clock is that of the slowest chunk.
        """
        pipeline_start = time.monotonic()

        def cancelled() -> bool:
            return cancel_event is not None and cancel_event.is_set()

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

        if cancelled():
            return

        # ── Step 2: Retrieve, fuse, cap ───────────────────────────────────
        yield {
            "type": "progress",
            "step": "retrieval",
            "status": "start",
            "message": f"Retrieving documents across {len(queries)} queries...",
        }

        t0 = time.monotonic()
        agent_result: Optional[AgentResult] = None
        try:
            total = self.dense_rag.count()
            if total == 0:
                # Reachable but unusable: report it instead of returning a
                # successful-looking empty result.
                yield {
                    "type": "error",
                    "message": (
                        f"The document collection '{self.dense_rag.collection_name}' "
                        f"is empty. Index documents before searching."
                    ),
                }
                return

            selection = self._select_documents(
                query, queries, total, cancel_event=cancel_event
            )
            while True:
                try:
                    yield next(selection)
                except StopIteration as stop:
                    all_docs, agent_result = stop.value
                    break
        except DependencyUnavailable as exc:
            logger.error("[PIPELINE] Retrieval unavailable: %s", exc)
            yield {"type": "error", "message": exc.user_message()}
            return
        except Exception as exc:
            logger.exception("[PIPELINE] Retrieval failed: %s", exc)
            yield {"type": "error", "message": f"Retrieval failed: {exc}"}
            return

        retrieval_elapsed = time.monotonic() - t0

        if agent_result is not None:
            message = (
                f"{len(all_docs)} related paper"
                f"{'s' if len(all_docs) != 1 else ''} selected from "
                f"{agent_result.kept + agent_result.rejected} candidates"
                if agent_result.filtered
                else f"Using {len(all_docs)} retrieval matches (unfiltered)"
            )
        else:
            message = f"Retrieved {len(all_docs)} unique documents"

        yield {
            "type": "progress",
            "step": "retrieval",
            "status": "done",
            "message": message,
            "count": len(all_docs),
            "elapsed_ms": round(retrieval_elapsed * 1000),
        }

        if cancelled():
            return

        if not all_docs:
            # Nothing related was found.  Deliberately no answer: generating one
            # from papers the agent judged unrelated is worse than saying so.
            complete = {
                "type": "complete",
                "total_docs_retrieved": 0,
                "num_chunks": 0,
                "elapsed_ms": round((time.monotonic() - pipeline_start) * 1000),
            }
            if agent_result is not None and agent_result.notice:
                complete["notice"] = agent_result.notice
                complete["agent_outcome"] = agent_result.outcome.value
            yield complete
            return

        if cancelled():
            return

        # ── Step 3: Chunk into groups of CHUNK_SIZE ───────────────────────
        chunks = self._chunk_documents(all_docs)

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

        # ── Step 4: Generate answers (concurrently, emitted in order) ──────
        producers = [
            functools.partial(
                self._generate_chunk_response_stream,
                query,
                chunk,
                index + 1,
                cancel_event,
            )
            for index, chunk in enumerate(chunks)
        ]

        evaluations: list[Optional[dict]] = []

        for event in stream_in_order(
            producers,
            max_workers=self.generation_workers,
            cancel_event=cancel_event,
        ):
            if isinstance(event, ProducerError):
                chunk_index = event.index + 1
                chunk = chunks[event.index]
                logger.error(
                    "[PIPELINE] Chunk %s/%s generation failed: %s",
                    chunk_index,
                    len(chunks),
                    event.exc,
                )
                yield {
                    "type": "chunk_start",
                    "chunk_index": chunk_index,
                    "num_docs_in_chunk": len(chunk),
                }
                yield {
                    "type": "chunk_end",
                    "chunk_index": chunk_index,
                    "num_docs_in_chunk": len(chunk),
                    "docs": chunk,
                    "generated_response": (
                        f"[Error generating response for chunk {chunk_index}]"
                    ),
                    "error": str(event.exc),
                }
            else:
                if event.get("type") == "chunk_end":
                    evaluations.append(event.get("evaluation"))
                yield event

        if cancelled():
            logger.info(
                "[PIPELINE] === Streaming pipeline cancelled after %.1fs ===",
                time.monotonic() - pipeline_start,
            )
            return

        # ── Final summary ─────────────────────────────────────────────────
        total_elapsed = time.monotonic() - pipeline_start
        logger.info(
            "[PIPELINE] === Streaming pipeline complete — total %.1fs ===",
            total_elapsed,
        )

        complete = {
            "type": "complete",
            "total_docs_retrieved": len(all_docs),
            "num_chunks": len(chunks),
            "chunk_size": settings.CHUNK_SIZE,
            "elapsed_ms": round(total_elapsed * 1000),
            "aggregate_faithfulness": aggregate_faithfulness(evaluations),
        }
        if agent_result is not None:
            complete["agent_outcome"] = agent_result.outcome.value
            if agent_result.notice:
                complete["notice"] = agent_result.notice
        yield complete

    # ── Readiness ─────────────────────────────────────────────────────────────

    def readiness(self, use_cache: bool = True) -> dict:
        """
        Probe every dependency the pipeline needs and report status.

        Results are cached briefly so an aggressive load-balancer probe cannot
        turn health checks into a load source of their own.
        """
        if use_cache:
            with self._readiness_lock:
                cached = self._readiness_cache
                if cached and time.monotonic() - cached[0] < self.readiness_cache_seconds:
                    return cached[1]

        # Single-flight: probes talk to the network, so a stalled dependency
        # must not accumulate one blocked prober per poll.  Concurrent callers
        # get the last known answer instead.
        if not self._probe_lock.acquire(blocking=False):
            with self._readiness_lock:
                cached = self._readiness_cache
            if cached:
                stale = dict(cached[1])
                stale["stale"] = True
                return stale
            return {
                "ready": False,
                "stale": True,
                "checks": {},
                "error": "A readiness probe is already running.",
            }

        try:
            return self._probe_dependencies()
        finally:
            self._probe_lock.release()

    def _probe_dependencies(self) -> dict:
        vector_store = chroma_settings.probe()
        embedder = self.dense_rag.probe_embedder()
        llm = {
            "ok": bool(settings.OPENROUTER_API_KEY),
            "base_url": settings.OPENROUTER_BASE_URL,
            "model": self.llm_service.model,
            "error": None if settings.OPENROUTER_API_KEY else "OPENROUTER_API_KEY is not set.",
        }

        report = {
            "ready": bool(vector_store["ok"] and embedder["ok"] and llm["ok"]),
            "checks": {
                "vector_store": vector_store,
                "embedder": embedder,
                "llm": llm,
            },
        }

        with self._readiness_lock:
            self._readiness_cache = (time.monotonic(), report)
        return report


# ── Lazy process-wide singleton ───────────────────────────────────────────────
# Building the pipeline at import time meant one missing environment variable
# (or an unreachable ChromaDB) broke the URL conf itself, so *every* endpoint —
# including the health check an orchestrator uses to decide whether to restart
# the container — returned a 500.  Construction is now deferred to the first
# request that needs it, and failures are not cached: fix the config or bring
# the dependency back up and the next request succeeds without a restart.

_rag_index: Optional[RAGIndex] = None
_rag_index_lock = threading.Lock()


def get_rag_index() -> RAGIndex:
    """Return the shared :class:`RAGIndex`, building it on first use."""
    global _rag_index
    if _rag_index is None:
        with _rag_index_lock:
            if _rag_index is None:
                try:
                    _rag_index = RAGIndex()
                except PipelineError:
                    raise
                except Exception as exc:
                    logger.exception("[PIPELINE] Initialization failed: %s", exc)
                    raise PipelineNotReady(
                        f"Pipeline initialization failed ({type(exc).__name__}: {exc})"
                    ) from exc
    return _rag_index


def reset_rag_index():
    """Drop the shared pipeline instance (used by tests)."""
    global _rag_index
    with _rag_index_lock:
        _rag_index = None
