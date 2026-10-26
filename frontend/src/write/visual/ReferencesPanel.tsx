import { useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ToolButton } from "../ui";
import { buildBibliography, makeCiteKey, parseBibtex, serializeBibEntry, serializeBibtex } from "../latex/bibtex.ts";
import type { BibEntry, CitationStyle } from "../latex/bibtex.ts";
import { fetchBibtex } from "./doi.ts";

interface ReferencesPanelProps {
  bib: string;
  onBibChange: (bib: string) => void;
  style: CitationStyle;
  onStyleChange: (style: CitationStyle) => void;
  citedKeys: string[];
  missingKeys: string[];
  onCite: (key: string) => void;
  onClose: () => void;
}

type AddMode = "doi" | "bibtex" | "manual";

const EMPTY_MANUAL = { type: "article", author: "", title: "", year: "", venue: "", volume: "", pages: "", doi: "", url: "" };

/** Adds entries, renaming keys that already exist so citations stay unambiguous. */
function mergeEntries(existing: BibEntry[], incoming: BibEntry[]): { entries: BibEntry[]; added: string[] } {
  const keys = new Set(existing.map((entry) => entry.key));
  const added: string[] = [];
  const merged = [...existing];
  for (const entry of incoming) {
    const key = keys.has(entry.key) ? makeCiteKey(entry, keys) : entry.key;
    keys.add(key);
    added.push(key);
    merged.push({ ...entry, key });
  }
  return { entries: merged, added };
}

