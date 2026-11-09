/**
 * Bringing files into the paper editor.
 *
 * Documents — Word (.docx), Markdown, plain text — become LaTeX papers: they
 * are converted to visual content and the mode switch writes the LaTeX, so
 * the paper also opens in the visual editor with everything the document
 * had. LaTeX projects — a .zip, a folder or loose files — become LaTeX papers
 * as they are.
 *
 * Browser-side: pictures are scaled down and uploaded to the asset store
 * here, before anything is saved, so a paper never keeps a 12-megapixel
 * photo, or the same picture twice.
 */

import type { JSONContent } from "@tiptap/core";
import { BIB_FILE, DEFAULT_SETTINGS, newDocumentId } from "../documents.ts";
import type { PaperDocument, PaperSettings, ProjectAsset, ProjectFile } from "../documents.ts";
import { createFromTemplate } from "../templates.ts";
import { loadableContent, sourceSignature, switchToLatex } from "../modeSwitch.ts";
import { documentToLatex } from "../visual/toLatex.ts";
import { validBlock } from "../visual/contentCheck.ts";
import { readImageFile } from "../images.ts";
import { storeImage } from "../assetClient.ts";
import { convertDocx } from "./docx.ts";
import type { DocumentImport } from "./docx.ts";
import { convertMarkdown, convertPlainText } from "./markdown.ts";
import { admitUpload, buildLatexProject, isProjectFile, isSkippedFolder, MAX_UPLOAD_BYTES, projectAdditions, unzipProject } from "./latexProject.ts";
import type { ProjectBinary, ProjectEntry } from "./latexProject.ts";
import { scanPreamble, packagesOf } from "../latexPreamble.ts";

export interface Upload {
  /** Path inside the upload (a folder's relative path, or the file name). */
  path: string;
  file: File;
}

export interface ImportOutcome {
  doc: PaperDocument;
  /** What the conversion approximated, to show when the paper opens. */
  notice: string;
}

const DOCUMENT = /\.(docx|md|markdown|txt)$/i;

/** Formats people try that cannot be read here, and what to do instead. */
function unsupported(name: string): string | null {
  if (/\.doc$/i.test(name)) return `“${name}” is an old Word document (.doc). Open it in Word, save it as .docx, and import that.`;
  if (/\.(odt|rtf|pages|wpd|gdoc)$/i.test(name)) return `“${name}” cannot be read here. Save it as a Word document (.docx) and import that.`;
  if (/\.pdf$/i.test(name)) return `A PDF cannot be turned back into editable text. Import the Word document or the LaTeX source it was made from.`;
  return null;
}

export function stem(name: string): string {
  return (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "") || "Imported paper";
}

/** Uploads from a file input; a folder input carries relative paths. */
export function uploadsFromInput(list: FileList | File[]): Upload[] {
  return Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
}

