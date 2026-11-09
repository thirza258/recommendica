/**
 * Word documents (.docx) as visual paper content.
 *
 * A .docx is a zip of XML parts. This reads the main document with its
 * styles, list numbering, footnotes, relationships and pictures, and builds
 * the visual editor's JSON: headings from heading styles, lists from Word's
 * numbering, equations from Word math, figures and tables with their
 * captions, footnotes, links, and citations from Zotero, Mendeley or Word's
 * own reference list. The mode switch then writes the LaTeX.
 *
 * DOM-free: pictures become data URLs, which the browser side scales and
 * uploads before the paper is saved.
 */

import { unzipSync } from "fflate";
import type { JSONContent } from "@tiptap/core";
import type { PaperSettings } from "../documents.ts";
import { DEFAULT_SETTINGS } from "../documents.ts";
import { documentToLatex } from "../visual/toLatex.ts";
import { attr, child, descendant, descendants, elements, parseXml, textOf } from "./xml.ts";
import type { XmlElement } from "./xml.ts";
import { ommlParagraph, ommlToLatex } from "./omml.ts";
import { Bibliography, cslCitation, wordCitationTags } from "./citations.ts";

export interface DocumentImport {
  content: JSONContent;
  settings: Partial<PaperSettings>;
  /** The paper's title as plain text ("" when the document has none). */
  title: string;
  /** BibTeX for citations made with a reference manager. */
  bib: string;
  warnings: string[];
}

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertical?: "superscript" | "subscript";
  color?: string;
  highlight?: string;
  mono?: boolean;
  font?: string;
  size?: number;
}

interface Style {
  id: string;
  name: string;
  type: string;
  basedOn: string | null;
  outline: number | null;
  numId: string | null;
  ilvl: number;
  align: string | null;
  /** Line spacing in 240ths of a line (w:spacing w:line, lineRule auto). */
  line: number | null;
  run: RunProps;
}

type ParagraphKind = "normal" | "title" | "subtitle" | "heading" | "caption" | "quote" | "code" | "abstract" | "keywords" | "author" | "toc" | "bibliography";

interface ListInfo {
  ordered: boolean;
  start: number;
  level: number;
  /** One list instance (Word's numId), so two lists side by side stay apart. */
  id: string;
}

type Item =
  | { kind: "paragraph"; style: ParagraphKind; level: number; inline: JSONContent[]; text: string; align: string | null; list: ListInfo | null; numbered: boolean }
  | { kind: "figure"; attrs: Record<string, unknown> }
  | { kind: "math"; latex: string; numbered: boolean }
  | { kind: "table"; table: JSONContent }
  | { kind: "pageBreak" }
  | { kind: "toc" }
  | { kind: "bibliography" };

interface Field {
  instruction: string;
  result: boolean;
  /** Skip the result: a table of contents, or a citation replaced by \cite. */
  skip: boolean;
  link: string | null;
}

const MAX_PART_BYTES = 80_000_000;
const MAX_TOTAL_BYTES = 400_000_000;
const EMU_PER_INCH = 914400;
const TWIPS_PER_INCH = 1440;

const MONOSPACE = /^(courier( new)?|consolas|menlo|monaco|lucida console|source code pro|fira (code|mono)|jetbrains mono|inconsolata|dejavu sans mono|liberation mono|cascadia (code|mono)|roboto mono|ubuntu mono|sf mono)$/i;

const HIGHLIGHTS: Record<string, string> = {
  yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000", darkBlue: "#000080", darkCyan: "#008080",
  darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000",
};

/** Characters of the Symbol font (w:sym, w:font="Symbol") that papers use. */
const SYMBOL_FONT: Record<number, string> = {
  0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6a: "ϕ", 0x6b: "κ", 0x6c: "λ", 0x6d: "μ", 0x6e: "ν",
  0x6f: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ", 0x44: "Δ", 0x46: "Φ", 0x47: "Γ",
  0x4c: "Λ", 0x50: "Π", 0x51: "Θ", 0x53: "Σ", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0xb1: "±", 0xb4: "×", 0xb8: "÷", 0xa3: "≤", 0xb3: "≥", 0xb9: "≠", 0xbb: "≈",
  0xba: "≡", 0xa5: "∞", 0xb6: "∂", 0xd1: "∇", 0xce: "∈", 0xcf: "∉", 0xc8: "∪", 0xc7: "∩", 0xae: "→", 0xac: "←", 0xdb: "⇔", 0xde: "⇒", 0xdc: "⇐", 0xb7: "•",
  0xd6: "√", 0xe5: "∑", 0xd5: "∏", 0xf2: "∫", 0xb0: "°", 0xa2: "′", 0xb2: "″", 0xbc: "…", 0xd7: "·", 0x22: "∀", 0x24: "∃", 0xc6: "∅", 0xb5: "∝",
};

const CAPTION = /^\s*(figure|fig\.?|table|tab\.?|gambar|tabel|grafik|diagram|chart|abbildung|tabelle)\s*(\d+(?:[.\-–]\d+)*)?\s*([.:—–-])?\s*/i;
const ABSTRACT_HEADING = /^(abstract|abstrak|ringkasan|summary|résumé|resumen|zusammenfassung)\.?$/i;
const ABSTRACT_LEAD = /^\s*(abstract|abstrak)\s*[—–:.-]\s*/i;
const KEYWORDS_LEAD = /^\s*(key\s*-?\s*words?|index\s+terms|kata\s*kunci|keywords?)\s*[—–:.-]\s*/i;

function onOff(element: XmlElement | null): boolean | undefined {
  if (!element) return undefined;
  const value = attr(element, "val");
  return value === null || !/^(0|false|off|none)$/i.test(value);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf", wdp: "image/vnd.ms-photo",
};

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return [...marks.filter((entry) => entry.type !== mark.type), mark];
}

function sameMarks(left: Mark[] | undefined, right: Mark[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function pushText(out: JSONContent[], text: string, marks: Mark[]): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === "text" && sameMarks(last.marks as Mark[] | undefined, marks)) {
    last.text = (last.text ?? "") + text;
    return;
  }
  out.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
}

/** Inline content without leading/trailing blanks and with single spaces. */
function tidy(content: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of content) {
    if (node.type === "text") {
      const text = (node.text ?? "").replace(/[ \t\u00a0]{2,}/g, (run) => (run.includes("\u00a0") ? run : " "));
      const last = out[out.length - 1];
      if (last?.type === "text" && sameMarks(last.marks as Mark[] | undefined, node.marks as Mark[] | undefined)) last.text = (last.text ?? "") + text;
      else out.push({ ...node, text });
    } else out.push(node);
  }
  while (out.length && out[0].type === "text" && !(out[0].text ?? "").trim()) out.shift();
  while (out.length && out[out.length - 1].type === "text" && !(out[out.length - 1].text ?? "").trim()) out.pop();
  while (out.length && out[0].type === "hardBreak") out.shift();
  while (out.length && out[out.length - 1].type === "hardBreak") out.pop();
  if (out[0]?.type === "text") out[0] = { ...out[0], text: (out[0].text ?? "").replace(/^\s+/, "") };
  const last = out[out.length - 1];
  if (last?.type === "text") out[out.length - 1] = { ...last, text: (last.text ?? "").replace(/\s+$/, "") };
  return out.filter((node) => node.type !== "text" || Boolean(node.text));
}

