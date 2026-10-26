import { useEffect } from "react";
import type { RefObject } from "react";

/** Calls `close` on a pointer press outside `ref` while `open` is true. */
export function useOutsideClose(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open, close, ref]);
}
