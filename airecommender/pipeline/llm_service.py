from langchain_openrouter import ChatOpenRouter
from django.conf import settings
from typing import Optional
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
import logging
import json
import time
import hashlib
import threading

logger = logging.getLogger(__name__)

# ── LLM timeout / retry / cache constants ────────────────────────────────────
LLM_REQUEST_TIMEOUT = 120   # seconds per individual LLM HTTP request
LLM_CONNECT_TIMEOUT = 15    # seconds to establish a TCP connection
LLM_MAX_RETRIES = 2         # total attempts = 1 + retries
LLM_CACHE_TTL = 300         # cache TTL in seconds (5 minutes)
LLM_CACHE_MAX_SIZE = 512    # max number of cached responses


class OpenRouterService():
    default_model = settings.DEFAULT_LLM_MODEL
    base_url = settings.OPENROUTER_BASE_URL

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        if api_key is None:
            api_key = settings.OPENROUTER_API_KEY
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY not found in environment variables.")

        self.api_key = api_key
        self.model = model or self.default_model

        # ── Per-model LLM instance cache ──────────────────────────────────
        # Keyed by normalized model name so that generate_response(model=...)
        # actually switches to the correct model instead of always using the
        # default one (which was the old bug).
        self._llm_instances: dict = {}
        self._llm_lock = threading.Lock()

        # ── Response cache ────────────────────────────────────────────────
        # {cache_key: (monotonic_timestamp, response_text)}
        self._response_cache: dict = {}
        self._cache_lock = threading.Lock()

        # Pre-build the default model's LLM instance
        self.llm = self._get_or_build_llm(self.model)

        logger.info(
            "[LLM] OpenRouterService initialized — default_model=%r base_url=%r "
            "cache_ttl=%ss cache_max=%s",
            self.model,
            self.base_url,
            LLM_CACHE_TTL,
            LLM_CACHE_MAX_SIZE,
        )

    def from_settings(self):
        return self.__class__(model=self.model, api_key=self.api_key)

    # ── LLM instance helpers ──────────────────────────────────────────────────

    def _get_or_build_llm(self, model: str):
        """Return a cached LLM client for *model*, building it on first use."""
        model = self.normalize_model(model)
        with self._llm_lock:
            if model not in self._llm_instances:
                logger.info("[LLM] Building new LLM client for model=%r", model)
                self._llm_instances[model] = self._build_llm(
                    api_key=self.api_key, model=model
                )
            return self._llm_instances[model]

    def _build_llm(self, api_key: str, model: Optional[str] = None):
        model_name = self.normalize_model(model)

        logger.info(
            "[LLM] _build_llm: model=%r connect_timeout=%ss request_timeout=%ss",
            model_name,
            LLM_CONNECT_TIMEOUT,
            LLM_REQUEST_TIMEOUT,
        )

        # ── Try ChatOpenRouter first ──────────────────────────────────────
        # if ChatOpenRouter is not None:
        #     for key_name in ("api_key", "openai_api_key"):
        #         try:
        #             llm = ChatOpenRouter(
        #                 model=model_name,
        #                 temperature=settings.LLM_TEMPERATURE,
        #                 request_timeout=LLM_REQUEST_TIMEOUT,
        #                 **{key_name: api_key},
        #             )
        #             logger.info(
        #                 "[LLM] Created ChatOpenRouter — model=%r key_param=%r",
        #                 model_name,
        #                 key_name,
        #             )
        #             return llm
        #         except Exception as exc:
        #             logger.warning(
        #                 "[LLM] ChatOpenRouter(model=%r, %s=…) failed: %s",
        #                 model_name,
        #                 key_name,
        #                 exc,
        #             )
        #             continue

        # ── Fall back to ChatOpenAI ───────────────────────────────────────
        base_kwargs = {
            "model": model_name,
            "temperature": settings.LLM_TEMPERATURE,
            "request_timeout": LLM_REQUEST_TIMEOUT,
        }

        for base_url_key in ("base_url", "openai_api_base"):
            for key_name in ("api_key", "openai_api_key"):
                try:
                    llm = ChatOpenAI(
                        **base_kwargs,
                        **{base_url_key: self.base_url, key_name: api_key},
                    )
                    logger.info(
                        "[LLM] Created ChatOpenAI — model=%r base_url_key=%r key_param=%r",
                        model_name,
                        base_url_key,
                        key_name,
                    )
                    return llm
                except Exception as exc:
                    logger.warning(
                        "[LLM] ChatOpenAI(model=%r, %s=…, %s=…) failed: %s",
                        model_name,
                        base_url_key,
                        key_name,
                        exc,
                    )
                    continue

        logger.warning(
            "[LLM] All constructors exhausted — falling back to bare ChatOpenAI model=%r",
            model_name,
        )
        return ChatOpenAI(**base_kwargs)

    def normalize_model(self, model: Optional[str] = None) -> str:
        """Return the model name, falling back to the default."""
        return model or self.model or self.default_model

    # ── Response helpers ──────────────────────────────────────────────────────

    def build_response_instruction(
        self,
        system_instruction: str,
        response_schema: Optional[list[str]] = None,
    ) -> str:
        """Build the system instruction, optionally appending schema hints."""
        if response_schema:
            schema_hint = (
                "Respond with a JSON object containing these keys: "
                + ", ".join(response_schema)
                + "."
            )
            return f"{system_instruction}\n\n{schema_hint}"
        return system_instruction

    def coerce_text(self, response) -> str:
        if response is None:
            logger.warning("[LLM] coerce_text: response is None — returning empty string")
            return ""

        if isinstance(response, str):
            return response

        if hasattr(response, "content"):
            content = response.content

            if isinstance(content, str):
                return content

            if isinstance(content, list):
                return "\n".join(
                    item.get("text", str(item))
                    for item in content
                )

            return str(content)

        logger.debug("[LLM] coerce_text: falling back to str() for type=%s", type(response))
        return str(response)

    def ensure_json_response(
        self,
        response_text: str,
        response_schema_param=None,  # noqa: ARG002 — kept for API compatibility
        mime_type: str = "application/json",
    ) -> str:
        """Validate the response is valid JSON when the caller expects JSON."""
        if "json" in mime_type:
            try:
                json.loads(response_text)
                logger.debug(
                    "[LLM] Response is valid JSON (len=%s)", len(response_text)
                )
            except json.JSONDecodeError as exc:
                logger.warning(
                    "[LLM] Response is NOT valid JSON (len=%s): %s",
                    len(response_text),
                    exc,
                )
        return response_text

    # ── Cache helpers ─────────────────────────────────────────────────────────

    def _cache_key(
        self,
        prompt: str,
        system_instruction: str,
        model: str,
        response_schema: Optional[list[str]] = None,
    ) -> str:
        """Build a deterministic cache key from request parameters."""
        raw = (
            f"{prompt}|{system_instruction}|{model}|"
            f"{json.dumps(response_schema or [], sort_keys=True)}"
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _cache_get(self, key: str) -> Optional[str]:
        """Return a cached response if it exists and hasn't expired."""
        with self._cache_lock:
            entry = self._response_cache.get(key)
            if entry is None:
                return None
            timestamp, value = entry
            if time.monotonic() - timestamp > LLM_CACHE_TTL:
                del self._response_cache[key]
                logger.debug("[LLM] Cache entry expired (key=%s...)", key[:12])
                return None
            return value

    def _cache_set(self, key: str, value: str):
        """Store a response in the cache, evicting the oldest entry if at capacity."""
        with self._cache_lock:
            if len(self._response_cache) >= LLM_CACHE_MAX_SIZE:
                oldest_key = min(
                    self._response_cache,
                    key=lambda k: self._response_cache[k][0],
                )
                del self._response_cache[oldest_key]
                logger.debug(
                    "[LLM] Cache evicted oldest entry (max_size=%s)",
                    LLM_CACHE_MAX_SIZE,
                )
            self._response_cache[key] = (time.monotonic(), value)
            logger.debug(
                "[LLM] Cached response (key=%s... size=%s/%s)",
                key[:12],
                len(self._response_cache),
                LLM_CACHE_MAX_SIZE,
            )

    # ── Main entry point ──────────────────────────────────────────────────────

    # ── Streaming entry point ───────────────────────────────────────────────────

    def generate_response_stream(
        self,
        prompt: str,
        system_instruction_string: str = "Answer this prompt make sure answer that",
        model: Optional[str] = None,
        response_schema_param: Optional[list[str]] = None,
        timeout: int = LLM_REQUEST_TIMEOUT,
        max_retries: int = LLM_MAX_RETRIES,
    ):
        """
        Stream tokens from the LLM one at a time.

        Uses effective_llm.stream() under the hood so each token is yielded
        as it arrives from the provider — the caller can relay them to the
        browser immediately rather than buffering the whole response.

        Yields
        ------
        str
            Individual text tokens from the LLM response stream.
        """
        instruction = self.build_response_instruction(
            system_instruction_string,
            response_schema_param,
        )

        effective_model = self.normalize_model(model)
        effective_llm = (
            self._get_or_build_llm(effective_model)
            if model is not None and model != self.model
            else self.llm
        )

        messages = [
            SystemMessage(content=instruction),
            HumanMessage(content=prompt),
        ]

        logger.info(
            "[LLM] ▶  Streaming — model=%r prompt_len=%s timeout=%ss",
            effective_model,
            len(prompt),
            timeout,
        )

        t0 = time.monotonic()
        token_count = 0
        last_exc: Optional[Exception] = None

        for attempt in range(max_retries + 1):
            try:
                for chunk in effective_llm.stream(
                    messages,
                    config={"timeout": timeout},
                ):
                    token = self.coerce_text(chunk)
                    if token:
                        token_count += 1
                        yield token
                # If we get here, streaming finished without error
                elapsed = time.monotonic() - t0
                logger.info(
                    "[LLM] ✓  Stream finished — %.1fs, %s tokens, model=%r",
                    elapsed,
                    token_count,
                    effective_model,
                )
                return
            except Exception as exc:
                last_exc = exc
                elapsed = time.monotonic() - t0
                logger.warning(
                    "[LLM] ✗  Stream attempt %s/%s FAILED after %.1fs — %s: %s",
                    attempt + 1,
                    max_retries + 1,
                    elapsed,
                    type(exc).__name__,
                    exc,
                )
                if attempt < max_retries:
                    backoff = 2 ** attempt
                    logger.info(
                        "[LLM] ↻  Retrying stream in %ss (model=%r) …",
                        backoff,
                        effective_model,
                    )
                    time.sleep(backoff)
                else:
                    logger.error(
                        "[LLM] ✗  ALL %s STREAM ATTEMPTS EXHAUSTED after %.1fs.",
                        max_retries + 1,
                        time.monotonic() - t0,
                    )

        raise RuntimeError(
            f"LLM stream failed after {max_retries + 1} attempts: {last_exc}"
        )

    def generate_response(
            self,
            prompt: str,
            api_key: Optional[str] = None,  # noqa: ARG002 — kept for API compatibility
            model: Optional[str] = None,
            system_instruction_string: str = "Answer this prompt make sure answer that",
            response_schema_param: Optional[list[str]] = None,
            response_mime_type_param: str = "application/json",
            timeout: int = LLM_REQUEST_TIMEOUT,
            max_retries: int = LLM_MAX_RETRIES,
            use_cache: bool = True,
        ) -> str:
            """
            Call the LLM with caching, timeout, and automatic retry on transient failures.

            Parameters
            ----------
            timeout : int
                Seconds to wait for a single HTTP request to the LLM provider.
            max_retries : int
                Number of retries on transient errors (5xx, connection errors).
                Total attempts = 1 + max_retries.
            use_cache : bool
                When True (default), cache the response and return cached results
                for identical (prompt, system_instruction, model) tuples within
                the TTL window.
            """
            instruction = self.build_response_instruction(
                system_instruction_string,
                response_schema_param,
            )

            # ── Resolve the correct LLM instance ──────────────────────────
            # This was the old bug: *model* was accepted but never used —
            # generate_response always called self.llm (the default model).
            # Now we look up the correct LLM instance per model.
            effective_model = self.normalize_model(model)
            if model is not None and model != self.model:
                effective_llm = self._get_or_build_llm(effective_model)
                logger.debug(
                    "[LLM] Using model %r (overrides default %r)",
                    effective_model,
                    self.model,
                )
            else:
                effective_llm = self.llm

            # ── Check cache ───────────────────────────────────────────────
            cache_key = self._cache_key(
                prompt, instruction, effective_model, response_schema_param
            )

            if use_cache:
                cached = self._cache_get(cache_key)
                if cached is not None:
                    logger.info(
                        "[LLM] CACHE HIT — model=%r prompt_len=%s",
                        effective_model,
                        len(prompt),
                    )
                    return cached

            logger.info(
                "[LLM] CACHE MISS — model=%r prompt_len=%s prompt_head=%r",
                effective_model,
                len(prompt),
                prompt[:120].replace("\n", " "),
            )

            # ── Invoke with retry loop ────────────────────────────────────
            last_exc: Optional[Exception] = None
            t_total_start = time.monotonic()

            for attempt in range(max_retries + 1):
                try:
                    t0 = time.monotonic()
                    logger.info(
                        "[LLM] ▶  Attempt %s/%s — model=%r prompt_len=%s timeout=%ss",
                        attempt + 1,
                        max_retries + 1,
                        effective_model,
                        len(prompt),
                        timeout,
                    )

                    messages = [
                        SystemMessage(content=instruction),
                        HumanMessage(content=prompt),
                    ]

                    logger.debug(
                        "[LLM] Messages built — system_len=%s human_len=%s",
                        len(instruction),
                        len(prompt),
                    )

                    response = effective_llm.invoke(
                        messages,
                        config={
                            "timeout": timeout,
                        },
                    )

                    elapsed = time.monotonic() - t0
                    response_text = self.coerce_text(response)

                    logger.info(
                        "[LLM] ✓  Call succeeded in %.1fs (attempt %s/%s) "
                        "model=%r response_len=%s",
                        elapsed,
                        attempt + 1,
                        max_retries + 1,
                        effective_model,
                        len(response_text),
                    )

                    result = self.ensure_json_response(
                        response_text,
                        response_schema_param,
                        mime_type=response_mime_type_param,
                    )

                    # ── Cache successful result ───────────────────────────
                    if use_cache:
                        self._cache_set(cache_key, result)

                    total_elapsed = time.monotonic() - t_total_start
                    logger.info(
                        "[LLM] Total call time: %.1fs (including cache miss + retries)",
                        total_elapsed,
                    )

                    return result

                except Exception as exc:
                    last_exc = exc
                    elapsed = time.monotonic() - t0
                    exc_type = type(exc).__name__

                    logger.warning(
                        "[LLM] ✗  Attempt %s/%s FAILED after %.1fs — %s: %s",
                        attempt + 1,
                        max_retries + 1,
                        elapsed,
                        exc_type,
                        exc,
                    )

                    if attempt < max_retries:
                        backoff = 2 ** attempt  # 1 s, 2 s, 4 s, …
                        logger.info(
                            "[LLM] ↻  Retrying in %ss (model=%r) …",
                            backoff,
                            effective_model,
                        )
                        time.sleep(backoff)
                    else:
                        total_elapsed = time.monotonic() - t_total_start
                        logger.error(
                            "[LLM] ✗  ALL %s ATTEMPTS EXHAUSTED after %.1fs. "
                            "model=%r last_error=%s: %s",
                            max_retries + 1,
                            total_elapsed,
                            effective_model,
                            exc_type,
                            last_exc,
                        )

            raise RuntimeError(
                f"LLM call failed after {max_retries + 1} attempts: {last_exc}"
            )
