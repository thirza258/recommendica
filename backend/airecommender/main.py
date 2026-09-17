import copy
import functools
import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Optional

from django.conf import settings

from airecommender.pipeline.adaptive import plan_research
from airecommender.pipeline.agent.answer_review import DEEP_GENERATION_INSTRUCTION, review_answer
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
from airecommender.pipeline.modes import SearchMode
from airecommender.pipeline.ordered_stream import ProducerError, stream_in_order
from airecommender.pipeline.prompting import build_chunk_prompt
from airecommender.pipeline.query_transform.hyde_rag import generate_hypothetical_abstract
from airecommender.pipeline.query_transform.rag_fusion import generate_query_variants
from airecommender.pipeline.query_transform.step_back import step_back
from airecommender.pipeline.sources.arxiv_api import ArxivClient, ArxivUnavailable
from airecommender.pipeline.verification import QueryVerdict, verify_query, verify_results

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
        self.generation_options = {}
        self.response_mode = None
        self.research_plan = None
        self._adaptive_limits = None
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

        # ── Live arXiv fallback ───────────────────────────────────────────
        # Consulted by the relevance agent when the indexed collection cannot
        # supply AGENT_MIN_RELEVANT_DOCS related papers.  It needs the agent:
        # the grader is what keeps live results to the same standard as local
        # ones, so with the agent off there is nothing to enforce it.
        self.enable_arxiv_fallback = bool(_setting("ENABLE_ARXIV_FALLBACK", True))
        self.arxiv_client = None
        if self.enable_arxiv_fallback:
            try:
                self.arxiv_client = ArxivClient()
            except Exception as exc:  # noqa: BLE001
                # An optional extra must not be able to stop the pipeline from
                # starting: without it every request would 503, when the local
                # collection could have served them all.
                logger.error(
                    "[PIPELINE] arXiv fallback disabled — client setup failed: %s",
                    exc,
                )
        if self.enable_arxiv_fallback and not self.enable_agent:
            logger.warning(
                "[PIPELINE] ENABLE_ARXIV_FALLBACK is on but the relevance agent "
                "is off — the fallback stays disabled, because nothing would "
                "grade what it returns."
            )

        # ── Boundary checks ───────────────────────────────────────────────
        self.enable_query_verification = bool(_setting("ENABLE_QUERY_VERIFICATION", True))
        self.query_verification_timeout = int(_setting("QUERY_VERIFICATION_TIMEOUT", 15))
        self.query_min_chars = int(_setting("QUERY_MIN_CHARS", 2))
        self.query_max_chars = int(_setting("QUERY_MAX_CHARS", 1000))
        self.enable_result_verification = bool(_setting("ENABLE_RESULT_VERIFICATION", True))

        self._readiness_cache: Optional[tuple[float, dict]] = None
        self._readiness_lock = threading.Lock()
        self._probe_lock = threading.Lock()

        logger.info(
            "[PIPELINE] RAGIndex ready — transforms(hyde=%s step_back=%s fusion=%s) "
            "max_context_docs=%s chunk_size=%s generation_workers=%s "
            "relevance_agent=%s(model=%r iterations=%s min_relevant=%s) "
            "answer_evaluation=%s arxiv_fallback=%s query_check=%s result_check=%s",
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
            self._fallback_enabled,
            self.enable_query_verification,
            self.enable_result_verification,
        )

    @property
    def _fallback_enabled(self) -> bool:
        """The live source is only usable when the grader is there to check it."""
        return bool(self.enable_arxiv_fallback and self.enable_agent and self.arxiv_client)

    @property
    def _uses_evidence_review(self) -> bool:
        return self.response_mode in {SearchMode.DEEP.value, SearchMode.ADAPTIVE.value}

    def for_mode(self, mode: str):
        """Make a request-local profile while sharing clients and their caches.

        Never change the singleton's flags: searches may run at the same time.
        Adaptive selects steps per question and retrieval; legacy Python calls
        without a mode retain the deployment's ENABLE_* configuration.
        """
        mode = SearchMode(mode)
        request_index = copy.copy(self)
        request_index.response_mode = mode.value
        request_index.research_plan = None
        deep = mode is SearchMode.DEEP
        adaptive = mode is SearchMode.ADAPTIVE
        request_index.enable_hyde = deep
        request_index.enable_step_back = deep
        request_index.enable_rag_fusion = deep
        request_index.enable_query_verification = True
        request_index.enable_result_verification = True
        request_index.enable_agent = True
        request_index.enable_arxiv_fallback = deep or adaptive
        request_index.enable_answer_evaluation = deep or adaptive
        request_index.generation_options = dict(self.generation_options)
        if deep or adaptive:
            request_index.agent_max_iterations = max(2, self.agent_max_iterations)
            if request_index.arxiv_client is None:
                try:
                    request_index.arxiv_client = ArxivClient()
                except Exception:
                    logger.exception("[PIPELINE] Could not configure optional arXiv source")
        else:
            # One original-query search, one relevance call, one answer. Keep
            # the grader so speed never means answering from rejected papers.
            request_index.max_context_docs = max(
                1, min(self.max_context_docs, settings.CHUNK_SIZE, 5)
            )
            request_index.agent_grade_candidates = max(1, min(self.agent_grade_candidates, 10))
            request_index.agent_max_iterations = 1
            request_index.agent_min_relevant = min(
                self.agent_min_relevant, request_index.max_context_docs
            )
            request_index.agent_timeout = min(self.agent_timeout, 15)
            request_index.generation_options = {
                "timeout": min(int(_setting("LLM_REQUEST_TIMEOUT", 120)), 60),
                "max_retries": 0,
            }
        if adaptive:
            request_index._adaptive_limits = {
                "docs": self.max_context_docs, "candidates": self.agent_grade_candidates,
            }
            request_index.agent_max_iterations = 2
            request_index.agent_timeout = min(self.agent_timeout, 15)
            request_index.generation_options = {
                "timeout": min(int(_setting("LLM_REQUEST_TIMEOUT", 120)), 60),
                "max_retries": 0,
            }
        return request_index

    def _apply_research_plan(self, plan):
        """Only request copies call this; shared clients and flags stay intact."""
        self.research_plan = plan
        self.enable_hyde = plan.hyde
        self.enable_step_back = plan.step_back
        self.enable_rag_fusion = plan.fusion
        limits = self._adaptive_limits
        self.max_context_docs = max(1, limits["docs"] if plan.expanded else min(
            limits["docs"], settings.CHUNK_SIZE, 5
        ))
        self.agent_grade_candidates = max(
            1, limits["candidates"] if plan.expanded else min(limits["candidates"], 10)
        )
        self.agent_min_relevant = min(
            int(_setting("AGENT_MIN_RELEVANT_DOCS", 3)), self.max_context_docs
        )

    def _plan_progress(self):
        return {
            "type": "progress", "step": "adaptive",
            "status": "expanded" if self.research_plan.expanded else "focused",
            "message": self.research_plan.reason,
            "research_plan": self.research_plan.as_payload(),
        }

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

        rerank = self.response_mode != SearchMode.FAST.value and (
            self.research_plan is None or self.research_plan.expanded
        )
        if rerank and (
            self.dense_rag.rerank_model or self.dense_rag.cross_encoder
        ):
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

    def _build_agent(self, query: str, total: int, cancel_event=None) -> RelevanceAgent:
        """
        Wire the agent to this request's retrieval, grading and refinement.

        Grading and refinement both run with ``max_retries=0`` and their own
        timeout (see :mod:`agent.grading`): they sit inside a bounded loop, so a
        retry storm would blow the loop's wall-clock deadline.
        """

        retrieval_round = 0

        def retrieve(queries: list[str]) -> list[dict]:
            nonlocal retrieval_round
            if cancel_event is not None and cancel_event.is_set():
                return []
            retrieval_round += 1
            if self.research_plan is not None and retrieval_round > 1:
                # This round exists only because graded evidence was weak.
                # Expand the refined query; keep the first round's graded pool.
                queries = self._build_query_variants(queries[0])
            if cancel_event is not None and cancel_event.is_set():
                return []
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
            if self.research_plan is not None:
                self._apply_research_plan(self.research_plan.broaden())
                agent.max_docs = self.max_context_docs
                agent.min_relevant = self.agent_min_relevant
            refined = refine_query(
                original_query,
                attempted_query,
                reasons,
                self.llm_service,
                model=self.agent_model,
                timeout=self.agent_timeout,
            )
            # Adaptive can still search alternate concepts if rewriting fails.
            return refined or (original_query if self.research_plan is not None else None)

        def weak_evidence(candidates):
            report = self._verify_results(query, candidates, None) or {}
            confidence = report.get("retrieval_confidence")
            # Keyword overlap alone is not enough: relevant sources may use
            # different terminology. Both available signals must be weak.
            return (
                confidence is not None
                and confidence < report.get("confidence_threshold", 0.5)
                and report.get("query_term_coverage", 1) < 0.5
            )

        agent = RelevanceAgent(
            retrieve,
            grade,
            refine,
            self._arxiv_fallback if self._fallback_enabled else None,
            min_relevant=self.agent_min_relevant,
            max_iterations=self.agent_max_iterations,
            threshold=self.agent_threshold,
            max_docs=self.max_context_docs,
            deadline_seconds=self.agent_deadline,
            needs_more_fn=weak_evidence if self.research_plan is not None else None,
        )
        return agent

    def _arxiv_fallback(self, query: str, budget: float) -> list[dict]:
        """
        The agent's live source: search arXiv for *query* within *budget*.

        Returns candidates in the same shape as retrieval; the agent grades all
        of them before any can reach an answer.

        Raises :class:`ArxivUnavailable` when the source could not be consulted
        — including when its client failed to build at startup.  Returning
        ``[]`` there would be reported to the user as "arXiv had nothing",
        which is a different (and false) statement about a source that was
        never contacted.
        """
        if self.arxiv_client is None:
            raise ArxivUnavailable("the arXiv client is not configured")
        return self.arxiv_client.search(query, budget=budget)

    # ── Boundary checks ───────────────────────────────────────────────────────

    def check_query(self, query: str) -> QueryVerdict:
        """
        Screen the query before spending anything on it.

        A rejection here saves three transform calls, a retrieval round trip, a
        grading call and one generation call per chunk.  The check fails open —
        see :mod:`verification.query_check`.
        """
        if not self.enable_query_verification:
            return QueryVerdict()

        return verify_query(
            query,
            None if self.response_mode == SearchMode.FAST.value or (
                self.research_plan is not None and not self.research_plan.expanded
            ) else self.llm_service,
            model=self.agent_model,
            timeout=self.query_verification_timeout,
            min_chars=self.query_min_chars,
            max_chars=self.query_max_chars,
        )

    def _verify_results(self, query: str, candidates, agent_result) -> Optional[dict]:
        """Describe the selected documents, or ``None`` when switched off."""
        if not self.enable_result_verification:
            return None
        return verify_results(
            query,
            candidates,
            agent_result=agent_result,
            min_relevant=self.agent_min_relevant,
        )

    @staticmethod
    def _rejected_query_result(query: str, verdict: QueryVerdict) -> dict:
        """The non-streaming shape for a query that never ran."""
        return {
            "query": query,
            "total_docs_retrieved": 0,
            "num_chunks": 0,
            "chunk_size": settings.CHUNK_SIZE,
            "responses": [],
            "aggregate_faithfulness": None,
            "notice": verdict.reason,
            "query_check": verdict.as_payload(),
        }

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
        ``(docs, AgentResult | None, verification | None)``.

        The verification report is built here, before :meth:`_strip_docs`,
        because it reads the retrieval signals (distance, source) that the wire
        shape deliberately drops.
        """
        if not self.enable_agent:
            candidates = self._fuse_documents(query, queries, total)
            verification = self._verify_results(query, candidates, None)
            return self._strip_docs(candidates), None, verification

        agent = self._build_agent(query, total, cancel_event)
        generator = agent.run(query, queries=queries, cancel_event=cancel_event)

        result = AgentResult()
        previous_plan = self.research_plan
        while True:
            try:
                event = next(generator)
            except StopIteration as stop:
                result = stop.value or AgentResult()
                break
            if self.research_plan != previous_plan:
                yield self._plan_progress()
                previous_plan = self.research_plan
            yield self._agent_progress(event)

        verification = self._verify_results(query, result.docs, result)
        return self._strip_docs(result.docs), result, verification

    def _chunk_documents(self, docs: list[dict]) -> list[list[dict]]:
        size = max(1, settings.CHUNK_SIZE)
        return [docs[i : i + size] for i in range(0, len(docs), size)]

    # ── Answer generation ─────────────────────────────────────────────────────

    def _build_chunk_prompt(self, query: str, chunk: list[dict], chunk_index: int):
        """Build the system + user prompt strings for a chunk."""
        system, prompt = build_chunk_prompt(query, chunk, chunk_index, self.max_doc_chars)
        if self._uses_evidence_review:
            system += "\n" + DEEP_GENERATION_INSTRUCTION
        return system, prompt

    def _review_deep_answer(self, query, answer, chunk, chunk_index, comparison_docs=(), cancel_event=None):
        review = review_answer(
            query, answer, chunk, self.llm_service,
            model=_setting("DEEP_REVIEW_MODEL", None) or self.agent_model,
            timeout=int(_setting("DEEP_REVIEW_TIMEOUT", 25)),
            repair_timeout=int(_setting("DEEP_REPAIR_TIMEOUT", 30)),
            deadline_seconds=float(_setting("DEEP_REVIEW_DEADLINE", 90)),
            max_doc_chars=self.max_doc_chars,
            comparison_docs=comparison_docs,
            cancel_event=cancel_event,
        )
        try:
            while True:
                try:
                    progress = next(review)
                except StopIteration as stop:
                    return stop.value
                yield {
                    **progress, "type": "progress", "step": "answer_review",
                    "chunk_index": chunk_index,
                }
        finally:
            review.close()

    def _generate_chunk_response(
        self,
        query: str,
        chunk: list[dict],
        chunk_index: int,
        comparison_docs=(),
    ) -> dict:
        """Non-streaming chunk generation — used by main_pipeline()."""
        system_prompt, user_prompt = self._build_chunk_prompt(query, chunk, chunk_index)

        try:
            response_text = self.llm_service.generate_response(
                prompt=user_prompt,
                system_instruction_string=system_prompt,
                response_mime_type_param="text/plain",
                **self.generation_options,
            )
        except Exception as exc:
            logger.error(f"[PIPELINE] LLM generation failed for chunk {chunk_index}: {exc}")
            return {
                "chunk_index": chunk_index,
                "num_docs_in_chunk": len(chunk),
                "docs": chunk,
                "generated_response": "",
                "error": "Answer generation failed. Please try again.",
            }

        response = {
            "chunk_index": chunk_index,
            "num_docs_in_chunk": len(chunk),
            "docs": chunk,
            "generated_response": response_text,
        }
        if self._uses_evidence_review:
            review = self._review_deep_answer(query, response_text, chunk, chunk_index, comparison_docs)
            while True:
                try:
                    next(review)
                except StopIteration as stop:
                    response.update(stop.value)
                    return response
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
        comparison_docs=(),
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
            **({"answer_review": {"status": "checking"}} if self._uses_evidence_review else {}),
        }

        t0 = time.monotonic()
        accumulated_tokens: list[str] = []
        error: Optional[str] = None

        try:
            for token in self.llm_service.generate_response_stream(
                prompt=user_prompt,
                system_instruction_string=system_prompt,
                cancel_event=cancel_event,
                **self.generation_options,
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
            if self._uses_evidence_review:
                # Make the answer and its papers usable immediately. The
                # grounding verdict follows independently; it must not hold
                # back this answer or another chunk's tokens.
                yield {**event, "answer_review": {"status": "checking"}}
                if cancel_event is not None and cancel_event.is_set():
                    return
                reviewed = yield from self._review_deep_answer(
                    query, full_response, chunk, chunk_index, comparison_docs, cancel_event
                )
                if cancel_event is not None and cancel_event.is_set():
                    return
                yield {
                    "type": "chunk_evaluation",
                    "chunk_index": chunk_index,
                    **reviewed,
                }
                return
            # Runs inside this chunk's own worker thread, so evaluations for
            # different chunks overlap rather than adding up.
            evaluation = self._evaluate_answer(
                query, full_response, chunk, chunk_index
            )
            if evaluation is not None:
                event["evaluation"] = evaluation
        yield event

    # ── Main pipeline (non-streaming) ─────────────────────────────────────────

    def _prepare_search(self, query: str, cancel_event=None):
        """Prepare the query and collection; overlap independent research steps.

        Cheap input guards run first. Adaptive chooses transformations and
        whether model classification is useful; Deep enables all of them.
        These tasks overlap the collection check. Retrieval still waits for
        query acceptance, so a rejected question is never answered.
        """
        guarded = verify_query(
            query, min_chars=self.query_min_chars, max_chars=self.query_max_chars
        )
        if self.enable_query_verification and not guarded.ok:
            return guarded, [], 0

        if self.response_mode == SearchMode.ADAPTIVE.value:
            self._apply_research_plan(plan_research(query))
            yield self._plan_progress()

        expand = self.enable_hyde or self.enable_step_back or self.enable_rag_fusion
        tasks = [
            ("query_check", lambda: self.check_query(query), "Checking the query..."),
            (
                "variants",
                lambda: self._build_query_variants(query),
                "Expanding the question to search from multiple angles..."
                if expand else "Preparing a focused search...",
            ),
            ("collection", self.dense_rag.count, "Connecting to the paper collection..."),
        ]
        results = {}

        def progress(name, value, elapsed):
            event = {
                "type": "progress", "step": name, "status": "done",
                "elapsed_ms": round(elapsed * 1000),
            }
            if name == "query_check":
                event.update(message="Query check complete", query_check=value.as_payload())
            elif name == "variants":
                event.update(
                    message=(
                        f"Generated {len(value)} query variants" if expand
                        else "Searching your question directly for a fast response"
                    ),
                    count=len(value), status="done" if expand else "skipped",
                )
            else:
                event.update(message="Paper collection ready")
            return event

        if self._uses_evidence_review:
            pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="research-prepare")
            started = time.monotonic()
            try:
                pending = {}
                for name, task, message in tasks:
                    yield {"type": "progress", "step": name, "status": "start", "message": message}
                    pending[pool.submit(task)] = name
                while pending:
                    if cancel_event is not None and cancel_event.is_set():
                        return QueryVerdict(), [], 0
                    done, _ = wait(pending, timeout=0.1, return_when=FIRST_COMPLETED)
                    for future in done:
                        name = pending.pop(future)
                        value = results[name] = future.result()
                        yield progress(name, value, time.monotonic() - started)
                        if name == "query_check" and not value.ok:
                            return value, [], 0
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        else:
            for name, task, message in tasks:
                if cancel_event is not None and cancel_event.is_set():
                    return QueryVerdict(), [], 0
                if name == "query_check" and not self.enable_query_verification:
                    results[name] = QueryVerdict()
                    continue
                yield {"type": "progress", "step": name, "status": "start", "message": message}
                started = time.monotonic()
                value = results[name] = task()
                yield progress(name, value, time.monotonic() - started)
                if name == "query_check" and not value.ok:
                    return value, [], 0

        return results["query_check"], results["variants"], results["collection"]

    def main_pipeline(self, query: str, *, mode: Optional[str] = None) -> dict:
        """
        End-to-end pipeline for a single user query.

        Flow
        ----
        0. Verify the query          (stop early if a search cannot answer it)
        1. Generate query variants   (HyDE, step-back, rag-fusion — concurrent)
        2. Dense retrieval           (one batched call, fused with RRF)
        3. Relevance agent           (grade, drop unrelated, refine and retry,
                                      then fall back to a live arXiv search)
        4. Verify the selection      (deterministic report on what was chosen)
        5. Chunk documents           (groups of settings.CHUNK_SIZE)
        6. Generate LLM response     (chunks generated concurrently)
        7. Return structured result
        """
        if mode is not None:
            request_index = self.for_mode(mode)
            result = request_index.main_pipeline(query)
            if request_index.research_plan is not None:
                result["research_plan"] = request_index.research_plan.as_payload()
            return {**result, "mode": request_index.response_mode}

        logger.info(f"[PIPELINE] === Starting main_pipeline for query: '{query[:100]}' ===")
        pipeline_start = time.monotonic()

        preparation = self._prepare_search(query)
        while True:
            try:
                next(preparation)
            except StopIteration as stop:
                verdict, queries, total = stop.value
                break
        if not verdict.ok:
            return self._rejected_query_result(query, verdict)

        t0 = time.monotonic()
        if total == 0:
            # Reachable but unusable — say so instead of returning an
            # empty result that looks like "nothing matched".
            raise VectorStoreUnavailable(
                f"The document collection '{self.dense_rag.collection_name}' is "
                f"empty. Index documents before searching."
            )
        all_docs, agent_result, verification = self._collect_documents(
            query, queries, total
        )
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
            if verification is not None:
                empty["verification"] = verification
            return empty

        chunks = self._chunk_documents(all_docs)
        logger.info(
            f"[PIPELINE] Step 4/6 — chunking: {len(chunks)} chunk(s) of ≤{settings.CHUNK_SIZE}"
        )

        t0 = time.monotonic()
        if len(chunks) == 1:
            responses = [self._generate_chunk_response(query, chunks[0], 1, all_docs)]
        else:
            with ThreadPoolExecutor(
                max_workers=max(1, min(self.generation_workers, len(chunks))),
                thread_name_prefix="generate",
            ) as pool:
                # pool.map preserves input order, so responses stay chunk-ordered.
                responses = list(
                    pool.map(
                        lambda item: self._generate_chunk_response(query, item[1], item[0] + 1, all_docs),
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
        if verification is not None:
            result["verification"] = verification
        if self._uses_evidence_review:
            result["answer_review"] = self._review_summary(responses)
            if result["answer_review"]["withheld"]:
                result["aggregate_faithfulness"] = None
        return result

    @staticmethod
    def _review_summary(responses):
        reviews = [response.get("answer_review", {}) for response in responses]
        accepted = {"checked", "limited"}
        return {
            "checked": sum(review.get("status") in accepted for review in reviews),
            "revised": sum(bool(review.get("revised")) for review in reviews),
            "limited": sum(review.get("status") == "limited" for review in reviews),
            "withheld": sum(review.get("status") not in accepted for review in reviews),
        }

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
        *,
        mode: Optional[str] = None,
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

        Deep mode emits chunks as soon as they are ready, identified by
        chunk_index. Its chunk_end carries a draft and papers immediately;
        chunk_evaluation follows with authoritative reviewed/revised text and
        supporting evidence. The final complete waits for all reviews. Legacy
        streams retain chunk order.
        """
        if mode is not None:
            request_index = self.for_mode(mode)
            pipeline = request_index.main_pipeline_stream(query, cancel_event=cancel_event)
            try:
                for event in pipeline:
                    if event["type"] == "complete" and request_index.research_plan is not None:
                        event = {**event, "research_plan": request_index.research_plan.as_payload()}
                    yield {**event, "mode": request_index.response_mode}
            finally:
                pipeline.close()
            return

        pipeline_start = time.monotonic()

        def cancelled() -> bool:
            return cancel_event is not None and cancel_event.is_set()

        if cancelled():
            return

        agent_result: Optional[AgentResult] = None
        verification: Optional[dict] = None
        try:
            verdict, queries, total = yield from self._prepare_search(query, cancel_event)
            if cancelled():
                return
            if not verdict.ok:
                yield {
                    "type": "complete",
                    "total_docs_retrieved": 0,
                    "num_chunks": 0,
                    "elapsed_ms": round((time.monotonic() - pipeline_start) * 1000),
                    "notice": verdict.reason,
                    "query_check": verdict.as_payload(),
                }
                return

            yield {
                "type": "progress",
                "step": "retrieval",
                "status": "start",
                "message": f"Retrieving documents across {len(queries)} queries...",
            }
            t0 = time.monotonic()
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
                    all_docs, agent_result, verification = stop.value
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

        # ── Verify the selection ──────────────────────────────────────────
        # Deterministic, so it is emitted whatever the outcome — including for
        # an empty selection, where "why is there no answer" is the question
        # the user actually has.
        if verification is not None:
            yield {
                "type": "progress",
                "step": "verification",
                "status": "done",
                "message": (
                    "; ".join(verification["warnings"])
                    if verification.get("warnings")
                    else f"{verification['docs']} paper(s) verified as the basis for the answer"
                ),
                "verification": verification,
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
            if verification is not None:
                complete["verification"] = verification
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
                all_docs,
            )
            for index, chunk in enumerate(chunks)
        ]

        evaluations: list[Optional[dict]] = []
        reviewed_chunks = {}

        for event in stream_in_order(
            producers,
            max_workers=self.generation_workers,
            cancel_event=cancel_event,
            ordered=not self._uses_evidence_review,
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
                if event.get("type") in ("chunk_end", "chunk_evaluation"):
                    evaluations.append(event.get("evaluation"))
                    reviewed_chunks[event["chunk_index"]] = event
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
        if verification is not None:
            complete["verification"] = verification
        if self._uses_evidence_review:
            complete["answer_review"] = self._review_summary([
                reviewed_chunks.get(i, {}) for i in range(1, len(chunks) + 1)
            ])
            if complete["answer_review"]["withheld"]:
                complete["aggregate_faithfulness"] = None
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
