import { FormEvent } from "react";
import { SAMPLE_PROMPTS } from "../constant";

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
  status: "idle" | "loading" | "success" | "error";
  error: string;
}) {
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
        placeholder="Enter a research question"
      />

      <div className="sample-row" aria-label="Sample prompts">
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
  );
}

export default QueryForm;