function plain(content: JSONContent[]): string {
  return content.map((node) => (node.type === "text" ? node.text ?? "" : node.type === "hardBreak" ? " " : node.type === "mathInline" ? "x" : "")).join("");
}

/** Removes `count` characters from the start of inline content. */
function dropLeading(content: JSONContent[], count: number): JSONContent[] {
  let left = count;
  const out: JSONContent[] = [];
  for (const node of content) {
    if (left > 0 && node.type === "text") {
      const text = node.text ?? "";
      if (text.length <= left) {
        left -= text.length;
        continue;
      }
      out.push({ ...node, text: text.slice(left) });
      left = 0;
      continue;
    }
    if (left > 0 && node.type === "hardBreak") {
      left -= 1;
      continue;
    }
    out.push(node);
  }
  return tidy(out);
}

class DocxConverter {
  private readonly parts: Record<string, Uint8Array>;
  private readonly warnings = new Set<string>();
  private readonly styles = new Map<string, Style>();
  private defaultParagraphStyle: string | null = null;
  private readonly numbering = new Map<string, { abstract: string; starts: Map<number, number> }>();
  private readonly abstractLevels = new Map<string, Map<number, { format: string; start: number }>>();
  private rels = new Map<string, { target: string; external: boolean }>();
  private readonly footnotes = new Map<string, XmlElement>();
  private readonly endnotes = new Map<string, XmlElement>();
  private readonly sources = new Map<string, XmlElement>();
  private readonly bibliography = new Bibliography();
  private readonly fields: Field[] = [];
  private documentPath = "word/document.xml";
  private textWidth = 6.5;
  private citationStyle: "ieee" | "apa" | null = null;
  private tocWritten = false;
  private unsupportedPictures = 0;
  private charts = 0;
  private objects = 0;
  private tableImages = 0;
  private trackedChanges = 0;
  private comments = 0;

  constructor(parts: Record<string, Uint8Array>) {
    this.parts = parts;
  }

  private xml(path: string): XmlElement | null {
    const bytes = this.parts[path];
    if (!bytes) return null;
    try {
      return parseXml(decodeText(bytes));
    } catch {
      this.warnings.add(`Part of the document (${path}) could not be read and was left out.`);
      return null;
    }
  }

  private relsFor(partPath: string): Map<string, { target: string; external: boolean }> {
    const folder = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/") + 1) : "";
    const name = partPath.slice(folder.length);
    const rels = new Map<string, { target: string; external: boolean }>();
    for (const rel of elements(this.xml(`${folder}_rels/${name}.rels`), "Relationship")) {
      const id = attr(rel, "Id");
      const target = attr(rel, "Target") ?? "";
      if (!id) continue;
      const external = attr(rel, "TargetMode") === "External";
      rels.set(id, { target: external ? target : this.resolvePath(folder, target), external });
    }
    return rels;
  }

  private resolvePath(folder: string, target: string): string {
    const parts = (target.startsWith("/") ? target.slice(1) : folder + target).split("/");
    const out: string[] = [];
    for (const part of parts) {
      if (part === "..") out.pop();
      else if (part && part !== ".") out.push(part);
    }
    return out.join("/");
  }

  // ── Setup: styles, numbering, notes, sources ─────────────────────────────

  private readRunProps(rPr: XmlElement | null): RunProps {
    const props: RunProps = {};
    if (!rPr) return props;
    props.bold = onOff(child(rPr, "b"));
    props.italic = onOff(child(rPr, "i"));
    const underline = attr(child(rPr, "u"), "val");
    if (child(rPr, "u")) props.underline = underline !== "none";
    const strike = onOff(child(rPr, "strike")) || onOff(child(rPr, "dstrike"));
    if (child(rPr, "strike") || child(rPr, "dstrike")) props.strike = Boolean(strike);
    const vertical = attr(child(rPr, "vertAlign"), "val");
    if (vertical === "superscript" || vertical === "subscript") props.vertical = vertical;
    const color = attr(child(rPr, "color"), "val");
    if (color && /^[0-9a-f]{6}$/i.test(color) && color.toUpperCase() !== "000000") props.color = `#${color.toUpperCase()}`;
    const highlight = attr(child(rPr, "highlight"), "val");
    if (highlight && HIGHLIGHTS[highlight]) props.highlight = HIGHLIGHTS[highlight];
    const shade = attr(child(rPr, "shd"), "fill");
    if (!props.highlight && shade && /^[0-9a-f]{6}$/i.test(shade) && !/^(FFFFFF|auto)$/i.test(shade)) props.highlight = `#${shade.toUpperCase()}`;
    const fonts = child(rPr, "rFonts");
    const font = attr(fonts, "ascii") ?? attr(fonts, "hAnsi");
    if (font) {
      props.font = font;
      props.mono = MONOSPACE.test(font.trim());
    }
    const size = Number.parseInt(attr(child(rPr, "sz"), "val") ?? "", 10);
    if (Number.isFinite(size)) props.size = size / 2;
    return props;
  }

  private readStyles(): void {
    const styles = this.xml("word/styles.xml");
    for (const style of elements(styles, "style")) {
      const id = attr(style, "styleId") ?? "";
      if (!id) continue;
      const pPr = child(style, "pPr");
      const numPr = child(pPr, "numPr");
      const outline = Number.parseInt(attr(child(pPr, "outlineLvl"), "val") ?? "", 10);
      const entry: Style = {
        id,
        name: (attr(child(style, "name"), "val") ?? id).toLowerCase(),
        type: attr(style, "type") ?? "paragraph",
        basedOn: attr(child(style, "basedOn"), "val"),
        outline: Number.isFinite(outline) && outline < 9 ? outline : null,
        numId: attr(child(numPr, "numId"), "val"),
        ilvl: Number.parseInt(attr(child(numPr, "ilvl"), "val") ?? "0", 10) || 0,
        align: attr(child(pPr, "jc"), "val"),
        line: (attr(child(pPr, "spacing"), "lineRule") ?? "auto") === "auto" && attr(child(pPr, "spacing"), "line") ? Number(attr(child(pPr, "spacing"), "line")) : null,
        run: this.readRunProps(child(style, "rPr")),
      };
      this.styles.set(id, entry);
      if (entry.type === "paragraph" && /^(1|true|on)$/i.test(attr(style, "default") ?? "")) this.defaultParagraphStyle = id;
    }
  }

  /** The style and the styles it is based on, nearest first. */
  private styleChain(id: string | null): Style[] {
    const chain: Style[] = [];
    let current = id ?? this.defaultParagraphStyle;
    while (current && chain.length < 20) {
      const style = this.styles.get(current);
      if (!style || chain.includes(style)) break;
      chain.push(style);
      current = style.basedOn;
    }
    return chain;
  }

  private styleRun(id: string | null): RunProps {
    const merged: RunProps = {};
    for (const style of this.styleChain(id).reverse()) Object.assign(merged, Object.fromEntries(Object.entries(style.run).filter(([, value]) => value !== undefined)));
    return merged;
  }

