import { lazy, startTransition, Suspense, useCallback, useEffect, useState } from "react";
import DocumentsHome from "./DocumentsHome";
import { documentIdFromRoute, WRITE_HOME_HREF } from "./routes.ts";
import { openDocumentStore } from "./storage.ts";
import type { DocumentStore } from "./storage.ts";
import type { DocumentKind, PaperDocument } from "./documents.ts";
import { switchToLatex, switchToVisual } from "./modeSwitch.ts";
import { takePendingNotice } from "./pendingNotice.ts";
import type { ModeAnchor } from "./modeAnchor.ts";
import "katex/dist/katex.min.css";
import "./paper.css";
import "./write.css";

// Each editor brings its own heavy dependencies (TipTap or CodeMirror), so
// the documents list loads without either.
const loadVisual = () => import("./visual/VisualWorkspace");
const loadLatex = () => import("./source/LatexWorkspace");
// The schema check for converted content comes with the visual editor's code.
const loadContentCheck = () => import("./visual/contentCheck.ts");
const VisualWorkspace = lazy(loadVisual);
const LatexWorkspace = lazy(loadLatex);

interface WriteAppProps {
  route: string;
  onHome: () => void;
}

export function WriteLoading({ message = "Opening your paper…" }: { message?: string }) {
  return (
    <div className="write-loading" role="status">
      <span className="write-spinner" aria-hidden="true" />
      {message}
    </div>
  );
}

function DocumentLoader({ id, store }: { id: string; store: DocumentStore }) {
  const [doc, setDoc] = useState<PaperDocument | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [anchor, setAnchor] = useState<ModeAnchor | null>(null);

  useEffect(() => {
    let active = true;
    store
      .get(id)
      .then((found) => {
        if (!active) return;
        // What an import approximated, shown once as the paper opens.
        const pending = takePendingNotice(id);
        if (pending) setNotice(pending);
        setDoc(found);
      })
      .catch(() => active && setDoc(null));
    return () => {
      active = false;
    };
  }, [id, store]);

  // While the paper is open, fetch the other editor's code in the background,
  // so switching does not wait for a download.
  const kind = doc?.kind;
  useEffect(() => {
    if (!kind) return;
    const load = kind === "latex" ? loadVisual : loadLatex;
    const run = () => void load().catch(() => undefined);
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(run, 1500);
    return () => window.clearTimeout(timer);
  }, [kind]);

  const switchMode = useCallback(
    async (current: PaperDocument, next: DocumentKind, at: ModeAnchor | null = null) => {
      const check = next === "visual" ? await loadContentCheck().catch(() => null) : null;
      const result = next === "latex" ? await switchToLatex(current) : await switchToVisual(current, { validBlock: check?.validBlock });
      await store.put(result.document);
      // A transition keeps the current editor on screen until the other one is
      // ready, instead of flashing a loading screen in between.
      startTransition(() => {
        setNotice(result.notice);
        setAnchor(at);
        setDoc(result.document);
      });
    },
    [store],
  );

  if (doc === undefined) return <WriteLoading />;
  if (doc === null) {
    return (
      <main className="write-missing">
        <h1>This paper is not in this browser</h1>
        <p>Papers are stored only in the browser that created them. It may have been deleted, or opened from another device.</p>
        <a className="primary-button" href={WRITE_HOME_HREF}>
          Back to your papers
        </a>
      </main>
    );
  }
  return (
    <Suspense fallback={<WriteLoading message="Loading the editor…" />}>
      {doc.kind === "latex" ? (
        <LatexWorkspace initial={doc} store={store} onSwitchMode={switchMode} initialNotice={notice} initialAnchor={anchor} />
      ) : (
        <VisualWorkspace initial={doc} store={store} onSwitchMode={switchMode} initialNotice={notice} initialAnchor={anchor} />
      )}
    </Suspense>
  );
}

export default function WriteApp({ route, onHome }: WriteAppProps) {
  const [store, setStore] = useState<DocumentStore | null>(null);
  const docId = documentIdFromRoute(route);

  useEffect(() => {
    let active = true;
    void openDocumentStore().then((opened) => active && setStore(opened));
    return () => {
      active = false;
    };
  }, []);

  if (!store) return <WriteLoading message="Opening your papers…" />;
  if (docId) return <DocumentLoader key={docId} id={docId} store={store} />;
  return <DocumentsHome store={store} onHome={onHome} />;
}
