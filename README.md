# Recommendica

Recommendica is a research recommendation API powered by AI and Retrieval-Augmented Generation (RAG). It helps users find the most relevant research papers based on their input queries.
This project is set up to create a virtual environment, install dependencies, and run a Django server for the Recommendica.

## Setup Instructions

1. Create a virtual environment:
   ```sh
   python -m venv env
   ```

2. Activate the virtual environment:
   - On macOS and Linux:
     ```sh
     source env/bin/activate
     ```
   - On Windows:
     ```sh
     .\env\Scripts\activate
     ```

3. Install dependencies:
   ```sh
   pip install -r requirements.txt
   ```

4. Configure local environment variables:
   - Development uses `.env.development`.
   - Production uses `.env.production`.

5. Import research data:
   ```sh
   python manage.py import_research
   ```

6. Apply migrations:
   ```sh
   python manage.py migrate
   ```

7. Run the app locally:
   ```sh
   make run
   ```
   To run both backend and frontend dev servers together:
   ```sh
   make dev
   ```

## Input Prompt Configuration
- localhost:8000/api/v1/prompt/

```json
{
    "input_prompt": "What is the impact of COVID-19 on the economy?"
}
```

The return response will be the top 5 most relevant research papers to the input prompt.

```json
{
    "status": 200,
    "message": "Success",
    "data": {
        "response": "ai response",
        "research_results": [
            {
                "title": "title",
                "category": "category",
                "summary": "summary",
                "authors": "authors"
            }
        ]
    }
}
```
## API Documentation
- localhost:8000/docs/

## Health checks

| Endpoint | Meaning | Use it for |
| --- | --- | --- |
| `GET /api/v1/health/` | Liveness. Answers 200 whenever the process can serve HTTP, with no dependency calls. | Container restart policies, load-balancer target checks. |
| `GET /api/v1/health/ready/` | Readiness. Probes ChromaDB (reachable? collection populated?), Ollama (reachable? is the configured embedding model installed?) and the LLM config. Returns 503 when a query would fail. | Debugging "why does every search return nothing", deploy gates. |

The pipeline is built lazily on first use, so a missing key or a downed
dependency yields a `503` with the specific reason instead of taking every
endpoint (health checks included) down with it. Fix the cause and the next
request picks it up — no restart needed.

## Donations (Paddle)

