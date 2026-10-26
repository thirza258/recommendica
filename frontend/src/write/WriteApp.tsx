import { lazy, Suspense, useEffect, useState } from "react";
import DocumentsHome from "./DocumentsHome";
import { documentIdFromRoute, WRITE_HOME_HREF } from "./routes.ts";
import { openDocumentStore } from "./storage.ts";
import type { DocumentStore } from "./storage.ts";
import type { PaperDocument } from "./documents.ts";
import "katex/dist/katex.min.css";
import "./paper.css";
import "./write.css";

// Each editor brings its own heavy dependencies (TipTap or CodeMirror), so
// the documents list loads without either.
const VisualWorkspace = lazy(() => import("./visual/VisualWorkspace"));
const LatexWorkspace = lazy(() => import("./source/LatexWorkspace"));

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

  useEffect(() => {
    let active = true;
    store
      .get(id)
      .then((found) => active && setDoc(found))
      .catch(() => active && setDoc(null));
    return () => {
      active = false;
    };
  }, [id, store]);

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
      {doc.kind === "latex" ? <LatexWorkspace initial={doc} store={store} /> : <VisualWorkspace initial={doc} store={store} />}
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
