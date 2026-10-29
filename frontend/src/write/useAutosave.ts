import { useCallback, useEffect, useRef, useState } from "react";
import type { PaperDocument } from "./documents.ts";
import type { DocumentStore } from "./storage.ts";

export type SaveState = "saved" | "unsaved" | "saving" | "error";

const DELAY_MS = 800;

/**
 * Debounced saving. Editors call `schedule()` on every change; the document
 * is built (serialised) only when a save actually runs, saves never overlap,
 * and pending work is flushed when the tab is hidden or the editor closes.
 */
export function useAutosave(store: DocumentStore, build: () => PaperDocument) {
  const [state, setState] = useState<SaveState>("saved");
  const buildRef = useRef(build);
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    buildRef.current = build;
  }, [build]);

  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return chain.current;
    dirty.current = false;
    chain.current = chain.current.then(async () => {
      setState("saving");
      try {
        await store.put({ ...buildRef.current(), updatedAt: Date.now() });
        setState(dirty.current ? "unsaved" : "saved");
      } catch {
        dirty.current = true;
        setState("error");
      }
    });
    return chain.current;
  }, [store]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setState("unsaved");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, DELAY_MS);
  }, [flush]);

  /**
   * Drop pending work without saving it. Editors use this when the current
   * state has just been persisted in another form (a mode conversion), so the
   * unmount flush must not write the old representation over the new one.
   */
  const discard = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    dirty.current = false;
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  return { saveState: state, schedule, flush, discard };
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved in this browser",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Could not save — retrying on the next change",
};
