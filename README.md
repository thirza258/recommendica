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
