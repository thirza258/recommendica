import { ScoreBadge, ClaimList } from "../helper";
import { ChunkResponse } from "../interface";
import DocumentsDetail from "./DocumentDetail";

function ChunkCard({
  chunk,
  numChunks,
}: {
  chunk: ChunkResponse;
  numChunks: number;
}) {
  return (
    <article className="chunk-card">
      <div className="chunk-response-header">
        <p className="section-label">
          Chunk {chunk.chunk_index} of {numChunks}
        </p>
        <ScoreBadge
          score={chunk.evaluation?.faithfulness_score ?? null}
          label="Faithfulness"
        />
      </div>
      <p className="chunk-response-text">{chunk.generated_response}</p>

      {chunk.evaluation?.claims && chunk.evaluation.claims.length > 0 && (
        <ClaimList claims={chunk.evaluation.claims} />
      )}

      <DocumentsDetail docs={chunk.docs} />
    </article>
  );
}

export default ChunkCard;