import { FormEvent, useState } from "react";
import "./App.css";
import { ApiResponse, ChunkResponse } from "./interface";
import { parseDoc, ScoreBadge, ClaimList, pct } from "./helper";

// ── main app ────────────────────────────────────────────────────────────────

function App() {
  const [prompt, setPrompt] = useState(
    "What are the most relevant papers on climate change and public health?",
  );
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [totalDocs, setTotalDocs] = useState(0);
  const [numChunks, setNumChunks] = useState(0);
  const [aggFaithfulness, setAggFaithfulness] = useState<number | null>(null);
  const [chunks, setChunks] = useState<ChunkResponse[]>([]);

  const statusLabel =
    status === "loading"
      ? "Searching"
      : status === "error"
        ? "Error"
        : status === "success"
          ? "Ready"
          : "Ready";

  const samplePrompts = [
    "What papers explain the impact of AI on healthcare?",
    "Show research on renewable energy adoption in cities.",
    "Find papers about machine learning for medical diagnosis.",
  ];

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();

    if (!trimmed) {
      setError("Enter a research question to continue.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const controller = new AbortController();

      const timeout = setTimeout(
        () => {
          controller.abort();
        },
        10 * 60 * 1000,
      );

      const response = await fetch("/api/v1/prompt/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_prompt: trimmed }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const payload = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(payload.error || "The recommendation request failed.");
      }

      setQuery(payload.query ?? trimmed);
      setTotalDocs(payload.total_docs_retrieved ?? 0);
      setNumChunks(payload.num_chunks ?? 0);
      setAggFaithfulness(payload.aggregate_faithfulness ?? null);
      setChunks(payload.data ?? []);
      setStatus("success");
    } catch (err) {
      setStatus("error");

      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out after 10 minutes.");
      } else {
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    }
  };

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Recommendica</p>
          <h1>Research recommendations, grounded in papers.</h1>
        </div>
        <div className="status-chip">
          <span className={`status-dot ${status}`} />
          <span>{statusLabel}</span>
        </div>
      </header>

      <main className="layout">
        {/* ── hero + prompt ──────────────────────────────────────────── */}
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="section-label">Find better sources faster</p>
            <p className="hero-text">
              Ask for papers by topic, get concise answers grounded in retrieved
              documents, and see faithfulness scores that tell you how well each
              answer sticks to the sources.
            </p>
            <div className="hero-metrics" aria-label="Result highlights">
              <div>
                <strong>{totalDocs || "—"}</strong>
                <span>docs retrieved</span>
              </div>
              <div>
                <strong>{numChunks || "—"}</strong>
                <span>response chunk{numChunks !== 1 ? "s" : ""}</span>
              </div>
              <div>
                <strong>{pct(aggFaithfulness)}</strong>
                <span>faithfulness</span>
              </div>
            </div>
          </div>

          <form className="query-panel" onSubmit={runSearch}>
            <label className="input-label" htmlFor="research-prompt">
              Research prompt
            </label>
            <textarea
              id="research-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Enter a research question"
            />

            <div className="sample-row" aria-label="Sample prompts">
              {samplePrompts.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="sample-pill"
                  onClick={() => setPrompt(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={status === "loading"}
              >
                {status === "loading"
                  ? "Searching..."
                  : "Generate recommendations"}
              </button>
              <p className="helper-copy">
                Backend: <code>/api/v1/prompt/</code>
              </p>
            </div>

            {error ? <p className="error-banner">{error}</p> : null}
          </form>
        </section>

        {/* ── chunk responses ────────────────────────────────────────── */}
        {chunks.length > 0 && (
          <section className="chunks-section">
            <div className="chunks-header">
              <div>
                <p className="section-label">Results</p>
                {query && <p className="chunks-query">« {query} »</p>}
              </div>
              <ScoreBadge
                score={aggFaithfulness}
                label="Aggregate faithfulness"
              />
            </div>

            {chunks.map((chunk) => (
              <article className="chunk-card" key={chunk.chunk_index}>
                {/* response */}
                <div className="chunk-response-header">
                  <p className="section-label">
                    Chunk {chunk.chunk_index} of {numChunks}
                  </p>
                  <ScoreBadge
                    score={chunk.evaluation?.faithfulness_score ?? null}
                    label="Faithfulness"
                  />
                </div>
                <p className="chunk-response-text">
                  {chunk.generated_response}
                </p>

                {/* evaluation detail */}
                {chunk.evaluation?.claims &&
                  chunk.evaluation.claims.length > 0 && (
                    <ClaimList claims={chunk.evaluation.claims} />
                  )}

                {/* documents used */}
                <details className="chunk-docs-detail">
                  <summary>
                    {chunk.num_docs_in_chunk} document
                    {chunk.num_docs_in_chunk !== 1 ? "s" : ""} used
                  </summary>
                  <div className="docs-grid">
                    {chunk.docs.map((doc, i) => {
                      const info = parseDoc(doc);
                      if (!info) return null;
                      return (
                        <div className="doc-card" key={i}>
                          <div className="doc-title-row">
                            <span className="doc-index">{i + 1}</span>
                            <h3>{info.title}</h3>
                          </div>
                          {info.category && (
                            <span className="doc-category">
                              {info.category}
                            </span>
                          )}
                          <p className="doc-summary">{info.summary}</p>
                          {info.authors && (
                            <div className="doc-authors">{info.authors}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </article>
            ))}
          </section>
        )}

        {/* empty state */}
        {status !== "loading" && chunks.length === 0 && (
          <section className="content-grid">
            <article className="summary-card">
              <div className="card-header">
                <p className="section-label">AI summary</p>
              </div>
              <div className="empty-state">
                <p>No recommendations yet.</p>
                <span>Run a query to populate the result list.</span>
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
