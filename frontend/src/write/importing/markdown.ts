/**
 * Markdown and plain-text documents as visual paper content.
 *
 * Markdown is parsed as CommonMark with GitHub's extensions (tables,
 * footnotes, strikethrough, task lists, autolinks). Math is taken out before
 * parsing — `$…$`, `$$…$$`, `\(…\)`, `\[…\]` — since Markdown would read
 * `\\` as an escape and `*` as emphasis inside it. A YAML front matter
 * block gives the title, authors and abstract; `[@key]` becomes a citation.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Nodes, Parents, PhrasingContent, Root, RootContent, Table } from "mdast";
import type { JSONContent } from "@tiptap/core";
import type { DocumentImport } from "./docx.ts";

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

const TOKEN = /MDXMATH(\d+)X/g;

/** Link targets a paper may hold: web and mail addresses only (as from Word). */
function safeHref(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** Takes math out of Markdown source, outside code, leaving tokens behind. */
function protectMath(source: string): { text: string; math: { latex: string; display: boolean }[] } {
  const math: { latex: string; display: boolean }[] = [];
  const token = (latex: string, display: boolean) => {
    math.push({ latex: latex.trim(), display });
    const index = math.length - 1;
    return display ? `\n\nMDXMATH${index}X\n\n` : `MDXMATH${index}X`;
  };
  let out = "";
  let index = 0;
  let fence: string | null = null;
  let lineStart = true;
  while (index < source.length) {
    if (lineStart) {
      const line = source.slice(index, source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index));
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null;
        out += line;
        index += line.length;
        lineStart = false;
        continue;
      }
      if (marker) {
        fence = marker;
        out += line;
        index += line.length;
        lineStart = false;
        continue;
      }
    }
    const ch = source[index];
    if (ch === "\n") {
      out += ch;
      index++;
      lineStart = true;
      continue;
    }
    lineStart = false;
    if (ch === "`") {
      // A code span: its backtick run closes it.
      const run = /^`+/.exec(source.slice(index))?.[0] ?? "`";
      const close = source.indexOf(run, index + run.length);
      if (close !== -1) {
        out += source.slice(index, close + run.length);
        index = close + run.length;
        continue;
      }
      out += run;
      index += run.length;
      continue;
    }
    if (ch === "\\" && (source[index + 1] === "[" || source[index + 1] === "(")) {
      const closer = source[index + 1] === "[" ? "\\]" : "\\)";
      const close = source.indexOf(closer, index + 2);
      if (close !== -1) {
        out += token(source.slice(index + 2, close), closer === "\\]");
        index = close + 2;
        continue;
      }
    }
    if (ch === "\\" && source[index + 1] === "$") {
      out += "\\$";
      index += 2;
      continue;
    }
    if (ch === "$") {
      if (source[index + 1] === "$") {
        const close = source.indexOf("$$", index + 2);
        if (close !== -1) {
          out += token(source.slice(index + 2, close), true);
          index = close + 2;
          continue;
        }
      } else {
        // Inline math: no space just inside the dollars, not a price ($5 … $10).
        const match = /^\$([^\s$](?:[^$\n]|\n(?!\s*\n))*?[^\s$\\])\$(?!\d)|^\$([^\s$\\])\$(?!\d)/.exec(source.slice(index));
        if (match) {
          out += token(match[1] ?? match[2], false);
          index += match[0].length;
          continue;
        }
      }
    }
    out += ch;
    index++;
  }
  return { text: out, math };
}

