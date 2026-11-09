/**
 * A message for a paper that is about to open, such as what an import had
 * to approximate. Kept per paper id for this browser tab, read once.
 */

const PREFIX = "recommendica-write-notice:";
const memory = new Map<string, string>();

export function setPendingNotice(id: string, text: string): void {
  if (!text) return;
  memory.set(id, text);
  try {
    window.sessionStorage.setItem(PREFIX + id, text);
  } catch {
    // Storage blocked: the in-memory copy still reaches this tab.
  }
}

/** The message for this paper, once; "" when there is none. */
export function takePendingNotice(id: string): string {
  let text = memory.get(id) ?? "";
  memory.delete(id);
  try {
    text = window.sessionStorage.getItem(PREFIX + id) ?? text;
    window.sessionStorage.removeItem(PREFIX + id);
  } catch {
    // Storage blocked: use the in-memory copy.
  }
  return text;
}