export default function ReferencesPanel({ bib, onBibChange, style, onStyleChange, citedKeys, missingKeys, onCite, onClose }: ReferencesPanelProps) {
  const [mode, setMode] = useState<AddMode>("doi");
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [pasted, setPasted] = useState("");
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [rawBib, setRawBib] = useState(bib);
  const abort = useRef<AbortController | null>(null);

  const database = useMemo(() => parseBibtex(bib), [bib]);
  const formatted = useMemo(
    () => buildBibliography(database.entries, { style, citedKeys, includeAll: true }),
    [database, style, citedKeys],
  );
  const htmlByKey = useMemo(() => new Map(formatted.items.map((item) => [item.key, item])), [formatted]);

  const add = (incoming: BibEntry[]) => {
    if (!incoming.length) {
      setMessage("No BibTeX entries were found in that text.");
      return;
    }
    const { entries, added } = mergeEntries(database.entries, incoming);
    onBibChange(serializeBibtex(entries));
    setMessage(`Added ${added.join(", ")}.`);
    setIdentifier("");
    setPasted("");
    setManual(EMPTY_MANUAL);
  };

  const lookup = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setMessage("");
    try {
      add(parseBibtex(await fetchBibtex(identifier, controller.signal)).entries);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "The lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  const addManual = () => {
    if (!manual.title.trim()) {
      setMessage("A reference needs at least a title.");
      return;
    }
    const authors = manual.author
      .split(/\n|;/)
      .map((name) => name.trim())
      .filter(Boolean)
      .join(" and ");
    const venueField = manual.type === "inproceedings" ? "booktitle" : manual.type === "article" ? "journal" : "publisher";
    const fields: Record<string, string> = {};
    if (authors) fields.author = authors;
    fields.title = manual.title.trim();
    if (manual.venue.trim()) fields[venueField] = manual.venue.trim();
    if (manual.year.trim()) fields.year = manual.year.trim();
    if (manual.volume.trim()) fields.volume = manual.volume.trim();
    if (manual.pages.trim()) fields.pages = manual.pages.trim().replace(/[–—]/g, "--");
    if (manual.doi.trim()) fields.doi = manual.doi.trim();
    if (manual.url.trim()) fields.url = manual.url.trim();
    const keys = new Set(database.entries.map((entry) => entry.key));
    add([{ type: manual.type, key: makeCiteKey({ fields }, keys), fields, line: 0 }]);
  };

  const remove = (key: string) => {
    onBibChange(serializeBibtex(database.entries.filter((entry) => entry.key !== key)));
  };

  return (
    <aside className="write-panel write-panel--right" aria-label="References">
      <div className="write-panel-head">
        <h2>References</h2>
        <ToolButton icon="close" label="Close references" onClick={onClose} />
      </div>
      <div className="write-panel-body write-refs-body">
        <label className="write-field">
          <span>Citation style</span>
          <select value={style} onChange={(event) => onStyleChange(event.target.value as CitationStyle)}>
            <option value="ieee">Numbered — [1] (IEEE)</option>
            <option value="apa">Author–year — (Smith, 2020) (APA)</option>
          </select>
        </label>

        {!adding ? (
          <button type="button" className="ghost-button write-wide-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add a reference
          </button>
        ) : (
          <div className="write-add-ref">
            <div className="write-tabs" role="tablist" aria-label="Add by">
              {(["doi", "bibtex", "manual"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}>
                  {value === "doi" ? "DOI / arXiv" : value === "bibtex" ? "BibTeX" : "Manual"}
                </button>
              ))}
            </div>
            {mode === "doi" && (
              <form
                className="write-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void lookup();
                }}
              >
                <label className="write-field">
                  <span>DOI or arXiv id</span>
                  <input value={identifier} placeholder="10.1038/nature14539 or 1706.03762" onChange={(event) => setIdentifier(event.target.value)} />
                </label>
                <p className="write-hint">Looks up the citation at doi.org; nothing else about your paper is sent.</p>
                <button type="submit" className="primary-button" disabled={busy || !identifier.trim()}>
                  {busy ? "Looking up…" : "Add"}
                </button>
              </form>
            )}
            {mode === "bibtex" && (
              <form
                className="write-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  add(parseBibtex(pasted).entries);
                }}
              >
                <label className="write-field">
                  <span>Paste BibTeX</span>
                  <textarea className="write-code" rows={6} value={pasted} placeholder="@article{key, author = {...}, title = {...}, year = {2024}}" onChange={(event) => setPasted(event.target.value)} />
                </label>
                <button type="submit" className="primary-button" disabled={!pasted.trim()}>
                  Add entries
                </button>
              </form>
            )}
            {mode === "manual" && (
              <form
                className="write-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  addManual();
                }}
              >
                <label className="write-field">
                  <span>Type</span>
                  <select value={manual.type} onChange={(event) => setManual({ ...manual, type: event.target.value })}>
                    <option value="article">Journal article</option>
                    <option value="inproceedings">Conference paper</option>
                    <option value="book">Book</option>
                    <option value="misc">Web page or other</option>
                  </select>
                </label>
                <label className="write-field">
                  <span>Authors (one per line, “Last, First”)</span>
                  <textarea rows={3} value={manual.author} onChange={(event) => setManual({ ...manual, author: event.target.value })} />
                </label>
                <label className="write-field">
                  <span>Title</span>
                  <input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} />
                </label>
                <label className="write-field">
                  <span>{manual.type === "inproceedings" ? "Conference" : manual.type === "article" ? "Journal" : "Publisher"}</span>
                  <input value={manual.venue} onChange={(event) => setManual({ ...manual, venue: event.target.value })} />
                </label>
                <div className="write-field-row">
                  <label className="write-field">
                    <span>Year</span>
                    <input inputMode="numeric" value={manual.year} onChange={(event) => setManual({ ...manual, year: event.target.value })} />
                  </label>
                  <label className="write-field">
                    <span>Volume</span>
                    <input value={manual.volume} onChange={(event) => setManual({ ...manual, volume: event.target.value })} />
                  </label>
                  <label className="write-field">
                    <span>Pages</span>
                    <input value={manual.pages} onChange={(event) => setManual({ ...manual, pages: event.target.value })} />
                  </label>
                </div>
                <label className="write-field">
                  <span>DOI</span>
                  <input value={manual.doi} onChange={(event) => setManual({ ...manual, doi: event.target.value })} />
                </label>
                <label className="write-field">
                  <span>URL</span>
                  <input type="url" value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} />
                </label>
                <button type="submit" className="primary-button">
                  Add reference
                </button>
              </form>
            )}
            <button type="button" className="ghost-button" onClick={() => setAdding(false)}>
              Done adding
            </button>
          </div>
        )}
        {message && (
          <p className="write-hint" role="status">
            {message}
          </p>
        )}

        {missingKeys.length > 0 && (
          <p className="write-error">
            <Icon name="alertTriangle" size={16} /> Cited but not in the list: {missingKeys.join(", ")}
          </p>
        )}
        {database.diagnostics.length > 0 && (
          <p className="write-hint">
            {database.diagnostics.length} BibTeX {database.diagnostics.length === 1 ? "problem" : "problems"}: {database.diagnostics[0].message}
          </p>
        )}

        {database.entries.length === 0 ? (
          <p className="write-empty">No references yet. Add one by DOI, arXiv id or BibTeX, then cite it from the toolbar.</p>
        ) : (
          <ul className="write-refs">
            {database.entries.map((entry) => {
              const item = htmlByKey.get(entry.key);
              const cited = citedKeys.includes(entry.key);
              return (
                <li key={entry.key} className="write-ref">
                  <span className="write-ref-text">
                    {item?.label && <strong>{item.label} </strong>}
                    <span dangerouslySetInnerHTML={{ __html: item?.html ?? entry.key }} />
                  </span>
                  <span className="write-ref-meta">
                    <span className="write-ref-key" title={entry.key}>
                      {entry.key}
                    </span>
                    <span>{cited ? "· cited" : "· not cited"}</span>
                    <span className="write-ref-actions">
                      <ToolButton icon="citation" label={`Cite ${entry.key} at the cursor`} onClick={() => onCite(entry.key)} />
                      <ToolButton icon="copy" label={`Copy BibTeX for ${entry.key}`} onClick={() => void navigator.clipboard?.writeText(serializeBibEntry(entry))} />
                      <ToolButton icon="trash" label={`Remove ${entry.key}`} onClick={() => remove(entry.key)} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="write-refs-footer">
          {editing ? (
            <>
              <label className="write-field">
                <span>All references as BibTeX</span>
                <textarea className="write-code" rows={14} spellCheck={false} value={rawBib} onChange={(event) => setRawBib(event.target.value)} />
              </label>
              <div className="write-field-row">
                <button type="button" className="ghost-button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    onBibChange(rawBib);
                    setEditing(false);
                  }}
                >
                  Save BibTeX
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="ghost-button write-wide-button"
              onClick={() => {
                setRawBib(bib);
                setEditing(true);
              }}
            >
              <Icon name="braces" size={16} /> Edit BibTeX directly
            </button>
          )}
          <a className="write-hint write-find-papers" href="/#search" target="_blank" rel="noopener noreferrer">
            <Icon name="search" size={14} /> Find papers to cite with Recommendica search
          </a>
        </div>
      </div>
    </aside>
  );
}
