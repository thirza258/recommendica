import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import TopBar from "../components/Topbar";
import { Icon } from "./icons";
import { Dialog, MenuButton } from "./ui";
import { newDocumentId, relativeTime } from "./documents.ts";
import type { DocumentSummary } from "./documents.ts";
import { createFromTemplate, DESIGN_GROUPS, DESIGNS, TEMPLATES } from "./templates.ts";
import type { TemplateDesign, TemplateInfo } from "./templates.ts";
import { documentHref } from "./routes.ts";
import type { DocumentStore } from "./storage.ts";
import { setPendingNotice } from "./pendingNotice.ts";
import type { Upload } from "./importing/index.ts";

interface DocumentsHomeProps {
  store: DocumentStore;
  onHome: () => void;
}

function TemplateThumb({ template }: { template: TemplateInfo }) {
  const twoColumn = [
    "ieee-conference",
    "latex-ieee",
    "ml-conference",
    "latex-ml-conference",
    "physics-revtex",
    "latex-revtex",
  ].includes(template.id);

  const latexBadges: Record<string, string> = {
    "latex-ieee": "IEEEtran",
    "latex-arxiv-preprint": "arXiv",
    "latex-ml-conference": "NeurIPS",
    "latex-revtex": "REVTeX",
    "latex-amsart": "amsart",
    "latex-article": "article",
  };

  if (template.kind === "latex") {
    const badge = latexBadges[template.id] || (twoColumn ? "2-col" : undefined);
    return (
      <span className="write-thumb write-thumb--latex" aria-hidden="true">
        <span className="write-thumb-code">\documentclass</span>
        <span className="write-thumb-code write-thumb-code--dim">\begin{"{document}"}</span>
        <span className="write-thumb-code">\section{"{…}"}</span>
        <span className="write-thumb-code write-thumb-code--dim">$E = mc^2$</span>
        <span className="write-thumb-code">\cite{"{…}"}</span>
        {badge && <span className="write-thumb-badge">{badge}</span>}
      </span>
    );
  }
  const blank = template.id === "blank";
  return (
    <span className={`write-thumb${twoColumn ? " write-thumb--cols" : ""}`} aria-hidden="true">
      <span className="write-thumb-title" />
      {!blank && <span className="write-thumb-author" />}
      {!blank && <span className="write-thumb-abstract" />}
      {blank ? (
        <span className="write-thumb-plus">
          <Icon name="plus" size={28} />
        </span>
      ) : (
        <span className="write-thumb-body">
          {Array.from({ length: twoColumn ? 14 : 8 }, (_, index) => (
            <span key={index} className={`write-thumb-line${index % 5 === 4 ? " write-thumb-line--short" : ""}`} />
          ))}
          {(template.id === "research-article" || template.id === "math-amsart") && <span className="write-thumb-eq">∑</span>}
          {template.id === "physics-revtex" && <span className="write-thumb-eq">∫</span>}
          {template.id === "literature-review" && <span className="write-thumb-table" />}
        </span>
      )}
    </span>
  );
}

