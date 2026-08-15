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
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: Status;
  error: string;
}) {
  const isLoading = status === "loading";

  return (
    <form className="query-panel" onSubmit={onSubmit}>
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
          {isLoading ? "Searching..." : "Generate recommendations"}
        </button>
        <p className="helper-copy" id="research-prompt-help">
          Answers stream in as each group of papers is processed.
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
