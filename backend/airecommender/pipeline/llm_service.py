import hashlib
import json
import logging
import threading
import time
from typing import Optional

from django.conf import settings
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from airecommender.pipeline.errors import LLMUnavailable

logger = logging.getLogger(__name__)


def _setting(name: str, default):
    """Read a tunable from Django settings, falling back to *default*."""
    return getattr(settings, name, default)


# ── LLM timeout / retry / cache defaults ─────────────────────────────────────
# All overridable from settings (and therefore from the environment).
LLM_REQUEST_TIMEOUT = 120   # seconds per LLM HTTP request (answer generation)
LLM_TRANSFORM_TIMEOUT = 30  # seconds for short query-transform calls
LLM_MAX_RETRIES = 2         # our own retries; total attempts = 1 + retries
LLM_CACHE_TTL = 900         # cache TTL in seconds
LLM_CACHE_MAX_SIZE = 512    # max number of cached responses

# HTTP statuses worth retrying.  Everything else (400 bad request, 401 bad key,
# 403, 404 unknown model) is permanent: retrying only multiplies the latency of
# a request that can never succeed.
RETRYABLE_STATUS_CODES = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 522, 524, 529})

# Transport-level failures rarely carry a status code, so fall back to the
# exception's class name.
_RETRYABLE_NAME_HINTS = (
    "timeout",
    "connection",
    "ratelimit",
    "overload",
    "unavailable",
    "protocolerror",
    "readerror",
    "writeerror",
    "incompleteread",
    "streamclosed",
)

_RETRYABLE_MESSAGE_HINTS = (
    "timed out",
    "connection reset",
    "connection aborted",
    "temporarily unavailable",
    "try again",
    "overloaded",
    "bad gateway",
)


def response_status_code(exc: BaseException) -> Optional[int]:
    """Best-effort extraction of an HTTP status code from *exc*."""
    for attr in ("status_code", "http_status", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value

    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int):
        return status
    return None


def is_retryable_error(exc: BaseException) -> bool:
    """
    Decide whether *exc* is a transient failure worth another attempt.

    A status code is authoritative when present: a 401 or 400 will fail
    identically on every retry, so we surface it immediately instead of
    spending two more timeouts on it.
    """
    status = response_status_code(exc)
    if status is not None:
        return status in RETRYABLE_STATUS_CODES

    name = type(exc).__name__.lower()
    if any(hint in name for hint in _RETRYABLE_NAME_HINTS):
        return True

    message = str(exc).lower()
    return any(hint in message for hint in _RETRYABLE_MESSAGE_HINTS)


