# Recommendica

Recommendica is a research recommendation API powered by AI and Retrieval-Augmented Generation (RAG). It helps users find the most relevant research papers based on their input queries.
This project is set up to create a virtual environment, install dependencies, and run a Django server for the Recommendica.

## Repository layout

A monorepo with one directory per deployable: each has its own dependency
manifest and Dockerfile, and neither appears in the other's build context.

```
.
├── backend/              Django + DRF API (the RAG pipeline, donations)
│   ├── airecommender/      app: views, pipeline, models, tests
│   ├── recommendica/       project: settings, urls, wsgi/asgi
│   ├── templates/          swagger-ui override
│   ├── manage.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/             React + Vite client
│   ├── src/
│   ├── package.json
│   ├── nginx.conf          serves the build, proxies /api/ to the backend
│   └── Dockerfile
├── docker-compose.yml    backend + postgres + frontend
├── deploy.sh             build, start and health-check the stack
├── Makefile              run-backend / run-frontend / dev / deploy
└── .env.example          one env file for the whole stack, kept at the root
```

Environment files (`.env.development`, `.env.production`) live at the **repository
root**: `docker compose --env-file` and `deploy.sh` read them from there, and the
backend looks there first so both halves are configured from one file. A file
next to `manage.py` still works if you only ever run the backend.

## Setup Instructions

