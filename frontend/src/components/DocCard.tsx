import { parseDoc } from "../helper";
import { Document } from "../interface";

function DocCard({ doc, index }: { doc: Document; index: number }) {
  const info = parseDoc(doc);
  if (!info) return null;

  return (
    <div className="doc-card">
      <div className="doc-title-row">
        <span className="doc-index">{index + 1}</span>
        <h3>{info.title}</h3>
      </div>
      {info.category && (
        <span className="doc-category">{info.category}</span>
      )}
      <p className="doc-summary">{info.summary}</p>
      {info.authors && (
        <div className="doc-authors">{info.authors}</div>
      )}
    </div>
  );
}

export default DocCard;