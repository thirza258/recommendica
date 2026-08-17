import { parseDoc } from "../helper";
import { Document } from "../interface";

function DocCard({ doc, index }: { doc: Document; index: number }) {
  const info = parseDoc(doc);
  if (!info) return null;

  // Papers the live arXiv search supplied are not in the indexed corpus, so
  // they are labelled: "where did this come from" is a fair question to ask of
  // a source you are about to cite.
  const fromArxiv = doc.meta?.source === "arxiv_api";
  const url = typeof doc.meta?.url === "string" ? doc.meta.url : "";

  return (
    <div className="doc-card">
      <div className="doc-title-row">
        <span className="doc-index" aria-hidden="true">
          {index + 1}
        </span>
        <h3>{info.title}</h3>
      </div>

      <div className="doc-body">
        <div className="doc-tags">
          {info.category && <span className="doc-category">{info.category}</span>}
          {fromArxiv && (
            <span className="doc-category doc-category--live">
              live from arXiv
            </span>
          )}
        </div>
        <p className="doc-summary">{info.summary}</p>
        {info.authors && <p className="doc-authors">{info.authors}</p>}
        {fromArxiv && url && (
          <p className="doc-authors">
            <a href={url} target="_blank" rel="noopener noreferrer">
              View on arXiv
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

export default DocCard;