1. Create a virtual environment (the backend is a Python project; run these
   from `backend/`):
   ```sh
   cd backend
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

4. Configure local environment variables, at the repository root:
   - Development uses `.env.development`.
   - Production uses `.env.production`.
   - Copy `.env.example` as a starting point.

5. Import research data:
   ```sh
   python manage.py import_research
   ```

6. Apply migrations:
   ```sh
   python manage.py migrate
   ```

7. Run the app locally (the Makefile targets are at the repository root and
   change into the right directory themselves):
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

## Adaptive research

The app has one research flow. It selects individual search steps from the
question, then adapts when the retrieved evidence needs more coverage.
Both `POST /api/v1/prompt/` and `POST /api/v1/prompt/stream/` accept:

```json
{
  "input_prompt": "What methods improve retrieval augmented generation?",
  "mode": "adaptive"
}
```

`adaptive` is the default when `mode` is omitted. The earlier `fast` and `deep`
API profiles remain accepted for existing integrations, but there is no mode
selector in the app. Invalid modes return HTTP 400 before pipeline setup.

| Signal | Work selected automatically |
| --- | --- |
| A straightforward question | Original-query retrieval, up to 10 graded candidates and one answer group of up to 5 papers |
| Comparison or a multipart question | Broader context and alternate search queries |
| Mechanism or causality question | Concept search (HyDE) and broader context |
| Comprehensive synthesis | HyDE, step-back, multiple queries, and configured reranking |
| Medical, safety, legal or financial cues | Additional search angles |
| Too few related papers, or both low retrieval confidence and low term coverage | Expand the search, refine once, retain previously accepted papers and grade additional results |
| Evidence remains weak | Consult arXiv once and grade any new papers |
| Every answer | Complete evidence audit, citation/quote/number checks, and conditional revision plus recheck |

The initial planner uses inexpensive text heuristics, not a model call or a
claim of certainty. It selects steps independently rather than choosing between
two fixed modes. Retrieval feedback can expand any question, including one
whose wording did not match a heuristic. Keyword overlap alone does not trigger
expansion, since related papers can use different terminology. Unknown retrieval
confidence is not treated as evidence of failure.
Accepted papers are reused during expansion instead of being graded again.

Adaptive searches use at most two retrieval rounds and one live fallback,
within the existing agent deadline. Answer generation has no retries and a
timeout of at most 60 seconds. This bounds a provider call, not total latency:
embedding, storage and source checks also take time.

Query checking, selected transformations and the collection check overlap
after deterministic guards. Enabled transformations run concurrently too.
Retrieval and generation wait for query acceptance. A rejected question can
spend concurrent expansion calls, but never proceeds to an answer.

The stream emits an `adaptive` progress event with a `research_plan` containing
`strategy`, `reason`, enabled `steps`, and whether retrieval caused escalation.
The final JSON response and SSE `complete` also include that plan. Enabled
steps describe the plan; individual progress events describe work performed.

Adaptive streams emit each answer's tokens as they arrive, even if an earlier
answer is slow. Match events by `chunk_index`; their order can interleave.
`chunk_end` exposes a **draft** and its papers immediately. The UI labels it as
unchecked until the review completes. `chunk_evaluation` then carries
`{chunk_index, generated_response, evaluation, answer_review}`. Clients must
**replace** the draft with `generated_response`: this is the revised answer or
an explanation that no answer could be verified. The final `complete` waits for
all checks and includes an `answer_review` count summary. The browser displays
cards in index order and updates each answer and its source evidence together.

### Accuracy flow

1. Write a draft with numbered source citations for every factual point.
2. Audit every nonblank answer section using the **same excerpts provided to
   generation**, including details beyond the old 400-character grading snippets.
   Other selected papers are also provided to check conflicting findings across
   answer groups. The reviewer checks entities, quantities, units, population,
   causality, uncertainty, unanswered parts and overstated conclusions.
3. Validate the audit in Python: every section ID must be covered exactly once;
   citations must refer to supplied sources; supporting quotes must actually
   occur in those excerpts; numerical values and percentage units must appear
   in the cited evidence. Partial support does not pass. Evidence quotes are
   available in the UI's expandable claim list. A model's `NOT_A_CLAIM`
   verdict cannot waive these checks for arbitrary prose: only fixed neutral
   section labels and a standard missing-information note are exempt. Factual
   assertions in headings or caveats still require evidence.
4. If support fails, revise once using the issues and source excerpts, then
   repeat the complete audit on the **new text**. A passing draft needs only
   one audit; revision and the second audit are conditional.
5. If the recheck fails, a reviewer is unavailable, coverage is incomplete or
   the review deadline expires, replace the draft with an explanation and keep
   the sources. Do not present an unverified answer or an old draft's score as
   checked. Supported partial answers retain visible limitations. Aggregate
   support is left unscored if any answer group is withheld.

These are checks of support in the supplied excerpts, **not a guarantee of
factual correctness**. A model can misjudge entailment, an abstract can omit
important context, and a source can itself be wrong. Adaptive research does not
claim to have read full papers or independently replicated their findings.

Reviews run concurrently across answer groups, after their drafts stream. They
have no provider retries, at most one repair and a shared per-answer budget:

| Setting | Default | Purpose |
| --- | --- | --- |
| `DEEP_REVIEW_MODEL` | `AGENT_MODEL` | Can select a separate reviewer model. |
| `DEEP_REVIEW_TIMEOUT` | 25 seconds | Maximum per audit call. |
| `DEEP_REPAIR_TIMEOUT` | 30 seconds | Maximum for the one revision call. |
| `DEEP_REVIEW_DEADLINE` | 90 seconds | Budget shared by audit, revision and recheck. |

Cancellation and the remaining budget are checked immediately before each
provider call, including after a progress event pauses the review. A cancelled
or expired review cannot start another audit or revision, and a result returned
after cancellation or deadline expiry cannot certify the draft. These local
checks add no model calls. Missing-answer notices are kept nonempty and repeated
limitations are combined.

An audit never silently truncates an answer: drafts exceeding 12,000 characters
or 40 nonblank sections must be shortened and rechecked before release.

The `DEEP_REVIEW_*` settings above also govern adaptive answer reviews.
Explicit API profiles select stages independently of legacy `ENABLE_*` flags.
Timing, model, relevance, collection and context settings still apply. Direct
Python callers omitting `mode` retain legacy flags and ordered streams.
Research plans and settings belong to individual requests; simultaneous
searches share clients/caches without changing one another's plans.

**Stop search** cancels an active request and keeps received results. The
browser enforces a 10-minute timeout through the entire adaptive stream and
reports interrupted streams instead of leaving the spinner on.

Run the backend tests with `cd backend && python manage.py test airecommender`
and the stream-parser regressions with `cd frontend && npm test` (Node 22.6+).
The mode tests use dependency fakes and synchronization barriers to verify the
full flow, mode isolation, parallel preparation and independent answer delivery.

The JSON response groups selected papers and their reviewed answers in `data`.
A focused search uses one answer group; expanded research can use more within
the configured context limits. Example response excerpt:

```json
{
    "status": 200,
    "message": "Success",
    "mode": "adaptive",
    "total_docs_retrieved": 1,
    "num_chunks": 1,
    "data": [{
        "chunk_index": 1,
        "num_docs_in_chunk": 1,
        "generated_response": "An answer supported by the supplied source [1].",
        "docs": [{"document": "...", "meta": {}}],
        "answer_review": {"status": "checked", "revised": false, "checks": 1}
    }]
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

This setting applies to legacy Python calls without a response mode. Deep
analysis always runs the stricter accuracy flow described above.

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
explaining what the tool does. **Open Console** opens the search view at
`#search` and moves focus to the prompt field. Lightweight hash navigation in
`App.tsx` supports browser Back/Forward and direct links without a router
dependency. Existing landing section links still work.

**Courses**, available from the landing page and search console, opens the
learning hub at `#courses`. It contains four free courses with 16 lessons:

- Create your first research project: question, literature review, design, proposal.
- Do research, step by step: protocol and pilot, evidence collection, analysis, reporting.
- Get started with Recommendica: search, answer status, source inspection, refinement.
- Read research with confidence: reading passes, methods, results, notes and citations.

Each lesson includes teaching content, a worked example, an exercise, and a
knowledge check with feedback. Answering correctly enables **Mark lesson
complete**. Completion is saved under `recommendica.course-progress.v1` in
this browser's local storage; unavailable storage leaves the lessons usable
and displays a notice. There are no accounts or server-side progress records.
Course cards resume at the first incomplete lesson and allow completed courses
to be reviewed. **Try this in search** prefills the console without submitting.

Course content and further-reading links live in `frontend/src/data/courses.ts`.
Stable course and lesson IDs form links such as
`#courses/website-tutorial/first-search` and are also used for saved progress.
Unknown lesson links show a notice and the catalog. Run `cd frontend && npm test`
for curriculum navigation and progress regressions alongside the stream tests.

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
