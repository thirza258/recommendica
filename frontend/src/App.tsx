import { useEffect, useState, FormEvent } from "react";
import TopBar from "./components/Topbar";
import HeroPanel from "./components/Hero";
import ChunksList from "./components/ChunkList";
import EmptyState from "./components/EmptyState";
import { ApiResponse, ChunkResponse } from "./interface";
import "./App.css";

let backendHealthCheckSent = false;

function App() {
  const [prompt, setPrompt] = useState(
    "What are the most relevant papers on climate change and public health?"
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

  // health check (unchanged)
  useEffect(() => {
    if (backendHealthCheckSent) return;
    backendHealthCheckSent = true;
    const checkBackendHealth = async () => {
      try {
        await fetch("/api/v1/health/");
      } catch {
        // Background liveness probe only; search can still proceed.
      }
    };
    void checkBackendHealth();
  }, []);

  // search handler (unchanged)
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
      const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

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

  // ----- render --------------------------------------------------
  return (
    <div className="app-shell">
      <TopBar status={status} />

      <main className="layout">
        <HeroPanel
          prompt={prompt}
          setPrompt={setPrompt}
          onSubmit={runSearch}
          status={status}
          error={error}
          totalDocs={totalDocs}
          numChunks={numChunks}
          aggFaithfulness={aggFaithfulness}
        />

        {chunks.length > 0 ? (
          <ChunksList
            chunks={chunks}
            numChunks={numChunks}
            query={query}
            aggFaithfulness={aggFaithfulness}
          />
        ) : (
          status !== "loading" && <EmptyState />
        )}
      </main>
    </div>
  );
}

export default App;