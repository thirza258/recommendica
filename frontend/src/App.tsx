import { useEffect, useState, FormEvent, useRef } from "react";
import TopBar from "./components/Topbar";
import HeroPanel from "./components/Hero";
import ChunksList from "./components/ChunkList";
import EmptyState from "./components/EmptyState";
import { ChunkResponse, StreamEvent } from "./interface";
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
  const [progressMsg, setProgressMsg] = useState("");

  // Track the AbortController so we can cancel an in-flight stream
  const abortRef = useRef<AbortController | null>(null);

  // ── Health check ──────────────────────────────────────────────────────────
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

  // ── Search handler (streaming) ────────────────────────────────────────────
  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Enter a research question to continue.");
      setStatus("error");
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();

    setStatus("loading");
    setError("");
    setProgressMsg("Starting...");
    setChunks([]);
    setQuery(trimmed);
    setTotalDocs(0);
    setNumChunks(0);
    setAggFaithfulness(null);

    const controller = new AbortController();
    abortRef.current = controller;

    // 10-minute timeout as a safety net; the stream should stay alive via SSE
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

    try {
      const response = await fetch("/api/v1/prompt/stream/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_prompt: trimmed }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text();
        let errMsg = `Backend returned ${response.status}`;
        try {
          const parsed = JSON.parse(errBody);
          errMsg = parsed.error || errMsg;
        } catch { /* ignore parse failures */ }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable (streaming not supported).");
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are delimited by double newlines
        const parts = buffer.split("\n\n");
        // The last part may be incomplete — keep it in the buffer
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6); // strip "data: " prefix
          try {
            const event: StreamEvent = JSON.parse(jsonStr);
            handleStreamEvent(event);
          } catch {
            // Ignore malformed JSON (partial writes, etc.)
          }
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled or timeout — don't overwrite if we already have results
        if (status === "loading") {
          setStatus("idle");
          setError("Request cancelled.");
        }
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    }
  };

  // ── SSE event dispatcher ──────────────────────────────────────────────────
  const handleStreamEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "progress":
        setProgressMsg(event.message);
        break;

      case "chunk_start":
        setProgressMsg(`Generating response for chunk ${event.chunk_index}...`);
        // Insert a placeholder chunk that we'll stream tokens into
        setChunks((prev) => {
          const exists = prev.find(
            (c) => c.chunk_index === event.chunk_index
          );
          if (exists) return prev;
          return [
            ...prev,
            {
              chunk_index: event.chunk_index,
              num_docs_in_chunk: event.num_docs_in_chunk,
              docs: [],
              generated_response: "",
            },
          ];
        });
        break;

      case "chunk_token":
        // Append the token to the matching chunk's generated_response
        setChunks((prev) =>
          prev.map((c) =>
            c.chunk_index === event.chunk_index
              ? {
                  ...c,
                  generated_response: c.generated_response + event.token,
                }
              : c
          )
        );
        break;

      case "chunk_end":
        setProgressMsg(`Chunk ${event.chunk_index} complete.`);
        setChunks((prev) =>
          prev.map((c) =>
            c.chunk_index === event.chunk_index
              ? {
                  ...c,
                  docs: event.docs,
                  num_docs_in_chunk: event.num_docs_in_chunk,
                  generated_response: event.generated_response,
                }
              : c
          )
        );
        break;

      case "complete":
        setTotalDocs(event.total_docs_retrieved);
        setNumChunks(event.num_chunks);
        setProgressMsg("");
        setStatus("success");
        break;

      case "error":
        setError(event.message);
        setStatus("error");
        break;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
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

        {/* Progress banner during loading */}
        {status === "loading" && progressMsg && (
          <div className="stream-progress">
            <span className="stream-progress-dot" />
            <span>{progressMsg}</span>
          </div>
        )}

        {chunks.length > 0 ? (
          <ChunksList
            chunks={chunks}
            numChunks={numChunks || chunks.length}
            query={query}
            aggFaithfulness={aggFaithfulness}
            isLoading={status === "loading"}
          />
        ) : (
          status !== "loading" && <EmptyState />
        )}
      </main>
    </div>
  );
}

export default App;