async function readEntry(entry: FileSystemEntry, out: Upload[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\//, ""), file });
    return;
  }
  if (entry.isDirectory) {
    // .git, node_modules and the like are never read.
    if (isSkippedFolder(entry.name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns the folder in batches until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await readEntry(child, out);
    }
  }
}

/**
 * Dropped files and folders, with paths. The entries must be taken from the
 * drop event while it runs (`dropEntries`); reading them may happen later.
 */
export async function uploadsFromEntries(entries: FileSystemEntry[], files: File[]): Promise<Upload[]> {
  if (!entries.length) return uploadsFromInput(files);
  const out: Upload[] = [];
  for (const entry of entries) await readEntry(entry, out);
  return out;
}

/** What an upload is: one document, or a LaTeX project. */
export function classifyUploads(uploads: Upload[]): { kind: "document" | "project" } | { error: string } {
  if (!uploads.length) return { error: "Choose a file to import." };
  const documents = uploads.filter((upload) => DOCUMENT.test(upload.path) && !/\.txt$/i.test(upload.path));
  const hasTex = uploads.some((upload) => /\.(tex|ltx|zip)$/i.test(upload.path));
  if (uploads.length === 1) {
    const only = uploads[0].path;
    if (DOCUMENT.test(only)) return { kind: "document" };
    const problem = unsupported(only);
    if (problem) return { error: problem };
  }
  if (documents.length && !hasTex) {
    return documents.length === 1 && uploads.length === 1 ? { kind: "document" } : { error: "Import one document at a time, or a LaTeX project (a .zip, a folder, or its .tex files)." };
  }
  if (hasTex || uploads.some((upload) => isProjectFile(upload.path))) return { kind: "project" };
  return { error: unsupported(uploads[0].path) ?? `“${uploads[0].path}” is not a document or LaTeX file this editor can import.` };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",", 2);
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  if (!meta.includes(";base64")) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Scales and uploads a picture; falls back to the scaled data URL when the
 * asset store is unavailable. Returns "" when the browser cannot decode it.
 */
async function storePicture(blob: Blob, name: string, warnings: Set<string>): Promise<{ src: string; type: string; size: number } | null> {
  try {
    const image = await readImageFile(blob);
    const stored = await storeImage(image, name);
    if (!stored.uploaded) warnings.add("Some pictures were kept in this browser because the image store is unavailable.");
    return { src: stored.src, type: image.type, size: image.size };
  } catch (error) {
    warnings.add(error instanceof Error && /15 MB/.test(error.message) ? "Pictures larger than 15 MB were left out." : "Some pictures could not be read by the browser and were left out.");
    return null;
  }
}

/** Pictures inside converted content: scaled, uploaded, their sources replaced. */
async function storeFigures(content: JSONContent, warnings: Set<string>, onStatus?: (text: string) => void): Promise<JSONContent> {
  let count = 0;
  const visit = async (node: JSONContent): Promise<JSONContent> => {
    if (node.type === "figure" && typeof node.attrs?.src === "string" && node.attrs.src.startsWith("data:")) {
      count += 1;
      onStatus?.(`Storing picture ${count}…`);
      const stored = await storePicture(dataUrlToBlob(node.attrs.src), `figure-${count}`, warnings);
      return { ...node, attrs: { ...node.attrs, src: stored?.src ?? "" } };
    }
    if (!node.content) return node;
    const children: JSONContent[] = [];
    for (const child of node.content) children.push(await visit(child));
    return { ...node, content: children };
  };
  return visit(content);
}

const MAX_DOCUMENT_BYTES = 150_000_000;

/** Converts one document file (Word, Markdown, text) to visual content. */
export async function convertDocumentFile(file: File): Promise<DocumentImport> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`“${file.name}” is too large to import (more than 150 MB).`);
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return convertDocx(new Uint8Array(await file.arrayBuffer()));
  const text = new TextDecoder("utf-8").decode(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/, "");
  return name.endsWith(".txt") ? convertPlainText(text) : convertMarkdown(text);
}

/** A document as a new LaTeX paper. */
async function importDocument(upload: Upload, onStatus?: (text: string) => void): Promise<ImportOutcome> {
  onStatus?.(`Converting “${upload.file.name}”…`);
  const converted = await convertDocumentFile(upload.file);
  const warnings = new Set(converted.warnings);
  const settings: PaperSettings = { ...DEFAULT_SETTINGS, ...converted.settings };
  const stored = await storeFigures(converted.content, warnings, onStatus);
  const content = loadableContent(stored, validBlock, settings, converted.bib).content;
  const now = Date.now();
  const visual: PaperDocument = {
    ...createFromTemplate("blank", now),
    id: newDocumentId(),
    title: converted.title || stem(upload.file.name),
    template: "import",
    settings,
    content,
    bib: converted.bib,
  };
  onStatus?.("Writing the LaTeX…");
  const latex = await switchToLatex(visual);
  let doc = latex.document;
  // Citations without BibTeX still need the file \bibliography names.
  if (/\\bibliography\{references\}/.test(doc.source) && !doc.files.some((file) => file.name === BIB_FILE)) {
    const files = [...doc.files, { name: BIB_FILE, content: "" }];
    doc = { ...doc, files, sync: doc.sync ? { ...doc.sync, source: sourceSignature(doc.source, files, doc.assets) } : doc.sync };
    warnings.add("The citations have no references yet: add their BibTeX entries to references.bib.");
  }
  return { doc, notice: [...warnings, latex.notice].filter(Boolean).join(" ") };
}