export default function DocumentsHome({ store, onHome }: DocumentsHomeProps) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "visual" | "latex">("all");
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState("");
  const [dragging, setDragging] = useState(false);
  const documentInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await store.list());
    } catch {
      setError("Your saved papers could not be read from browser storage.");
      setDocs([]);
    }
  }, [store]);

  useEffect(() => {
    document.title = "Write a paper — Recommendica";
    void refresh();
    return store.subscribe(() => void refresh());
  }, [refresh, store]);

  const open = (id: string) => {
    window.location.hash = documentHref(id).slice(1);
  };

  const create = async (templateId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = createFromTemplate(templateId);
      await store.put(doc);
      open(doc.id);
    } catch {
      setError("The paper could not be created. Browser storage may be full or blocked.");
    } finally {
      setBusy(false);
    }
  };

  /** Imports a document (as a LaTeX paper) or a LaTeX project, then opens it. */
  const runImport = async (collect: () => Promise<Upload[]>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setImporting("Reading the files…");
    try {
      const importing = await import("./importing/index.ts");
      const uploads = await collect();
      const outcome = await importing.importUploads(uploads, setImporting);
      setImporting("Saving…");
      await store.put(outcome.doc);
      setPendingNotice(outcome.doc.id, outcome.notice);
      open(outcome.doc.id);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Those files could not be imported.");
    } finally {
      setBusy(false);
      setImporting("");
      for (const input of [documentInput.current, projectInput.current, folderInput.current]) if (input) input.value = "";
    }
  };

  const importFromInput = (list: FileList | null) => {
    if (!list?.length) return;
    const uploads: Upload[] = Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
    void runImport(async () => uploads);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    // Folder entries are only available while the drop event runs.
    const entries = Array.from(event.dataTransfer.items ?? [])
      .map((item) => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => entry !== null);
    const files = Array.from(event.dataTransfer.files);
    if (!entries.length && !files.length) return;
    void runImport(async () => (await import("./importing/index.ts")).uploadsFromEntries(entries, files));
  };

  const duplicate = async (summary: DocumentSummary) => {
    const doc = await store.get(summary.id);
    if (!doc) return;
    const now = Date.now();
    await store.put({ ...doc, id: newDocumentId(), title: `Copy of ${doc.title}`, createdAt: now, updatedAt: now });
    await refresh();
  };

  const rename = async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    const doc = await store.get(renaming.id);
    setRenaming(null);
    if (!doc || !title || title === doc.title) return;
    await store.put({ ...doc, title, updatedAt: Date.now() });
    await refresh();
  };

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await store.remove(target.id);
    await refresh();
  };

  // Each design is one card: its visual version (or the LaTeX one when that
  // is the only one, or when the LaTeX filter is on), plus a link to the other.
  const designGroups = useMemo(() => {
    const info = (id: string | undefined) => TEMPLATES.find((template) => template.id === id) ?? null;
    return DESIGN_GROUPS.map((group) => ({
      ...group,
      designs: DESIGNS.filter((design) => design.group === group.id)
        .map((design: TemplateDesign) => {
          const primary = info(templateFilter === "latex" ? design.latex : (design.visual ?? (templateFilter === "visual" ? undefined : design.latex)));
          const secondaryId = templateFilter === "all" ? (primary?.kind === "visual" ? design.latex : undefined) : undefined;
          return primary ? { design, primary, secondary: info(secondaryId) } : null;
        })
        .filter((entry) => entry !== null),
    })).filter((group) => group.designs.length);
  }, [templateFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (docs ?? []).filter((doc) => !needle || doc.title.toLowerCase().includes(needle) || doc.excerpt.toLowerCase().includes(needle));
  }, [docs, query]);

  return (
    <div className="app-shell write-home">
      <TopBar
        status="idle"
        onHome={onHome}
        onSearch={() => {
          window.location.hash = "search";
        }}
        isWriting
      />
      <main
        className="write-home-main"
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="write-drop-overlay" aria-hidden="true">
            <Icon name="upload" size={28} />
            Drop a Word or Markdown document, a LaTeX .zip or a project folder
          </div>
        )}
        <section className="write-start" aria-labelledby="write-start-heading">
          <div className="write-start-head">
            <div>
              <p className="write-eyebrow">
                <Icon name="fileText" size={16} /> Recommendica paper editor
              </p>
              <h1 id="write-start-heading">Write your paper</h1>
              <p className="write-lead">
                Draft like in a word processor, with live equations, citations, cross-references and numbering — or write
                LaTeX with an instant preview. Export a PDF or a LaTeX project for submission.
              </p>
            </div>
            <div className="write-start-actions">
              <button type="button" className="ghost-button" onClick={() => documentInput.current?.click()} disabled={busy} title="Word (.docx), Markdown or text: converted to a LaTeX paper">
                <Icon name="fileText" size={16} />
                Import a document
              </button>
              <button type="button" className="ghost-button" onClick={() => projectInput.current?.click()} disabled={busy} title="A .zip of a LaTeX project (for example from Overleaf), or its .tex, .bib and figure files">
                <Icon name="upload" size={16} />
                Upload a LaTeX project
              </button>
              <button type="button" className="write-link-button" onClick={() => folderInput.current?.click()} disabled={busy}>
                or a project folder
              </button>
              <input
                ref={documentInput}
                type="file"
                hidden
                accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                onChange={(event) => importFromInput(event.target.files)}
              />
              <input
                ref={projectInput}
                type="file"
                hidden
                multiple
                accept=".zip,.tex,.ltx,.bib,.bbl,.sty,.cls,.bst,.txt,.pdf,.eps,image/png,image/jpeg,image/gif,image/svg+xml,image/webp,application/zip"
                onChange={(event) => importFromInput(event.target.files)}
              />
              <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} onChange={(event) => importFromInput(event.target.files)} />
            </div>
          </div>
          <p className="write-import-hint">
            Word documents keep their headings, lists, tables, equations, pictures, footnotes and Zotero or Mendeley citations. You can also drop
            files or a folder anywhere on this page.
          </p>
          {importing && (
            <p className="write-import-status" role="status">
              <span className="write-spinner" aria-hidden="true" /> {importing}
            </p>
          )}
          {error && (
            <p className="write-error" role="alert">
              <Icon name="alertCircle" size={16} /> {error}
            </p>
          )}
          <div className="write-templates-head">
            <h2 className="write-section-title">Start a new paper</h2>
            <div className="write-tabs write-templates-filter" role="tablist" aria-label="Filter templates by format">
              <button
                type="button"
                role="tab"
                aria-selected={templateFilter === "all"}
                onClick={() => setTemplateFilter("all")}
              >
                All formats
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateFilter === "visual"}
                onClick={() => setTemplateFilter("visual")}
              >
                Visual
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateFilter === "latex"}
                onClick={() => setTemplateFilter("latex")}
              >
                LaTeX
              </button>
            </div>
          </div>
          <div className="write-design-groups">
            {designGroups.map((group) => (
              <section key={group.id} className="write-design-group" aria-labelledby={`write-designs-${group.id}`}>
                <h3 id={`write-designs-${group.id}`} className="write-design-group-title">
                  {group.title}
                </h3>
                {group.note && <p className="write-design-note">{group.note}</p>}
                <ul className="write-templates">
                  {group.designs.map(({ design, primary, secondary }) => (
                    <li key={design.id} className="write-design">
                      <button type="button" className="write-template" onClick={() => void create(primary.id)} disabled={busy}>
                        <TemplateThumb template={primary} />
                        <span className="write-template-name">{design.name}</span>
                        <span className="write-template-desc">{design.description}</span>
                        <span className={`write-kind write-kind--${primary.kind}`}>{primary.kind === "latex" ? "LaTeX" : "Visual"}</span>
                      </button>
                      {secondary && (
                        <button
                          type="button"
                          className="write-design-alt"
                          onClick={() => void create(secondary.id)}
                          disabled={busy}
                          aria-label={`Start ${design.name} in LaTeX`}
                        >
                          or start in LaTeX
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section className="write-recent" aria-labelledby="write-recent-heading">
          <div className="write-recent-head">
            <h2 id="write-recent-heading" className="write-section-title">
              Your papers
            </h2>
            {docs && docs.length > 3 && (
              <label className="write-filter">
                <Icon name="search" size={16} />
                <span className="visually-hidden">Filter papers</span>
                <input type="search" value={query} placeholder="Filter papers" onChange={(event) => setQuery(event.target.value)} />
              </label>
            )}
          </div>
          {docs === null ? (
            <p className="write-muted" role="status">
              Loading…
            </p>
          ) : visible.length === 0 ? (
            <p className="write-empty">{docs.length ? "No paper matches that filter." : "Papers you create appear here. Pick a template above to begin."}</p>
          ) : (
            <ul className="write-doc-list">
              {visible.map((doc) => (
                <li key={doc.id} className="write-doc">
                  <a className="write-doc-link" href={documentHref(doc.id)}>
                    <span className={`write-doc-icon write-doc-icon--${doc.kind}`} aria-hidden="true">
                      <Icon name={doc.kind === "latex" ? "fileCode" : "fileText"} size={20} />
                    </span>
                    <span className="write-doc-text">
                      <span className="write-doc-title">{doc.title}</span>
                      <span className="write-doc-meta">
                        {doc.kind === "latex" ? "LaTeX" : "Visual"} · Edited {relativeTime(doc.updatedAt)}
                      </span>
                      {doc.excerpt && <span className="write-doc-excerpt">{doc.excerpt}</span>}
                    </span>
                  </a>
                  <MenuButton
                    label={`More actions for ${doc.title}`}
                    align="end"
                    className="write-doc-more"
                    items={[
                      { label: "Open", icon: "folderOpen", onSelect: () => open(doc.id) },
                      {
                        label: "Rename…",
                        icon: "pencil",
                        onSelect: () => {
                          setRenameValue(doc.title);
                          setRenaming(doc);
                        },
                      },
                      { label: "Make a copy", icon: "copy", onSelect: () => void duplicate(doc) },
                      "separator",
                      { label: "Delete…", icon: "trash", onSelect: () => setDeleting(doc) },
                    ]}
                  >
                    <Icon name="more" />
                  </MenuButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="write-storage-note" role={store.persistent ? undefined : "status"}>
          <Icon name={store.persistent ? "check" : "alertTriangle"} size={16} />
          {store.persistent
            ? "Papers are saved in this browser only — no account, no upload. Export a LaTeX project or PDF to keep a copy elsewhere."
            : "Browser storage is unavailable, so papers last only while this tab is open. Export your work before closing it."}
        </p>
      </main>

      {renaming && (
        <Dialog
          title="Rename paper"
          size="sm"
          onClose={() => setRenaming(null)}
          initialFocusId="write-rename-input"
          footer={
            <>
              <button type="button" className="ghost-button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" form="write-rename-form" className="primary-button">
                Rename
              </button>
            </>
          }
        >
          <form
            id="write-rename-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <label className="write-field">
              <span>Title</span>
              <input id="write-rename-input" value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} />
            </label>
          </form>
        </Dialog>
      )}

      {deleting && (
        <Dialog
          title="Delete this paper?"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="ghost-button" onClick={() => setDeleting(null)}>
                Keep it
              </button>
              <button type="button" className="primary-button write-danger" onClick={() => void remove()}>
                Delete permanently
              </button>
            </>
          }
        >
          <p>
            “{deleting.title}” will be removed from this browser. This cannot be undone; export it first if you might need it.
          </p>
        </Dialog>
      )}
    </div>
  );
}
