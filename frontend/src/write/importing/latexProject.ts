/**
 * A LaTeX project from uploaded files: a .zip (Overleaf, arXiv, GitHub), a
 * folder, or loose .tex/.bib/image files.
 *
 * Paths are kept exactly as written, since \input and \includegraphics refer
 * to them; the project is re-rooted at its main file, which becomes main.tex.
 * Build output and system clutter are dropped, text is decoded as UTF-8 (or
 * Windows-1252 when that fails), and sizes are capped so a stray video does
 * not end up in browser storage. DOM-free.
 */

import { unzipSync } from "fflate";
import { BIB_FILE, MAIN_FILE } from "../documents.ts";
import type { ProjectFile } from "../documents.ts";

export interface ProjectEntry {
  /** Path inside the upload, with / separators. */
  path: string;
  bytes: Uint8Array;
}

export interface ProjectBinary {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface LatexProject {
  /** The main file's source, which becomes main.tex. */
  source: string;
  /** Where the main file was in the upload. */
  mainPath: string;
  /** The other text files, by path relative to the main file's folder. */
  files: ProjectFile[];
  /** Pictures, PDF and EPS figures. */
  binaries: ProjectBinary[];
  title: string;
  warnings: string[];
}

const MAX_TEXT_BYTES = 8_000_000;
const MAX_BINARY_BYTES = 30_000_000;
const MAX_TOTAL_BYTES = 250_000_000;
const MAX_ENTRIES = 3000;

const TEXT_EXTENSIONS = new Set([
  "tex", "ltx", "latex", "bib", "bbl", "sty", "cls", "bst", "bbx", "cbx", "lbx", "dbx", "def", "cfg", "clo", "fd", "ins", "dtx", "ist",
  "txt", "csv", "tsv", "dat", "tikz", "pgf", "pgf-plot", "gnuplot", "md", "bibtex", "py", "m", "r", "jl", "c", "h", "cpp", "hpp", "java", "js", "ts",
  "sh", "json", "xml", "yaml", "yml", "toml", "sql", "hs", "rs", "go", "lua", "lst", "asy", "mp", "mf",
]);

const BINARY_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp",
  pdf: "application/pdf", eps: "application/postscript", ps: "application/postscript",
};

/** Files LaTeX writes while compiling, and system clutter. */
const BUILD_OUTPUT = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex(\.gz)?|synctex\(busy\)|blg|bcf|run\.xml|xdv|dvi|nav|snm|vrb|idx|ilg|ind|glo|gls|glg|acn|acr|alg|thm|loa|lol|brf|upa|upb|ptc|maf|xwm|pyg|auxlock|figlist|makefile|bak|swp|tmp)$/i;

function extension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** `a\\b/./c/../d` → `a/b/d`; `..` never climbs above the upload, and a leading / is dropped. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** Folders never part of a paper (version control, dependencies, macOS). */
export function isSkippedFolder(name: string): boolean {
  return name === "__MACOSX" || name === "node_modules" || (name.startsWith(".") && name !== ".");
}

/**
 * Whether an upload is worth reading, checked from its path and size before
 * any bytes are read, so a stray video or a .git folder never reaches memory.
 */
export function admitUpload(path: string, size: number): "ok" | "skip" | "too large" {
  const clean = normalizePath(path);
  if (!clean || isJunk(clean)) return "skip";
  const kind = extension(clean);
  if (kind === "zip") return size > MAX_TOTAL_BYTES ? "too large" : "ok";
  if (TEXT_EXTENSIONS.has(kind)) return size > MAX_TEXT_BYTES ? "too large" : "ok";
  if (BINARY_TYPES[kind]) return size > MAX_BINARY_BYTES ? "too large" : "ok";
  return "skip";
}

export const MAX_UPLOAD_BYTES = MAX_TOTAL_BYTES;

function isJunk(path: string): boolean {
  const parts = path.split("/");
  if (parts.slice(0, -1).some(isSkippedFolder) || parts.some((part) => part.startsWith(".") && part !== ".")) return true;
  const name = parts[parts.length - 1];
  return BUILD_OUTPUT.test(name) || /^(thumbs\.db|desktop\.ini)$/i.test(name) || name.endsWith("~");
}

