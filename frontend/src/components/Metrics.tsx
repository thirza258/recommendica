import {pct} from "../helper"

function Metrics({
  totalDocs,
  numChunks,
  aggFaithfulness,
}: {
  totalDocs: number;
  numChunks: number;
  aggFaithfulness: number | null;
}) {
  return (
    <div className="hero-metrics" aria-label="Result highlights">
      <div>
        <strong>{totalDocs || "—"}</strong>
        <span>docs retrieved</span>
      </div>
      <div>
        <strong>{numChunks || "—"}</strong>
        <span>response chunk{numChunks !== 1 ? "s" : ""}</span>
      </div>
      <div>
        <strong>{pct(aggFaithfulness)}</strong>
        <span>faithfulness</span>
      </div>
    </div>
  );
}

export default Metrics;