  private paragraphKind(styleId: string | null, outlineLevel: number | null): { kind: ParagraphKind; level: number } {
    for (const style of this.styleChain(styleId)) {
      const heading = /^heading ([1-9])$/.exec(style.name);
      if (heading) return { kind: "heading", level: Number(heading[1]) };
      if (style.name === "title" || style.name === "paper title") return { kind: "title", level: 0 };
      if (style.name === "subtitle") return { kind: "subtitle", level: 0 };
      if (style.name === "caption") return { kind: "caption", level: 0 };
      if (/^toc \d$|^toc heading$|^table of figures$/.test(style.name)) return { kind: "toc", level: 0 };
      if (/^bibliography$/.test(style.name)) return { kind: "bibliography", level: 0 };
      if (/quote/.test(style.name)) return { kind: "quote", level: 0 };
      if (/^(html preformatted|source code|code|macro text|plain text|code block)$/.test(style.name)) return { kind: "code", level: 0 };
      if (/abstract/.test(style.name)) return { kind: "abstract", level: 0 };
      if (/key ?words|index terms/.test(style.name)) return { kind: "keywords", level: 0 };
      if (/^(authors?|author name|affiliations?|email)$/.test(style.name)) return { kind: "author", level: 0 };
      if (style.outline !== null) return { kind: "heading", level: style.outline + 1 };
    }
    if (outlineLevel !== null && outlineLevel < 9) return { kind: "heading", level: outlineLevel + 1 };
    return { kind: "normal", level: 0 };
  }

  private readNumbering(): void {
    const numbering = this.xml("word/numbering.xml");
    for (const definition of elements(numbering, "abstractNum")) {
      const levels = new Map<number, { format: string; start: number }>();
      for (const level of elements(definition, "lvl")) {
        const ilvl = Number.parseInt(attr(level, "ilvl") ?? "0", 10) || 0;
        levels.set(ilvl, { format: attr(child(level, "numFmt"), "val") ?? "decimal", start: Number.parseInt(attr(child(level, "start"), "val") ?? "1", 10) || 1 });
      }
      this.abstractLevels.set(attr(definition, "abstractNumId") ?? "", levels);
    }
    for (const num of elements(numbering, "num")) {
      const starts = new Map<number, number>();
      for (const override of elements(num, "lvlOverride")) {
        const value = Number.parseInt(attr(child(override, "startOverride"), "val") ?? "", 10);
        if (Number.isFinite(value)) starts.set(Number.parseInt(attr(override, "ilvl") ?? "0", 10) || 0, value);
      }
      this.numbering.set(attr(num, "numId") ?? "", { abstract: attr(child(num, "abstractNumId"), "val") ?? "", starts });
    }
  }

  private listInfo(numId: string | null, ilvl: number): ListInfo | null {
    if (!numId || numId === "0") return null;
    const num = this.numbering.get(numId);
    if (!num) return null;
    const level = this.abstractLevels.get(num.abstract)?.get(ilvl) ?? { format: "bullet", start: 1 };
    if (level.format === "none") return null;
    return { ordered: level.format !== "bullet", start: num.starts.get(ilvl) ?? level.start, level: ilvl, id: numId };
  }

  private readNotes(path: string, local: string, target: Map<string, XmlElement>): void {
    for (const note of elements(this.xml(path), local)) {
      const type = attr(note, "type");
      if (type && /separator|continuationNotice/.test(type)) continue;
      const id = attr(note, "id");
      if (id) target.set(id, note);
    }
  }

  private readSources(): void {
    for (const path of Object.keys(this.parts)) {
      if (!/^customXml\/item\d*\.xml$/i.test(path)) continue;
      const root = this.xml(path);
      if (root?.local !== "Sources") continue;
      for (const source of elements(root, "Source")) {
        const tag = textOf(child(source, "Tag")).trim();
        if (tag) this.sources.set(tag, source);
      }
    }
  }

  // ── Fields ────────────────────────────────────────────────────────────────

  private hidden(): boolean {
    return this.fields.some((field) => !field.result || field.skip);
  }

  private fieldLink(): string | null {
    for (let index = this.fields.length - 1; index >= 0; index--) if (this.fields[index].link) return this.fields[index].link;
    return null;
  }

