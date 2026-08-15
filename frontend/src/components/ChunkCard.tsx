import { ScoreBadge, ClaimList } from "../helper";
import { ChunkResponse } from "../interface";
import DocumentsDetail from "./DocumentDetail";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
}: {
  chunk: ChunkResponse;
  numChunks: number;
  isStreaming?: boolean;
}) {
  const hasDocs = chunk.docs && chunk.docs.length > 0;
  const hasText = chunk.generated_response.length > 0;

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
        </p>
        <ScoreBadge
          score={chunk.evaluation?.faithfulness_score ?? null}
          label="Faithfulness"
        />
      </div>

      <div className="chunk-response-text">
        {hasText ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {chunk.generated_response}
          </ReactMarkdown>
        ) : (
          <AnswerSkeleton />
        )}
      </div>

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

export default ChunkCard;