Recommendica is free, has no accounts and grants nothing in return for money —
the donate button exists only to offset the embedding and LLM calls each search
makes. Payments run through [Paddle](https://www.paddle.com/) as merchant of
record, so no card details ever reach this application.

| Endpoint | Meaning |
| --- | --- |
| `GET /api/v1/donate/config/` | What the browser needs: the public Paddle.js client token, the environment, the currency allowlist, the suggested amounts and the bounds. Answers `{"enabled": false}` — not 404 — when Paddle is unconfigured, which is the signal the UI uses to hide the button. |
| `POST /api/v1/donate/checkout/` | Creates a Paddle transaction for `{"amount": "15.00", "currency": "USD", "message": "optional"}` and returns its id for the overlay checkout. Rate-limited (`DONATION_THROTTLE_RATE`, default 20/hour per client IP; the counter is per process, so more Gunicorn workers means a proportionally looser limit unless you configure a shared cache). |
| `POST /api/v1/donate/webhook/` | Paddle's notification destination. Every request must carry a valid `Paddle-Signature`; unsigned or tampered payloads get a 401 and change nothing. |

Amounts are pay-what-you-want: the server builds a **custom price** against one
donation product for each checkout, so supporters are not limited to a fixed
set of tiers. The browser never names the price it pays — it receives a
transaction id, and the amount inside it was validated and converted to minor
units server-side.

Donations are recorded in the `Donation` table (visible read-only in the Django
admin). A row is written when the checkout opens, so an abandoned checkout shows
up as `draft` rather than vanishing; webhooks then move it through Paddle's own
statuses to `completed`. Paddle retries webhooks and does not guarantee order,
so events are applied idempotently — a redelivery updates the same row, and a
late-arriving earlier event cannot revert a later status.

### Setup

1. In the Paddle dashboard, create a **product** named e.g. "Donation" (its
   catalogue price is never used) and copy its `pro_…` id.
2. Copy a server-side **API key** and a client-side **token** from Developer
   tools → Authentication.
3. Add a **notification destination** pointing at
   `https://your-domain/api/v1/donate/webhook/`, subscribe it to the
   `transaction.*` events, and copy its secret.
4. Fill in `PADDLE_*` in your env file (see `.env.example`) and run
   `python manage.py migrate`.

Leave `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` or `PADDLE_DONATION_PRODUCT_ID`
empty and the whole feature stays off — the endpoints report themselves as
disabled and no donate button is rendered.

## Relevance agent

Dense retrieval always returns its top-k, however off-topic those papers are, so
plain RAG will happily write a confident answer from unrelated sources. The
agent closes that loop:

```
retrieve (all query variants, one batched search)
   → grade every candidate against the user's actual question
   → keep the related ones
   → too few? ask why they were rejected, rewrite the query with those
     reasons, and search again
   → stop when enough related papers are found, attempts run out, or the
     wall-clock deadline is hit
```

Related papers **accumulate** across attempts, and grading always judges against
the original question — a refined query is a search tool, not a new intent.

What you see per request: `progress` events with `step: "relevance"` reporting
each attempt (`searching`, `graded`, `refining`), and a `complete` event carrying
`agent_outcome`.

| Outcome | Meaning |
| --- | --- |
| `accepted` | Related papers found; the answer is built only from those. |
| `no_relevant` | Candidates existed but none were related. **No answer is generated** — the response carries a `notice` explaining that, which the UI shows. Answering from papers the agent already judged unrelated would be worse than saying nothing. |
| `no_candidates` | Retrieval matched nothing at all. |
| `grader_unavailable` | The grader itself failed (provider down, or unparseable output). Papers are returned **unfiltered and ranked by retrieval score**, with a `notice` saying so. Heuristics rank, only the LLM rejects: keyword overlap would drop relevant papers that use different terminology, which is exactly what HyDE and RAG-fusion exist to catch. Parse failures are logged — if you see them often, `AGENT_MODEL` is not returning usable JSON. |

Cost: one LLM call per attempt (grading), plus one per refinement. It partly pays
for itself by dropping unrelated papers before generation, which means fewer
chunks to answer. Turn the whole thing off with `ENABLE_RELEVANCE_AGENT=False`.

| Setting | Default | Effect |
| --- | --- | --- |
| `ENABLE_RELEVANCE_AGENT` | `True` | Master switch. Off = previous behaviour (answer from whatever retrieval returned). |
| `AGENT_MIN_RELEVANT_DOCS` | `3` | Related papers wanted before the agent stops searching. |
| `AGENT_MAX_ITERATIONS` | `2` | Search attempts including the first, so one refined retry. |
| `AGENT_RELEVANCE_THRESHOLD` | `0.5` | Minimum score (0-1) to keep a paper. Raise to be stricter. |
| `AGENT_GRADE_CANDIDATES` | `20` | Candidates graded per attempt. |
| `AGENT_DEADLINE` | `90` | Wall-clock budget for the loop, independent of attempt count. |
| `AGENT_MODEL` | `DEFAULT_LLM_MODEL` | Model used for grading and refinement. |

### Live arXiv fallback

The indexed collection is a snapshot. A question about work it never ingested
retrieves nothing related however well the query is refined — refining cannot
conjure papers that were never there. When the agent finishes short of
`AGENT_MIN_RELEVANT_DOCS`, it searches arxiv.org directly:

```
agent loop ends with too few related papers
   → search the live arXiv API with the last query tried
   → drop anything already selected (same paper, different serialisation)
   → grade the rest with the SAME grader used on local results
   → merge the survivors into the pool
```

Live results are never a shortcut around verification. They go through the same
relevance grading as local ones, and the fallback is **skipped entirely when the
grader is unavailable** — a local paper at least matched an embedding, while an
ungradeable live paper has nothing vouching for it at all.

**When arXiv cannot be reached, the request is answered from ChromaDB alone.**
Connection refused, timeout, HTTP error, or an open circuit breaker all resolve
to "no extra papers", never to a failed request: the agent absorbs anything the
source throws, keeps whatever the collection found, and says which happened.
The response distinguishes the two cases — `fallback_empty` means arXiv answered
and had nothing, `fallback_unavailable` means it never answered — because a thin
result set reads very differently depending on which it was.

Progress events use `step: "relevance"` with `status` of `fallback_searching`,
`fallback_graded`, `fallback_empty`, `fallback_unavailable` or
`fallback_ungraded`. Papers from the live source carry `meta.source =
"arxiv_api"` (plus `arxiv_id`, `url`, `pdf_url`) so the UI can label them.

| Setting | Default | Effect |
| --- | --- | --- |
| `ENABLE_ARXIV_FALLBACK` | `True` | Master switch. **Requires `ENABLE_RELEVANCE_AGENT`** — with no grader there is nothing to hold live results to the same standard, so the fallback stays off and logs a warning. |
| `ARXIV_FALLBACK_MAX_RESULTS` | `10` | Papers requested per live search. |
| `ARXIV_FALLBACK_TIMEOUT` | `15` | Per-request HTTP timeout. The whole search also runs inside whatever is left of `AGENT_DEADLINE`. |
| `ARXIV_MIN_REQUEST_INTERVAL` | `3` | Seconds between requests, process-wide, as arXiv asks. A search that cannot get a slot inside its budget is skipped rather than queued. |
| `ARXIV_MAX_QUERY_TERMS` | `6` | Content terms per search. They are ANDed, so more terms means a narrower search. |
| `ARXIV_BREAKER_THRESHOLD` / `ARXIV_BREAKER_COOLDOWN` | `3` / `300` | Consecutive failures before the source is skipped for a cooldown, so a downed API costs one timeout rather than one per request. |
| `ARXIV_USER_AGENT` | Recommendica/1.0 | Sent on every request; arXiv asks callers to identify themselves. |

The user's question is never passed to arXiv verbatim. Its `search_query`
grammar gives meaning to quotes, parentheses, colons and the `AND`/`OR` keywords,
so the query is tokenised down to alphanumeric content words — which is the
escaping strategy, not just tidying.

## Pipeline verification

Two checks sit at the pipeline's boundaries, and they fail in opposite
directions on purpose.

### Query check (before anything is spent)

Dense retrieval never refuses. Ask it "hello" and it returns its top-k papers
about anything, the grader rejects them all, and the user waits through three
transform calls, a retrieval round trip, a grading call and a generation call to
be told nothing was related. The query check catches that up front: two cheap
deterministic guards (empty, too short, too long, no letters) and then one LLM
classification of whether a paper corpus could answer this at all.

It **fails open**. A rejection is the one outcome that produces no answer, so it
is only returned on a confident verdict: a provider outage, an unparseable
response, or an unexplained "no" all let the query through. Blocking a real
question because a checker broke is worse than running a pipeline on a bad one.
The length floor is 2 characters for the same reason — a length rule cannot tell
"AI" from "hi", so that judgement is left to the model.

A rejected query ends the stream with a `complete` event (not an `error` —
nothing broke) carrying a `notice` and a `query_check` payload.

### Result check (before the answer is written)

Deterministic reporting on the documents an answer is about to be built from:
how many, from which source, how confident retrieval was, and how much of the
query's vocabulary they actually cover. This is where `ConfidenceGate` is
computed. It never blocks anything and never calls an LLM — the two model-based
checks on either side of it (relevance grading before, answer grounding after)
already ask the model-shaped questions.

It arrives as a `progress` event with `step: "verification"` and is attached to
the `complete` event (and to the non-streaming response) as `verification`:

```json
{
  "docs": 6,
  "sources": {"collection": 4, "arxiv_api": 2},
  "min_relevant_met": true,
  "retrieval_confidence": 0.62,
  "query_term_coverage": 0.75,
  "warnings": ["2 of 6 papers came from a live arXiv search rather than the indexed collection."]
}
```

`retrieval_confidence` is `null` when nothing in the selection carried a vector
distance (a live-source-only answer) — reported as unknown rather than as zero,
which would read as "no confidence".

| Setting | Default | Effect |
| --- | --- | --- |
| `ENABLE_QUERY_VERIFICATION` | `True` | Screen the query before the pipeline runs. One extra LLM call, which it usually saves several of. |
| `QUERY_VERIFICATION_TIMEOUT` | `15` | Bound on that call. It never retries. |
| `QUERY_MIN_CHARS` / `QUERY_MAX_CHARS` | `2` / `1000` | Deterministic bounds. The upper one is a prompt-budget guard: the query is interpolated into every prompt the request makes. |
| `ENABLE_RESULT_VERIFICATION` | `True` | Attach the selection report. No LLM call. |

### Answer grounding (optional)

`ENABLE_ANSWER_EVALUATION=True` additionally audits each generated answer
against its own sources, filling the `faithfulness_score` badge, the claim list
and the aggregate score the UI already renders. **Off by default**: it adds an
LLM call per chunk on the critical path (a chunk's evaluation ships with its
`chunk_end`), and it answers a different question from the one this feature is
about — relevance filtering keeps answers *on topic*; this measures how well
they *stick to their sources*.

## Pipeline performance

Per request the pipeline makes one batched embedding call, one batched ChromaDB
query, one relevance-grading call, and one LLM call per `CHUNK_SIZE` selected
documents. The dials that matter:

| Setting | Default | Effect |
| --- | --- | --- |
| `MAX_CONTEXT_DOCS` | `12` | Hard cap on documents sent to answer generation — the main latency/cost dial. At `CHUNK_SIZE=5` this is 3 generation calls, run concurrently. Documents are ranked by Reciprocal Rank Fusion across all query variants first, so the cap trims the tail rather than good matches. |
| `CHUNK_SIZE` | `5` | Documents per generation call. Fewer docs per chunk means more, smaller, concurrent calls. |
| `GENERATION_MAX_WORKERS` | `3` | How many chunk answers generate at once. Answers still stream to the client strictly in chunk order. Set to `1` for the old serial behaviour — worth doing on a rate-limited API key, since concurrent generation multiplies upstream requests (3 chunks × 8 concurrent queries = up to 24 simultaneous completions) and a 429 burst surfaces as `[Error generating response for chunk N]`. |
| `ENABLE_HYDE` / `ENABLE_STEP_BACK` / `ENABLE_RAG_FUSION` | `True` | The three query transforms. They run concurrently, so the stage costs the slowest one; turning some off trades recall for latency. |
| `VARIANT_STAGE_TIMEOUT` | `45` | A transform that exceeds this is dropped and retrieval proceeds without it. |
| `MAX_CONCURRENT_QUERIES` | `8` | Concurrent pipeline runs per process. Excess requests get `503` + `Retry-After` instead of all timing out. |

See `.env.example` for the full list.

## Makefile

- `make run`: start the Django backend with the development env file.
- `make run-frontend`: start the Vite frontend dev server.
- `make dev`: start backend and frontend together.
- `make deploy`: start the Docker Compose stack with the production env file.

## Docker Setup

The production stack uses Docker Compose with the frontend served by nginx.

1. Make sure `.env.production` has the production values you want to deploy.
2. Start the stack:
   ```sh
   make deploy
   ```
3. Open the services:
   - Frontend: localhost:5156
   - Backend API: localhost:8000/api/v1/
   - API docs: localhost:8000/docs/
4. Optionally import the sample research data after the backend is running:
   ```sh
   docker compose exec backend python manage.py import_research
   ```

## Frontend pages

The frontend opens on a landing page (`frontend/src/components/Landing.tsx`)
explaining what the tool does. **Get started** swaps it for the search view —
plain component state in `App.tsx`, no router — and moves focus to the prompt
field. Every load starts on the landing page; the choice is not persisted.

## SEO

The deployed site is **https://recommendica.nevatal.tech/**. That origin is
written into four places, all of which need updating together if the domain
changes:

| File | What it holds |
| --- | --- |
| `frontend/index.html` | canonical URL, Open Graph / Twitter card tags, JSON-LD (`WebSite` + `WebApplication`) |
| `frontend/public/robots.txt` | crawl rules (`/api/` excluded) and the sitemap URL |
| `frontend/public/sitemap.xml` | the single indexable URL and its `lastmod` |
| `frontend/public/site.webmanifest` | installable-app metadata and icons |

Other pieces of the setup:

- **Social preview**: `frontend/public/og-image.png` (1200×630). Regenerate it
  from a 1200×630 HTML page rendered with headless Chrome if the pitch changes.
- **No-JS fallback**: `index.html` carries a `<noscript>` version of the landing
  copy, so crawlers that do not execute JavaScript still see the substance of
  the page rather than an empty `<div id="root">`.
- **Titles**: the landing title in `index.html` must match `DOC_TITLE.landing`
  in `src/App.tsx` — the app rewrites `document.title` on mount, and a mismatch
  makes the tab name flicker on load.
- **nginx** (`frontend/nginx.conf`) gzips static text, caches hashed
  `/assets/` for a year, and revalidates `index.html` on every load so meta-tag
  changes reach crawlers on the next deploy.

After a domain or content change, resubmit the sitemap in Google Search Console
and re-scrape the URL with the Facebook and X card debuggers to clear their
cached preview.
