import DocCard from "./DocCard";
import { Document } from "../interface";
import { ChevronRightIcon, FileTextIcon } from "./Icons";

function DocumentsDetail({ docs }: { docs: Document[] }) {
  return (
    <details className="chunk-docs-detail">
      <summary>
        <ChevronRightIcon size={16} className="claims-chevron" />
        <FileTextIcon size={16} />
        {docs.length} source document{docs.length !== 1 ? "s" : ""}
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