/** UTF-8 when the bytes are UTF-8, else Windows-1252 (old LaTeX sources); no BOM. */
export function decodeSource(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The entries of a .zip, size-checked while it is read. */
export function unzipProject(bytes: Uint8Array, warnings: string[] = []): ProjectEntry[] {
  let total = 0;
  let count = 0;
  let skipped = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        const path = normalizePath(file.name);
        if (!path || isJunk(path)) return false;
        const binary = !TEXT_EXTENSIONS.has(extension(path));
        if (file.originalSize > (binary ? MAX_BINARY_BYTES : MAX_TEXT_BYTES)) {
          skipped += 1;
          return false;
        }
        if (!TEXT_EXTENSIONS.has(extension(path)) && !BINARY_TYPES[extension(path)]) return false;
        total += file.originalSize;
        count += 1;
        if (total > MAX_TOTAL_BYTES || count > MAX_ENTRIES) throw new Error("This project is too large to import (more than 250 MB or 3000 files).");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) throw error;
    throw new Error("This .zip file could not be read.");
  }
  if (skipped) warnings.push(`${skipped} file${skipped === 1 ? " was" : "s were"} too large and left out.`);
  return Object.entries(files).map(([path, data]) => ({ path: normalizePath(path), bytes: data }));
}

/** Drops one folder that every path starts with (GitHub zips wrap the project in one). */
function stripCommonFolder(entries: ProjectEntry[]): ProjectEntry[] {
  if (!entries.length) return entries;
  const first = entries[0].path.split("/");
  if (first.length < 2) return entries;
  const folder = `${first[0]}/`;
  if (!entries.every((entry) => entry.path.startsWith(folder))) return entries;
  return stripCommonFolder(entries.map((entry) => ({ ...entry, path: entry.path.slice(folder.length) })));
}

function withoutComments(source: string): string {
  return source.replace(/(^|[^\\])%.*$/gm, "$1");
}

const MAIN_NAMES = /^(main|paper|ms|manuscript|article|thesis|dissertation|report|root|document|book|draft|submission)$/i;

