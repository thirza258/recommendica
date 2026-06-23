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
    <section className="chunks-section">
      <div className="chunks-header">
        <div>
          <p className="section-label">Results</p>
          {query && <p className="chunks-query">{`<< ${query} >>`}</p>}
        </div>
        <ScoreBadge
          score={aggFaithfulness}
          label="Aggregate faithfulness"
        />
      </div>

      {chunks.map((chunk) => (
        <ChunkCard
          key={chunk.chunk_index}
          chunk={chunk}
          numChunks={numChunks}
          isStreaming={isLoading && !chunk.docs?.length}
        />
      ))}
    </section>
  );
}

export default ChunksList;
