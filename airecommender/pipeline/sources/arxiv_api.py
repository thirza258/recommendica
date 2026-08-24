"""
Live arXiv API search, used as a fallback when the local collection is thin.

The indexed ChromaDB collection is a fixed snapshot: a question about work it
never ingested retrieves nothing related, and the relevance agent correctly
refuses to answer from the unrelated papers it did find.  That is the right
behaviour for a wrong corpus, but the papers usually *do* exist — on arXiv.

So when the agent finishes short of ``AGENT_MIN_RELEVANT_DOCS``, it asks arXiv
directly.  Everything that comes back is graded by the same relevance grader as
local results before it can reach an answer, so the fallback widens the corpus
without weakening the verification around it.

Operational notes
-----------------
* **Politeness.** arXiv asks callers to identify themselves and to leave a few
  seconds between requests.  Requests are serialised through a process-wide
  slot reservation (``ARXIV_MIN_REQUEST_INTERVAL``) and carry a descriptive
  User-Agent.  Reservation happens under a lock but the waiting does not, so
  concurrent requests stagger instead of piling up on one held mutex.
* **Bounded.** Every call takes a wall-clock ``budget``; a request that cannot
  start inside it is skipped rather than queued.  The response is read with a
  byte cap before it is parsed.
* **Reachability is reported, not hidden.** A search that ran and matched
  nothing returns ``[]``.  A search that could not run at all — connection
  refused, timeout, HTTP error, open circuit breaker — raises
  :class:`ArxivUnavailable`, because those two outcomes call for different
  things to be said to the user, and because "the collection is the only
  source right now" is worth knowing.  The agent catches it and carries on
  with the local results either way: an unreachable fallback must never cost
  the user the papers ChromaDB *did* find.
* **Self-limiting.** Repeated failures trip a circuit breaker, so a downed API
  costs one timeout rather than one per request.

Only ``requests`` and the standard library are imported here, so the module can
be exercised without ChromaDB or Ollama installed.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import xml.etree.ElementTree as ElementTree
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def _setting(name: str, default):
    return getattr(settings, name, default)


class ArxivUnavailable(RuntimeError):
    """
    arXiv could not be consulted — as distinct from having nothing to offer.

    Deliberately *not* a :class:`~airecommender.pipeline.errors.DependencyUnavailable`:
    that class means "this request cannot be served", and an unreachable
    fallback means the opposite — serve the request from the local collection.
    """


# ── Atom / arXiv XML namespaces ───────────────────────────────────────────────
ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"
OPENSEARCH = "{http://a9.com/-/spec/opensearch/1.0/}"

DEFAULT_API_URL = "https://export.arxiv.org/api/query"

#: Read cap for a response body.  arXiv answers are tens of kilobytes; anything
#: past this is a malformed or hostile response and is rejected before parsing,
#: which is what keeps ElementTree's input bounded.
MAX_RESPONSE_BYTES = 4 * 1024 * 1024

#: Content terms per search.  arXiv ANDs them, so more terms means a narrower
#: search; past half a dozen the query starts excluding the papers it wants.
DEFAULT_MAX_QUERY_TERMS = 6

#: Dropped before building the search expression: function words, and the
#: "find me papers about…" scaffolding that surrounds the actual topic.  Kept
#: deliberately short — over-stripping loses the subject.
_STOPWORDS = frozenset(
    """
    a an the this that these those and or not but if then than so of in on at to
    for from with without into over under about across between is are was were be
    been being do does did done has have had having can could should would will
    shall may might must it its they them their there here what which who whom
    whose when where why how any some all most more much many few very
    i me my we us our you your he she his her
    paper papers article articles study studies research researches work works
    publication publications literature find show tell give list explain
    describe using use used based recent recently latest new state art please
    me impact
    """.split()
)

#: Search operators in arXiv's grammar.  A user term that happens to be one of
#: these would change the query's meaning, so they never survive tokenisation.
_OPERATORS = frozenset({"and", "or", "andnot", "not"})


# ── Query construction ────────────────────────────────────────────────────────


def extract_terms(query: str, max_terms: int = DEFAULT_MAX_QUERY_TERMS) -> list[str]:
    """
    Reduce free text to the content words arXiv should search for.

    Tokenising on ``[A-Za-z0-9]+`` is the escaping strategy: arXiv's
    ``search_query`` grammar gives meaning to quotes, parentheses, colons and
    the ``AND``/``OR``/``ANDNOT`` keywords, and a question like
    ``transformers: attention (2017)`` pasted in raw either 400s or matches
    nonsense.  Nothing that could be read as syntax survives this step, so no
    further escaping is needed.

    Order is preserved and duplicates are dropped, so the resulting query is
    deterministic for a given input.
    """
    tokens = re.findall(r"[A-Za-z0-9]+", str(query or "").lower())

    terms: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in _OPERATORS or token in _STOPWORDS:
            continue
        # Single characters carry no retrieval signal; two-character tokens do
        # ("ai", "ml", "3d"), so the floor is deliberately low.
        if len(token) < 2:
            continue
        if token in seen:
            continue
        seen.add(token)
        terms.append(token)
        if len(terms) >= max_terms:
            break

    if not terms:
        # Everything was filtered out (a query of pure stopwords). Fall back to
        # the longest raw tokens so the search is at least *about* something.
        # Ties break on first appearance, never on set iteration order — the
        # latter varies between processes and would silently make the same
        # question produce a different search on every run.
        first_seen: dict[str, int] = {}
        for position, token in enumerate(tokens):
            if len(token) >= 3 and token not in first_seen:
                first_seen[token] = position
        terms = sorted(first_seen, key=lambda t: (-len(t), first_seen[t]))[:max_terms]

    return terms


def build_search_query(
    query: str,
    max_terms: int = DEFAULT_MAX_QUERY_TERMS,
    operator: str = "AND",
) -> str:
    """
    Build an arXiv ``search_query`` expression from free text.

    Returns ``""`` when the query yields no usable terms, which the caller
    treats as "no search to run" rather than as a search for everything.
    """
    terms = extract_terms(query, max_terms)
    if not terms:
        return ""
    joiner = f" {operator.strip().upper()} "
    return joiner.join(f"all:{term}" for term in terms)


# ── Atom parsing ──────────────────────────────────────────────────────────────


def _text(element: Optional[ElementTree.Element]) -> str:
    """Whitespace-normalised text of an element, or ``""``."""
    if element is None or element.text is None:
        return ""
    return " ".join(element.text.split())


def _entry_to_candidate(entry: ElementTree.Element, rank: int) -> Optional[dict]:
    """
    Convert one Atom ``<entry>`` into a pipeline candidate.

    The ``document`` field is the same JSON record shape the ChromaDB
    collection stores (``title``/``category``/``summary``/``authors``), so
    :mod:`prompting` renders an arXiv paper and an indexed one identically and
    nothing downstream needs to know where a document came from.
    """
    title = _text(entry.find(f"{ATOM}title"))
    summary = _text(entry.find(f"{ATOM}summary"))
    if not title and not summary:
        return None

    authors = [
        name
        for name in (
            _text(author.find(f"{ATOM}name"))
            for author in entry.findall(f"{ATOM}author")
        )
        if name
    ]

    primary = entry.find(f"{ARXIV}primary_category")
    category = (primary.get("term") or "").strip() if primary is not None else ""
    if not category:
        first = entry.find(f"{ATOM}category")
        category = (first.get("term") or "").strip() if first is not None else ""

    categories = [
        term
        for term in (
            (node.get("term") or "").strip() for node in entry.findall(f"{ATOM}category")
        )
        if term
    ]

    abs_url = _text(entry.find(f"{ATOM}id"))
    pdf_url = ""
    for link in entry.findall(f"{ATOM}link"):
        if link.get("title") == "pdf" or link.get("type") == "application/pdf":
            pdf_url = (link.get("href") or "").strip()
            break

    # "http://arxiv.org/abs/2301.12345v1" → "2301.12345v1"
    arxiv_id = abs_url.rsplit("/", 1)[-1] if abs_url else ""

    # Match new Chroma schema document structure
    if title and summary:
        doc_text = f"Title: {title.strip()}\n\nAbstract: {summary.strip()}"
    elif title:
        doc_text = f"Title: {title.strip()}"
    else:
        doc_text = summary.strip()

    updated_str = _text(entry.find(f"{ATOM}updated"))
    published_str = _text(entry.find(f"{ATOM}published"))

    meta = {
        "id": arxiv_id,
        "title": title,
        "abstract": summary,
        "authors": ", ".join(authors),
        "categories": " ".join(categories) if categories else category,
        "primary_category": category,
        "source": "arxiv_api",
        "arxiv_id": arxiv_id,
        "url": abs_url,
        "pdf_url": pdf_url,
        "published": published_str,
        "updated": updated_str,
        "update_date": updated_str[:10] if updated_str else "",
    }

    parsed_authors = []
    for name in authors:
        parts = name.split()
        if len(parts) > 1:
            parsed_authors.append([parts[-1], " ".join(parts[:-1]), ""])
        elif parts:
            parsed_authors.append([parts[0], "", ""])
    if parsed_authors:
        meta["authors_parsed"] = json.dumps(parsed_authors)

    clean_meta = {k: v for k, v in meta.items() if v is not None and v != ""}

    return {
        "document": doc_text,
        "meta": clean_meta,
        "source": "arxiv_api",
        # Position in arXiv's own ranking. Deliberately *not* called
        # `dense_score`: no embedding was involved, and code that blends
        # retrieval signals must not mistake this for a vector similarity.
        "arxiv_rank": rank,
    }


def parse_atom_feed(payload: bytes | str) -> list[dict]:
    """
    Parse an arXiv Atom response into candidates, best first.

    Returns ``[]`` for malformed XML: a fallback source that cannot be parsed
    is indistinguishable, to the caller, from one that matched nothing.
    """
    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError as exc:
        logger.error("[ARXIV] Response was not valid XML: %s", exc)
        return []

    candidates = []
    for rank, entry in enumerate(root.findall(f"{ATOM}entry"), start=1):
        candidate = _entry_to_candidate(entry, rank)
        if candidate is not None:
            candidates.append(candidate)
    return candidates


# ── Process-wide request pacing ───────────────────────────────────────────────

_slot_lock = threading.Lock()
_next_slot_at = 0.0


def _reserve_slot(min_interval: float, budget: float) -> bool:
    """
    Claim the next request slot, waiting at most *budget* seconds for it.

    The lock is held only while the slot is reserved, never while waiting for
    it, so N concurrent callers stagger by *min_interval* instead of serialising
    on a mutex one of them is sleeping under.  Returns ``False`` when the wait
    would exceed the caller's budget — the fallback is optional, and a request
    that would blow the agent's deadline is better skipped than queued.
    """
    global _next_slot_at

    with _slot_lock:
        now = time.monotonic()
        earliest = max(now, _next_slot_at)
        wait = earliest - now
        if wait > max(0.0, budget):
            return False
        _next_slot_at = earliest + max(0.0, min_interval)

    if wait > 0:
        time.sleep(wait)
    return True


def reset_pacing():
    """Clear the pacing state (tests only)."""
    global _next_slot_at
    with _slot_lock:
        _next_slot_at = 0.0


# ── Client ────────────────────────────────────────────────────────────────────


class ArxivClient:
    """
    Thin, bounded, non-raising client for the arXiv query API.

    One instance per process (the pipeline holds it), so the circuit breaker
    state is shared across requests the way the rerank breaker in
    :class:`~airecommender.pipeline.dense_rag.DenseRAG` is.
    """

    def __init__(self):
        self.api_url = _setting("ARXIV_API_URL", DEFAULT_API_URL)
        self.max_results = int(_setting("ARXIV_FALLBACK_MAX_RESULTS", 10))
        self.timeout = float(_setting("ARXIV_FALLBACK_TIMEOUT", 15))
        self.min_interval = float(_setting("ARXIV_MIN_REQUEST_INTERVAL", 3.0))
        self.max_query_terms = int(_setting("ARXIV_MAX_QUERY_TERMS", DEFAULT_MAX_QUERY_TERMS))
        self.sort_by = _setting("ARXIV_SORT_BY", "relevance")
        self.user_agent = _setting(
            "ARXIV_USER_AGENT",
            "Recommendica/1.0 (research recommender; +https://recommendica.nevatal.tech)",
        )

        self._failures = 0
        self._blocked_until = 0.0
        self._breaker_threshold = int(_setting("ARXIV_BREAKER_THRESHOLD", 3))
        self._breaker_cooldown = float(_setting("ARXIV_BREAKER_COOLDOWN", 300))

    # ── Circuit breaker ──────────────────────────────────────────────────────

    def available(self) -> bool:
        """False while the breaker is open after repeated failures."""
        return time.monotonic() >= self._blocked_until

    def _record_failure(self):
        self._failures += 1
        if self._failures >= self._breaker_threshold:
            self._blocked_until = time.monotonic() + self._breaker_cooldown
            self._failures = 0
            logger.error(
                "[ARXIV] Fallback disabled for %.0fs after %s consecutive failures.",
                self._breaker_cooldown,
                self._breaker_threshold,
            )

    def _record_success(self):
        self._failures = 0

    # ── HTTP ─────────────────────────────────────────────────────────────────

    def _fetch(self, search_query: str, max_results: int, budget: float) -> bytes:
        """
        One paced, size-capped GET.

        Raises :class:`ArxivUnavailable` if the request could not be made or
        did not succeed; the caller turns that into "use the collection only".
        """
        if not _reserve_slot(self.min_interval, budget):
            logger.info(
                "[ARXIV] Skipped — next request slot is further away than the "
                "%.1fs budget left for it.",
                budget,
            )
            raise ArxivUnavailable(
                f"no request slot available within the {budget:.1f}s budget"
            )

        params = {
            "search_query": search_query,
            "start": 0,
            "max_results": max_results,
            "sortBy": self.sort_by,
            "sortOrder": "descending",
        }

        t0 = time.monotonic()
        try:
            with requests.get(
                self.api_url,
                params=params,
                timeout=self.timeout,
                stream=True,
                headers={"User-Agent": self.user_agent},
            ) as response:
                response.raise_for_status()

                size = 0
                blocks = []
                for block in response.iter_content(8192):
                    size += len(block)
                    if size > MAX_RESPONSE_BYTES:
                        raise ValueError(
                            f"response exceeded {MAX_RESPONSE_BYTES} bytes"
                        )
                    blocks.append(block)
        except Exception as exc:
            logger.error(
                "[ARXIV] Query failed after %.1fs (%s): %s",
                time.monotonic() - t0,
                search_query[:120],
                exc,
            )
            self._record_failure()
            raise ArxivUnavailable(f"{type(exc).__name__}: {exc}") from exc

        self._record_success()
        logger.info(
            "[ARXIV] Fetched %s bytes in %.1fs for %r",
            size,
            time.monotonic() - t0,
            search_query[:120],
        )
        return b"".join(blocks)

    # ── Search ───────────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        max_results: Optional[int] = None,
        budget: Optional[float] = None,
    ) -> list[dict]:
        """
        Search arXiv for *query* and return pipeline-shaped candidates.

        *budget* is the wall-clock the caller can spare, in seconds; it bounds
        both the wait for a request slot and whether a second, broader attempt
        is worth making.

        Returns ``[]`` when the search ran and matched nothing (or when the
        query has no searchable terms).  Raises :class:`ArxivUnavailable` when
        the search could not run — the caller keeps its local results and says
        which of the two happened.
        """
        if not self.available():
            logger.info("[ARXIV] Skipped — circuit breaker is open.")
            raise ArxivUnavailable(
                "arXiv is in a cooldown after repeated failures"
            )

        limit = max(1, int(max_results or self.max_results))
        remaining = self.timeout + self.min_interval if budget is None else float(budget)

        started = time.monotonic()
        expression = build_search_query(query, self.max_query_terms)
        if not expression:
            logger.info("[ARXIV] Skipped — %r yielded no searchable terms.", query[:80])
            return []

        candidates = parse_atom_feed(self._fetch(expression, limit, remaining))

        # An AND of every content term is precise but can be too narrow. When it
        # matches nothing, one broader OR pass is worth the second round trip —
        # but only if the caller's budget still covers it.
        if not candidates and expression.count(" AND ") >= 2:
            spent = time.monotonic() - started
            left = remaining - spent
            if left > self.timeout:
                broadened = build_search_query(query, self.max_query_terms, operator="OR")
                logger.info("[ARXIV] AND search was empty — retrying broader (OR).")
                # The first request succeeded, so a failure here is still just
                # "no extra papers": the caller already has a usable answer.
                try:
                    candidates = parse_atom_feed(self._fetch(broadened, limit, left))
                except ArxivUnavailable as exc:
                    logger.warning("[ARXIV] Broader retry unavailable: %s", exc)

        logger.info(
            "[ARXIV] %s candidate(s) for %r in %.1fs",
            len(candidates),
            query[:80],
            time.monotonic() - started,
        )
        return candidates
