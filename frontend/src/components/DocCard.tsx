import { useState } from "react";
import { parseDoc } from "../helper";
import { Document } from "../interface";

function DocCard({ doc, index }: { doc: Document; index: number }) {
  const [copied, setCopied] = useState(false);
  const info = parseDoc(doc);
  if (!info) return null;

  // Papers the live arXiv search supplied are not in the indexed corpus, so
  // they are labelled: "where did this come from" is a fair question to ask of
  // a source you are about to cite.
  const fromArxiv = doc.meta?.source === "arxiv_api";
  const rawId = (doc.meta?.id || doc.meta?.arxiv_id || "") as string;
  const arxivId = String(rawId).replace(/^arxiv:\s*/i, "").trim();
  const url =
    typeof doc.meta?.url === "string" && doc.meta.url
      ? doc.meta.url
      : arxivId
        ? `https://arxiv.org/abs/${arxivId}`
        : "";

  const copyBibtex = () => {
    const yearMatch = arxivId.match(/^(\d{2})/);
    const year = doc.meta?.published
      ? new Date(doc.meta.published as string).getFullYear()
      : yearMatch
        ? 2000 + Number(yearMatch[1])
        : new Date().getFullYear();
    const authors = (info.authors || "Unknown").replace(/,/g, " and");
    const firstAuthor =
      authors.split(/\s+and\s+/i)[0].split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") || "paper";
    const key = `${firstAuthor}${year}${arxivId ? arxivId.replace(/[^0-9]/g, "").slice(0, 4) : ""}`;
    const bibtex = `@article{${key},
  author        = {${authors}},
  title         = {${info.title.replace(/[{}]/g, "")}},
  journal       = {arXiv preprint arXiv:${arxivId || "unknown"}},
  year          = {${year}},
  eprint        = {${arxivId || "unknown"}},
  archivePrefix = {arXiv}${info.category ? `,\n  primaryClass  = {${info.category}}` : ""}
}`;
    void navigator.clipboard?.writeText(bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        <div className="doc-actions">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="ghost-button doc-action-btn">
              View on arXiv
            </a>
          )}
          <button
            type="button"
            className="ghost-button doc-action-btn"
            onClick={copyBibtex}
            title="Copy BibTeX entry to clipboard"
          >
            {copied ? "Copied BibTeX!" : "Copy BibTeX"}
          </button>
          <a
            href="#write"
            className="ghost-button doc-action-btn"
            title="Open paper in Recommendica Write"
          >
            Cite in Write
          </a>
        </div>
      </div>
    </div>
  );
}

export default DocCard;
