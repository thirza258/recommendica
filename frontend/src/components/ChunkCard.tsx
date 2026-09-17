import { ScoreBadge, ClaimList } from "../helper";
import { ChunkResponse } from "../interface";
import DocumentsDetail from "./DocumentDetail";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useDeferredValue } from "react";

const MARKDOWN_PLUGINS = [remarkGfm];

const MarkdownAnswer = memo(function MarkdownAnswer({ answer }: { answer: string }) {
  return <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{answer}</ReactMarkdown>;
});

/** Placeholder that reserves the answer's space while the first tokens arrive. */
function AnswerSkeleton() {
  return (
    <div className="answer-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function ChunkCard({
  chunk,
  numChunks,
  isStreaming,
  isEvaluating,
  isLoading,
}: {
  chunk: ChunkResponse;
  numChunks: number;
  isStreaming?: boolean;
  isEvaluating?: boolean;
  isLoading?: boolean;
}) {
  const hasDocs = chunk.docs && chunk.docs.length > 0;
  const hasText = chunk.generated_response.length > 0;
  const answer = useDeferredValue(chunk.generated_response);
  const review = chunk.answer_review;
  const pendingReview = review && ["checking", "rechecking", "revising"].includes(review.status);
  const checked = review?.status === "checked" || review?.status === "limited";
  const reviewMessage = review?.status === "revising"
    ? "Draft — revising unsupported details"
    : pendingReview
      ? isLoading ? "Draft — accuracy checks in progress" : "Draft — accuracy checks incomplete"
      : checked
        ? review.revised ? "Revised and checked against the source excerpts" : "Checked against the source excerpts"
        : "Answer withheld — source checks did not pass";

  return (
    <article
      className={`chunk-card${isStreaming ? " chunk-card--streaming" : ""}`}
      aria-busy={isStreaming || undefined}
    >
      <div className="chunk-response-header">
        <p className="section-label chunk-label">
          <span>
            Chunk {chunk.chunk_index} of {numChunks}
          </span>
          {isStreaming && <span className="streaming-pulse">streaming</span>}
          {isEvaluating && !review && <span className="streaming-pulse">checking sources</span>}
        </p>
        <ScoreBadge
          score={chunk.evaluation?.faithfulness_score ?? null}
          label={review ? "Source support" : "Faithfulness"}
        />
      </div>

      {review && (
        <div className={`answer-review${checked ? " answer-review--checked" : ""}`}>
          <strong>{reviewMessage}</strong>
          {review.limitations && review.limitations.length > 0 && (
            <ul>{review.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>
          )}
          {!pendingReview && !checked && review.issues && review.issues.length > 0 && (
            <ul>{review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
          )}
        </div>
      )}

      <div className="chunk-response-text">
        {hasText ? (
          <MarkdownAnswer answer={isStreaming ? answer : chunk.generated_response} />
        ) : isStreaming ? (
          <AnswerSkeleton />
        ) : <p>No answer was generated for these papers.</p>}
      </div>

      {chunk.error && <p className="error-banner" role="alert">This answer could not be completed. Please try again.</p>}

      {chunk.evaluation?.claims && chunk.evaluation.claims.length > 0 && (
        <ClaimList claims={chunk.evaluation.claims} />
      )}

      {hasDocs ? (
        <DocumentsDetail docs={chunk.docs} />
      ) : (
        <p className="docs-pending">
          Source documents appear once this chunk finishes.
        </p>
      )}
    </article>
  );
}

export default memo(ChunkCard);
