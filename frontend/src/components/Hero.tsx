import { FormEvent } from "react";
import Metrics from "./Metrics";
import QueryForm from "./QueryForm";

function HeroPanel({
  prompt,
  setPrompt,
  onSubmit,
  status,
  error,
  totalDocs,
  numChunks,
  aggFaithfulness,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: "idle" | "loading" | "success" | "error";
  error: string;
  totalDocs: number;
  numChunks: number;
  aggFaithfulness: number | null;
}) {
  return (
    <section className="hero-panel">
      <div className="hero-copy">
        <p className="section-label">Find better sources faster</p>
        <p className="hero-text">
          Ask for papers by topic, get concise answers grounded in retrieved
          documents, and see faithfulness scores that tell you how well each
          answer sticks to the sources.
        </p>
        <Metrics
          totalDocs={totalDocs}
          numChunks={numChunks}
          aggFaithfulness={aggFaithfulness}
        />
      </div>

      <QueryForm
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={onSubmit}
        status={status}
        error={error}
      />
    </section>
  );
}

export default HeroPanel;