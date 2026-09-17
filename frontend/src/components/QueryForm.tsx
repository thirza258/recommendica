import { FormEvent } from "react";
import { SAMPLE_PROMPTS } from "../constant";
import { Status } from "../interface";
import { AlertCircleIcon, SpinnerIcon } from "./Icons";

function QueryForm({
  prompt,
  setPrompt,
  onSubmit,
  status,
  error,
  onCancel,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: Status;
  error: string;
  onCancel: () => void;
}) {
  const isLoading = status === "loading";

  return (
    <form className="query-panel" onSubmit={onSubmit}>
      <div className="adaptive-hint">
        <strong>Adaptive research</strong>
        <span>A focused answer when the evidence is clear. Deeper research when it needs more work.</span>
      </div>
      <label className="input-label" htmlFor="research-prompt">
        Research prompt
      </label>
      <textarea
        id="research-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="e.g. What does recent work say about transformers in medical imaging?"
        aria-describedby="research-prompt-help"
        aria-invalid={status === "error" && Boolean(error)}
      />

      <div className="sample-row" role="group" aria-label="Sample prompts">
        {SAMPLE_PROMPTS.map((s) => (
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
        <button type="submit" className="primary-button" disabled={isLoading}>
          {isLoading && <SpinnerIcon size={16} className="button-spinner" />}
          {isLoading ? "Researching..." : "Research question"}
        </button>
        {isLoading && <button type="button" className="sample-pill" onClick={onCancel}>Stop search</button>}
        <p className="helper-copy" id="research-prompt-help">
          Search depth adjusts automatically. Drafts stream as they are written;
          source checks and any needed revisions finish before the final answer.
        </p>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          <AlertCircleIcon size={18} />
          <span>{error}</span>
        </p>
      ) : null}
    </form>
  );
}

export default QueryForm;