/** Reads the uploads worth reading; the rest is decided from path and size alone. */
async function entriesOf(uploads: Upload[], warnings: string[]): Promise<ProjectEntry[]> {
  const entries: ProjectEntry[] = [];
  let total = 0;
  let tooLarge = 0;
  for (const upload of uploads) {
    const verdict = admitUpload(upload.path, upload.file.size);
    if (verdict === "skip") continue;
    if (verdict === "too large" || total + upload.file.size > MAX_UPLOAD_BYTES) {
      tooLarge += 1;
      continue;
    }
    total += upload.file.size;
    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    if (/\.zip$/i.test(upload.path)) entries.push(...unzipProject(bytes, warnings));
    else entries.push({ path: upload.path, bytes });
  }
  if (tooLarge) warnings.push(`${tooLarge} file${tooLarge === 1 ? " was" : "s were"} too large and left out.`);
  return entries;
}

/** Project pictures as assets (scaled, uploaded); PDF and EPS figures inline. */
async function projectAssets(binaries: ProjectBinary[], warnings: Set<string>, onStatus?: (text: string) => void): Promise<ProjectAsset[]> {
  const assets: ProjectAsset[] = [];
  let index = 0;
  for (const binary of binaries) {
    index += 1;
    onStatus?.(`Storing ${binary.name} (${index} of ${binaries.length})…`);
    if (binary.type.startsWith("image/")) {
      const stored = await storePicture(new Blob([binary.bytes.slice()], { type: binary.type }), binary.name, warnings);
      if (stored) assets.push({ name: binary.name, type: stored.type, dataUrl: stored.src, size: stored.size });
    } else {
      assets.push({ name: binary.name, type: binary.type, dataUrl: `data:${binary.type};base64,${base64(binary.bytes)}`, size: binary.bytes.length });
    }
  }
  return assets;
}

/** A LaTeX project as a new LaTeX paper. */
async function importProject(uploads: Upload[], onStatus?: (text: string) => void): Promise<ImportOutcome> {
  onStatus?.("Reading the project…");
  const warnings: string[] = [];
  const project = buildLatexProject(await entriesOf(uploads, warnings), warnings);
  const notes = new Set(warnings);
  const assets = await projectAssets(project.binaries, notes, onStatus);
  if (project.binaries.some((binary) => !binary.type.startsWith("image/"))) {
    notes.add("PDF and EPS figures are kept for export but cannot be previewed; upload PNG or JPEG copies with the same names to see them.");
  }
  const now = Date.now();
  const doc: PaperDocument = {
    ...createFromTemplate("latex-blank", now),
    id: newDocumentId(),
    title: project.title || stem(project.mainPath),
    template: "import",
    source: project.source,
    files: project.files,
    assets,
  };
  return { doc, notice: [...notes].join(" ") };
}

/** Turns uploads into a new LaTeX paper. */
export async function importUploads(uploads: Upload[], onStatus?: (text: string) => void): Promise<ImportOutcome> {
  const kind = classifyUploads(uploads);
  if ("error" in kind) throw new Error(kind.error);
  return kind.kind === "document" ? importDocument(uploads[0], onStatus) : importProject(uploads, onStatus);
}

// ── Adding files to an open LaTeX project ─────────────────────────────────

export interface ProjectUpload {
  files: ProjectFile[];
  assets: ProjectAsset[];
  /** BibTeX for the project's .bib, from a converted document's citations. */
  bib: string;
  notice: string;
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  while (taken.has(`${base}-${index}${ext}`)) index++;
  return `${base}-${index}${ext}`;
}

/** Packages the main file loads (natbib is part of REVTeX). */
function loadedPackages(mainSource: string): Set<string> {
  const loaded = new Set(scanPreamble(mainSource).statements.flatMap((statement) => packagesOf(statement)?.names ?? []));
  if (/\\documentclass\s*(\[[^\]]*\])?\s*\{revtex/.test(mainSource)) loaded.add("natbib");
  return loaded;
}

