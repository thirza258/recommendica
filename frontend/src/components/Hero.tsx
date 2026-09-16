import { FormEvent } from "react";
import Metrics from "./Metrics";
import QueryForm from "./QueryForm";
import { Status } from "../interface";

function HeroPanel({
  prompt,
  setPrompt,
  onSubmit,
  status,
  error,
  onCancel,
  totalDocs,
  numChunks,
  aggFaithfulness,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: Status;
  error: string;
  onCancel: () => void;
  totalDocs: number;
  numChunks: number;
  aggFaithfulness: number | null;
}) {
  return (
    <section className="hero-panel">
      <div className="hero-copy">
        <h1 className="hero-title">
          Research recommendations, grounded in papers.
        </h1>
        <p className="hero-text">
          Ask a research question. The search adapts to its complexity and the
          evidence it finds, combining quick answers with deeper analysis
          whenever it is needed.
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
        onCancel={onCancel}
      />
    </section>
  );
}

export default HeroPanel;
