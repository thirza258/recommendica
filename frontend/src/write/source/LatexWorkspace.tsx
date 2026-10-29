import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import CodeEditor from "./CodeEditor";
import type { CodeEditorHandle } from "./CodeEditor";
import { RenderService } from "./renderService.ts";
import { patchChildren } from "./patchDom.ts";
import WorkspaceHeader from "../WorkspaceHeader";
import { Icon } from "../icons";
import { Dialog, MenuButton, ToolButton, ToolSeparator } from "../ui";
import type { MenuEntry } from "../ui";
import { BIB_FILE, MAIN_FILE, fileBaseName } from "../documents.ts";
import type { DocumentKind, PaperDocument, ProjectAsset } from "../documents.ts";
import type { DocumentStore } from "../storage.ts";
import { useAutosave } from "../useAutosave.ts";
import { readImageFile } from "../images.ts";
import { lookFromLayout, paperClassName, paperStyle } from "../paperStyle.ts";
import { parseBibtex } from "../latex/bibtex.ts";
import type { RenderDiagnostic, RenderResult } from "../latex/render.ts";
import { shortcut } from "../keys.ts";

interface LatexWorkspaceProps {
  initial: PaperDocument;
  store: DocumentStore;
  onSwitchMode: (current: PaperDocument, kind: DocumentKind) => Promise<void>;
  initialNotice?: string;
}

const SNIPPETS = {
  bold: "\\textbf{${selection}}",
  italic: "\\textit{${selection}}",
  math: "$${selection}$",
  equation: "\\begin{equation}\n\t${selection}\n\t\\label{eq:${label}}\n\\end{equation}",
  figure: "\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}\n\\end{figure}",
  table: "\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\t\\begin{tabular}{lcc}\n\t\t\\toprule\n\t\t${Header} & B & C \\\\\n\t\t\\midrule\n\t\t1 & 2 & 3 \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}",
  itemize: "\\begin{itemize}\n\t\\item ${selection}\n\\end{itemize}",
  enumerate: "\\begin{enumerate}\n\t\\item ${selection}\n\\end{enumerate}",
  cite: "\\cite{${}}",
  ref: "\\ref{${}}",
  footnote: "\\footnote{${selection}}",
  link: "\\href{${https://}}{${selection}}",
};

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,80}\.(tex|bib|sty|cls|bst|txt)$/;

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",", 2);
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  if (!meta.includes(";base64")) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  while (taken.has(`${stem}-${index}${ext}`)) index++;
  return `${stem}-${index}${ext}`;
}

function nearestBlock(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -1;
  root.querySelectorAll<HTMLElement>(":scope > [data-line], :scope > * > [data-line]").forEach((element) => {
    const value = Number(element.dataset.line);
    if (value <= line && value >= bestLine) {
      best = element;
      bestLine = value;
    }
  });
  return best;
}

interface PreviewProps {
  result: RenderResult | null;
  zoom: number | "fit";
  syncLine: number | null;
  onJump: (line: number) => void;
}

const SHEET_WIDTH_PX = { a4: 793.7, letter: 816 };

function LatexPreview({ result, zoom, syncLine, onJump }: PreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (bodyRef.current && result) patchChildren(bodyRef.current, result.html);
  }, [result]);

  useEffect(() => {
    const body = bodyRef.current;
    const scroller = scrollRef.current;
    if (!body || !scroller || syncLine === null) return;
    const block = nearestBlock(body, syncLine);
    if (!block) return;
    const view = scroller.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    if (rect.bottom < view.top + 24 || rect.top > view.bottom - 24) block.scrollIntoView({ block: "center" });
    block.classList.add("is-synced");
    const timer = window.setTimeout(() => block.classList.remove("is-synced"), 900);
    return () => {
      window.clearTimeout(timer);
      block.classList.remove("is-synced");
    };
  }, [syncLine]);

  const onClick = (event: ReactMouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#']");
    if (!link) return;
    // In-document links must not change the page's route hash.
    event.preventDefault();
    const id = decodeURIComponent(link.getAttribute("href")?.slice(1) ?? "");
    bodyRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const look = result ? lookFromLayout(result.layout) : null;
  const scale = zoom === "fit" ? Math.min(1.5, Math.max(0.3, (width - 8) / SHEET_WIDTH_PX[look?.paper ?? "a4"])) : zoom;
  return (
    <div
      ref={scrollRef}
      className="write-preview"
      onClick={onClick}
      onDoubleClick={(event) => {
        const block = (event.target as Element).closest<HTMLElement>("[data-line]");
        if (block?.dataset.line) onJump(Number(block.dataset.line));
      }}
      title="Double-click to jump to the source"
    >
      {look ? (
        <article className={`${paperClassName(look)} paper-sheet`} style={{ ...paperStyle(look), zoom: scale }} aria-label="Rendered preview">
          <div ref={bodyRef} className="paper-body" />
        </article>
      ) : (
        <div className="write-loading">
          <span className="write-spinner" aria-hidden="true" /> Rendering…
        </div>
      )}
    </div>
  );
}

