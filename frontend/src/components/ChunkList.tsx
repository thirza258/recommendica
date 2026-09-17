import { ScoreBadge } from "../helper";
import { ChunkResponse } from "../interface";
import ChunkCard from "./ChunkCard";

function ChunksList({
  chunks,
  numChunks,
  query,
  aggFaithfulness,
  isLoading,
}: {
  chunks: ChunkResponse[];
  numChunks: number;
  query: string;
  aggFaithfulness: number | null;
  isLoading?: boolean;
}) {
  return (
    <section className="chunks-section" aria-label="Results">
      <div className="chunks-header">
        <div>
          <p className="section-label">Results · Adaptive research</p>
          {query && <p className="chunks-query">&ldquo;{query}&rdquo;</p>}
        </div>
        <ScoreBadge score={aggFaithfulness} label="Source support" />
      </div>

      {chunks.map((chunk) => (
        <ChunkCard
          key={chunk.chunk_index}
          chunk={chunk}
          numChunks={numChunks}
          isStreaming={isLoading && !chunk.complete}
          isEvaluating={Boolean(chunk.answer_review) && isLoading && chunk.complete && !chunk.evaluation && !chunk.error}
          isLoading={isLoading}
        />
      ))}
    </section>
  );
}

export default ChunksList;
