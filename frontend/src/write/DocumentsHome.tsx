import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "../components/Topbar";
import { Icon } from "./icons";
import { Dialog, MenuButton } from "./ui";
import { BIB_FILE, MAIN_FILE, newDocumentId, relativeTime } from "./documents.ts";
import type { DocumentSummary, PaperDocument, ProjectAsset, ProjectFile } from "./documents.ts";
import { createFromTemplate, TEMPLATES } from "./templates.ts";
import type { TemplateInfo } from "./templates.ts";
import { documentHref } from "./routes.ts";
import type { DocumentStore } from "./storage.ts";
import { readImageFile } from "./images.ts";

interface DocumentsHomeProps {
  store: DocumentStore;
  onHome: () => void;
}

function TemplateThumb({ template }: { template: TemplateInfo }) {
  const twoColumn = template.id === "ieee-conference" || template.id === "latex-ieee";
  if (template.kind === "latex") {
    return (
      <span className="write-thumb write-thumb--latex" aria-hidden="true">
        <span className="write-thumb-code">\documentclass</span>
        <span className="write-thumb-code write-thumb-code--dim">\begin{"{document}"}</span>
        <span className="write-thumb-code">\section{"{…}"}</span>
        <span className="write-thumb-code write-thumb-code--dim">$E = mc^2$</span>
        <span className="write-thumb-code">\cite{"{…}"}</span>
        {twoColumn && <span className="write-thumb-badge">IEEEtran</span>}
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
          {template.id === "research-article" && <span className="write-thumb-eq">∑</span>}
          {template.id === "literature-review" && <span className="write-thumb-table" />}
        </span>
      )}
    </span>
  );
}

function titleFromLatex(source: string, fallback: string): string {
  const match = /\\title\s*(?:\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(source);
  const title = match?.[1].replace(/\\\\/g, " ").replace(/\\[a-zA-Z]+\*?/g, "").replace(/[{}~]/g, " ").replace(/\s+/g, " ").trim();
  return title || fallback;
}

export default function DocumentsHome({ store, onHome }: DocumentsHomeProps) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const importFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      const files: ProjectFile[] = [];
      const assets: ProjectAsset[] = [];
      for (const file of Array.from(list)) {
        if (/\.(tex|bib|sty|cls|bst|txt)$/i.test(file.name)) {
          files.push({ name: file.name, content: await file.text() });
        } else if (file.type.startsWith("image/")) {
          const image = await readImageFile(file);
          assets.push({ name: file.name, type: image.type, dataUrl: image.dataUrl, size: image.size });
        }
      }
      const texFiles = files.filter((file) => file.name.toLowerCase().endsWith(".tex"));
      if (!texFiles.length) {
        setError("Choose at least one .tex file. You can add .bib files and images in the same selection.");
        return;
      }
      const main = texFiles.find((file) => /\\documentclass/.test(file.content)) ?? texFiles[0];
      const now = Date.now();
      const base = createFromTemplate("latex-blank", now);
      const others = files.filter((file) => file !== main);
      if (!others.some((file) => file.name.toLowerCase().endsWith(".bib"))) others.push({ name: BIB_FILE, content: "" });
      const doc: PaperDocument = {
        ...base,
        id: newDocumentId(),
        title: titleFromLatex(main.content, main.name.replace(/\.tex$/i, "")),
        template: "import",
        source: main.content,
        files: others.map((file) => (file.name === MAIN_FILE ? { ...file, name: `imported-${file.name}` } : file)),
        assets,
      };
      await store.put(doc);
      open(doc.id);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Those files could not be imported.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
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
      <main className="write-home-main">
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
              <button type="button" className="ghost-button" onClick={() => fileInput.current?.click()} disabled={busy}>
                <Icon name="upload" size={16} />
                Open .tex files
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept=".tex,.bib,.sty,.cls,.bst,image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                onChange={(event) => void importFiles(event.target.files)}
              />
            </div>
          </div>
          {error && (
            <p className="write-error" role="alert">
              <Icon name="alertCircle" size={16} /> {error}
            </p>
          )}
          <h2 className="write-section-title">Start a new paper</h2>
          <ul className="write-templates">
            {TEMPLATES.map((template) => (
              <li key={template.id}>
                <button type="button" className="write-template" onClick={() => void create(template.id)} disabled={busy}>
                  <TemplateThumb template={template} />
                  <span className="write-template-name">{template.name}</span>
                  <span className="write-template-desc">{template.description}</span>
                  <span className={`write-kind write-kind--${template.kind}`}>{template.kind === "latex" ? "LaTeX" : "Visual"}</span>
                </button>
              </li>
            ))}
          </ul>
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
