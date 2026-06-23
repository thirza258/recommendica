import DocCard from "./DocCard";
import { Document } from "../interface";

function DocumentsDetail({ docs }: { docs: Document[] }) {
  return (
    <details className="chunk-docs-detail">
      <summary>
        {docs.length} document{docs.length !== 1 ? "s" : ""} used
      </summary>
      <div className="docs-grid">
        {docs.map((doc, i) => (
          <DocCard key={i} doc={doc} index={i} />
        ))}
      </div>
    </details>
  );
}

export default DocumentsDetail;