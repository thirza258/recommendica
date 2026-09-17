import { useEffect, useState, FormEvent, useRef } from "react";
import TopBar from "./components/Topbar";
import Landing from "./components/Landing";
import HeroPanel from "./components/Hero";
import ChunksList from "./components/ChunkList";
import DonateDialog from "./components/DonateDialog";
import EmptyState from "./components/EmptyState";
import Courses from "./components/Courses";
import { viewFromHash } from "./learning";
import type { View } from "./learning";
import { AlertTriangleIcon } from "./components/Icons";
import {
  ChunkResponse,
  CorpusStatsResponse,
  DonationConfigResponse,
  DonationSettings,
  Status,
  ResearchPlan,
  StreamEvent,
} from "./interface";
import "./App.css";
import { readSearchStream } from "./searchStream";

let backendHealthCheckSent = false;
let donationConfigRequested = false;
let corpusStatsRequested = false;

const DOC_TITLE: Record<View, string> = {
  landing: "Recommendica — AI Research Paper Recommendations & Grounded Search",
  app: "Search papers — Recommendica",
  courses: "Research courses — Recommendica",
};

function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const view = viewFromHash(hash);
  const [prompt, setPrompt] = useState(
    "What are the most relevant papers on climate change and public health?"
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [researchPlan, setResearchPlan] = useState<ResearchPlan | null>(null);

  const [query, setQuery] = useState("");
  const [totalDocs, setTotalDocs] = useState(0);
  const [numChunks, setNumChunks] = useState(0);
  const [aggFaithfulness, setAggFaithfulness] = useState<number | null>(null);
  const [chunks, setChunks] = useState<ChunkResponse[]>([]);
  const [progressMsg, setProgressMsg] = useState("");
  // Set by the relevance agent — e.g. no sufficiently related papers found.
  const [notice, setNotice] = useState("");
  const [totalPapers, setTotalPapers] = useState<number | undefined>(undefined);

  // Null until the server confirms Paddle is configured; the donate button
  // stays hidden until then rather than opening a flow that cannot complete.
  const [donation, setDonation] = useState<DonationSettings | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);

  // Track the AbortController so we can cancel an in-flight stream
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const cancelSearch = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setProgressMsg("");
    setNotice("Search stopped. Any results received are shown below.");
  };

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

  // ── Corpus Stats ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (corpusStatsRequested) return;
    corpusStatsRequested = true;
    const loadCorpusStats = async () => {
      try {
        const response = await fetch("/api/v1/stats/");
        if (!response.ok) return;
        const data: CorpusStatsResponse = await response.json();
        if (typeof data.total_papers === "number" && data.total_papers > 0) {
          setTotalPapers(data.total_papers);
        }
      } catch {
        // Fallback handled within Landing component
      }
    };
    void loadCorpusStats();
  }, []);

  // ── Donation availability ─────────────────────────────────────────────────
  // Asked once per page load. A deployment with no Paddle credentials answers
  // {"enabled": false}, which is a configuration state and not an error — so a
  // failure here only ever means "no donate button".
  useEffect(() => {
    if (donationConfigRequested) return;
    donationConfigRequested = true;
    const loadDonationConfig = async () => {
      try {
        const response = await fetch("/api/v1/donate/config/");
        if (!response.ok) return;
        const config: DonationConfigResponse = await response.json();
        if (config.enabled) setDonation(config);
      } catch {
        // Donations are optional; the rest of the app does not depend on them.
      }
    };
    void loadDonationConfig();
  }, []);

  // ── View transition ───────────────────────────────────────────────────────
  // Entering the app has to move focus to the prompt field: the CTA that
  // triggered the switch unmounts, and focus would otherwise fall back to
  // <body>, leaving a keyboard user to re-traverse the page to reach the one
  // control they just asked for.
  useEffect(() => {
    if (view !== "courses") document.title = DOC_TITLE[view];
    if (view !== "app" && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStatus("idle");
      setProgressMsg("");
      setNotice("Search stopped. Any results received are shown below.");
    }
    if (view === "app") {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.getElementById("research-prompt")?.focus();
    } else if (view === "landing" && window.location.hash === "#home") {
      document.getElementById("hero-heading")?.focus();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [view]);

  // ── Search handler (streaming) ────────────────────────────────────────────
  const executeSearch = async (textToSearch: string) => {
    const trimmed = textToSearch.trim();
    if (!trimmed) {
      setError("Enter a research question to continue.");
      setStatus("error");
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();

    setStatus("loading");
    setError("");
    setProgressMsg("Planning your research...");
    setResearchPlan(null);
    setNotice("");
    setChunks([]);
    setQuery(trimmed);
    setTotalDocs(0);
    setNumChunks(0);
    setAggFaithfulness(null);

    const controller = new AbortController();
    abortRef.current = controller;

    // Keep the timeout active while reading the body, not only until headers.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10 * 60 * 1000);

    try {
      const response = await fetch("/api/v1/prompt/stream/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_prompt: trimmed, mode: "adaptive" }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        let errMsg = `Backend returned ${response.status}`;
        try {
          const parsed = JSON.parse(errBody);
          errMsg = parsed.error || errMsg;
        } catch { /* ignore parse failures */ }
        throw new Error(errMsg);
      }

      await readSearchStream(response, (event) => {
        if (abortRef.current === controller && !controller.signal.aborted) {
          handleStreamEvent(event);
        }
      });
    } catch (err) {
      // A replaced or cancelled request must never change the next search.
      if (abortRef.current !== controller) return;
      setStatus("error");
      setProgressMsg("");
      setError(timedOut
        ? "The search took too long. Please try again or use a narrower question."
        : err instanceof Error ? err.message : "Request failed.");
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await executeSearch(prompt);
  };

  const handleStartFromLanding = (initialPrompt?: string, autoSubmit?: boolean) => {
    if (initialPrompt && initialPrompt.trim()) {
      const q = initialPrompt.trim();
      setPrompt(q);
      window.location.hash = "search";
      if (autoSubmit) {
        void executeSearch(q);
      }
    } else {
      window.location.hash = "search";
    }
  };

  // ── SSE event dispatcher ──────────────────────────────────────────────────
  const handleStreamEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "progress":
        setProgressMsg(event.message);
        if (event.research_plan) setResearchPlan(event.research_plan);
        if (event.step === "answer_review" && event.chunk_index !== undefined
          && (event.status === "checking" || event.status === "rechecking" || event.status === "revising")) {
          const reviewStatus = event.status;
          setChunks((prev) => prev.map((chunk) => chunk.chunk_index === event.chunk_index
            ? { ...chunk, answer_review: { ...chunk.answer_review, status: reviewStatus } }
            : chunk));
        }
        if (event.step === "chunking" && event.num_chunks !== undefined) setNumChunks(event.num_chunks);
        if (event.step === "retrieval" && event.status === "done" && event.count !== undefined) setTotalDocs(event.count);
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
              answer_review: event.answer_review,
            },
          ].sort((a, b) => a.chunk_index - b.chunk_index);
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
                  evaluation: event.evaluation ?? c.evaluation,
                  answer_review: event.answer_review ?? c.answer_review,
                  error: event.error,
                  complete: true,
                }
              : c
          )
        );
        break;

      case "chunk_evaluation":
        setChunks((prev) => prev.map((chunk) => chunk.chunk_index === event.chunk_index
          ? {
              ...chunk,
              generated_response: event.generated_response ?? chunk.generated_response,
              evaluation: event.evaluation ?? undefined,
              answer_review: event.answer_review ?? chunk.answer_review,
            }
          : chunk));
        break;

      case "complete":
        if (event.research_plan) setResearchPlan(event.research_plan);
        setTotalDocs(event.total_docs_retrieved);
        setNumChunks(event.num_chunks);
        setAggFaithfulness(event.aggregate_faithfulness ?? null);
        setNotice([
          event.notice,
          event.answer_review?.withheld
            ? `${event.answer_review.withheld} ${event.answer_review.withheld === 1 ? "answer was" : "answers were"} withheld because their source checks did not pass.`
            : "",
        ].filter(Boolean).join(" "));
        setProgressMsg("");
        setStatus("success");
        break;

      case "error":
        setError(event.message);
        setProgressMsg("");
        setStatus("error");
        break;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const donateDialog = donation && donateOpen && (
    <DonateDialog settings={donation} onClose={() => setDonateOpen(false)} />
  );
  const openDonate = donation ? () => setDonateOpen(true) : undefined;

  if (view === "courses") {
    return (
      <>
        <Courses
          hash={hash}
          onHome={() => { window.location.hash = "home"; }}
          onSearch={(initialPrompt) => handleStartFromLanding(initialPrompt)}
          onDonate={openDonate}
        />
        {donateDialog}
      </>
    );
  }

  if (view === "landing") {
    return (
      <>
        <Landing
          onStart={handleStartFromLanding}
          onDonate={openDonate}
          totalPapers={totalPapers}
        />
        {donateDialog}
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        status={status}
        onHome={() => {
          if (abortRef.current) cancelSearch();
          window.location.hash = "home";
        }}
        onDonate={openDonate}
      />

      <main className="layout">
        <HeroPanel
          prompt={prompt}
          setPrompt={setPrompt}
          onSubmit={runSearch}
          status={status}
          error={error}
          onCancel={cancelSearch}
          totalDocs={totalDocs}
          numChunks={numChunks}
          aggFaithfulness={aggFaithfulness}
        />

        {researchPlan && (
          <div className="research-plan" aria-label="Research approach">
            <strong>{researchPlan.escalated ? "Research expanded" : "Adaptive research"}</strong>
            <p>{researchPlan.reason}</p>
          </div>
        )}

        {/* Progress banner during loading. This is the only live region for
            the stream — the token text itself must never be one, or screen
            readers would re-announce on every token. */}
        {status === "loading" && progressMsg && (
          <div className="stream-progress" role="status" aria-live="polite">
            <span className="stream-progress-dot" />
            <span>{progressMsg}</span>
          </div>
        )}

        {/* Relevance-agent notice, e.g. no related papers were found */}
        {status !== "loading" && notice && (
          <div className="stream-notice">
            <AlertTriangleIcon size={18} />
            <span>{notice}</span>
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

      {donateDialog}
    </div>
  );
}

export default App;
