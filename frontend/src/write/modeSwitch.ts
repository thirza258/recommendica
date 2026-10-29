/**
 * Switching one paper between the visual and LaTeX editors.
 *
 * Both representations live on the same document. A switch converts only when
 * the representation being left has changed since the last conversion; looking
 * at the other editor and coming back keeps the original bytes. `sync` stores
 * signatures of the two representations as they were at that conversion.
 */

import type { JSONContent } from "@tiptap/core";
import { BIB_FILE } from "./documents.ts";
import type { PaperDocument, PaperSettings, ProjectAsset, ProjectFile } from "./documents.ts";
import { toLatexImage } from "./images.ts";
import { importLatex } from "./visual/fromLatex.ts";
import { documentToLatex } from "./visual/toLatex.ts";

export interface ModeSwitchResult {
  document: PaperDocument;
  /** Warnings from the conversion, for the destination editor to display. */
  notice: string;
}

function hash(value: string): string {
  // FNV-1a. Signatures only need to detect local edits, and storing another
  // full copy of the document (especially its images) would be wasteful.
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

/** Deterministic JSON, so equivalent settings always produce the same hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A short signature of the visual representation: its content, page settings
 * and references all affect the LaTeX a conversion produces.
 */
export function contentSignature(content: JSONContent | null | undefined, settings?: PaperSettings, bib = ""): string {
  return content ? `c:${hash(canonical({ content, settings: settings ?? null, bib: bib.trim() }))}` : "";
}

/**
 * A short signature of the LaTeX representation: source, project files and
 * images all affect what the importer produces. Line endings are ignored.
 */
export function sourceSignature(source: string, files: ProjectFile[] = [], assets: ProjectAsset[] = []): string {
  if (!source) return "";
  const normalized = {
    source: source.replace(/\r\n?/g, "\n"),
    files: [...files]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((file) => [file.name, file.content.replace(/\r\n?/g, "\n")]),
    assets: [...assets].sort((left, right) => left.name.localeCompare(right.name)).map((asset) => [asset.name, asset.dataUrl]),
  };
  return `s:${hash(canonical(normalized))}`;
}

function fileMap(files: ProjectFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.name, file.content]));
}

function assetMap(assets: ProjectAsset[]): Record<string, string> {
  return Object.fromEntries(assets.map((asset) => [asset.name, asset.dataUrl]));
}

function mergeFiles(base: ProjectFile[], extra: ProjectFile[]): ProjectFile[] {
  const merged = new Map(base.map((file) => [file.name, file]));
  for (const file of extra) merged.set(file.name, file);
  return [...merged.values()];
}

/** The .bib a LaTeX project actually uses, following its bibliography commands. */
function projectBib(source: string, files: ProjectFile[], fallback: string): string {
  const byName = new Map(files.map((file) => [file.name, file.content]));
  const candidates: string[] = [];
  for (const match of source.matchAll(/\\(?:bibliography|addbibresource)\{([^}]+)\}/g)) {
    for (const name of match[1].split(",")) {
      const clean = name.trim();
      if (!clean) continue;
      candidates.push(clean, clean.endsWith(".bib") ? clean : `${clean}.bib`);
    }
  }
  for (const name of candidates) {
    const content = byName.get(name);
    if (content !== undefined) return content;
  }
  const references = files.find((file) => file.name.toLowerCase() === BIB_FILE);
  if (references) return references.content;
  const anyBib = files.find((file) => file.name.toLowerCase().endsWith(".bib"));
  return anyBib ? anyBib.content : fallback;
}

function emptyVisualContent(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** True for the names new LaTeX documents use before the author edits them. */
function genericTitle(title: string): boolean {
  return !title.trim() || /^untitled(?: paper| latex paper)?$/i.test(title.trim());
}

/**
 * Convert a visual paper to LaTeX in place. Existing source is reused when the
 * visual content has not changed since the last switch.
 */
export async function switchToLatex(doc: PaperDocument): Promise<ModeSwitchResult> {
  const content = doc.content ?? emptyVisualContent();
  const contentHash = contentSignature(content, doc.settings, doc.bib);

  if (doc.sync?.content === contentHash && doc.sync.source === sourceSignature(doc.source, doc.files, doc.assets)) {
    return { document: { ...doc, kind: "latex", updatedAt: Date.now() }, notice: "" };
  }

  const exported = documentToLatex(content, doc.settings, doc.bib);
  const images: ProjectAsset[] = [];
  for (const image of exported.images) {
    const dataUrl = await toLatexImage(image.dataUrl);
    const type = /^data:(image\/[a-z+.-]+)/i.exec(dataUrl)?.[1] ?? image.mime;
    images.push({ name: image.path, type, dataUrl, size: Math.round((dataUrl.length * 3) / 4) });
  }

  // Images generated by this conversion replace earlier generated ones;
  // everything the author uploaded in LaTeX mode is kept.
  const assets = new Map(doc.assets.filter((asset) => !asset.name.startsWith("figures/figure-")).map((asset) => [asset.name, asset]));
  for (const image of images) assets.set(image.name, image);

  const files = mergeFiles(doc.files, exported.files);
  const bibIndex = files.findIndex((file) => file.name === BIB_FILE);
  if (exported.bib.trim() || bibIndex !== -1) {
    const bib = { name: BIB_FILE, content: exported.bib };
    if (bibIndex === -1) files.push(bib);
    else files[bibIndex] = bib;
  }

  const nextAssets = [...assets.values()];

  return {
    document: {
      ...doc,
      kind: "latex",
      source: exported.tex,
      files,
      assets: nextAssets,
      sync: { content: contentHash, source: sourceSignature(exported.tex, files, nextAssets) },
      updatedAt: Date.now(),
    },
    notice: exported.warnings.join(" "),
  };
}

/**
 * Convert a LaTeX paper to the visual editor in place. Existing visual content
 * is reused when the source has not changed since the last switch.
 */
export async function switchToVisual(doc: PaperDocument): Promise<ModeSwitchResult> {
  const sourceHash = sourceSignature(doc.source, doc.files, doc.assets);
  const bib = projectBib(doc.source, doc.files, doc.bib);

  if (doc.content && doc.sync?.source === sourceHash && doc.sync.content === contentSignature(doc.content, doc.settings, bib)) {
    return { document: { ...doc, kind: "visual", bib, updatedAt: Date.now() }, notice: "" };
  }

  const imported = importLatex(doc.source, {
    files: fileMap(doc.files),
    assets: assetMap(doc.assets),
    bib: doc.bib,
  });
  const content = imported.content;
  const settings: PaperSettings = { ...doc.settings, ...imported.settings };
  const title = genericTitle(doc.title) && imported.title.trim() ? imported.title.trim() : doc.title;

  return {
    document: {
      ...doc,
      kind: "visual",
      title,
      settings,
      content,
      bib: imported.bib,
      sync: { content: contentSignature(content, settings, imported.bib), source: sourceHash },
      updatedAt: Date.now(),
    },
    notice: imported.warnings.join(" "),
  };
}