/** `--- title: … ---` at the very top. */
function frontMatter(source: string): { body: string; meta: Record<string, string | string[]> } {
  const match = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(source);
  if (!match) return { body: source, meta: {} };
  const meta: Record<string, string | string[]> = {};
  let key: string | null = null;
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1].toLowerCase();
      const value = pair[2].trim().replace(/^["']|["']$/g, "");
      meta[key] = value === "" || value === "|" || value === ">" ? [] : value;
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && key) {
      const value = item[1].replace(/^name:\s*/, "").trim().replace(/^["']|["']$/g, "");
      meta[key] = [...(Array.isArray(meta[key]) ? (meta[key] as string[]) : []), value];
      continue;
    }
    if (key && /^\s+\S/.test(line)) {
      const previous = meta[key];
      meta[key] = Array.isArray(previous) ? [...previous, line.trim()] : `${previous} ${line.trim()}`.trim();
    }
  }
  return { body: source.slice(match[0].length), meta };
}

class MarkdownConverter {
  private readonly math: { latex: string; display: boolean }[];
  private readonly definitions = new Map<string, { url: string; title: string | null }>();
  private readonly notes = new Map<string, RootContent[]>();
  private readonly warnings = new Set<string>();
  private localImages = 0;

  constructor(math: { latex: string; display: boolean }[]) {
    this.math = math;
  }

  private collect(node: Nodes): void {
    if (node.type === "definition") this.definitions.set(node.identifier, { url: node.url, title: node.title ?? null });
    if (node.type === "footnoteDefinition") this.notes.set(node.identifier, node.children as RootContent[]);
    if ("children" in node) for (const child of (node as Parents).children) this.collect(child as Nodes);
  }

  private text(out: JSONContent[], value: string, marks: Mark[]): void {
    let last = 0;
    for (const match of value.matchAll(TOKEN)) {
      this.pushText(out, value.slice(last, match.index), marks);
      const math = this.math[Number(match[1])];
      if (math?.latex) out.push({ type: "mathInline", attrs: { latex: math.latex } });
      last = (match.index ?? 0) + match[0].length;
    }
    this.pushText(out, value.slice(last), marks);
  }

  private pushText(out: JSONContent[], value: string, marks: Mark[]): void {
    if (!value) return;
    // [@key] and [@a; @b, p. 5] are citations (Pandoc's form).
    let last = 0;
    for (const match of value.matchAll(/\[((?:-?@[\w:.#$%&+?<>~/-]+\s*;?\s*)+)(?:,\s*([^\]]+))?\]/g)) {
      this.plainText(out, value.slice(last, match.index), marks);
      const keys = [...match[1].matchAll(/@([\w:.#$%&+?<>~/-]+)/g)].map((key) => key[1].replace(/[.:]+$/, ""));
      const attrs: Record<string, unknown> = { keys };
      if (match[2]) attrs.post = match[2].trim().replace(/^p\.\s*/, "p.~");
      out.push({ type: "citation", attrs });
      last = (match.index ?? 0) + match[0].length;
    }
    this.plainText(out, value.slice(last), marks);
  }

  private plainText(out: JSONContent[], value: string, marks: Mark[]): void {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) {
      last.text = (last.text ?? "") + value;
      return;
    }
    out.push(marks.length ? { type: "text", text: value, marks: [...marks] } : { type: "text", text: value });
  }

  private inline(nodes: PhrasingContent[], marks: Mark[], out: JSONContent[] = [], figures: JSONContent[] = []): JSONContent[] {
    const html: Mark[] = [];
    for (const node of nodes) {
      const current = [...marks, ...html];
      switch (node.type) {
        case "text":
          this.text(out, node.value, current);
          break;
        case "emphasis":
          this.inline(node.children, [...current.filter((mark) => mark.type !== "italic"), { type: "italic" }], out, figures);
          break;
        case "strong":
          this.inline(node.children, [...current.filter((mark) => mark.type !== "bold"), { type: "bold" }], out, figures);
          break;
        case "delete":
          this.inline(node.children, [...current, { type: "strike" }], out, figures);
          break;
        case "inlineCode":
          this.plainText(out, node.value, [...current, { type: "code" }]);
          break;
        case "break":
          out.push({ type: "hardBreak" });
          break;
        case "link": {
          const href = safeHref(node.url);
          this.inline(node.children, href ? [...current, { type: "link", attrs: { href } }] : current, out, figures);
          break;
        }
        case "linkReference": {
          const href = safeHref(this.definitions.get(node.identifier)?.url);
          this.inline(node.children, href ? [...current, { type: "link", attrs: { href } }] : current, out, figures);
          break;
        }
        case "image":
        case "imageReference": {
          const url = node.type === "image" ? node.url : this.definitions.get(node.identifier)?.url ?? "";
          figures.push(this.figure(url, node.alt ?? ""));
          break;
        }
        case "footnoteReference": {
          const definition = this.notes.get(node.identifier);
          const content = definition ? this.flatten(definition) : [];
          const text = content.map((part) => (part.type === "text" ? part.text ?? "" : part.type === "mathInline" ? `$${String(part.attrs?.latex ?? "")}$` : " ")).join("").replace(/\s+/g, " ").trim();
          if (text) out.push({ type: "footnote", attrs: { text } });
          break;
        }
        case "html": {
          // A few inline tags have a visual counterpart.
          const tag = /^<(\/)?(sup|sub|b|strong|i|em|u|s|del|br)\b[^>]*>$/i.exec(node.value.trim());
          if (!tag) break;
          const name = tag[2].toLowerCase();
          if (name === "br") {
            out.push({ type: "hardBreak" });
            break;
          }
          const type = { sup: "superscript", sub: "subscript", b: "bold", strong: "bold", i: "italic", em: "italic", u: "underline", s: "strike", del: "strike" }[name] ?? "";
          if (tag[1]) {
            const at = html.map((mark) => mark.type).lastIndexOf(type);
            if (at !== -1) html.splice(at, 1);
          } else if (type) html.push({ type });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** The inline content of blocks (for footnotes): paragraphs joined by spaces. */
  private flatten(blocks: RootContent[]): JSONContent[] {
    const out: JSONContent[] = [];
    for (const block of blocks) {
      if (block.type === "paragraph") {
        if (out.length) out.push({ type: "text", text: " " });
        this.inline(block.children, [], out);
      }
    }
    return out;
  }

  private figure(url: string, alt: string): JSONContent {
    const attrs: Record<string, unknown> = { src: "", alt, width: 80, id: "" };
    if (/^(https:\/\/|data:image\/)/i.test(url)) attrs.src = url;
    else if (url) {
      // A local picture: kept as its path, for the LaTeX source.
      this.localImages += 1;
      attrs.path = decodeURI(url).replace(/^\.\//, "");
    }
    return { type: "figure", attrs, content: [{ type: "figcaption", content: alt ? [{ type: "text", text: alt }] : [] }] };
  }

  private table(node: Table): JSONContent {
    const rows = node.children.map((row, index) => ({
      type: "tableRow",
      content: row.children.map((cell, column) => {
        const align = node.align?.[column];
        const paragraph: JSONContent = { type: "paragraph", content: this.inline(cell.children, []) };
        if (align === "center" || align === "right") paragraph.attrs = { textAlign: align };
        return { type: index === 0 ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph] };
      }),
    }));
    const width = Math.max(1, ...rows.map((row) => row.content.length));
    for (const row of rows) {
      while (row.content.length < width) row.content.push({ type: row === rows[0] ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] });
    }
    return { type: "table", content: rows };
  }

  blocks(nodes: RootContent[], shift: number): JSONContent[] {
    const out: JSONContent[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "heading": {
          const content = this.inline(node.children, []);
          if (content.length) out.push({ type: "heading", attrs: { level: Math.min(4, Math.max(1, node.depth - shift)), numbered: true, id: "" }, content });
          break;
        }
        case "paragraph": {
          const only = node.children.length === 1 ? node.children[0] : null;
          const token = only?.type === "text" ? /^MDXMATH(\d+)X$/.exec(only.value.trim()) : null;
          if (token) {
            const math = this.math[Number(token[1])];
            if (math?.latex) out.push({ type: "mathBlock", attrs: { latex: math.latex.replace(/\\label\{[^}]*\}/g, "").replace(/\\tag\{[^}]*\}/g, "").trim(), numbered: /\\(?:tag|label)\{/.test(math.latex), id: "" } });
            break;
          }
          const figures: JSONContent[] = [];
          const content = this.inline(node.children, [], [], figures);
          const trimmed = content.filter((part) => part.type !== "text" || (part.text ?? "").trim());
          if (trimmed.length) out.push({ type: "paragraph", content });
          out.push(...figures);
          break;
        }
        case "list": {
          const list: JSONContent = {
            type: node.ordered ? "orderedList" : "bulletList",
            content: node.children.map((item) => {
              const content = this.blocks(item.children as RootContent[], shift);
              if (!content.length || content[0].type !== "paragraph") content.unshift({ type: "paragraph" });
              if (item.checked !== null && item.checked !== undefined) {
                content[0] = { ...content[0], content: [{ type: "text", text: item.checked ? "☑ " : "☐ " }, ...(content[0].content ?? [])] };
              }
              return { type: "listItem", content };
            }),
          };
          if (node.ordered && node.start && node.start !== 1) list.attrs = { start: node.start };
          if (list.content?.length) out.push(list);
          break;
        }
        case "blockquote": {
          const content = this.blocks(node.children as RootContent[], shift);
          if (content.length) out.push({ type: "blockquote", content });
          break;
        }
        case "code": {
          const code: JSONContent = { type: "codeBlock", content: node.value ? [{ type: "text", text: node.value }] : [] };
          if (node.lang) code.attrs = { language: node.lang };
          out.push(code);
          break;
        }
        case "thematicBreak":
          out.push({ type: "horizontalRule" });
          break;
        case "table":
          out.push(this.table(node));
          break;
        case "html":
          if (node.value.trim()) this.warnings.add("HTML in the Markdown was left out.");
          break;
        default:
          break;
      }
    }
    return out;
  }

  finish(): string[] {
    if (this.localImages) this.warnings.add(`${this.localImages} picture${this.localImages === 1 ? " refers" : "s refer"} to a file that was not uploaded; ${this.localImages === 1 ? "its path is" : "their paths are"} kept for the LaTeX source.`);
    return [...this.warnings];
  }

  prepare(root: Root): void {
    this.collect(root);
  }
}

const textOf = (value: string | string[] | undefined): string => (Array.isArray(value) ? value.join(" ") : value ?? "").trim();

/** Converts Markdown to visual paper content. */
export function convertMarkdown(source: string): DocumentImport {
  const { body, meta } = frontMatter(source.replace(/\r\n?/g, "\n"));
  const { text, math } = protectMath(body);
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const converter = new MarkdownConverter(math);
  converter.prepare(root);
  // A single top-level heading at the start is the title; the rest move up a level.
  const topHeadings = root.children.filter((node) => node.type === "heading" && node.depth === 1);
  const first = root.children[0];
  const headingTitle = !meta.title && topHeadings.length === 1 && first?.type === "heading" && first.depth === 1;
  const title: JSONContent[] = [];
  const blocks: JSONContent[] = [];
  if (meta.title) title.push({ type: "text", text: textOf(meta.title) });
  else if (headingTitle && first.type === "heading") title.push(...converter.blocks([first], 0)[0]?.content ?? []);
  if (title.length) blocks.push({ type: "paperTitle", content: title });
  const authors = Array.isArray(meta.author) ? meta.author : meta.author ? [meta.author] : [];
  if (authors.length) blocks.push({ type: "paperAuthors", content: authors.flatMap((name, index) => (index ? [{ type: "hardBreak" }, { type: "text", text: name }] : [{ type: "text", text: name }])) });
  if (textOf(meta.abstract)) blocks.push({ type: "paperAbstract", content: [{ type: "paragraph", content: [{ type: "text", text: textOf(meta.abstract) }] }] });
  const rest = headingTitle ? root.children.slice(1) : root.children;
  blocks.push(...converter.blocks(rest as RootContent[], headingTitle ? 1 : 0));
  return {
    content: { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] },
    settings: {},
    title: title.map((node) => node.text ?? "").join("").trim(),
    bib: "",
    warnings: converter.finish(),
  };
}

/** Plain text: paragraphs at blank lines; line breaks inside one are wrapping. */
export function convertPlainText(source: string): DocumentImport {
  const paragraphs = source
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph", content: [{ type: "text", text: part }] }));
  return { content: { type: "doc", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] }, settings: {}, title: "", bib: "", warnings: [] };
}