  /** What a field's result becomes once its instruction is known. */
  private classifyField(field: Field, out: JSONContent[]): void {
    const instruction = field.instruction.trim();
    const command = /^([A-Z]+)/i.exec(instruction)?.[1]?.toUpperCase() ?? "";
    if (command === "TOC") {
      field.skip = true;
      if (!this.tocWritten) {
        this.tocWritten = true;
        out.push({ type: "__toc" });
      }
      return;
    }
    if (command === "HYPERLINK") {
      const target = /HYPERLINK\s+"([^"]+)"/i.exec(instruction)?.[1] ?? "";
      if (/^(https?:|mailto:)/i.test(target) && !/\\l\b/.test(instruction)) field.link = target;
      return;
    }
    if (command === "ADDIN" && /CSL_CITATION/.test(instruction)) {
      const cited = cslCitation(instruction, this.bibliography);
      if (!cited) return;
      field.skip = true;
      if (!this.citationStyle && cited.formatted) this.citationStyle = /^\s*\(.*\d{4}/.test(cited.formatted) ? "apa" : "ieee";
      out.push(this.citationNode(cited.items.map((item) => item.key), cited.items.length === 1 ? cited.items[0] : null));
      return;
    }
    if (command === "CITATION") {
      const keys = wordCitationTags(instruction)
        .map((tag) => this.sources.get(tag))
        .filter((source): source is XmlElement => Boolean(source))
        .map((source) => this.bibliography.addWordSource(source));
      if (!keys.length) return;
      field.skip = true;
      const page = /\\p\s+"?([^"\\]+)"?/.exec(instruction)?.[1]?.trim();
      out.push(this.citationNode(keys, page ? { prefix: "", locator: `p.~${page}` } : null));
      return;
    }
    if ((command === "BIBLIOGRAPHY" || (command === "ADDIN" && /ZOTERO_BIBL|CSL_BIBLIOGRAPHY|Mendeley Bibliography/i.test(instruction))) && this.bibliography.size) {
      field.skip = true;
      out.push({ type: "__bibliography" });
    }
  }

  private citationNode(keys: string[], single: { prefix: string; locator: string } | null): JSONContent {
    const attrs: Record<string, unknown> = { keys: [...new Set(keys)] };
    if (single?.prefix) attrs.pre = single.prefix;
    if (single?.locator) attrs.post = single.locator;
    return { type: "citation", attrs };
  }

  // ── Inline content ────────────────────────────────────────────────────────

  private marksFor(props: RunProps, extra: Mark[]): Mark[] {
    let marks = [...extra];
    if (props.bold) marks = withMark(marks, { type: "bold" });
    if (props.italic) marks = withMark(marks, { type: "italic" });
    if (props.underline) marks = withMark(marks, { type: "underline" });
    if (props.strike) marks = withMark(marks, { type: "strike" });
    if (props.vertical === "superscript") marks = withMark(marks, { type: "superscript" });
    if (props.vertical === "subscript") marks = withMark(marks, { type: "subscript" });
    if (props.mono) marks = withMark(marks, { type: "code" });
    if (props.color) marks = withMark(marks, { type: "textStyle", attrs: { color: props.color } });
    if (props.highlight) marks = withMark(marks, { type: "highlight", attrs: { color: props.highlight } });
    const link = this.fieldLink();
    if (link) marks = withMark(marks, { type: "link", attrs: { href: link } });
    return marks;
  }

  /** Inline content of paragraph-level XML: runs, links, fields, math, notes. */
  private inline(nodes: XmlElement[], out: JSONContent[], marks: Mark[], paragraphRun: RunProps, blocks: Item[]): void {
    for (const node of nodes) {
      switch (node.local) {
        case "r":
          this.run(node, out, marks, paragraphRun, blocks);
          break;
        case "hyperlink": {
          const target = this.rels.get(attr(node, "id") ?? "");
          const href = target?.external && /^(https?:|mailto:)/i.test(target.target) ? target.target : null;
          this.inline(elements(node), out, href ? withMark(marks, { type: "link", attrs: { href } }) : marks, paragraphRun, blocks);
          break;
        }
        case "fldSimple": {
          const field: Field = { instruction: attr(node, "instr") ?? "", result: true, skip: false, link: null };
          this.fields.push(field);
          this.classifyField(field, out);
          this.inline(elements(node), out, marks, paragraphRun, blocks);
          this.fields.pop();
          break;
        }
        case "oMath":
          if (!this.hidden()) {
            const latex = ommlToLatex(node);
            if (latex) out.push({ type: "mathInline", attrs: { latex } });
          }
          break;
        case "oMathPara":
          if (!this.hidden()) {
            const { latex, number } = ommlParagraph(node);
            if (latex) out.push({ type: "__math", attrs: { latex, numbered: number !== null } });
          }
          break;
        case "del":
        case "moveFrom":
          this.trackedChanges += 1;
          break;
        case "ins":
        case "moveTo":
          this.trackedChanges += 1;
          this.inline(elements(node), out, marks, paragraphRun, blocks);
          break;
        case "sdt":
          this.inline(elements(child(node, "sdtContent")), out, marks, paragraphRun, blocks);
          break;
        case "AlternateContent":
          this.inline(this.alternative(node), out, marks, paragraphRun, blocks);
          break;
        case "pPr":
        case "bookmarkStart":
        case "bookmarkEnd":
        case "proofErr":
        case "permStart":
        case "permEnd":
        case "commentRangeStart":
        case "commentRangeEnd":
          break;
        default:
          // smartTag, customXml, dir, bdo and other wrappers hold runs.
          this.inline(elements(node), out, marks, paragraphRun, blocks);
      }
    }
  }

  /** One branch of mc:AlternateContent: the Choice, or else the Fallback — never both. */
  private alternative(node: XmlElement): XmlElement[] {
    const choice = child(node, "Choice");
    if (choice && elements(choice).length) return elements(choice);
    return elements(child(node, "Fallback"));
  }

  private run(run: XmlElement, out: JSONContent[], marks: Mark[], paragraphRun: RunProps, blocks: Item[]): void {
    const direct = this.readRunProps(child(run, "rPr"));
    const characterStyle = attr(child(child(run, "rPr"), "rStyle"), "val");
    const props: RunProps = { ...paragraphRun, ...this.styleRun(characterStyle), ...Object.fromEntries(Object.entries(direct).filter(([, value]) => value !== undefined)) };
    for (const node of elements(run)) {
      switch (node.local) {
        case "fldChar": {
          const type = attr(node, "fldCharType");
          if (type === "begin") this.fields.push({ instruction: "", result: false, skip: false, link: null });
          else if (type === "separate") {
            const field = this.fields[this.fields.length - 1];
            if (field && !field.result) {
              field.result = true;
              if (!this.fields.slice(0, -1).some((outer) => outer.skip)) this.classifyField(field, out);
            }
          } else if (type === "end") {
            const field = this.fields.pop();
            // A field that shows no result (no "separate"): citations still count.
            if (field && !field.result && !this.hidden()) this.classifyField({ ...field, result: true }, out);
          }
          break;
        }
        case "instrText": {
          const field = this.fields[this.fields.length - 1];
          if (field && !field.result) field.instruction += textOf(node);
          break;
        }
        case "t":
          if (!this.hidden()) pushText(out, textOf(node), this.marksFor(props, marks));
          break;
        case "tab":
        case "ptab":
          if (!this.hidden()) pushText(out, " ", this.marksFor(props, marks));
          break;
        case "br": {
          if (this.hidden()) break;
          const type = attr(node, "type");
          if (type === "page") out.push({ type: "__pageBreak" });
          else if (type !== "column") out.push({ type: "hardBreak" });
          break;
        }
        case "cr":
          if (!this.hidden()) out.push({ type: "hardBreak" });
          break;
        case "noBreakHyphen":
          if (!this.hidden()) pushText(out, "-", this.marksFor(props, marks));
          break;
        case "softHyphen":
          if (!this.hidden()) pushText(out, "\u00ad", this.marksFor(props, marks));
          break;
        case "sym": {
          if (this.hidden()) break;
          const code = Number.parseInt(attr(node, "char") ?? "", 16);
          const font = (attr(node, "font") ?? "").toLowerCase();
          const char = font === "symbol" ? SYMBOL_FONT[code >= 0xf000 ? code - 0xf000 : code] : code >= 0xf000 ? "" : String.fromCodePoint(code);
          if (char) pushText(out, char, this.marksFor(props, marks));
          break;
        }
        case "footnoteReference":
        case "endnoteReference": {
          if (this.hidden()) break;
          const note = (node.local === "footnoteReference" ? this.footnotes : this.endnotes).get(attr(node, "id") ?? "");
          const footnote = note ? this.footnote(note) : null;
          if (footnote) out.push(footnote);
          break;
        }
        case "drawing":
        case "pict":
          if (!this.hidden()) this.picture(node, out, blocks);
          break;
        case "object":
          if (!this.hidden()) {
            this.objects += 1;
            this.picture(node, out, blocks);
          }
          break;
        case "AlternateContent":
          // Only what a run can hold (drawings, text boxes) comes in here.
          this.run({ ...run, children: this.alternative(node) }, out, marks, paragraphRun, blocks);
          break;
        case "commentReference":
          this.comments += 1;
          break;
        default:
          break;
      }
    }
  }

  /** A footnote as the visual editor holds it: its text, and its LaTeX when it has more. */
  private footnote(note: XmlElement): JSONContent | null {
    const content: JSONContent[] = [];
    const ignored: Item[] = [];
    for (const paragraph of elements(note, "p")) {
      const part: JSONContent[] = [];
      this.inline(elements(paragraph), part, [], {}, ignored);
      const clean = tidy(part.filter((node) => !node.type?.startsWith("__") && node.type !== "footnote"));
      if (clean.length && content.length) content.push({ type: "text", text: " " });
      content.push(...clean);
    }
    const tidied = tidy(content);
    const text = tidied.map((node) => (node.type === "text" ? node.text ?? "" : node.type === "mathInline" ? `$${String(node.attrs?.latex ?? "")}$` : node.type === "citation" ? `[${((node.attrs?.keys as string[]) ?? []).join(", ")}]` : " ")).join("").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const simple = tidied.every((node) => node.type === "text" && !node.marks?.length);
    return simple ? { type: "footnote", attrs: { text } } : { type: "footnote", attrs: { text, __content: tidied } };
  }

  // ── Pictures ──────────────────────────────────────────────────────────────

  private picture(node: XmlElement, out: JSONContent[], blocks: Item[]): void {
    if (descendant(node, "chart")) {
      this.charts += 1;
      out.push({ type: "__figure", attrs: { src: "", alt: "Chart", width: 80 } });
      return;
    }
    if (descendant(node, "relIds")) {
      this.unsupportedPictures += 1;
      return;
    }
    // Text boxes hold paragraphs of their own.
    for (const box of descendants(node, "txbxContent")) this.blockContent(elements(box), blocks);
    const blips = descendants(node, "blip");
    const images = blips.length ? blips : descendants(node, "imagedata");
    const extent = descendant(node, "extent");
    const docPr = descendant(node, "docPr");
    const widthInches = Number(attr(extent, "cx") ?? 0) / EMU_PER_INCH;
    const width = widthInches > 0 ? Math.min(100, Math.max(10, Math.round((widthInches / this.textWidth) * 100))) : 80;
    const alt = (attr(docPr, "descr") ?? attr(docPr, "title") ?? "").trim();
    for (const image of images) {
      const id = attr(image, "embed") ?? attr(image, "id");
      const link = attr(image, "link");
      const target = id ? this.rels.get(id) : link ? this.rels.get(link) : undefined;
      if (!target || target.external) {
        this.unsupportedPictures += 1;
        continue;
      }
      const bytes = this.parts[target.target];
      const extension = target.target.split(".").pop()?.toLowerCase() ?? "";
      const type = IMAGE_TYPES[extension];
      if (!bytes || !type) {
        this.unsupportedPictures += 1;
        continue;
      }
      if (type === "image/emf" || type === "image/wmf" || type === "image/vnd.ms-photo") {
        this.unsupportedPictures += 1;
        out.push({ type: "__figure", attrs: { src: "", alt: alt || "Picture", width } });
        continue;
      }
      out.push({ type: "__figure", attrs: { src: `data:${type};base64,${base64(bytes)}`, alt, width } });
    }
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  private paragraph(paragraph: XmlElement, blocks: Item[]): void {
    const pPr = child(paragraph, "pPr");
    const styleId = attr(child(pPr, "pStyle"), "val");
    const outline = Number.parseInt(attr(child(pPr, "outlineLvl"), "val") ?? "", 10);
    const { kind, level } = this.paragraphKind(styleId, Number.isFinite(outline) ? outline : null);
    const chain = this.styleChain(styleId);
    const numPr = child(pPr, "numPr");
    const numId = numPr ? attr(child(numPr, "numId"), "val") : chain.find((style) => style.numId)?.numId ?? null;
    const ilvl = numPr ? Number.parseInt(attr(child(numPr, "ilvl"), "val") ?? "0", 10) || 0 : chain.find((style) => style.numId)?.ilvl ?? 0;
    const list = this.listInfo(numId, ilvl);
    const align = attr(child(pPr, "jc"), "val") ?? chain.find((style) => style.align)?.align ?? null;
    // Headings, titles and captions are styled by their node; their style's
    // bold or italic is not the author's emphasis.
    const styled = kind === "heading" || kind === "title" || kind === "subtitle" || kind === "caption";
    const paragraphRun = styled ? {} : this.styleRun(styleId);
    if (onOff(child(pPr, "pageBreakBefore")) && !this.hidden()) blocks.push({ kind: "pageBreak" });

    const out: JSONContent[] = [];
    const after: Item[] = [];
    this.inline(elements(paragraph), out, [], paragraphRun, after);

    // Split the paragraph where it holds blocks: pictures, display math, page breaks.
    let current: JSONContent[] = [];
    const emit = () => {
      const inline = tidy(current);
      current = [];
      if (!inline.length) return;
      blocks.push({
        kind: "paragraph",
        style: kind,
        level,
        inline,
        text: plain(inline),
        align: align === "center" ? "center" : align === "right" || align === "end" ? "right" : null,
        list: kind === "heading" ? null : list,
        numbered: kind === "heading" && Boolean(list),
      });
    };
    for (const node of out) {
      if (node.type === "__figure") {
        emit();
        blocks.push({ kind: "figure", attrs: node.attrs ?? {} });
      } else if (node.type === "__math") {
        // An equation alone with a "(1)" beside it is a numbered equation.
        const rest = tidy(current);
        const label = plain(rest).trim();
        if (/^\(?\d+(?:\.\d+)*\)?$/.test(label) && rest.every((item) => item.type === "text")) current = [];
        emit();
        blocks.push({ kind: "math", latex: String(node.attrs?.latex ?? ""), numbered: Boolean(node.attrs?.numbered) || /^\(\d+(?:\.\d+)*\)$/.test(label) });
      } else if (node.type === "__pageBreak") {
        emit();
        blocks.push({ kind: "pageBreak" });
      } else if (node.type === "__toc") {
        emit();
        blocks.push({ kind: "toc" });
      } else if (node.type === "__bibliography") {
        emit();
        blocks.push({ kind: "bibliography" });
      } else current.push(node);
    }
    // The equation number after the equation, in the same paragraph.
    const trailing = blocks[blocks.length - 1];
    const label = plain(tidy(current)).trim();
    if (trailing?.kind === "math" && /^\(\d+(?:\.\d+)*\)$/.test(label)) {
      trailing.numbered = true;
      current = [];
    }
    emit();
    blocks.push(...after);
  }

  private tableCellBlocks(cell: XmlElement): JSONContent[] {
    const items: Item[] = [];
    this.blockContent(elements(cell), items);
    const paragraphs: JSONContent[] = [];
    for (const item of items) {
      if (item.kind === "paragraph") {
        const paragraph: JSONContent = { type: "paragraph", content: item.inline };
        if (item.align) paragraph.attrs = { textAlign: item.align };
        paragraphs.push(paragraph);
      } else if (item.kind === "math") {
        paragraphs.push({ type: "paragraph", content: [{ type: "mathInline", attrs: { latex: item.latex } }] });
      } else if (item.kind === "figure") {
        this.tableImages += 1;
      } else if (item.kind === "table") {
        // A table inside a cell: its cells' text, row by row.
        for (const row of item.table.content ?? []) {
          const text = (row.content ?? []).map((nested) => (nested.content ?? []).map((paragraph) => plain(paragraph.content ?? [])).join(" ")).join(" | ");
          if (text.trim()) paragraphs.push({ type: "paragraph", content: [{ type: "text", text }] });
        }
      }
    }
    return paragraphs.length ? paragraphs : [{ type: "paragraph" }];
  }

  private table(table: XmlElement, blocks: Item[]): void {
    const rows: JSONContent[] = [];
    const merges = new Map<number, JSONContent>();
    const headerRows: boolean[] = [];
    const rowElements = elements(table).flatMap((node) => (node.local === "tr" ? [node] : node.local === "sdt" || node.local === "customXml" ? descendants(node, "tr") : []));
    for (const row of rowElements) {
      const trPr = child(row, "trPr");
      let column = Number.parseInt(attr(child(trPr, "gridBefore"), "val") ?? "0", 10) || 0;
      const cells: JSONContent[] = [];
      const cellElements = elements(row).flatMap((node) => (node.local === "tc" ? [node] : node.local === "sdt" || node.local === "customXml" ? descendants(node, "tc") : []));
      for (const cell of cellElements) {
        const tcPr = child(cell, "tcPr");
        const span = Math.max(1, Number.parseInt(attr(child(tcPr, "gridSpan"), "val") ?? "1", 10) || 1);
        const merge = child(tcPr, "vMerge");
        const mergeValue = attr(merge, "val");
        if (merge && mergeValue !== "restart") {
          const above = merges.get(column);
          if (above?.attrs) above.attrs.rowspan = Number(above.attrs.rowspan ?? 1) + 1;
          column += span;
          continue;
        }
        const node: JSONContent = { type: "tableCell", attrs: { colspan: span, rowspan: 1, colwidth: null }, content: this.tableCellBlocks(cell) };
        if (merge) merges.set(column, node);
        else merges.delete(column);
        cells.push(node);
        column += span;
      }
      if (!cells.length) continue;
      headerRows.push(Boolean(child(trPr, "tblHeader")));
      rows.push({ type: "tableRow", content: cells });
    }
    if (!rows.length) return;
    // A repeated header row, or a first row set in bold, is the header.
    const firstBold = (rows[0].content ?? []).every((cell) => (cell.content ?? []).every((paragraph) => (paragraph.content ?? []).every((node) => node.type !== "text" || !(node.text ?? "").trim() || (node.marks ?? []).some((mark) => mark.type === "bold"))));
    const header = rows.length > 1 && (headerRows[0] || firstBold);
    if (header) {
      for (const cell of rows[0].content ?? []) {
        cell.type = "tableHeader";
        for (const paragraph of cell.content ?? []) {
          for (const node of paragraph.content ?? []) if (node.marks) node.marks = node.marks.filter((mark) => mark.type !== "bold");
        }
      }
    }
    // Rows are padded to the widest row, counting cells that span from above.
    const width = (row: JSONContent) => (row.content ?? []).reduce((sum, cell) => sum + Number(cell.attrs?.colspan ?? 1), 0);
    const occupied = new Array<number>(rows.length).fill(0);
    rows.forEach((row, index) => {
      for (const cell of row.content ?? []) for (let below = 1; below < Number(cell.attrs?.rowspan ?? 1) && index + below < rows.length; below++) occupied[index + below] += Number(cell.attrs?.colspan ?? 1);
    });
    const columns = Math.max(1, ...rows.map((row, index) => width(row) + occupied[index]));
    rows.forEach((row, index) => {
      for (let filled = width(row) + occupied[index]; filled < columns; filled++) {
        row.content?.push({ type: index === 0 && header ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] });
      }
    });
    blocks.push({ kind: "table", table: { type: "table", content: rows } });
  }

  /** Body-level content: paragraphs, tables, content controls. */
  private blockContent(nodes: XmlElement[], blocks: Item[]): void {
    for (const node of nodes) {
      try {
        switch (node.local) {
          case "p":
            this.paragraph(node, blocks);
            break;
          case "tbl":
            if (!this.hidden()) this.table(node, blocks);
            break;
          case "sdt": {
            // A table of contents built as a content control.
            const gallery = attr(descendant(child(node, "sdtPr"), "docPartGallery"), "val") ?? "";
            if (/table of contents/i.test(gallery)) {
              if (!this.tocWritten) {
                this.tocWritten = true;
                blocks.push({ kind: "toc" });
              }
              break;
            }
            if (/bibliograph/i.test(gallery) && this.bibliography.size) {
              blocks.push({ kind: "bibliography" });
              break;
            }
            this.blockContent(elements(child(node, "sdtContent")), blocks);
            break;
          }
          case "customXml":
          case "ins":
          case "moveTo":
            this.blockContent(elements(node), blocks);
            break;
          case "AlternateContent":
            this.blockContent(this.alternative(node), blocks);
            break;
          case "altChunk":
            this.warnings.add("Content embedded from another file (an “alt chunk”) was left out.");
            break;
          default:
            break;
        }
      } catch {
        this.warnings.add("Part of the document could not be converted and was left out.");
      }
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  private settings(body: XmlElement | null): Partial<PaperSettings> {
    const settings: Partial<PaperSettings> = {};
    const sections = descendants(body, "sectPr");
    const section = sections[sections.length - 1] ?? null;
    const size = child(section, "pgSz");
    const pageWidth = Number(attr(size, "w") ?? 0);
    const pageHeight = Number(attr(size, "h") ?? 0);
    if (pageWidth && pageHeight) settings.paper = Math.abs(pageHeight / TWIPS_PER_INCH - 11.69) < Math.abs(pageHeight / TWIPS_PER_INCH - 11) ? "a4" : "letter";
    const margins = child(section, "pgMar");
    const left = Number(attr(margins, "left") ?? 0) / TWIPS_PER_INCH;
    const right = Number(attr(margins, "right") ?? 0) / TWIPS_PER_INCH;
    if (left > 0 && right > 0) {
      const average = (left + right) / 2;
      settings.margins = average < 0.75 ? "narrow" : average > 1.25 ? "wide" : "normal";
      if (pageWidth) this.textWidth = Math.max(2, pageWidth / TWIPS_PER_INCH - left - right);
    }
    if (Number(attr(child(section, "cols"), "num") ?? 1) >= 2) settings.columns = 2;
    // The body text's font, size and spacing: the default paragraph style.
    const normal = this.styleRun(this.defaultParagraphStyle);
    const defaults = this.xml("word/styles.xml");
    const docDefaults = this.readRunProps(descendant(child(defaults, "docDefaults"), "rPr"));
    let font = normal.font ?? docDefaults.font ?? "";
    if (!font) {
      // Theme fonts (Calibri, Cambria …) are named in the theme.
      const theme = this.xml("word/theme/theme1.xml");
      font = attr(child(descendant(theme, "minorFont"), "latin"), "typeface") ?? "";
    }
    if (/times|termes|nimbus roman|liberation serif/i.test(font)) settings.font = "times";
    else if (/palatino|book antiqua|pagella/i.test(font)) settings.font = "palatino";
    else if (/calibri|arial|helvetica|segoe|verdana|tahoma|liberation sans|open sans|roboto|lato|source sans|aptos/i.test(font)) settings.font = "sans";
    const points = normal.size ?? docDefaults.size;
    if (points) settings.fontSize = points <= 10.5 ? 10 : points <= 11.5 ? 11 : 12;
    const spacing = descendant(child(descendant(defaults, "pPrDefault"), "pPr"), "spacing");
    const defaultLine = (attr(spacing, "lineRule") ?? "auto") === "auto" ? Number(attr(spacing, "line") ?? 0) : 0;
    const line = this.styleChain(this.defaultParagraphStyle).find((style) => style.line !== null)?.line ?? defaultLine;
    if (line) {
      const ratio = line / 240;
      settings.lineSpacing = [1, 1.15, 1.5, 2].reduce((best, value) => (Math.abs(value - ratio) < Math.abs(best - ratio) ? value : best), 1);
    }
    return settings;
  }

  // ── Assembly ──────────────────────────────────────────────────────────────

  private isCaption(item: Item | undefined, kind: "figure" | "table"): item is Extract<Item, { kind: "paragraph" }> {
    if (item?.kind !== "paragraph" || item.list || item.text.length > 600) return false;
    const match = CAPTION.exec(item.text);
    const word = match?.[1]?.toLowerCase() ?? "";
    const isTable = /^(table|tab|tabel|tabelle)/.test(word);
    if (item.style === "caption") return !match || (kind === "table") === isTable;
    // Body text is a caption only in the label form: "Figure 3:", "Table 1." —
    // not "Figure 3 shows the trend".
    if (item.style === "normal" && match?.[2] && match[3]) return kind === "table" ? isTable : !isTable;
    return false;
  }

  /**
   * Each picture and table takes the caption next to it: one in Word's
   * Caption style first, else one written as "Figure n:" — below a picture
   * or above a table when both sides have one. A paragraph is used once.
   */
  private assignCaptions(items: Item[], used: Set<Item>): Map<Item, Extract<Item, { kind: "paragraph" }>> {
    const captions = new Map<Item, Extract<Item, { kind: "paragraph" }>>();
    items.forEach((item, index) => {
      if (item.kind !== "figure" && item.kind !== "table") return;
      const kind = item.kind;
      const sides = kind === "figure" ? [items[index + 1], items[index - 1]] : [items[index - 1], items[index + 1]];
      const options = sides.filter((side): side is Extract<Item, { kind: "paragraph" }> => this.isCaption(side, kind) && !used.has(side as Item));
      const chosen = options.find((option) => option.style === "caption") ?? options[0];
      if (!chosen) return;
      captions.set(item, chosen);
      used.add(chosen);
    });
    return captions;
  }

  private captionContent(item: Extract<Item, { kind: "paragraph" }>): JSONContent[] {
    const match = CAPTION.exec(item.text);
    return match ? dropLeading(item.inline, match[0].length) : item.inline;
  }

  private assemble(items: Item[]): { blocks: JSONContent[]; title: JSONContent[] } {
    const out: JSONContent[] = [];
    const used = new Set<Item>();
    let title: JSONContent[] = [];

    // Front matter: title, author lines, abstract, keywords.
    const titleIndex = items.findIndex((item) => item.kind === "paragraph" && item.style === "title");
    if (titleIndex !== -1 && titleIndex < 8) {
      const item = items[titleIndex] as Extract<Item, { kind: "paragraph" }>;
      title = item.inline;
      used.add(item);
      out.push({ type: "paperTitle", content: item.inline });
      const authors: JSONContent[] = [];
      for (let next = titleIndex + 1; next < items.length && next < titleIndex + 10; next++) {
        const candidate = items[next];
        if (candidate.kind !== "paragraph") break;
        const isAuthor = candidate.style === "author" || (candidate.style === "normal" && !candidate.list && candidate.text.length < 200 && !ABSTRACT_LEAD.test(candidate.text) && !KEYWORDS_LEAD.test(candidate.text) && !ABSTRACT_HEADING.test(candidate.text.trim()));
        if (candidate.style === "subtitle") {
          used.add(candidate);
          out.push({ type: "paragraph", attrs: { textAlign: "center" }, content: [...candidate.inline.map((node) => (node.type === "text" ? { ...node, marks: [...(node.marks ?? []), { type: "italic" }] } : node))] });
          continue;
        }
        if (!isAuthor) break;
        if (authors.length) authors.push({ type: "hardBreak" });
        authors.push(...candidate.inline);
        used.add(candidate);
      }
      if (authors.length) out.push({ type: "paperAuthors", content: authors });
    }

    const abstract: JSONContent[] = [];
    let abstractAt = -1;
    for (let at = 0; at < items.length; at++) {
      const item = items[at];
      if (item.kind !== "paragraph" || used.has(item)) continue;
      if (item.style === "abstract" || ABSTRACT_LEAD.test(item.text)) {
        const lead = ABSTRACT_LEAD.exec(item.text);
        const content = lead ? dropLeading(item.inline, lead[0].length) : item.inline;
        // A style named "Abstract" may hold just the word as a heading.
        if (content.length && !ABSTRACT_HEADING.test(plain(content).trim())) abstract.push({ type: "paragraph", content });
        used.add(item);
        abstractAt = at;
        for (let next = at + 1; next < items.length; next++) {
          const more = items[next];
          if (more.kind !== "paragraph" || more.style !== "abstract") break;
          abstract.push({ type: "paragraph", content: more.inline });
          used.add(more);
        }
        break;
      }
      if ((item.style === "heading" || item.style === "normal") && ABSTRACT_HEADING.test(item.text.trim())) {
        used.add(item);
        abstractAt = at;
        for (let next = at + 1; next < items.length; next++) {
          const more = items[next];
          if (more.kind !== "paragraph" || more.style === "heading" || KEYWORDS_LEAD.test(more.text) || more.style === "keywords") break;
          abstract.push({ type: "paragraph", content: more.inline });
          used.add(more);
        }
        break;
      }
      if (item.style === "heading") break;
    }
    if (abstract.length) out.push({ type: "paperAbstract", content: abstract });
    for (let at = 0; at < items.length && at < Math.max(abstractAt, 0) + 8; at++) {
      const item = items[at];
      if (item.kind !== "paragraph" || used.has(item)) continue;
      const lead = KEYWORDS_LEAD.exec(item.text);
      if (item.style === "keywords" || lead) {
        used.add(item);
        out.push({ type: "paperKeywords", content: lead ? dropLeading(item.inline, lead[0].length) : item.inline });
        break;
      }
      if (item.style === "heading" && abstractAt === -1) break;
    }

    // Headings are numbered when the document numbers them (by list or by hand).
    const headings = items.filter((item): item is Extract<Item, { kind: "paragraph" }> => item.kind === "paragraph" && item.style === "heading" && !used.has(item));
    // "1.", "2.3", "IV.", "A." or a bare 1–2 digit number: not "2020 Census Data".
    const manual = /^\s*((?:\d+\.)+\d*|\d{1,2}|[IVXLC]+\.|[A-Z]\.)\s+/;
    const numberedHeadings = headings.some((heading) => heading.numbered || manual.test(heading.text));

    const captions = this.assignCaptions(items, used);
    const listStack: { level: number; list: JSONContent; id: string }[] = [];
    const closeLists = () => {
      listStack.length = 0;
    };
    const lastItemOf = (list: JSONContent): JSONContent | undefined => list.content?.[list.content.length - 1];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (used.has(item)) continue;
      if (item.kind !== "paragraph" || !item.list) closeLists();
      switch (item.kind) {
        case "paragraph": {
          if (item.style === "toc") break;
          if (item.list) {
            const { level, ordered, start, id } = item.list;
            const type = ordered ? "orderedList" : "bulletList";
            while (listStack.length && listStack[listStack.length - 1].level > level) listStack.pop();
            let top = listStack[listStack.length - 1];
            if (top && top.level === level && (top.list.type !== type || top.id !== id && level === 0)) {
              listStack.pop();
              top = listStack[listStack.length - 1];
            }
            if (!top || top.level < level) {
              const list: JSONContent = { type, content: [] };
              if (ordered && start !== 1) list.attrs = { start };
              const parentItem = top ? lastItemOf(top.list) : undefined;
              if (parentItem) parentItem.content?.push(list);
              else out.push(list);
              top = { level, list, id };
              listStack.push(top);
            }
            top.list.content?.push({ type: "listItem", content: [{ type: "paragraph", content: item.inline }] });
            break;
          }
          if (item.style === "heading") {
            // A "References" heading over a reference manager's list: the
            // generated list brings its own heading.
            if (/^(references|bibliography|daftar pustaka|referensi|works cited|literature cited|literatur)$/i.test(item.text.trim()) && items.slice(index + 1).find((next) => !(next.kind === "paragraph" && !next.text.trim()))?.kind === "bibliography") break;
            const strip = numberedHeadings ? manual.exec(item.text) : null;
            const content = strip ? dropLeading(item.inline, strip[0].length) : item.inline;
            if (content.length) out.push({ type: "heading", attrs: { level: Math.min(4, Math.max(1, item.level)), numbered: numberedHeadings, id: "" }, content });
            break;
          }
          if (item.style === "code") {
            const lines = [item.text];
            while (items[index + 1]?.kind === "paragraph" && (items[index + 1] as Extract<Item, { kind: "paragraph" }>).style === "code") {
              index++;
              lines.push((items[index] as Extract<Item, { kind: "paragraph" }>).text);
            }
            out.push({ type: "codeBlock", content: [{ type: "text", text: lines.join("\n") }] });
            break;
          }
          if (item.style === "quote") {
            const paragraphs: JSONContent[] = [{ type: "paragraph", content: item.inline }];
            while (items[index + 1]?.kind === "paragraph" && (items[index + 1] as Extract<Item, { kind: "paragraph" }>).style === "quote") {
              index++;
              paragraphs.push({ type: "paragraph", content: (items[index] as Extract<Item, { kind: "paragraph" }>).inline });
            }
            out.push({ type: "blockquote", content: paragraphs });
            break;
          }
          const paragraph: JSONContent = { type: "paragraph", content: item.inline };
          if (item.align) paragraph.attrs = { textAlign: item.align };
          out.push(paragraph);
          break;
        }
        case "figure": {
          const caption = captions.get(item);
          out.push({ type: "figure", attrs: { ...item.attrs, id: "" }, content: [{ type: "figcaption", content: caption ? this.captionContent(caption) : [] }] });
          break;
        }
        case "table": {
          const caption = captions.get(item);
          // Without a caption a table is not numbered: it stays a plain table.
          out.push(caption ? { type: "tableFigure", attrs: { id: "" }, content: [{ type: "figcaption", content: this.captionContent(caption) }, item.table] } : item.table);
          break;
        }
        case "math":
          if (item.latex) out.push({ type: "mathBlock", attrs: { latex: item.latex, numbered: item.numbered, id: "" } });
          break;
        case "pageBreak":
          if (out.length && out[out.length - 1].type !== "pageBreak") out.push({ type: "pageBreak" });
          break;
        case "toc":
          out.push({ type: "rawLatex", attrs: { source: "\\tableofcontents" } });
          break;
        case "bibliography":
          if (!out.some((block) => block.type === "bibliography")) out.push({ type: "bibliography" });
          break;
        default:
          break;
      }
    }
    while (out.length && out[out.length - 1].type === "pageBreak") out.pop();
    return { blocks: out, title };
  }

  convert(): DocumentImport {
    // The main document part is named in the package relationships.
    const packageRels = this.relsFor("");
    const main = [...packageRels.values()].find((rel) => !rel.external && /document(\d*)\.xml$/i.test(rel.target))?.target;
    if (main && this.parts[main]) this.documentPath = main;
    const document = this.xml(this.documentPath);
    const body = child(document, "body");
    if (!body) throw new Error("This file is not a Word document (.docx). Save it in Word format and try again.");
    this.rels = this.relsFor(this.documentPath);
    this.readStyles();
    this.readNumbering();
    this.readNotes("word/footnotes.xml", "footnote", this.footnotes);
    this.readNotes("word/endnotes.xml", "endnote", this.endnotes);
    this.readSources();
    const settings = this.settings(body);

    const items: Item[] = [];
    this.blockContent(elements(body), items);
    const { blocks, title } = this.assemble(items);
    const content = this.finishFootnotes(blocks, { ...DEFAULT_SETTINGS, ...settings, ...(this.citationStyle ? { citationStyle: this.citationStyle } : {}) });

    if (this.unsupportedPictures) {
      this.warnings.add(`${this.unsupportedPictures} picture${this.unsupportedPictures === 1 ? " is" : "s are"} in a format browsers cannot show (EMF/WMF, linked or SmartArt); ${this.unsupportedPictures === 1 ? "its place is" : "their places are"} kept empty — insert PNG or JPEG versions.`);
    }
    if (this.charts) this.warnings.add(`${this.charts} chart${this.charts === 1 ? "" : "s"} could not be converted; ${this.charts === 1 ? "its" : "their"} place is kept as an empty figure — insert a picture of the chart.`);
    if (this.objects) this.warnings.add(`${this.objects} embedded object${this.objects === 1 ? "" : "s"} (such as MathType equations) could not be converted; retype ${this.objects === 1 ? "it" : "them"} with Word's equation editor or in LaTeX.`);
    if (this.tableImages) this.warnings.add("Pictures inside table cells were left out; LaTeX tables cannot hold figures.");
    if (this.trackedChanges) this.warnings.add("Tracked changes were applied as if accepted.");
    if (this.comments) this.warnings.add(`${this.comments} Word comment${this.comments === 1 ? " was" : "s were"} left out.`);
    if (this.citationStyle) settings.citationStyle = this.citationStyle;
    return {
      content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
      settings,
      title: plain(title).trim(),
      bib: this.bibliography.toBibtex(),
      warnings: [...this.warnings],
    };
  }

  /**
   * A footnote with markup (math, links, citations, emphasis) keeps it as
   * LaTeX, which the footnote node exports as written.
   */
  private finishFootnotes(blocks: JSONContent[], settings: PaperSettings): JSONContent[] {
    const visit = (node: JSONContent): JSONContent => {
      if (node.type === "footnote" && node.attrs && "__content" in node.attrs) {
        const { __content: content, ...attrs } = node.attrs as Record<string, unknown>;
        const tex = documentToLatex({ type: "doc", content: [{ type: "paragraph", content: content as JSONContent[] }] }, settings, "").tex;
        const latex = (/\\begin\{document\}\n([\s\S]*)\n\\end\{document\}/.exec(tex)?.[1] ?? "")
          .replace(/\\bibliographystyle\{[^}]*\}\s*\\bibliography\{references\}\s*$/, "")
          .trim();
        return { ...node, attrs: latex ? { ...attrs, latex } : attrs };
      }
      return node.content ? { ...node, content: node.content.map(visit) } : node;
    };
    return blocks.map(visit);
  }
}

/** Parts of a .docx this converter reads, size-checked while unzipping. */
function unzipDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        const keep = /^(word\/|docProps\/core\.xml$|customXml\/item\d*\.xml$|_rels\/\.rels$|\[Content_Types\]\.xml$)/.test(file.name);
        if (!keep) return false;
        if (file.originalSize > MAX_PART_BYTES) return false;
        total += file.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new Error("This document is too large to import.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) throw error;
    throw new Error("This file is not a Word document (.docx). Save it in Word format and try again.");
  }
}

/** Converts a .docx file to visual paper content. */
export function convertDocx(bytes: Uint8Array): DocumentImport {
  return new DocxConverter(unzipDocx(bytes)).convert();
}

