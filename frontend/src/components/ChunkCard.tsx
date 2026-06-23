import { ScoreBadge, ClaimList } from "../helper";
import { ChunkResponse } from "../interface";
import DocumentsDetail from "./DocumentDetail";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

  return (
    <article
      className={`chunk-card${isStreaming ? " chunk-card--streaming" : ""}`}
    >
      <div className="chunk-response-header">
        <p className="section-label">
          Chunk {chunk.chunk_index} of {numChunks}
          {isStreaming && (
            <span className="streaming-pulse" title="Streaming response...">
              {" "}
              streaming
            </span>
          )}
        </p>
        <ScoreBadge
          score={chunk.evaluation?.faithfulness_score ?? null}
          label="Faithfulness"
        />
      </div>
      <div className="chunk-response-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {chunk.generated_response}
        </ReactMarkdown>
      </div>

      {chunk.evaluation?.claims && chunk.evaluation.claims.length > 0 && (
        <ClaimList claims={chunk.evaluation.claims} />
      )}

      {hasDocs ? (
        <DocumentsDetail docs={chunk.docs} />
      ) : (
        <p className="docs-pending">
          Documents will appear when the chunk completes.
        </p>
      )}
    </article>
  );
}

export default ChunkCard;