/** The file that is compiled: it opens a document of its own and is not a chapter of another. */
function chooseMain(texts: { path: string; content: string }[]): { path: string; content: string } | null {
  const tex = texts.filter((file) => /^(tex|ltx|latex)$/.test(extension(file.path)));
  if (!tex.length) return null;
  const clean = new Map(tex.map((file) => [file.path, withoutComments(file.content)]));
  const standalone = (content: string) => /\\documentclass\s*(\[[^\]]*\])?\s*\{\s*(subfiles|standalone)\s*\}/.test(content);
  const complete = tex.filter((file) => {
    const content = clean.get(file.path) ?? "";
    return /\\documentclass/.test(content) && /\\begin\s*\{document\}/.test(content) && !standalone(content);
  });
  const candidates = complete.length ? complete : tex.filter((file) => /\\documentclass/.test(clean.get(file.path) ?? "") && !standalone(clean.get(file.path) ?? ""));
  const pool = candidates.length ? candidates : tex;
  const included = (file: { path: string }) => {
    const stem = file.path.replace(/\.(tex|ltx|latex)$/i, "");
    const base = stem.split("/").pop() ?? stem;
    return tex.some((other) => other !== file && new RegExp(`\\\\(?:input|include|subfile)\\s*\\{\\s*(?:\\./)?(?:${escapeRegExp(stem)}|${escapeRegExp(base)})(?:\\.tex)?\\s*\\}`).test(clean.get(other.path) ?? ""));
  };
  const score = (file: { path: string; content: string }) => {
    const name = (file.path.split("/").pop() ?? "").replace(/\.(tex|ltx|latex)$/i, "");
    const depth = file.path.split("/").length - 1;
    return (/^main$/i.test(name) ? 12 : MAIN_NAMES.test(name) ? 6 : 0) - depth * 2 + (included(file) ? -10 : 4) + (/\\(?:bibliography|addbibresource|printbibliography)\b/.test(clean.get(file.path) ?? "") ? 1 : 0);
  };
  return [...pool].sort((left, right) => score(right) - score(left) || left.path.length - right.path.length || left.path.localeCompare(right.path))[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A title for the paper list, from the main file's \title. */
export function titleOfSource(source: string): string {
  const match = /\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/.exec(withoutComments(source));
  return (match?.[1] ?? "")
    .replace(/\\(?:thanks|footnote)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\\\(\[[^\]]*\])?/g, " ")
    .replace(/\\([&%$#_])/g, "$1")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds the project from upload entries (already unzipped). */
export function buildLatexProject(input: ProjectEntry[], warnings: string[] = []): LatexProject {
  const entries = stripCommonFolder(input.map((entry) => ({ ...entry, path: normalizePath(entry.path) })).filter((entry) => entry.path && !isJunk(entry.path)));
  const texts: { path: string; content: string }[] = [];
  const binaries: ProjectBinary[] = [];
  let other = 0;
  let total = 0;
  for (const entry of entries) {
    const kind = extension(entry.path);
    if (TEXT_EXTENSIONS.has(kind)) {
      if (entry.bytes.length > MAX_TEXT_BYTES) {
        warnings.push(`“${entry.path}” is too large and was left out.`);
        continue;
      }
      texts.push({ path: entry.path, content: decodeSource(entry.bytes) });
    } else if (BINARY_TYPES[kind]) {
      if (entry.bytes.length > MAX_BINARY_BYTES || total + entry.bytes.length > MAX_TOTAL_BYTES) {
        warnings.push(`“${entry.path}” is too large and was left out.`);
        continue;
      }
      total += entry.bytes.length;
      binaries.push({ name: entry.path, type: BINARY_TYPES[kind], bytes: entry.bytes });
    } else {
      other += 1;
    }
  }
  const main = chooseMain(texts);
  if (!main) throw new Error("This upload has no .tex file. Include the main .tex file (and its .bib, styles and figures), or a .zip of the whole project.");

  // Re-root at the main file's folder: paths in the source are relative to it.
  const folder = main.path.includes("/") ? main.path.slice(0, main.path.lastIndexOf("/") + 1) : "";
  const relative = (path: string) => (folder && path.startsWith(folder) ? path.slice(folder.length) : path);
  const outside = [...texts, ...binaries.map((binary) => ({ path: binary.name }))].filter((entry) => entry !== main && folder && !entry.path.startsWith(folder)).length;
  if (outside) warnings.push(`${outside} file${outside === 1 ? " is" : "s are"} outside the main file's folder and may not be found by \\input or \\includegraphics.`);

  const mainStem = relative(main.path).replace(/\.(tex|ltx|latex)$/i, "");
  const taken = new Set<string>([MAIN_FILE]);
  const files: ProjectFile[] = [];
  for (const file of texts) {
    if (file === main) continue;
    let name = relative(file.path);
    if (taken.has(name)) {
      const renamed = `${name.replace(/\.[^.]+$/, "")}-2${name.slice(name.lastIndexOf("."))}`;
      warnings.push(`“${name}” was renamed “${renamed}”, because the main file becomes main.tex.`);
      name = renamed;
    }
    taken.add(name);
    files.push({ name, content: file.content });
  }
  // The PDF that compiling the main file produced is output, not a figure.
  const kept = binaries
    .map((binary) => ({ ...binary, name: relative(binary.name) }))
    .filter((binary) => binary.name.toLowerCase() !== `${mainStem.toLowerCase()}.pdf`);
  if (!files.some((file) => extension(file.name) === "bib")) files.push({ name: BIB_FILE, content: "" });
  if (other) warnings.push(`${other} file${other === 1 ? "" : "s"} of other types (fonts, archives, videos …) ${other === 1 ? "was" : "were"} left out.`);
  if (main.path !== MAIN_FILE && relative(main.path) !== MAIN_FILE) warnings.push(`“${main.path}” is the main file and is now main.tex.`);
  return { source: main.content, mainPath: main.path, files, binaries: kept, title: titleOfSource(main.content), warnings };
}

/**
 * Upload entries for an existing project: the same clean-up and decoding,
 * without choosing a main file.
 */
export function projectAdditions(input: ProjectEntry[], warnings: string[] = [], options: { stripFolder?: boolean } = {}): { files: ProjectFile[]; binaries: ProjectBinary[] } {
  const cleaned = input.map((entry) => ({ ...entry, path: normalizePath(entry.path) })).filter((entry) => entry.path && !isJunk(entry.path));
  // A .zip often wraps the files in one folder; files dropped with their folder keep it.
  const entries = options.stripFolder === false ? cleaned : stripCommonFolder(cleaned);
  const files: ProjectFile[] = [];
  const binaries: ProjectBinary[] = [];
  let other = 0;
  for (const entry of entries) {
    const kind = extension(entry.path);
    if (TEXT_EXTENSIONS.has(kind) && entry.bytes.length <= MAX_TEXT_BYTES) files.push({ name: entry.path, content: decodeSource(entry.bytes) });
    else if (BINARY_TYPES[kind] && entry.bytes.length <= MAX_BINARY_BYTES) binaries.push({ name: entry.path, type: BINARY_TYPES[kind], bytes: entry.bytes });
    else other += 1;
  }
  if (other) warnings.push(`${other} file${other === 1 ? " was" : "s were"} left out (unsupported type or too large).`);
  return { files, binaries };
}

/** Whether a file name is part of a LaTeX project (text, figure or archive). */
export function isProjectFile(name: string): boolean {
  const kind = extension(name);
  return TEXT_EXTENSIONS.has(kind) || Boolean(BINARY_TYPES[kind]) || kind === "zip";
}