function diagnosticWhere(diagnostic: RenderDiagnostic): string {
  if (diagnostic.file) return diagnostic.file;
  return `line ${diagnostic.line}`;
}

export default function LatexWorkspace({ initial, store, onSwitchMode, initialNotice = "" }: LatexWorkspaceProps) {
  const [title, setTitle] = useState(initial.title);
  const [fileNames, setFileNames] = useState<string[]>(() => [MAIN_FILE, ...initial.files.map((file) => file.name).filter((name) => name !== MAIN_FILE)]);
  const [active, setActive] = useState(MAIN_FILE);
  const [assets, setAssets] = useState<ProjectAsset[]>(initial.assets);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [renderError, setRenderError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [autoCompile, setAutoCompile] = useState(true);
  const [showFiles, setShowFiles] = useState(() => typeof window === "undefined" || window.innerWidth > 980);
  const [showProblems, setShowProblems] = useState(false);
  const [mobileView, setMobileView] = useState<"source" | "preview">("source");
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [syncLine, setSyncLine] = useState<number | null>(null);
  const [dialog, setDialog] = useState<"new-file" | "help" | { remove: string } | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [newFileError, setNewFileError] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [switching, setSwitching] = useState(false);

  // React clears an imperative handle before unmount cleanups run; the final
  // save still needs it, so keep the last one (it reads CodeMirror's saved states).
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const keepHandle = useCallback((handle: CodeEditorHandle | null) => {
    if (handle) editorRef.current = handle;
  }, []);
  const uploadRef = useRef<HTMLInputElement>(null);
  const texts = useRef(new Map<string, string>([[MAIN_FILE, initial.source], ...initial.files.map((file) => [file.name, file.content] as [string, string])]));
  const service = useMemo(() => new RenderService(), []);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const renderTimer = useRef<number | null>(null);
  const syncTimer = useRef<number | null>(null);
  const lastDuration = useRef(150);
  const activeRef = useRef(active);
  const switchingRef = useRef(false);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => () => service.dispose(), [service]);

  const getText = useCallback((name: string) => {
    if (editorRef.current) return editorRef.current.getText(name);
    return texts.current.get(name) ?? "";
  }, []);

  const assetUrls = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const asset of assets) {
      try {
        urls[asset.name] = URL.createObjectURL(dataUrlToBlob(asset.dataUrl));
      } catch {
        // A corrupt asset shows as a missing image in the preview.
      }
    }
    return urls;
  }, [assets]);

  useEffect(() => () => Object.values(assetUrls).forEach((url) => URL.revokeObjectURL(url)), [assetUrls]);

  const buildDoc = useCallback((): PaperDocument => {
    for (const name of fileNames) texts.current.set(name, getText(name));
    return {
      ...initial,
      title: title.trim() || "Untitled paper",
      source: texts.current.get(MAIN_FILE) ?? "",
      files: fileNames.filter((name) => name !== MAIN_FILE).map((name) => ({ name, content: texts.current.get(name) ?? "" })),
      assets,
    };
  }, [initial, title, fileNames, assets, getText]);

  const { saveState, schedule, flush, discard } = useAutosave(store, buildDoc);

  // While a conversion runs, edits must not schedule a save over the result.
  const scheduleEdit = useCallback(() => {
    if (!switchingRef.current) schedule();
  }, [schedule]);

  // Renders run one at a time; edits made during a render queue exactly one more.
  const runRender = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setRendering(true);
    const started = performance.now();
    try {
      const files: Record<string, string> = {};
      for (const name of fileNames) if (name !== MAIN_FILE) files[name] = getText(name);
      const next = await service.render(getText(MAIN_FILE), { files, assets: assetUrls, idPrefix: "pv-" });
      setResult(next);
      setRenderError("");
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "The preview could not be rendered.");
    } finally {
      lastDuration.current = performance.now() - started;
      inFlight.current = false;
      setRendering(false);
      if (queued.current) {
        queued.current = false;
        void runRenderRef.current();
      }
    }
  }, [fileNames, getText, service, assetUrls]);

  const runRenderRef = useRef(runRender);
  useEffect(() => {
    runRenderRef.current = runRender;
  }, [runRender]);

  // The delay adapts to how long renders take, so large papers stay smooth.
  const requestRender = useCallback(() => {
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
    const delay = Math.min(1200, Math.max(160, lastDuration.current * 1.5));
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      void runRenderRef.current();
    }, delay);
  }, []);

  useEffect(() => {
    void runRender();
  }, [runRender]);

  useEffect(() => () => {
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
  }, []);

  useEffect(() => {
    document.title = `${title || "Untitled paper"} — Recommendica Write`;
  }, [title]);

  useEffect(
    () =>
      store.subscribe((id) => {
        if (id === initial.id) setChangedElsewhere(true);
      }),
    [store, initial.id],
  );

  const recompile = useCallback(() => {
    void flush();
    void runRenderRef.current();
  }, [flush]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        recompile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recompile]);

  const onChange = useCallback(() => {
    scheduleEdit();
    if (autoCompile) requestRender();
  }, [scheduleEdit, requestRender, autoCompile]);

  const onCursorLine = useCallback((line: number) => {
    if (activeRef.current !== MAIN_FILE) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => setSyncLine(line), 450);
  }, []);

  const completions = useMemo(
    () => ({
      citationKeys: () => {
        const keys: string[] = [];
        for (const name of fileNames) {
          if (name.toLowerCase().endsWith(".bib")) keys.push(...parseBibtex(getText(name)).entries.map((entry) => entry.key));
        }
        return keys;
      },
      labels: () => Object.keys(result?.labels ?? {}),
      files: () => [...fileNames.filter((name) => name !== MAIN_FILE), ...assets.map((asset) => asset.name)],
    }),
    [fileNames, assets, getText, result],
  );

  const changeTitle = (value: string) => {
    setTitle(value);
    scheduleEdit();
  };

  const insert = (key: keyof typeof SNIPPETS) => {
    editorRef.current?.insertSnippet(SNIPPETS[key]);
    if (key === "cite" || key === "ref") window.setTimeout(() => editorRef.current?.complete(), 30);
  };

  const jumpTo = (line: number) => {
    if (active !== MAIN_FILE) setActive(MAIN_FILE);
    setMobileView("source");
    window.setTimeout(() => editorRef.current?.goToLine(line, MAIN_FILE), 0);
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!FILE_NAME.test(name)) {
      setNewFileError("Use letters, numbers, dashes or folders, ending in .tex, .bib, .sty, .cls or .txt.");
      return;
    }
    if (fileNames.includes(name)) {
      setNewFileError("A file with that name already exists.");
      return;
    }
    texts.current.set(name, name.endsWith(".bib") ? "" : `% ${name}\n`);
    setFileNames((names) => [...names, name]);
    setActive(name);
    setDialog(null);
    scheduleEdit();
  };

  const removeFile = (name: string) => {
    if (name === MAIN_FILE) return;
    setFileNames((names) => names.filter((entry) => entry !== name));
    texts.current.delete(name);
    editorRef.current?.forget(name);
    if (active === name) setActive(MAIN_FILE);
    setDialog(null);
    scheduleEdit();
  };

  const uploadImages = async (list: FileList | null) => {
    if (!list?.length) return;
    const taken = new Set(assets.map((asset) => asset.name));
    const added: ProjectAsset[] = [];
    try {
      for (const file of Array.from(list)) {
        const image = await readImageFile(file);
        const name = uniqueName(file.name.replace(/[^A-Za-z0-9_.-]/g, "-"), taken);
        taken.add(name);
        added.push({ name, type: image.type, dataUrl: image.dataUrl, size: image.size });
      }
      setAssets((current) => [...current, ...added]);
      setNotice(`${added.length === 1 ? `${added[0].name} was` : `${added.length} images were`} added. Use \\includegraphics{${added[0].name}} to place it.`);
      scheduleEdit();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The image could not be added.");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const removeAsset = (name: string) => {
    setAssets((current) => current.filter((asset) => asset.name !== name));
    scheduleEdit();
  };

  const exportAs = async (format: "pdf" | "html" | "tex" | "zip" | "bib") => {
    const exporting = await import("../exporting.ts");
    const base = fileBaseName(title);
    try {
      if (format === "tex") {
        exporting.downloadText(getText(MAIN_FILE), `${base}.tex`, "application/x-tex");
      } else if (format === "bib") {
        const bib = fileNames.find((name) => name.toLowerCase().endsWith(".bib"));
        exporting.downloadText(bib ? getText(bib) : "", bib ?? BIB_FILE, "application/x-bibtex");
      } else if (format === "zip") {
        const files: Record<string, string | Uint8Array> = {};
        for (const name of fileNames) files[name] = getText(name);
        for (const asset of assets) files[asset.name] = exporting.dataUrlToBytes(asset.dataUrl);
        exporting.downloadBlob(await exporting.zipFiles(files), `${base}.zip`);
      } else {
        // Exports carry the images themselves, not this tab's blob: URLs.
        const files: Record<string, string> = {};
        for (const name of fileNames) if (name !== MAIN_FILE) files[name] = getText(name);
        const assetData = Object.fromEntries(assets.map((asset) => [asset.name, asset.dataUrl]));
        const { renderLatex } = await import("../latex/render.ts");
        const rendered = renderLatex(getText(MAIN_FILE), { files, assets: assetData, idPrefix: "ex-" });
        const look = lookFromLayout(rendered.layout);
        const body = `<div class="paper-body">${rendered.html}</div>`;
        if (format === "pdf") await exporting.printPaper(body, look, title);
        else exporting.downloadText(exporting.standaloneHtml(body, look, title), `${base}.html`, "text/html");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    }
  };

  const switchMode = async (kind: DocumentKind) => {
    if (switchingRef.current || kind === "latex") return;
    switchingRef.current = true;
    setSwitching(true);
    setDialog(null);
    try {
      await flush();
      // The converted document is about to replace this one; its unmount flush
      // must not write the old representation back over it.
      discard();
      await onSwitchMode(buildDoc(), kind);
    } catch (error) {
      switchingRef.current = false;
      setSwitching(false);
      schedule();
      setNotice(error instanceof Error ? error.message : "The editor could not be switched.");
    }
  };

  const diagnostics = useMemo(() => {
    const list: RenderDiagnostic[] = [...(result?.diagnostics ?? [])];
    if (renderError) list.unshift({ severity: "error", message: renderError, line: 0, column: 0 });
    return list;
  }, [result, renderError]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  const exportItems: MenuEntry[] = [
    { label: "PDF (print)", icon: "print", onSelect: () => void exportAs("pdf"), shortcut: shortcut("Mod+P") },
    { label: "LaTeX project (.zip)", icon: "archive", onSelect: () => void exportAs("zip") },
    { label: "main.tex only", icon: "fileCode", onSelect: () => void exportAs("tex") },
    { label: "Web page (.html)", icon: "externalLink", onSelect: () => void exportAs("html") },
    { label: "BibTeX (.bib)", icon: "citation", onSelect: () => void exportAs("bib") },
  ];

  useEffect(() => {
    const onPrint = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void exportAs("pdf");
      }
    };
    window.addEventListener("keydown", onPrint);
    return () => window.removeEventListener("keydown", onPrint);
  });

  const look = result ? lookFromLayout(result.layout) : null;

  return (
    <div className="write-workspace write-workspace--latex">
      <WorkspaceHeader
        title={title}
        onTitleChange={changeTitle}
        kind="latex"
        onSwitchKind={(kind) => void switchMode(kind)}
        switchBusy={switching}
        saveState={saveState}
        persistent={store.persistent}
        actions={
          <>
            <button type="button" className="primary-button" onClick={recompile} title={`Recompile (${shortcut("Mod+S")})`}>
              <Icon name="refresh" size={16} className={rendering ? "write-spin" : undefined} />
              <span className="write-hide-small">Recompile</span>
            </button>
            <MenuButton label="Export" items={exportItems} align="end" className="write-tool--text">
              <Icon name="download" size={16} /> <span className="write-hide-small">Export</span>
            </MenuButton>
          </>
        }
      />

      <div>
        <div className="write-toolbar" role="toolbar" aria-label="LaTeX formatting">
          <div className="write-tabs write-mobile-tabs" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={mobileView === "source"} onClick={() => setMobileView("source")}>
              Source
            </button>
            <button type="button" role="tab" aria-selected={mobileView === "preview"} onClick={() => setMobileView("preview")}>
              Preview
            </button>
          </div>
          <ToolButton icon="panelLeft" label="Files and outline" active={showFiles} onClick={() => setShowFiles(!showFiles)} />
          <ToolSeparator />
          <ToolButton icon="bold" label="Bold" shortcut={"\\textbf"} onClick={() => insert("bold")} />
          <ToolButton icon="italic" label="Italic" shortcut={"\\textit"} onClick={() => insert("italic")} />
          <MenuButton
            label="Heading"
            items={[
              { label: "Section", onSelect: () => editorRef.current?.insertSnippet("\\section{${selection}}") },
              { label: "Subsection", onSelect: () => editorRef.current?.insertSnippet("\\subsection{${selection}}") },
              { label: "Subsubsection", onSelect: () => editorRef.current?.insertSnippet("\\subsubsection{${selection}}") },
              { label: "Paragraph (run-in)", onSelect: () => editorRef.current?.insertSnippet("\\paragraph{${selection}}") },
              { label: "Unnumbered section", onSelect: () => editorRef.current?.insertSnippet("\\section*{${selection}}") },
            ]}
          >
            <Icon name="type" />
          </MenuButton>
          <ToolSeparator />
          <ToolButton icon="sigma" label="Inline math" shortcut="$…$" onClick={() => insert("math")} />
          <ToolButton icon="displayMath" label="Numbered equation" onClick={() => insert("equation")} />
          <ToolButton icon="image" label="Figure" onClick={() => insert("figure")} />
          <ToolButton icon="table" label="Table" onClick={() => insert("table")} />
          <ToolButton icon="bulletList" label="Bulleted list" onClick={() => insert("itemize")} />
          <ToolButton icon="orderedList" label="Numbered list" onClick={() => insert("enumerate")} />
          <ToolSeparator />
          <ToolButton icon="citation" label="Cite" onClick={() => insert("cite")} />
          <ToolButton icon="crossRef" label="Reference a label" onClick={() => insert("ref")} />
          <ToolButton icon="footnote" label="Footnote" onClick={() => insert("footnote")} />
          <ToolButton icon="link" label="Link" onClick={() => insert("link")} />
          <ToolSeparator />
          <ToolButton icon="code" label="Comment or uncomment lines" shortcut={shortcut("Mod+/")} onClick={() => editorRef.current?.toggleComment()} />
          <ToolButton icon="search" label="Find and replace" shortcut={shortcut("Mod+F")} onClick={() => editorRef.current?.openSearch()} />
          <ToolButton icon="help" label="LaTeX help" onClick={() => setDialog("help")} />
        </div>
        {changedElsewhere && (
          <div className="write-banner" role="status">
            <Icon name="alertTriangle" size={16} /> This paper was changed in another tab. Saving here will overwrite those changes.
            <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
        {notice && (
          <div className="write-banner" role="status">
            <Icon name="alertCircle" size={16} /> {notice}
            <button type="button" className="ghost-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="write-latex-body" data-mobile-view={mobileView}>
        {showFiles ? (
          <aside className="write-panel write-panel--left write-files" aria-label="Project files">
            <div className="write-panel-body">
              <p className="write-panel-subhead">
                Files
                <button type="button" className="write-icon-button" aria-label="New file" title="New file" onClick={() => {
                  setNewFileName("");
                  setNewFileError("");
                  setDialog("new-file");
                }}>
                  <Icon name="plus" size={16} />
                </button>
              </p>
              <ul className="write-file-list">
                {fileNames.map((name) => (
                  <li key={name}>
                    <button type="button" className="write-file" aria-current={active === name} onClick={() => setActive(name)}>
                      <Icon name={name.endsWith(".bib") ? "citation" : "fileCode"} size={15} />
                      <span>{name}</span>
                    </button>
                    {name !== MAIN_FILE && (
                      <button type="button" className="write-icon-button" aria-label={`Delete ${name}`} onClick={() => setDialog({ remove: name })}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <p className="write-panel-subhead">
                Images
                <button type="button" className="write-icon-button" aria-label="Upload images" title="Upload images" onClick={() => uploadRef.current?.click()}>
                  <Icon name="upload" size={16} />
                </button>
              </p>
              <input ref={uploadRef} type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" onChange={(event) => void uploadImages(event.target.files)} />
              {assets.length ? (
                <ul className="write-file-list">
                  {assets.map((asset) => (
                    <li key={asset.name}>
                      <button
                        type="button"
                        className="write-file"
                        title={`Insert ${asset.name}`}
                        onClick={() => editorRef.current?.insertSnippet(`\\includegraphics[width=0.8\\linewidth]{${asset.name}}`)}
                      >
                        <Icon name="image" size={15} />
                        <span>{asset.name}</span>
                      </button>
                      <button type="button" className="write-icon-button" aria-label={`Remove ${asset.name}`} onClick={() => removeAsset(asset.name)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="write-hint" style={{ padding: "0 8px 16px" }}>
                  Upload PNG or JPEG figures, then reference them with \includegraphics.
                </p>
              )}

              {result && result.outline.length > 0 && (
                <>
                  <p className="write-panel-subhead">Outline</p>
                  <ul className="write-outline">
                    {result.outline.map((entry) => (
                      <li key={entry.anchor} className={`level-${Math.max(entry.level, 1)}`}>
                        <button type="button" onClick={() => jumpTo(entry.line)}>
                          {entry.number && <span className="write-outline-num">{entry.number}</span>}
                          <span>{entry.title || "Untitled"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </aside>
        ) : (
          <div />
        )}

        <section className="write-source" aria-label={`Source: ${active}`}>
          <CodeEditor
            file={active}
            initialText={(name) => texts.current.get(name) ?? ""}
            onChange={onChange}
            onCursorLine={onCursorLine}
            onSave={recompile}
            completions={completions}
            handleRef={keepHandle}
            label="LaTeX source"
            readOnly={switching}
          />
        </section>

        <LatexPreview result={result} zoom={zoom} syncLine={syncLine} onJump={jumpTo} />
      </div>

      {showProblems && diagnostics.length > 0 && (
        <section className="write-problems" aria-label="Problems">
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.line}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (diagnostic.file) {
                      setActive(diagnostic.file);
                      return;
                    }
                    if (diagnostic.line > 0) jumpTo(diagnostic.line);
                  }}
                >
                  <Icon
                    name={diagnostic.severity === "error" ? "alertCircle" : diagnostic.severity === "warning" ? "alertTriangle" : "help"}
                    size={14}
                    className={`write-sev-${diagnostic.severity}`}
                  />
                  <span className="write-problem-where">{diagnosticWhere(diagnostic)}</span>
                  <span>{diagnostic.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="write-statusbar">
        <button type="button" onClick={() => setShowProblems(!showProblems)} aria-expanded={showProblems} disabled={!diagnostics.length}>
          {errors || warnings ? (
            <>
              <Icon name="alertTriangle" size={13} className={errors ? "write-sev-error" : "write-sev-warning"} /> {errors} {errors === 1 ? "error" : "errors"}, {warnings}{" "}
              {warnings === 1 ? "warning" : "warnings"}
            </>
          ) : (
            <>
              <Icon name="check" size={13} /> No problems
            </>
          )}
        </button>
        {result && <span>{result.wordCount.toLocaleString()} words</span>}
        {look && (
          <span>
            {result?.layout.documentClass} · {look.columns === 2 ? "two columns" : "one column"} · {look.paper === "letter" ? "US Letter" : "A4"}
          </span>
        )}
        <span className="write-statusbar-spacer" />
        <label className="write-check">
          <input type="checkbox" checked={autoCompile} onChange={(event) => setAutoCompile(event.target.checked)} /> Live preview
        </label>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, Math.round(((value === "fit" ? 1 : value) - 0.1) * 10) / 10))}>
          <Icon name="zoomOut" size={14} />
        </button>
        <button type="button" aria-label="Fit page width" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, Math.round(((value === "fit" ? 1 : value) + 0.1) * 10) / 10))}>
          <Icon name="zoomIn" size={14} />
        </button>
      </footer>

      {dialog === "new-file" && (
        <Dialog
          title="New file"
          size="sm"
          onClose={() => setDialog(null)}
          initialFocusId="write-new-file"
          footer={
            <>
              <button type="button" className="ghost-button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit" form="write-new-file-form" className="primary-button">
                Create
              </button>
            </>
          }
        >
          <form
            id="write-new-file-form"
            onSubmit={(event) => {
              event.preventDefault();
              addFile();
            }}
          >
            <label className="write-field">
              <span>File name</span>
              <input id="write-new-file" value={newFileName} placeholder="sections/introduction.tex" onChange={(event) => setNewFileName(event.target.value)} />
            </label>
            {newFileError && <p className="write-math-error">{newFileError}</p>}
            <p className="write-hint">Include it from main.tex with \input{"{"}sections/introduction{"}"}.</p>
          </form>
        </Dialog>
      )}

      {dialog && typeof dialog === "object" && (
        <Dialog
          title={`Delete ${dialog.remove}?`}
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="ghost-button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button write-danger" onClick={() => removeFile(dialog.remove)}>
                Delete file
              </button>
            </>
          }
        >
          <p>The file and its contents will be removed from this project.</p>
        </Dialog>
      )}

      {dialog === "help" && (
        <Dialog title="LaTeX quick reference" size="lg" onClose={() => setDialog(null)}>
          <div className="write-field-row">
            <div>
              <p><strong>Structure</strong></p>
              <p><code>\section{"{Title}"}</code>, <code>\subsection{"{…}"}</code>, <code>\label{"{sec:x}"}</code> and <code>Section~\ref{"{sec:x}"}</code></p>
              <p><strong>Math</strong></p>
              <p>Inline <code>$a^2+b^2$</code>; numbered <code>\begin{"{equation}"}…\end{"{equation}"}</code>; multi-line <code>align</code> with <code>&amp;</code> and <code>\\</code>.</p>
            </div>
            <div>
              <p><strong>Citations</strong></p>
              <p>Add entries to <code>references.bib</code>, cite with <code>\cite{"{key}"}</code>, and end with <code>\bibliography{"{references}"}</code>. The style follows <code>\bibliographystyle</code> (plain/IEEEtran numeric, apalike author–year).</p>
              <p><strong>Shortcuts</strong></p>
              <p>{shortcut("Mod+S")} recompile · {shortcut("Mod+F")} find · {shortcut("Mod+/")} comment · Ctrl+Space complete · double-click the preview to jump to the source.</p>
            </div>
          </div>
          <p className="write-hint">The preview renders a large subset of LaTeX in the browser. Packages it does not know are listed under problems; the downloaded project compiles with pdfLaTeX and BibTeX on Overleaf or a local TeX installation.</p>
        </Dialog>
      )}
    </div>
  );
}