class OpenRouterService:
    default_model = None  # resolved lazily from settings

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        if api_key is None:
            api_key = settings.OPENROUTER_API_KEY
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY not found in environment variables.")

        self.api_key = api_key
        self.base_url = settings.OPENROUTER_BASE_URL
        self.default_model = settings.DEFAULT_LLM_MODEL
        self.model = model or self.default_model

        self.request_timeout = int(_setting("LLM_REQUEST_TIMEOUT", LLM_REQUEST_TIMEOUT))
        self.transform_timeout = int(_setting("LLM_TRANSFORM_TIMEOUT", LLM_TRANSFORM_TIMEOUT))
        self.max_retries = int(_setting("LLM_MAX_RETRIES", LLM_MAX_RETRIES))
        self.cache_ttl = int(_setting("LLM_CACHE_TTL", LLM_CACHE_TTL))
        self.cache_max_size = int(_setting("LLM_CACHE_MAX_SIZE", LLM_CACHE_MAX_SIZE))

        # ── LLM instance cache, keyed by (model, timeout) ──────────────────
        # The timeout is part of the key because LangChain drops a per-call
        # ``config={"timeout": ...}`` on the floor — RunnableConfig has no such
        # key.  The only timeout that actually reaches the HTTP client is the
        # one bound at construction time, so each distinct timeout needs its
        # own client instance.
        self._llm_instances: dict = {}
        self._llm_lock = threading.Lock()

        # ── Response cache ────────────────────────────────────────────────
        # {cache_key: (monotonic_timestamp, response_text)}
        self._response_cache: dict = {}
        self._cache_lock = threading.Lock()

        # Pre-build the default model's client so the first request doesn't pay
        # for it.
        self.llm = self._get_or_build_llm(self.model, self.request_timeout)

        logger.info(
            "[LLM] OpenRouterService initialized — default_model=%r base_url=%r "
            "request_timeout=%ss transform_timeout=%ss retries=%s cache_ttl=%ss cache_max=%s",
            self.model,
            self.base_url,
            self.request_timeout,
            self.transform_timeout,
            self.max_retries,
            self.cache_ttl,
            self.cache_max_size,
        )

    def from_settings(self):
        return self.__class__(model=self.model, api_key=self.api_key)

    # ── LLM instance helpers ──────────────────────────────────────────────────

    def _get_or_build_llm(self, model: str, timeout: int):
        """Return a cached LLM client for (*model*, *timeout*)."""
        model = self.normalize_model(model)
        key = (model, int(timeout))
        with self._llm_lock:
            if key not in self._llm_instances:
                logger.info(
                    "[LLM] Building LLM client — model=%r timeout=%ss", model, timeout
                )
                self._llm_instances[key] = self._build_llm(
                    api_key=self.api_key, model=model, timeout=timeout
                )
            return self._llm_instances[key]

    def _build_llm(self, api_key: str, model: Optional[str] = None, timeout: int = LLM_REQUEST_TIMEOUT):
        model_name = self.normalize_model(model)

        kwargs = {
            "model": model_name,
            "temperature": settings.LLM_TEMPERATURE,
            "request_timeout": timeout,
            # The OpenAI SDK retries twice on its own by default.  Stacked on
            # our retry loop that is up to 9 HTTP requests for a single call —
            # ~18 minutes of wall clock at a 120 s timeout, long past the
            # proxy's read timeout.  We own retries; the SDK must not.
            "max_retries": 0,
            "openai_api_base": self.base_url,
            "openai_api_key": api_key,
        }

        try:
            return ChatOpenAI(**kwargs)
        except TypeError as exc:
            # Older/newer langchain-openai releases renamed these fields.
            logger.warning(
                "[LLM] ChatOpenAI rejected canonical kwargs (%s) — retrying with aliases",
                exc,
            )
            kwargs["base_url"] = kwargs.pop("openai_api_base")
            kwargs["api_key"] = kwargs.pop("openai_api_key")
            return ChatOpenAI(**kwargs)

    def normalize_model(self, model: Optional[str] = None) -> str:
        """Return the model name, falling back to the default."""
        return model or self.model or self.default_model

    def _resolve_llm(self, model: Optional[str], timeout: int):
        """Return (effective_model, client) for a call."""
        effective_model = self.normalize_model(model)
        return effective_model, self._get_or_build_llm(effective_model, timeout)

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
                parts = []
                for item in content:
                    if isinstance(item, dict):
                        # Reasoning models emit non-text blocks (thinking,
                        # tool calls); only textual parts belong in the answer.
                        text = item.get("text")
                        if text:
                            parts.append(text)
                    elif isinstance(item, str):
                        parts.append(item)
                return "".join(parts)

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
            if time.monotonic() - timestamp > self.cache_ttl:
                del self._response_cache[key]
                logger.debug("[LLM] Cache entry expired (key=%s...)", key[:12])
                return None
            return value

    def _cache_set(self, key: str, value: str):
        """Store a response, evicting the oldest entry when at capacity."""
        with self._cache_lock:
            if len(self._response_cache) >= self.cache_max_size:
                oldest_key = min(
                    self._response_cache,
                    key=lambda k: self._response_cache[k][0],
                )
                del self._response_cache[oldest_key]
                logger.debug(
                    "[LLM] Cache evicted oldest entry (max_size=%s)",
                    self.cache_max_size,
                )
            self._response_cache[key] = (time.monotonic(), value)

    # ── Streaming entry point ────────────────────────────────────────────────

    def generate_response_stream(
        self,
        prompt: str,
        system_instruction_string: str = "Answer this prompt make sure answer that",
        model: Optional[str] = None,
        response_schema_param: Optional[list[str]] = None,
        timeout: Optional[int] = None,
        max_retries: Optional[int] = None,
        cancel_event=None,
    ):
        """
        Stream tokens from the LLM one at a time.

        Retries only ever happen *before the first token* is emitted.  Once the
        caller has seen output, restarting the stream would replay the answer
        from the beginning and the client would render the text twice, so a
        mid-stream failure ends the stream instead.

        Pass *cancel_event* (a ``threading.Event``) to abandon a stream early —
        checked between tokens, so an aborted browser request stops billing
        within one token instead of running to completion.

        Yields
        ------
        str
            Individual text tokens from the LLM response stream.
        """
        instruction = self.build_response_instruction(
            system_instruction_string,
            response_schema_param,
        )
        effective_timeout = int(timeout or self.request_timeout)
        attempts_allowed = (self.max_retries if max_retries is None else max_retries) + 1

        effective_model, effective_llm = self._resolve_llm(model, effective_timeout)

        messages = [
            SystemMessage(content=instruction),
            HumanMessage(content=prompt),
        ]

        logger.info(
            "[LLM] ▶  Streaming — model=%r prompt_len=%s timeout=%ss",
            effective_model,
            len(prompt),
            effective_timeout,
        )

        t0 = time.monotonic()
        token_count = 0
        last_exc: Optional[BaseException] = None

        for attempt in range(attempts_allowed):
            try:
                for chunk in effective_llm.stream(messages):
                    if cancel_event is not None and cancel_event.is_set():
                        logger.info(
                            "[LLM] ⨯  Stream cancelled by caller after %s tokens (%.1fs)",
                            token_count,
                            time.monotonic() - t0,
                        )
                        return
                    token = self.coerce_text(chunk)
                    if token:
                        token_count += 1
                        yield token

                logger.info(
                    "[LLM] ✓  Stream finished — %.1fs, %s tokens, model=%r",
                    time.monotonic() - t0,
                    token_count,
                    effective_model,
                )
                return

            except Exception as exc:
                last_exc = exc
                elapsed = time.monotonic() - t0
                logger.warning(
                    "[LLM] ✗  Stream attempt %s/%s FAILED after %.1fs (%s tokens in) — %s: %s",
                    attempt + 1,
                    attempts_allowed,
                    elapsed,
                    token_count,
                    type(exc).__name__,
                    exc,
                )

                if token_count:
                    # Partial output already reached the client; replaying it
                    # would render the answer twice.  Surface the failure so the
                    # caller can flag the chunk, and keep the tokens delivered
                    # so far — but never re-stream them.
                    logger.error(
                        "[LLM] ✗  Stream died after partial output — not retrying "
                        "(would duplicate %s tokens)",
                        token_count,
                    )
                    raise LLMUnavailable(
                        f"LLM stream ended early after {token_count} tokens "
                        f"({type(exc).__name__}: {exc})"
                    ) from exc

                retryable = is_retryable_error(exc)
                if attempt < attempts_allowed - 1 and retryable:
                    backoff = 2 ** attempt
                    logger.info("[LLM] ↻  Retrying stream in %ss (model=%r)…", backoff, effective_model)
                    time.sleep(backoff)
                    continue

                if not retryable:
                    logger.error(
                        "[LLM] ✗  Permanent stream error (%s) — not retrying",
                        type(exc).__name__,
                    )
                break

        raise LLMUnavailable(
            f"LLM stream failed ({type(last_exc).__name__}: {last_exc})"
        )

    # ── Main entry point ──────────────────────────────────────────────────────

    def generate_response(
        self,
        prompt: str,
        api_key: Optional[str] = None,  # noqa: ARG002 — kept for API compatibility
        model: Optional[str] = None,
        system_instruction_string: str = "Answer this prompt make sure answer that",
        response_schema_param: Optional[list[str]] = None,
        response_mime_type_param: str = "application/json",
        timeout: Optional[int] = None,
        max_retries: Optional[int] = None,
        use_cache: bool = True,
    ) -> str:
        """
        Call the LLM with caching, timeout, and retry on *transient* failures.

        Parameters
        ----------
        timeout : int | None
            Seconds to wait for a single HTTP request.  Bound to the client at
            construction time (LangChain ignores per-call timeouts), so each
            distinct value gets its own cached client.
        max_retries : int | None
            Retries on transient errors only — permanent failures (4xx other
            than 408/409/425/429) are surfaced on the first attempt.
        use_cache : bool
            Serve identical (prompt, instruction, model) calls from the
            in-process cache within the TTL window.
        """
        instruction = self.build_response_instruction(
            system_instruction_string,
            response_schema_param,
        )
        effective_timeout = int(timeout or self.request_timeout)
        attempts_allowed = (self.max_retries if max_retries is None else max_retries) + 1

        effective_model, effective_llm = self._resolve_llm(model, effective_timeout)

        # ── Check cache ───────────────────────────────────────────────────
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

        messages = [
            SystemMessage(content=instruction),
            HumanMessage(content=prompt),
        ]

        last_exc: Optional[BaseException] = None
        t_total_start = time.monotonic()

        for attempt in range(attempts_allowed):
            t0 = time.monotonic()
            try:
                logger.info(
                    "[LLM] ▶  Attempt %s/%s — model=%r prompt_len=%s timeout=%ss",
                    attempt + 1,
                    attempts_allowed,
                    effective_model,
                    len(prompt),
                    effective_timeout,
                )

                response = effective_llm.invoke(messages)

                response_text = self.coerce_text(response)
                logger.info(
                    "[LLM] ✓  Call succeeded in %.1fs (attempt %s/%s) model=%r response_len=%s",
                    time.monotonic() - t0,
                    attempt + 1,
                    attempts_allowed,
                    effective_model,
                    len(response_text),
                )

                result = self.ensure_json_response(
                    response_text,
                    response_schema_param,
                    mime_type=response_mime_type_param,
                )

                if use_cache:
                    self._cache_set(cache_key, result)

                return result

            except Exception as exc:
                last_exc = exc
                exc_type = type(exc).__name__
                logger.warning(
                    "[LLM] ✗  Attempt %s/%s FAILED after %.1fs — %s: %s",
                    attempt + 1,
                    attempts_allowed,
                    time.monotonic() - t0,
                    exc_type,
                    exc,
                )

                retryable = is_retryable_error(exc)
                if attempt < attempts_allowed - 1 and retryable:
                    backoff = 2 ** attempt  # 1 s, 2 s, 4 s, …
                    logger.info("[LLM] ↻  Retrying in %ss (model=%r)…", backoff, effective_model)
                    time.sleep(backoff)
                    continue

                if not retryable:
                    logger.error(
                        "[LLM] ✗  Permanent error (%s: %s) — not retrying",
                        exc_type,
                        exc,
                    )
                else:
                    logger.error(
                        "[LLM] ✗  ALL %s ATTEMPTS EXHAUSTED after %.1fs. model=%r last_error=%s: %s",
                        attempts_allowed,
                        time.monotonic() - t_total_start,
                        effective_model,
                        exc_type,
                        exc,
                    )
                break

        raise LLMUnavailable(
            f"LLM call failed ({type(last_exc).__name__}: {last_exc})"
        )


# ── Process-wide singleton ───────────────────────────────────────────────────
# One service per process means one response cache and one pool of HTTP
# connections, instead of a separate cache per query-transform module.

_service: Optional[OpenRouterService] = None
_service_lock = threading.Lock()


def get_llm_service() -> OpenRouterService:
    """Return the shared :class:`OpenRouterService`, building it on first use."""
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = OpenRouterService()
    return _service


def reset_llm_service():
    """Drop the shared service (used by tests and settings reloads)."""
    global _service
    with _service_lock:
        _service = None
