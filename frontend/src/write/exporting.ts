/**
 * Getting a paper out of the browser: PDF through the print dialog, a
 * standalone HTML page, and LaTeX as a .tex or a .zip project.
 *
 * Loaded on demand (the editors import it dynamically), so the stylesheets
 * inlined here and the zip library cost nothing until someone exports.
 */

import katexCss from "katex/dist/katex.min.css?inline";
import paperCss from "./paper.css?inline";
import { pageRule, paperClassName, paperStyle } from "./paperStyle.ts";
import type { PaperLook } from "./paperStyle.ts";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, filename: string, type = "text/plain"): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (meta.includes(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

export async function zipFiles(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : content;
  }
  const bytes = zipSync(entries, { level: 6 });
  return new Blob([bytes.slice().buffer], { type: "application/zip" });
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function styleAttr(look: PaperLook): string {
  return Object.entries(paperStyle(look))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(";");
}

/** Removes editor-only markup from a copy of the editor or preview DOM. */
export function cleanForExport(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-export='omit'], .ProseMirror-gapcursor, .ProseMirror-separator, .ProseMirror-trailingBreak, input, button, .paper-node-chrome").forEach((element) => element.remove());
  copy.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
  copy.querySelectorAll(".ProseMirror-selectednode, .is-empty, .has-focus").forEach((element) => element.classList.remove("ProseMirror-selectednode", "is-empty", "has-focus"));
  copy.querySelectorAll("[data-placeholder]").forEach((element) => element.removeAttribute("data-placeholder"));
  copy.removeAttribute("contenteditable");
  copy.classList.remove("ProseMirror", "ProseMirror-focused");
  return copy.outerHTML;
}

/** A self-contained HTML page; KaTeX fonts come from a CDN pinned to the bundled version. */
export function standaloneHtml(bodyHtml: string, look: PaperLook, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.11/dist/katex.min.css" crossorigin="anonymous">
<style>
${paperCss}
body { margin: 0; padding: 32px 16px; background: #eef1f5; }
.paper-sheet { margin: 0 auto; box-shadow: 0 1px 3px rgba(15,23,42,.12), 0 8px 24px rgba(15,23,42,.08); max-width: 100%; }
@media (max-width: 860px) { .paper-sheet { width: auto; min-height: 0; padding: 24px 18px; } }
@media print { body { padding: 0; background: #fff; } .paper-sheet { box-shadow: none; } }
${pageRule(look)}
</style>
</head>
<body>
<article class="${paperClassName(look)} paper-sheet" style="${styleAttr(look)}">
${bodyHtml}
</article>
</body>
</html>
`;
}

/**
 * Prints the paper in a hidden frame. The browser's dialog then saves a PDF
 * with real page breaks, which the continuous on-screen page does not show.
 */
export async function printPaper(bodyHtml: string, look: PaperLook, title: string): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.append(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    throw new Error("Printing is not available in this browser.");
  }
  doc.open();
  doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeAttr(title)}</title><base href="${escapeAttr(window.location.origin)}/"><style>${katexCss}\n${paperCss}\nhtml,body{margin:0;background:#fff;}\n${pageRule(look)}</style></head><body><article class="${paperClassName(look)} paper-sheet" style="${styleAttr(look)}">${bodyHtml}</article></body></html>`);
  doc.close();

  const images = Array.from(doc.images).map((image) =>
    image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    }),
  );
  await Promise.race([Promise.all([doc.fonts?.ready, ...images]), new Promise((resolve) => setTimeout(resolve, 4000))]);

  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
  // Some browsers never fire afterprint for a frame; do not leave it behind.
  setTimeout(() => frame.isConnected && frame.remove(), 120_000);
}
