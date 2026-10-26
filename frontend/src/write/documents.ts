/**
 * Paper documents: the stored shape, defaults, and defensive normalisation.
 *
 * A document is either "visual" (edited like a word processor; content is
 * ProseMirror JSON) or "latex" (a small Overleaf-style project: main.tex plus
 * other text files and uploaded images). Both carry page settings so the
 * paper renders, prints and exports the same way.
 */

import type { JSONContent } from "@tiptap/core";
import type { CitationStyle } from "./latex/bibtex.ts";
import type { PaperFont } from "./latex/render.ts";
import { VISUAL_THEMES } from "./themes.ts";
import type { VisualTheme } from "./themes.ts";

export type { VisualTheme };
export type DocumentKind = "visual" | "latex";

export interface PaperSettings {
  theme: VisualTheme;
  paper: "a4" | "letter";
  margins: "narrow" | "normal" | "wide";
  columns: 1 | 2;
  font: PaperFont;
  fontSize: 10 | 11 | 12;
  lineSpacing: number;
  paragraphStyle: "indent" | "spaced";
  citationStyle: CitationStyle;
  numberedHeadings: boolean;
}

export interface ProjectFile {
  name: string;
  content: string;
}

export interface ProjectAsset {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
}

export interface PaperDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  template: string;
  createdAt: number;
  updatedAt: number;
  settings: PaperSettings;
  /** Visual documents: the editor's ProseMirror JSON. */
  content: JSONContent | null;
  /** Visual documents: the reference list as BibTeX. */
  bib: string;
  /** LaTeX documents: main.tex. */
  source: string;
  /** LaTeX documents: other text files, such as references.bib. */
  files: ProjectFile[];
  /** LaTeX documents: uploaded images. */
  assets: ProjectAsset[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKind;
  template: string;
  createdAt: number;
  updatedAt: number;
  excerpt: string;
}

export const DEFAULT_SETTINGS: PaperSettings = {
  theme: "article",
  paper: "a4",
  margins: "normal",
  columns: 1,
  font: "cm",
  fontSize: 11,
  lineSpacing: 1.15,
  paragraphStyle: "indent",
  citationStyle: "ieee",
  numberedHeadings: true,
};

export const MAIN_FILE = "main.tex";
export const BIB_FILE = "references.bib";

export const LINE_SPACINGS = [1, 1.15, 1.5, 2];
export const FONT_LABELS: Record<PaperFont, string> = {
  cm: "Computer Modern (LaTeX)",
  times: "Times",
  palatino: "Palatino",
  sans: "Sans serif",
};

export function newDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeSettings(value: unknown): PaperSettings {
  const raw = isRecord(value) ? value : {};
  const spacing = typeof raw.lineSpacing === "number" && raw.lineSpacing >= 1 && raw.lineSpacing <= 3 ? raw.lineSpacing : DEFAULT_SETTINGS.lineSpacing;
  return {
    theme: pick(raw.theme, VISUAL_THEMES, DEFAULT_SETTINGS.theme),
    paper: pick(raw.paper, ["a4", "letter"] as const, DEFAULT_SETTINGS.paper),
    margins: pick(raw.margins, ["narrow", "normal", "wide"] as const, DEFAULT_SETTINGS.margins),
    columns: pick(raw.columns, [1, 2] as const, DEFAULT_SETTINGS.columns),
    font: pick(raw.font, ["cm", "times", "palatino", "sans"] as const, DEFAULT_SETTINGS.font),
    fontSize: pick(raw.fontSize, [10, 11, 12] as const, DEFAULT_SETTINGS.fontSize),
    lineSpacing: spacing,
    paragraphStyle: pick(raw.paragraphStyle, ["indent", "spaced"] as const, DEFAULT_SETTINGS.paragraphStyle),
    citationStyle: pick(raw.citationStyle, ["ieee", "apa"] as const, DEFAULT_SETTINGS.citationStyle),
    numberedHeadings: typeof raw.numberedHeadings === "boolean" ? raw.numberedHeadings : DEFAULT_SETTINGS.numberedHeadings,
  };
}

/** Browser storage can hold anything, including data from an older version. */
export function normalizeDocument(value: unknown): PaperDocument | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  const kind = pick(value.kind, ["visual", "latex"] as const, "visual");
  const files = Array.isArray(value.files)
    ? value.files.filter((file): file is ProjectFile => isRecord(file) && typeof file.name === "string" && typeof file.content === "string")
    : [];
  const assets = Array.isArray(value.assets)
    ? value.assets.filter(
        (asset): asset is ProjectAsset =>
          isRecord(asset) && typeof asset.name === "string" && typeof asset.dataUrl === "string" && /^data:image\//.test(asset.dataUrl),
      )
    : [];
  const now = Date.now();
  return {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Untitled paper",
    kind,
    template: typeof value.template === "string" ? value.template : "blank",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
    settings: normalizeSettings(value.settings),
    content: isRecord(value.content) && value.content.type === "doc" ? (value.content as JSONContent) : null,
    bib: typeof value.bib === "string" ? value.bib : "",
    source: typeof value.source === "string" ? value.source : "",
    files,
    assets: assets.map((asset) => ({ ...asset, type: typeof asset.type === "string" ? asset.type : "image/png", size: typeof asset.size === "number" ? asset.size : asset.dataUrl.length })),
  };
}

export function normalizeSummary(value: unknown): DocumentSummary | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Untitled paper",
    kind: pick(value.kind, ["visual", "latex"] as const, "visual"),
    template: typeof value.template === "string" ? value.template : "blank",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    excerpt: typeof value.excerpt === "string" ? value.excerpt : "",
  };
}

/** Plain text of editor JSON, for previews and word counts. */
export function plainText(content: JSONContent | null | undefined, limit = Infinity): string {
  const parts: string[] = [];
  let length = 0;
  const visit = (node: JSONContent) => {
    if (length >= limit) return;
    if (node.type === "text" && node.text) {
      parts.push(node.text);
      length += node.text.length;
      return;
    }
    if (node.type === "mathInline" || node.type === "mathBlock") {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
      parts.push(` ${latex} `);
      length += latex.length;
      return;
    }
    node.content?.forEach(visit);
    if (node.type !== "text" && node.type !== "doc") parts.push(" ");
  };
  if (content) visit(content);
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, limit === Infinity ? undefined : limit);
}

/** A rough reading of LaTeX source for list previews: commands and markup removed. */
export function latexExcerpt(source: string, limit = 160): string {
  const body = source.includes("\\begin{document}") ? source.slice(source.indexOf("\\begin{document}") + 16) : source;
  return body
    .replace(/%.*$/gm, "")
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, " ")
    .replace(/\$[^$]*\$/g, " … ")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, " ")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function summarize(doc: PaperDocument): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    template: doc.template,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    excerpt: doc.kind === "latex" ? latexExcerpt(doc.source) : plainText(doc.content, 160),
  };
}

/** A safe download name derived from a document title. */
export function fileBaseName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return base || "paper";
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