/** What LaTeX in a body needs, by package. */
const BODY_NEEDS: [string, RegExp][] = [
  ["amsmath", /\\begin\{(?:equation|align|gather|multline|aligned)|\\\[|\$|\\eqref/],
  ["graphicx", /\\includegraphics/],
  ["booktabs", /\\(?:toprule|midrule|bottomrule)/],
  ["multirow", /\\multirow/],
  ["makecell", /\\makecell/],
  ["ulem", /\\sout\b/],
  ["xcolor", /\\textcolor|\\definecolor|\\color\b/],
  ["soul", /\\hl\b|\\sethlcolor/],
  ["hyperref", /\\(?:href|url|nameref|autoref)\b/],
];

/** Packages a body uses that the main file does not load yet. */
function missingPackages(body: string, mainSource: string): string[] {
  const loaded = loadedPackages(mainSource);
  return BODY_NEEDS.filter(([name, pattern]) => pattern.test(body) && !loaded.has(name) && !(name === "hyperref" && loaded.has("url") && !/\\(?:href|nameref|autoref)\b/.test(body))).map(([name]) => name);
}

/** Citation notes and natbib commands only where the main file loads natbib. */
function plainCitations(content: JSONContent): JSONContent {
  if (content.type === "citation" && content.attrs) {
    const attrs: Record<string, unknown> = { ...content.attrs };
    delete attrs.command;
    delete attrs.pre;
    return { ...content, attrs };
  }
  return content.content ? { ...content, content: content.content.map(plainCitations) } : content;
}

/**
 * A Word or Markdown document as a .tex file of the open project (to
 * \input), its pictures as project images and its citations as BibTeX.
 */
async function documentAsProjectFile(upload: Upload, taken: Set<string>, mainSource: string, onStatus?: (text: string) => void): Promise<ProjectUpload> {
  onStatus?.(`Converting “${upload.file.name}”…`);
  const converted = await convertDocumentFile(upload.file);
  const warnings = new Set(converted.warnings);
  const fileStem = stem(upload.file.name).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "document";
  const name = uniqueName(`${fileStem}.tex`, taken);
  taken.add(name);
  // A part of a paper: the title becomes a section, front matter stays.
  const natbib = loadedPackages(mainSource).has("natbib");
  const blocks = (converted.content.content ?? []).map((block) =>
    block.type === "paperTitle" ? { type: "heading", attrs: { level: 1, numbered: true, id: "" }, content: block.content } : block.type === "paperAuthors" ? { type: "paragraph", content: block.content } : block,
  );
  // \citep and notes need natbib; without it the part cites with plain \cite.
  const settings: PaperSettings = { ...DEFAULT_SETTINGS, ...converted.settings, ...(natbib ? {} : { citationStyle: "ieee" as const }) };
  const exported = documentToLatex(natbib ? { type: "doc", content: blocks } : plainCitations({ type: "doc", content: blocks }), settings, converted.bib);
  let body = (/\\begin\{document\}\n([\s\S]*)\n\\end\{document\}/.exec(exported.tex)?.[1] ?? "").replace(/\\bibliographystyle\{[^}]*\}\s*\\bibliography\{references\}\s*$/, "").trim();
  // Highlight colours are defined in the exporter's preamble; the part brings its own.
  const colours = exported.tex.slice(0, exported.tex.indexOf("\\begin{document}")).match(/^\\definecolor\{paperhl[0-9A-F]{6}\}\{HTML\}\{[0-9A-F]{6}\}$/gm) ?? [];
  if (colours.length) body = `${colours.join("\n")}\n${body}`;
  const assets: ProjectAsset[] = [];
  for (const image of exported.images) {
    const assetName = uniqueName(image.path.replace(/^figures\/figure-/, `figures/${fileStem}-`), taken);
    taken.add(assetName);
    body = body.split(`{${image.path}}`).join(`{${assetName}}`);
    const stored = image.dataUrl.startsWith("data:") ? await storePicture(dataUrlToBlob(image.dataUrl), assetName, warnings) : { src: image.dataUrl, type: image.mime, size: 0 };
    if (stored) assets.push({ name: assetName, type: stored.type, dataUrl: stored.src, size: stored.size });
  }
  const packages = missingPackages(body, mainSource);
  const notes = [`“${upload.file.name}” was converted to ${name}; add \\input{${name.replace(/\.tex$/, "")}} where it belongs in main.tex.`];
  if (packages.length) notes.push(`It uses ${packages.map((item) => `\\usepackage{${item}}`).join(", ")}, which main.tex does not load yet.`);
  return { files: [{ name, content: `${body}\n` }], assets, bib: converted.bib, notice: [...notes, ...warnings].join(" ") };
}

/**
 * Files added to an open LaTeX project: text files, pictures, PDF figures,
 * .zip archives (merged), and Word or Markdown documents (converted). A name
 * that is taken is never overwritten; the new file gets a free name.
 */
export async function addToProject(uploads: Upload[], existing: string[], mainSource: string, onStatus?: (text: string) => void): Promise<ProjectUpload> {
  const taken = new Set(existing);
  const result: ProjectUpload = { files: [], assets: [], bib: "", notice: "" };
  const notes: string[] = [];
  const renamed: string[] = [];
  const zipped: ProjectEntry[] = [];
  const loose: ProjectEntry[] = [];
  for (const upload of uploads) {
    const problem = /\.(doc|odt|rtf|pages|wpd)$/i.test(upload.path) ? unsupported(upload.path) : null;
    if (problem) {
      notes.push(problem);
      continue;
    }
    if (/\.(docx|md|markdown)$/i.test(upload.path)) {
      const converted = await documentAsProjectFile(upload, taken, mainSource, onStatus);
      result.files.push(...converted.files);
      result.assets.push(...converted.assets);
      result.bib = [result.bib, converted.bib].filter(Boolean).join("\n\n");
      notes.push(converted.notice);
      continue;
    }
    const verdict = admitUpload(upload.path, upload.file.size);
    if (verdict !== "ok") {
      if (verdict === "too large") notes.push(`“${upload.path}” is too large and was left out.`);
      continue;
    }
    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    if (/\.zip$/i.test(upload.path)) zipped.push(...unzipProject(bytes, notes));
    else loose.push({ path: upload.path, bytes });
  }
  const fromZip = projectAdditions(zipped, notes);
  const fromFiles = projectAdditions(loose, notes, { stripFolder: false });
  const additions = { files: [...fromZip.files, ...fromFiles.files], binaries: [...fromZip.binaries, ...fromFiles.binaries] };
  for (const file of additions.files) {
    const name = uniqueName(file.name, taken);
    if (name !== file.name) renamed.push(`${file.name} → ${name}`);
    taken.add(name);
    result.files.push({ ...file, name });
  }
  const pictures = new Set<string>();
  const binaries = additions.binaries.map((binary) => {
    const name = uniqueName(binary.name, taken);
    if (name !== binary.name) renamed.push(`${binary.name} → ${name}`);
    taken.add(name);
    return { ...binary, name };
  });
  result.assets.push(...(await projectAssets(binaries, pictures, onStatus)));
  notes.push(...pictures);
  if (renamed.length) notes.push(`Files with names already in the project were added as ${renamed.join(", ")}.`);
  const added = result.files.length + result.assets.length;
  if (added && !notes.length) notes.push(`${added} file${added === 1 ? " was" : "s were"} added to the project.`);
  result.notice = notes.filter(Boolean).join(" ");
  return result;
}

/** BibTeX entries whose keys are not in `existing` yet. */
export function newEntries(existing: string, added: string): string {
  const keys = new Set([...existing.matchAll(/@\w+\s*\{\s*([^,\s]+)/g)].map((match) => match[1]));
  return added
    .split(/\n(?=@)/)
    .filter((entry) => {
      const key = /@\w+\s*\{\s*([^,\s]+)/.exec(entry)?.[1];
      return key && !keys.has(key);
    })
    .join("\n\n");
}

