/**
 * LaTeX → HTML renderer for the paper preview.
 *
 * Renders the parser's tree into semantic HTML styled by paper.css: numbered
 * sections, figures and tables with captions, lists, theorems, algorithms,
 * footnotes, citations and a formatted bibliography. Math goes to KaTeX.
 *
 * Like LaTeX it works in one pass with a second look at the end: references,
 * citations, the bibliography and the table of contents are written as
 * placeholder tokens and resolved once every label is known, so forward
 * references work.
 *
 * All text is HTML-escaped; links are limited to http(s)/mailto, images to
 * uploaded project assets, and colours and lengths are validated before they
 * reach a style attribute, so a document from someone else cannot inject
 * markup or script into the page.
 */

import katex from "katex";
import { IMPLICIT_THEOREMS, nodesToText, parseKeyValues, parseLatex } from "./parser.ts";
import type {
  Argument,
  CommandNode,
  EnvironmentNode,
  LatexNode,
  MacroDefinition,
  MathNode,
  Severity,
} from "./parser.ts";
import {
  ACCENTS,
  CONTROL_SYMBOLS,
  FONT_COMMANDS,
  FONT_DECLARATIONS,
  FONT_SIZES,
  LIPSUM,
  NAMED_COLORS,
  TEXT_SYMBOLS,
  applyAccent,
  formatToday,
  toAlpha,
  toRoman,
} from "./symbols.ts";
import { buildBibliography, escapeHtml, formatCitation, parseBibtex } from "./bibtex.ts";
import { THEMES } from "../themes.ts";
import type { ThemeConventions } from "../themes.ts";
import type { BibEntry, Bibliography, CitationStyle } from "./bibtex.ts";

export type PaperTheme = "article" | "ieee" | "acm" | "llncs" | "report" | "arxiv" | "mlconf" | "revtex" | "amsart";
export type PaperFont = "cm" | "times" | "palatino" | "sans";

export interface PaperLayout {
  documentClass: string;
  theme: PaperTheme;
  columns: 1 | 2;
  fontSize: number;
  paper: "a4" | "letter";
  font: PaperFont;
  lineSpacing: number;
}

export interface RenderOptions {
  /** Other project text files: `.bib` databases and `\input` targets. */
  files?: Record<string, string>;
  /** Uploaded images by file name, as data: or blob: URLs. */
  assets?: Record<string, string>;
  /** Prefix for element ids, so several renders can share one page. */
  idPrefix?: string;
  /** Overrides the style implied by `\bibliographystyle`. */
  citationStyle?: CitationStyle;
  /** BibTeX that `\cite` can always use, in addition to `\bibliography` files. */
  bibliography?: string;
  today?: Date;
}

export interface RenderDiagnostic {
  severity: Severity;
  message: string;
  line: number;
  column: number;
  /** Set when the problem is in another project file, such as a .bib. */
  file?: string;
}

export interface OutlineEntry {
  level: number;
  number: string;
  title: string;
  line: number;
  anchor: string;
}

export interface RenderResult {
  html: string;
  title: string;
  layout: PaperLayout;
  diagnostics: RenderDiagnostic[];
  outline: OutlineEntry[];
  labels: Record<string, string>;
  citedKeys: string[];
  wordCount: number;
}

interface Style {
  weight: "normal" | "bold";
  shape: "upright" | "italic" | "slanted" | "smallcaps";
  family: "roman" | "sans" | "mono";
  size: number | null;
  color: string | null;
  align: "left" | "center" | "right" | null;
}

const BASE_STYLE: Style = {
  weight: "normal",
  shape: "upright",
  family: "roman",
  size: null,
  color: null,
  align: null,
};

interface Sink {
  inline: boolean;
  parts: string[];
  para: string[] | null;
  paraLine: number;
  paraClasses: string[];
  paraClass: string;
  paraTag: "p" | "div";
  noIndentNext: boolean;
}

interface FloatContext {
  kind: "figure" | "table" | "algorithm" | "listing" | "subfigure" | "subtable";
  anchor: string | null;
  number: string | null;
  parent: FloatContext | null;
  subCount: number;
}

interface LabelTarget {
  text: string;
  anchor: string;
  kind: string;
  title?: string;
  /** Sub-figures print as "1a": their figure's number is only known later. */
  parent?: FloatContext;
}

interface TheoremDef {
  title: string;
  counter: string;
  within: string | null;
  numbered: boolean;
  style: "plain" | "definition" | "remark";
}

interface Author {
  html: string[];
}

interface RefUse {
  key: string;
  kind: string;
  pos: number;
}

interface CiteUse {
  keys: string[];
  mode: "paren" | "text" | "author" | "year" | "yearpar";
  pre: string;
  post: string;
  pos: number;
}

const SECTION_LEVELS: Record<string, number> = {
  part: -1,
  chapter: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

const COUNTER_CHILDREN: Record<string, string[]> = {
  part: [],
  chapter: ["section", "footnote"],
  section: ["subsection"],
  subsection: ["subsubsection"],
  subsubsection: ["paragraph"],
};

/** Commands with nothing to show in a preview. Their arguments are parsed and dropped. */
const SILENT_COMMANDS = new Set([
  "usepackage",
  "RequirePackage",
  "pagestyle",
  "thispagestyle",
  "pagenumbering",
  "setlength",
  "addtolength",
  "setcounter",
  "addtocounter",
  "stepcounter",
  "refstepcounter",
  "newcounter",
  "newlength",
  "raggedbottom",
  "flushbottom",
  "frenchspacing",
  "nonfrenchspacing",
  "sloppy",
  "fussy",
  "hypersetup",
  "geometry",
  "lstset",
  "captionsetup",
  "setcitestyle",
  "newcolumntype",
  "urlstyle",
  "IEEEoverridecommandlockouts",
  "IEEEpeerreviewmaketitle",
  "IEEEtriggeratref",
  "IEEEtriggercmd",
  "bstctlcite",
  "protect",
  "relax",
  "null",
  "nobreak",
  "allowbreak",
  "leavevmode",
  "balance",
  "nopagebreak",
  "enlargethispage",
  "fontsize",
  "selectfont",
  "usetikzlibrary",
  "pgfplotsset",
  "tikzset",
  "setcopyright",
  "copyrightyear",
  "acmYear",
  "acmDOI",
  "acmISBN",
  "acmPrice",
  "acmConference",
  "acmBooktitle",
  "acmJournal",
  "acmVolume",
  "acmNumber",
  "acmArticle",
  "acmMonth",
  "acmSubmissionID",
  "ccsdesc",
  "received",
  "settopmatter",
  "printccsdesc",
  "markboth",
  "markright",
  "titleformat",
  "titlespacing",
  "FloatBarrier",
  "strut",
  "vfill",
  "hfil",
  "hss",
  "indent",
  "nolinebreak",
  "smallbreak",
  "medbreak",
  "bigbreak",
  "onehalfspacing",
  "doublespacing",
  "singlespacing",
  "setstretch",
  "linespread",
  "graphicspath",
  "theoremstyle",
  "definecolor",
  "label",
  "centering",
  "raggedright",
  "raggedleft",
  "twocolumn",
  "onecolumn",
  "endhead",
  "endfirsthead",
  "endfoot",
  "endlastfoot",
  "hline",
  "cline",
  "toprule",
  "midrule",
  "bottomrule",
  "cmidrule",
  "addlinespace",
  "specialrule",
  "noindent",
  "par",
]);

const ALGORITHM_COMMANDS = new Set([
  "State",
  "Statex",
  "If",
  "ElsIf",
  "Else",
  "EndIf",
  "For",
  "ForAll",
  "EndFor",
  "While",
  "EndWhile",
  "Repeat",
  "Until",
  "Loop",
  "EndLoop",
  "Function",
  "EndFunction",
  "Procedure",
  "EndProcedure",
  "Return",
  "Require",
  "Ensure",
  "STATE",
  "IF",
  "ELSIF",
  "ELSE",
  "ENDIF",
  "FOR",
  "FORALL",
  "ENDFOR",
  "WHILE",
  "ENDWHILE",
  "REPEAT",
  "UNTIL",
  "LOOP",
  "ENDLOOP",
  "RETURN",
  "REQUIRE",
  "ENSURE",
]);

const FOOTNOTE_SYMBOLS = ["*", "†", "‡", "§", "¶", "‖", "**", "††", "‡‡"];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

// ── Small helpers ───────────────────────────────────────────────────────────

const esc = escapeHtml;

/** Plain text of rendered HTML, without KaTeX's hidden MathML copy. */
export function htmlToText(html: string): string {
  return html
    .replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, "")
    .replace(/<\/(p|div|h[1-6]|li|section|header|figcaption|tr|td|blockquote|pre)>|<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSpaces(value: string): string {
  return value.replace(/^[ \n\t]+|[ \n\t]+$/g, "");
}

/** Converts a LaTeX length to CSS, or null when it cannot be expressed safely. */
export function cssLength(raw: string, relativeTo: "width" | "height" = "width"): string | null {
  const value = raw.trim();
  const relative = /^(-?\d*\.?\d+)?\s*\\(textwidth|linewidth|columnwidth|hsize|textheight|paperwidth|baselineskip|fill)\b/.exec(value);
  if (relative) {
    const factor = relative[1] === undefined ? 1 : Number(relative[1]);
    if (!Number.isFinite(factor)) return null;
    switch (relative[2]) {
      case "baselineskip":
        return `${round(factor * 1.2)}em`;
      case "fill":
        return "1em";
      case "textheight":
        return relativeTo === "height" ? `${round(Math.min(factor, 1) * 60)}vh` : `${round(factor * 100)}%`;
      default:
        return `${round(Math.min(Math.max(factor, 0), 1) * 100)}%`;
    }
  }
  const absolute = /^(-?\d*\.?\d+)\s*(pt|bp|mm|cm|in|em|ex|pc|px)$/.exec(value);
  if (!absolute) return null;
  const amount = Number(absolute[1]);
  if (!Number.isFinite(amount) || Math.abs(amount) > 10000) return null;
  const unit = absolute[2] === "bp" ? "pt" : absolute[2];
  return `${round(amount)}${unit}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

function safeUrl(raw: string): string | null {
  const value = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value) && !/[\s"'<>`]/.test(value)) return value;
  if (/^www\.[^\s"'<>`]+$/i.test(value)) return `https://${value}`;
  return null;
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function isBlank(node: LatexNode): boolean {
  return node.type === "space" || node.type === "parbreak";
}

function significant(nodes: LatexNode[]): LatexNode[] {
  return nodes.filter((node) => !isBlank(node));
}

// ── KaTeX ───────────────────────────────────────────────────────────────────

const katexCache = new Map<string, string>();

function renderKatex(tex: string, display: boolean, macros: Record<string, string>, macrosKey: string) {
  const key = `${display ? "D" : "I"}\u0000${macrosKey}\u0000${tex}`;
  const cached = katexCache.get(key);
  if (cached !== undefined) return { html: cached, error: null };
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      macros: { ...macros },
      maxExpand: 1000,
      maxSize: 40,
      output: "htmlAndMathml",
    });
    if (katexCache.size > 4000) katexCache.clear();
    katexCache.set(key, html);
    return { html, error: null };
  } catch (error) {
    return { html: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Splits math at top-level `\\`, keeping each separator (with any `[len]`). */
function splitMathRows(tex: string): { rows: string[]; separators: string[] } {
  const rows: string[] = [];
  const separators: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let current = "";
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      const next = tex[i + 1] ?? "";
      if (next === "\\" && depth === 0 && envDepth === 0) {
        let j = i + 2;
        let separator = "\\\\";
        if (tex[j] === "*") {
          separator += "*";
          j++;
        }
        const spacing = /^\s*\[[^\]]*\]/.exec(tex.slice(j));
        if (spacing) {
          separator += spacing[0];
          j += spacing[0].length;
        }
        rows.push(current);
        separators.push(separator);
        current = "";
        i = j - 1;
        continue;
      }
      const word = /^\\(begin|end)\s*\{/.exec(tex.slice(i));
      if (word) envDepth = word[1] === "begin" ? envDepth + 1 : Math.max(0, envDepth - 1);
      current += ch + next;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    current += ch;
  }
  rows.push(current);
  return { rows, separators };
}

function mathRowInfo(row: string) {
  const labels: string[] = [];
  let tex = row.replace(/\\label\s*\{([^{}]*)\}/g, (_match, key: string) => {
    labels.push(key.trim());
    return "";
  });
  let notag = false;
  tex = tex.replace(/\\(nonumber|notag)(?![a-zA-Z])/g, () => {
    notag = true;
    return "";
  });
  const tag = /\\tag\*?\s*\{([^{}]*)\}/.exec(tex);
  return { tex, labels, notag, tag: tag ? tag[1] : null };
}

// ── Tables ──────────────────────────────────────────────────────────────────

interface ColumnSpec {
  align: "l" | "c" | "r" | "j";
  width: string | null;
  bold: boolean;
  italic: boolean;
}

interface ColumnLayout {
  columns: ColumnSpec[];
  /** Vertical rules before column i; the last slot is after the last column. */
  borders: number[];
}

function readBraced(raw: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== "{") return { value: raw[i] ?? "", next: i + 1 };
  let depth = 0;
  let value = "";
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return { value, next: i + 1 };
    }
    value += ch;
  }
  return { value, next: i };
}

export function parseColumnSpec(raw: string, depth = 0): ColumnLayout {
  const columns: ColumnSpec[] = [];
  const borders: number[] = [0];
  let prefix = { bold: false, italic: false, align: null as ColumnSpec["align"] | null };
  const add = (align: ColumnSpec["align"], width: string | null = null) => {
    columns.push({ align: prefix.align ?? align, width, bold: prefix.bold, italic: prefix.italic });
    borders.push(0);
    prefix = { bold: false, italic: false, align: null };
  };
  let i = 0;
  while (i < raw.length && columns.length < 64) {
    const ch = raw[i++];
    switch (ch) {
      case "|":
        borders[columns.length] += 1;
        break;
      case "l":
      case "c":
      case "r":
        add(ch);
        break;
      case "p":
      case "m":
      case "b": {
        const group = readBraced(raw, i);
        i = group.next;
        add("j", cssLength(group.value));
        break;
      }
      case "X":
      case "L":
        add("j");
        break;
      case "C":
      case "S":
        add("c");
        break;
      case "R":
        add("r");
        break;
      case "D": {
        for (let k = 0; k < 3; k++) i = readBraced(raw, i).next;
        add("c");
        break;
      }
      case "@":
      case "!":
      case "<":
        i = readBraced(raw, i).next;
        break;
      case ">": {
        const group = readBraced(raw, i);
        i = group.next;
        prefix = {
          bold: /\\(bfseries|bf)\b/.test(group.value),
          italic: /\\(itshape|it)\b/.test(group.value),
          align: /\\centering/.test(group.value)
            ? "c"
            : /\\raggedleft/.test(group.value)
              ? "r"
              : /\\raggedright/.test(group.value)
                ? "l"
                : null,
        };
        break;
      }
      case "*": {
        const count = readBraced(raw, i);
        const inner = readBraced(raw, count.next);
        i = inner.next;
        const times = Math.min(Number.parseInt(count.value, 10) || 0, 32);
        if (depth < 4) {
          for (let k = 0; k < times; k++) {
            const sub = parseColumnSpec(inner.value, depth + 1);
            sub.columns.forEach((column, index) => {
              borders[columns.length] += sub.borders[index];
              columns.push(column);
              borders.push(0);
            });
            borders[columns.length] += sub.borders[sub.columns.length];
          }
        }
        break;
      }
      default:
        if (/[A-Za-z]/.test(ch)) add("l");
        break;
    }
  }
  return { columns, borders };
}

type Rule = { kind: "hline" | "thick" | "mid" | "space" } | { kind: "cline"; from: number; to: number };

interface TableRow {
  cells: LatexNode[][];
  above: Rule[];
  below: Rule[];
}

function ruleFor(node: CommandNode): Rule | null {
  switch (node.name) {
    case "hline":
      return { kind: "hline" };
    case "toprule":
    case "bottomrule":
    case "specialrule":
      return { kind: "thick" };
    case "midrule":
      return { kind: "mid" };
    case "addlinespace":
      return { kind: "space" };
    case "cline":
    case "cmidrule": {
      const raw = node.args[node.args.length - 1]?.raw ?? "";
      const match = /(\d+)\s*-\s*(\d+)/.exec(raw);
      if (!match) return null;
      return { kind: "cline", from: Number(match[1]), to: Number(match[2]) };
    }
    default:
      return null;
  }
}

function splitTableRows(children: LatexNode[]): TableRow[] {
  const rows: TableRow[] = [];
  let cells: LatexNode[][] = [];
  let cell: LatexNode[] = [];
  let pending: Rule[] = [];
  const rowIsEmpty = () => cells.length === 0 && significant(cell).length === 0;
  const finishRow = () => {
    cells.push(cell);
    rows.push({ cells, above: pending, below: [] });
    cells = [];
    cell = [];
    pending = [];
  };
  for (const node of children) {
    if (node.type === "tab") {
      cells.push(cell);
      cell = [];
      continue;
    }
    if (node.type === "command") {
      if (node.name === "\\" || node.name === "tabularnewline") {
        finishRow();
        continue;
      }
      const rule = ruleFor(node);
      if (rule) {
        if (rowIsEmpty()) pending.push(rule);
        continue;
      }
      if (/^end(first)?(head|foot)$|^endlastfoot$/.test(node.name)) continue;
    }
    cell.push(node.type === "parbreak" ? { type: "space", start: node.start, end: node.end } : node);
  }
  if (!rowIsEmpty()) finishRow();
  else if (pending.length && rows.length) rows[rows.length - 1].below.push(...pending);
  return rows;
}

// ── The renderer ────────────────────────────────────────────────────────────

class LatexRenderer {
  private readonly source: string;
  private readonly options: RenderOptions;
  private readonly prefix: string;
  private readonly nonce: string;
  private readonly lineStarts: number[];
  private macros = new Map<string, MacroDefinition>();
  private katexMacros: Record<string, string> = {};
  private macrosKey = "";
  private readonly diagnostics: { severity: Severity; message: string; pos: number; file?: string }[] = [];
  private readonly warned = new Set<string>();
  private sinks: Sink[] = [];
  private style: Style = BASE_STYLE;
  private readonly layout: PaperLayout = {
    documentClass: "article",
    theme: "article",
    columns: 1,
    fontSize: 10,
    paper: "letter",
    font: "cm",
    lineSpacing: 1,
  };
  private inPreamble = false;
  private resolving = false;
  private readonly counters: Record<string, number> = {};
  private readonly counterChildren: Record<string, string[]> = JSON.parse(JSON.stringify(COUNTER_CHILDREN));
  private appendix = false;
  private readonly labels = new Map<string, LabelTarget>();
  private target: LabelTarget | null = null;
  private readonly refs: RefUse[] = [];
  private readonly cites: CiteUse[] = [];
  private readonly citedKeys: string[] = [];
  private nociteAll = false;
  private readonly bibFiles: string[] = [];
  private bibStyle: string | null = null;
  private natbib = false;
  private natbibNumbers = false;
  private biblatexStyle: string | null = null;
  private manualBib: Map<string, string> | null = null;
  private readonly footnotes: { id: string; mark: string; html: string }[] = [];
  private symbolFootnotes = 0;
  private readonly floats: FloatContext[] = [];
  private readonly theorems = new Map<string, TheoremDef>();
  private theoremStyle: TheoremDef["style"] = "plain";
  private titleNodes: LatexNode[] | null = null;
  private readonly authors: Author[] = [];
  private dateNodes: LatexNode[] | null | undefined = undefined;
  private readonly stashed: string[] = [];
  private titleShown = false;
  private readonly outline: OutlineEntry[] = [];
  private readonly captions: { kind: string; number: string; html: string; anchor: string }[] = [];
  private readonly structural: { kind: "toc" | "lof" | "lot" | "bib"; title?: string }[] = [];
  private enumDepth = 0;
  private itemDepth = 0;
  private readonly enumRefs: string[] = [];
  private subequation: { parent: string; count: number } | null = null;
  private wordCount = 0;
  private ids = 0;
  private readonly colors: Record<string, string> = {};
  private readonly virtualFiles: Record<string, string> = {};
  private currentPos = 0;
  private currentLine = 1;
  /** Counters numbered within another, from \\numberwithin{equation}{section}. */
  private readonly numberWithin: Record<string, string> = {};

  constructor(source: string, options: RenderOptions) {
    this.source = source.replace(/\r\n?/g, "\n");
    this.options = options;
    this.prefix = options.idPrefix ?? "p-";
    this.nonce = `zq${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6)}x`;
    this.lineStarts = [0];
    for (let i = 0; i < this.source.length; i++) if (this.source[i] === "\n") this.lineStarts.push(i + 1);
  }

  render(): RenderResult {
    const parsed = parseLatex(this.source, { files: this.options.files });
    this.macros = parsed.macros;
    this.katexMacros = { ...parsed.mathMacros };
    this.macrosKey = JSON.stringify(Object.entries(this.katexMacros).sort());
    for (const diagnostic of parsed.diagnostics) {
      this.diagnostics.push({ severity: diagnostic.severity, message: diagnostic.message, pos: diagnostic.start });
    }

    const root: Sink = this.makeSink(false);
    this.sinks = [root];

    const docIndex = parsed.nodes.findIndex((node) => node.type === "environment" && node.name === "document");
    let body = parsed.nodes;
    if (docIndex !== -1) {
      const preamble = parsed.nodes.slice(0, docIndex);
      body = (parsed.nodes[docIndex] as EnvironmentNode).children;
      this.inPreamble = true;
      this.renderInline(preamble);
      this.inPreamble = false;
    }
    this.applyMacroLayout();
    this.renderNodes(body);
    this.closePara();

    let html = root.parts.join("");
    if (this.footnotes.length) {
      const items = this.footnotes
        .map((note) => `<li id="${note.id}" data-mark="${esc(note.mark)}"><span class="paper-footnote-mark">${esc(note.mark)}</span> ${note.html} <a class="paper-footnote-back" href="#${note.id}-ref" aria-label="Back to text">↩</a></li>`)
        .join("");
      html += `<section class="paper-footnotes" aria-label="Footnotes"><ol>${items}</ol></section>`;
    }
    this.resolving = true;
    html = this.resolve(html);
    const title = this.titleNodes ? htmlToText(this.resolve(this.renderInline(this.titleNodes))) : "";

    const labels: Record<string, string> = {};
    for (const [key, target] of this.labels) labels[key] = this.labelText(target);
    return {
      html,
      title,
      layout: { ...this.layout },
      diagnostics: this.diagnostics.map((diagnostic) => {
        const { line, column } = this.position(diagnostic.pos);
        return {
          severity: diagnostic.severity,
          message: diagnostic.message,
          line: diagnostic.file ? 0 : line,
          column: diagnostic.file ? 0 : column,
          ...(diagnostic.file ? { file: diagnostic.file } : {}),
        };
      }),
      outline: this.outline,
      labels,
      citedKeys: [...this.citedKeys],
      wordCount: this.wordCount,
    };
  }

  // ── Positions and diagnostics ────────────────────────────────────────────

  private position(pos: number): { line: number; column: number } {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= pos) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: pos - this.lineStarts[low] + 1 };
  }

  private report(severity: Severity, message: string, pos = this.currentPos): void {
    if (this.inPreamble && severity !== "error") return;
    this.diagnostics.push({ severity, message, pos });
  }

  private reportOnce(key: string, severity: Severity, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.report(severity, message);
  }

  private nextId(kind: string): string {
    this.ids += 1;
    return `${this.prefix}${kind}-${this.ids}`;
  }

  private token(kind: string, index: number): string {
    return `${this.nonce}${kind}${index}Z`;
  }

  // ── Output sinks ─────────────────────────────────────────────────────────

  private makeSink(inline: boolean, paraTag: "p" | "div" = "p", paraClass = ""): Sink {
    return { inline, parts: [], para: null, paraLine: this.currentLine, paraClasses: [], paraClass, paraTag, noIndentNext: false };
  }

  private get sink(): Sink {
    return this.sinks[this.sinks.length - 1];
  }

  private openPara(): void {
    const sink = this.sink;
    sink.para = [];
    sink.paraLine = this.currentLine;
    sink.paraClasses = sink.paraClass ? [sink.paraClass] : [];
    if (sink.noIndentNext) {
      sink.paraClasses.push("ltx-noindent");
      sink.noIndentNext = false;
    }
  }

  private closePara(): void {
    const sink = this.sink;
    if (sink.inline || !sink.para) return;
    const content = trimSpaces(sink.para.join(""));
    sink.para = null;
    if (!content) return;
    const classes = [...sink.paraClasses];
    if (this.style.align) classes.push(`ltx-align-${this.style.align}`);
    const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
    sink.parts.push(`<${sink.paraTag}${classAttr} data-line="${sink.paraLine}">${content}</${sink.paraTag}>`);
  }

  /** Emits inline HTML in the current style. */
  private inline(html: string): void {
    if (!html) return;
    const styled = this.styled(html);
    // Merge with the previous run when it has the same style, so a styled
    // sentence becomes one <span> instead of one per word.
    if (styled !== html) {
      const sink = this.sink;
      const parts = sink.inline ? sink.parts : sink.para;
      if (parts && parts.length) {
        const open = styled.slice(0, styled.indexOf(">") + 1);
        let gap = "";
        let index = parts.length - 1;
        if (parts[index] === " ") {
          gap = " ";
          index -= 1;
        }
        const previous = parts[index];
        if (index >= 0 && previous.startsWith(open) && previous.endsWith("</span>") && !previous.slice(open.length).includes("<span")) {
          parts[index] = `${previous.slice(0, -7)}${gap}${styled.slice(open.length)}`;
          parts.length = index + 1;
          return;
        }
      }
    }
    this.emitRaw(styled);
  }

  /** Emits inline HTML that is already styled (or must not be). */
  private emitRaw(html: string): void {
    if (!html) return;
    const sink = this.sink;
    if (sink.inline) {
      sink.parts.push(html);
      return;
    }
    if (!sink.para) this.openPara();
    sink.para?.push(html);
  }

  private space(): void {
    const sink = this.sink;
    if (sink.inline) sink.parts.push(" ");
    else if (sink.para && sink.para.length) sink.para.push(" ");
  }

  private parbreak(): void {
    const sink = this.sink;
    if (sink.inline) {
      sink.parts.push(" ");
      return;
    }
    this.closePara();
    sink.noIndentNext = false;
  }

  private block(html: string): void {
    const sink = this.sink;
    if (sink.inline) {
      sink.parts.push(html);
      return;
    }
    this.closePara();
    sink.parts.push(html);
    sink.noIndentNext = false;
  }

  private styled(html: string): string {
    const style = this.style;
    const classes: string[] = [];
    if (style.weight === "bold") classes.push("ltx-bf");
    if (style.shape === "italic") classes.push("ltx-it");
    else if (style.shape === "slanted") classes.push("ltx-sl");
    else if (style.shape === "smallcaps") classes.push("ltx-sc");
    if (style.family === "sans") classes.push("ltx-sf");
    else if (style.family === "mono") classes.push("ltx-tt");
    const css: string[] = [];
    if (style.size !== null && style.size !== 1) css.push(`font-size:${style.size}em`);
    if (style.color) css.push(`color:${style.color}`);
    if (!classes.length && !css.length) return html;
    return `<span${classes.length ? ` class="${classes.join(" ")}"` : ""}${css.length ? ` style="${css.join(";")}"` : ""}>${html}</span>`;
  }

  private withStyle(change: Partial<Style>, fn: () => void): void {
    const saved = this.style;
    this.style = { ...this.style, ...change };
    try {
      fn();
    } finally {
      this.style = saved;
    }
  }

  /** Renders into a fresh block container; environments are groups, so style is restored. */
  private withBlockSink(fn: () => void, paraTag: "p" | "div" = "p", paraClass = ""): string {
    const sink = this.makeSink(false, paraTag, paraClass);
    this.sinks.push(sink);
    const saved = this.style;
    try {
      fn();
      this.closePara();
    } finally {
      this.sinks.pop();
      this.style = saved;
    }
    return sink.parts.join("");
  }

  renderInline(nodes: LatexNode[]): string {
    const sink = this.makeSink(true);
    this.sinks.push(sink);
    const saved = this.style;
    try {
      this.renderNodes(nodes);
    } finally {
      this.sinks.pop();
      this.style = saved;
    }
    return trimSpaces(sink.parts.join(""));
  }

  /** Renders a LaTeX string (a list label, a .bib field) with the document's macros. */
  private renderFragment(source: string): string {
    const parsed = parseLatex(source, { macros: this.macros });
    const savedPos = this.currentPos;
    const html = this.renderInline(parsed.nodes);
    this.currentPos = savedPos;
    return html;
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  private renderNodes(nodes: LatexNode[]): void {
    for (const node of nodes) this.renderNode(node);
  }

  private renderNode(node: LatexNode): void {
    if (!this.resolving) {
      this.currentPos = node.start;
      this.currentLine = this.position(node.start).line;
    }
    switch (node.type) {
      case "text":
        this.inline(this.textHtml(node.value));
        break;
      case "space":
        this.space();
        break;
      case "parbreak":
        this.parbreak();
        break;
      case "tab":
        this.reportOnce("tab", "warning", "& is only meaningful inside a table or alignment.");
        break;
      case "group": {
        const saved = this.style;
        this.renderNodes(node.children);
        this.style = saved;
        break;
      }
      case "command":
        this.command(node);
        break;
      case "environment":
        this.environment(node);
        break;
      case "math":
        if (node.display) this.displayMath(node);
        else this.emitRaw(this.inlineMath(node.content));
        break;
      case "verb":
        this.emitRaw(`<code class="ltx-verb">${esc(node.value)}</code>`);
        break;
      default:
        break;
    }
  }

  private textHtml(value: string): string {
    let text = value;
    if (this.style.family !== "mono") {
      text = text
        .replace(/\?`/g, "¿")
        .replace(/!`/g, "¡")
        .replace(/---/g, "—")
        .replace(/--/g, "–")
        .replace(/``/g, "“")
        .replace(/''/g, "”")
        .replace(/`/g, "‘")
        .replace(/'/g, "’");
    }
    if (!this.inPreamble && !this.resolving) {
      this.wordCount += (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
    }
    return esc(text);
  }

  private argNodes(node: CommandNode, index: number): LatexNode[] {
    return node.args[index]?.children ?? [];
  }

  private argRaw(node: CommandNode | EnvironmentNode, index: number): string {
    const arg = node.args[index];
    if (!arg) return "";
    return arg.raw || nodesToText(arg.children);
  }

  private command(node: CommandNode): void {
    const name = node.name;

    if (name in FONT_COMMANDS) {
      this.fontCommand(FONT_COMMANDS[name], node.args[0]);
      return;
    }
    if (name in FONT_DECLARATIONS) {
      this.style = { ...this.style, ...this.fontChange(FONT_DECLARATIONS[name]) };
      return;
    }
    if (name in FONT_SIZES) {
      this.style = { ...this.style, size: FONT_SIZES[name] === 1 ? null : FONT_SIZES[name] };
      return;
    }
    if (name in SECTION_LEVELS) {
      this.heading(node);
      return;
    }
    if (name.length === 1 && name in CONTROL_SYMBOLS && name !== "\\") {
      this.inline(esc(CONTROL_SYMBOLS[name]));
      return;
    }
    if (name in ACCENTS && node.args.length) {
      this.accent(name, node.args[0]);
      return;
    }
    if (name in TEXT_SYMBOLS) {
      this.inline(esc(TEXT_SYMBOLS[name]));
      return;
    }
    if (ALGORITHM_COMMANDS.has(name)) {
      this.reportOnce(`alg:${name}`, "warning", `\\${name} only has a meaning inside an algorithmic environment.`);
      return;
    }

    switch (name) {
      // ── Preamble and document setup
      case "documentclass":
        this.documentClass(this.argRaw(node, 1), this.argRaw(node, 0));
        return;
      case "usepackage":
      case "RequirePackage":
        this.usePackage(this.argRaw(node, 1), this.argRaw(node, 0));
        return;
      case "title":
        this.titleNodes = this.argNodes(node, 1);
        return;
      case "author":
        this.authors.push({ html: this.renderAuthorParts(this.argNodes(node, 1)) });
        return;
      case "affiliation":
      case "institute":
      case "institution":
      case "email":
      case "address":
      case "orcid":
      case "country":
      case "city":
        if (this.inPreamble || !this.titleShown) {
          const last = this.authors[this.authors.length - 1];
          const html = `<span class="paper-author-line">${this.renderInline(this.argNodes(node, 0))}</span>`;
          if (last) last.html[last.html.length - 1] += html;
          else this.authors.push({ html: [html] });
        } else this.emitRaw(this.renderInline(this.argNodes(node, 0)));
        return;
      case "date":
        this.dateNodes = this.argNodes(node, 0);
        return;
      case "thanks":
        this.emitRaw(this.footnoteMark(this.renderInline(this.argNodes(node, 0)), true));
        return;
      case "maketitle":
        this.maketitle();
        return;
      case "keywords": {
        const html = `<p class="paper-keywords"><span class="paper-keywords-label">Keywords:</span> ${this.renderInline(this.argNodes(node, 0))}</p>`;
        if (this.inPreamble || (this.titleAfterFrontMatter() && !this.titleShown)) this.stashed.push(html);
        else this.block(html);
        return;
      }
      case "subjclass": {
        const year = this.argRaw(node, 0).trim();
        const html = `<p class="paper-keywords"><span class="paper-keywords-label">${year ? `${esc(year)} ` : ""}Mathematics Subject Classification.</span> ${this.renderInline(this.argNodes(node, 1))}</p>`;
        if (this.inPreamble || (this.titleAfterFrontMatter() && !this.titleShown)) this.stashed.push(html);
        else this.block(html);
        return;
      }
      case "numberwithin": {
        const counter = this.argRaw(node, 0).trim();
        const within = this.argRaw(node, 1).trim();
        if (counter && within) {
          this.numberWithin[counter] = within;
          this.counterChildren[within] = [...(this.counterChildren[within] ?? []), counter];
        }
        return;
      }
      case "newtheorem":
        this.defineTheorem(node);
        return;
      case "theoremstyle": {
        const style = this.argRaw(node, 0).trim();
        this.theoremStyle = style === "definition" ? "definition" : style === "remark" ? "remark" : "plain";
        return;
      }
      case "definecolor": {
        const color = this.parseColor(this.argRaw(node, 1).trim(), this.argRaw(node, 2).trim());
        if (color) this.colors[this.argRaw(node, 0).trim()] = color;
        return;
      }
      case "graphicspath":
        return;
      case "bibliographystyle":
        this.bibStyle = this.argRaw(node, 0).trim();
        return;
      case "addbibresource":
        this.bibFiles.push(this.argRaw(node, 1).trim());
        return;
      case "doublespacing":
      case "onehalfspacing":
      case "singlespacing":
      case "setstretch":
      case "linespread":
        this.lineSpacingCommand(name, this.argRaw(node, 0));
        return;
      case "twocolumn":
        this.layout.columns = 2;
        return;
      case "onecolumn":
        this.layout.columns = 1;
        return;

      // ── Structure
      case "appendix":
        this.appendix = true;
        this.counters[this.layout.theme === "report" ? "chapter" : "section"] = 0;
        return;
      case "tableofcontents":
        this.structuralBlock("toc");
        return;
      case "listoffigures":
        this.structuralBlock("lof");
        return;
      case "listoftables":
        this.structuralBlock("lot");
        return;
      case "label":
        this.setLabel(this.argRaw(node, 0).trim());
        return;
      case "caption":
        this.caption(node.args[1]?.children ?? []);
        return;
      case "captionof":
        this.caption(node.args[2]?.children ?? [], this.argRaw(node, 0).trim() === "table" ? "table" : "figure");
        return;
      case "subcaption":
        this.caption(node.args[1]?.children ?? []);
        return;
      case "subfloat":
        this.subfloat(node);
        return;
      case "item":
        this.reportOnce("item", "warning", "\\item is used outside a list.");
        this.parbreak();
        this.inline("• ");
        return;
      case "par":
        this.parbreak();
        return;
      case "noindent":
        if (!this.sink.para) this.sink.noIndentNext = true;
        return;
      case "\\":
      case "newline":
      case "linebreak":
        if (this.sink.inline || this.sink.para) this.emitRaw("<br>");
        return;
      case "newpage":
      case "clearpage":
      case "cleardoublepage":
      case "pagebreak":
        this.block('<div class="paper-pagebreak" aria-hidden="true"></div>');
        return;
      case "centering":
        this.style = { ...this.style, align: "center" };
        return;
      case "raggedright":
        this.style = { ...this.style, align: "left" };
        return;
      case "raggedleft":
        this.style = { ...this.style, align: "right" };
        return;

      // ── References and citations
      case "ref":
      case "eqref":
      case "pageref":
      case "autoref":
      case "cref":
      case "Cref":
      case "nameref":
      case "vref": {
        const keys = this.argRaw(node, 0).split(",").map((key) => key.trim()).filter(Boolean);
        keys.forEach((key, index) => {
          if (index) this.inline(", ");
          const at = this.refs.push({ key, kind: name, pos: this.currentPos }) - 1;
          this.emitRaw(this.styled(this.token("R", at)));
        });
        return;
      }
      case "cite":
      case "citep":
      case "citet":
      case "citealp":
      case "citealt":
      case "Cite":
      case "Citep":
      case "Citet":
      case "parencite":
      case "textcite":
      case "autocite":
      case "footcite":
      case "citeauthor":
      case "citeyear":
      case "citeyearpar":
      case "citetitle":
      case "nocite":
        this.cite(node);
        return;
      case "bibliography":
        for (const file of this.argRaw(node, 0).split(",")) if (file.trim()) this.bibFiles.push(file.trim());
        this.structuralBlock("bib");
        return;
      case "printbibliography": {
        const options = parseKeyValues(this.argRaw(node, 0));
        this.structuralBlock("bib", options.title);
        return;
      }
      case "bibitem":
        this.reportOnce("bibitem", "warning", "\\bibitem is used outside thebibliography.");
        return;

      // ── Links, footnotes, images
      case "url":
      case "nolinkurl": {
        const raw = this.argRaw(node, 0);
        const url = name === "url" ? safeUrl(raw) : null;
        const text = `<span class="ltx-url">${esc(raw)}</span>`;
        this.emitRaw(url ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${this.styled(text)}</a>` : this.styled(text));
        return;
      }
      case "href": {
        const url = safeUrl(this.argRaw(node, 0));
        const text = this.renderInline(this.argNodes(node, 1));
        if (!url) this.reportOnce(`href:${this.argRaw(node, 0)}`, "warning", `Link target "${this.argRaw(node, 0)}" is not an http(s) or mailto address, so it is shown as text.`);
        this.emitRaw(url ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${text}</a>` : text);
        return;
      }
      case "footnote":
        this.emitRaw(this.footnoteMark(this.renderInline(this.argNodes(node, 1)), false, this.argRaw(node, 0)));
        return;
      case "footnotemark": {
        const mark = this.argRaw(node, 0).trim() || String((this.counters.footnote ?? 0) + 1);
        if (!this.argRaw(node, 0).trim()) this.counters.footnote = (this.counters.footnote ?? 0) + 1;
        this.emitRaw(`<sup class="paper-footnote-ref">${esc(mark)}</sup>`);
        return;
      }
      case "footnotetext": {
        const mark = this.argRaw(node, 0).trim() || String(this.counters.footnote ?? 1);
        this.footnotes.push({ id: this.nextId("fn"), mark, html: this.renderInline(this.argNodes(node, 1)) });
        return;
      }
      case "includegraphics":
        this.includeGraphics(node);
        return;

      // ── Spacing
      case "vspace": {
        const length = cssLength(this.argRaw(node, 0), "height");
        if (!length) return;
        const css = length.startsWith("-") ? `margin-top:${length}` : `height:${length}`;
        if (this.sink.inline || this.sink.para) this.emitRaw(`<span class="ltx-vspace" style="display:block;${css}"></span>`);
        else this.block(`<div class="ltx-vspace" style="${css}"></div>`);
        return;
      }
      case "hspace": {
        const length = cssLength(this.argRaw(node, 0));
        if (length) this.emitRaw(`<span class="ltx-hspace" style="${length.startsWith("-") ? `margin-left:${length}` : `width:${length}`}"></span>`);
        return;
      }
      case "smallskip":
      case "medskip":
      case "bigskip": {
        const size = name === "smallskip" ? "0.25em" : name === "medskip" ? "0.5em" : "1em";
        this.block(`<div class="ltx-vspace" style="height:${size}"></div>`);
        return;
      }
      case "quad":
        this.emitRaw('<span class="ltx-hspace" style="width:1em"></span>');
        return;
      case "qquad":
        this.emitRaw('<span class="ltx-hspace" style="width:2em"></span>');
        return;
      case "enspace":
      case "enskip":
        this.emitRaw('<span class="ltx-hspace" style="width:0.5em"></span>');
        return;
      case "thinspace":
        this.inline("\u2009");
        return;
      case "hfill":
      case "dotfill":
      case "hrulefill":
        this.emitRaw('<span class="ltx-hfill"></span>');
        return;
      case "rule": {
        const width = cssLength(this.argRaw(node, 1)) ?? "0";
        const height = cssLength(this.argRaw(node, 2), "height") ?? "0";
        this.emitRaw(`<span class="ltx-rule" style="width:${width};height:${height}"></span>`);
        return;
      }

      // ── Text in boxes and transformations
      case "text":
      case "mbox":
      case "makebox":
      case "parbox":
      case "raisebox":
      case "scalebox":
      case "resizebox":
      case "rotatebox":
      case "adjustbox":
      case "shortstack":
      case "makecell": {
        const content = node.args[node.args.length - 1]?.children ?? [];
        const saved = this.style;
        this.renderNodes(content);
        this.style = saved;
        return;
      }
      case "fbox":
      case "framebox":
        this.emitRaw(`<span class="ltx-fbox">${this.renderInline(node.args[node.args.length - 1]?.children ?? [])}</span>`);
        return;
      case "MakeUppercase":
      case "uppercase":
        this.emitRaw(`<span style="text-transform:uppercase">${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "MakeLowercase":
      case "lowercase":
        this.emitRaw(`<span style="text-transform:lowercase">${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "ensuremath":
        this.emitRaw(this.inlineMath(this.argRaw(node, 0)));
        return;
      case "textcolor": {
        const color = this.parseColor(this.argRaw(node, 0).trim() || null, this.argRaw(node, 1).trim());
        this.withStyle(color ? { color } : {}, () => this.renderNodes(this.argNodes(node, 2)));
        return;
      }
      case "color": {
        const color = this.parseColor(this.argRaw(node, 0).trim() || null, this.argRaw(node, 1).trim());
        if (color) this.style = { ...this.style, color };
        return;
      }
      case "colorbox":
      case "fcolorbox": {
        const background = this.parseColor(this.argRaw(node, 0).trim() || null, this.argRaw(node, name === "fcolorbox" ? 2 : 1).trim());
        const border = name === "fcolorbox" ? this.parseColor(this.argRaw(node, 0).trim() || null, this.argRaw(node, 1).trim()) : null;
        const content = this.renderInline(node.args[node.args.length - 1]?.children ?? []);
        const css = [background ? `background:${background}` : "", border ? `border:1px solid ${border}` : ""].filter(Boolean).join(";");
        this.emitRaw(`<span class="ltx-colorbox"${css ? ` style="${css}"` : ""}>${content}</span>`);
        return;
      }

      // ── Logos and generated text
      case "LaTeX":
        this.inline('<span class="ltx-logo">L<span class="ltx-logo-a">a</span>T<span class="ltx-logo-e">e</span>X</span>');
        return;
      case "LaTeXe":
        this.inline('<span class="ltx-logo">L<span class="ltx-logo-a">a</span>T<span class="ltx-logo-e">e</span>X</span>2<span class="ltx-logo-eps">ε</span>');
        return;
      case "TeX":
        this.inline('<span class="ltx-logo">T<span class="ltx-logo-e">e</span>X</span>');
        return;
      case "BibTeX":
        this.inline('<span class="ltx-logo">B<span class="ltx-sc">ib</span>T<span class="ltx-logo-e">e</span>X</span>');
        return;
      case "today":
        this.inline(esc(formatToday(this.options.today)));
        return;
      case "lipsum":
      case "blindtext":
        this.lipsum(this.argRaw(node, 0));
        return;
      case "IEEEPARstart":
        this.emitRaw(`<span class="ltx-dropcap">${this.renderInline(this.argNodes(node, 0))}</span><span class="ltx-sc">${this.renderInline(this.argNodes(node, 1))}</span>`);
        return;
      case "IEEEauthorblockN":
        this.emitRaw(`<span class="paper-author-name">${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "IEEEauthorblockA":
        this.emitRaw(`<span class="paper-author-affil">${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "IEEEmembership":
        this.emitRaw(`<span class="ltx-it">${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "and":
      case "AND":
        this.inline(" ");
        return;
      case "Call":
        this.emitRaw(`<span class="ltx-sc">${this.renderInline(this.argNodes(node, 0))}</span>(${this.renderInline(this.argNodes(node, 1))})`);
        return;
      case "Comment":
      case "COMMENT":
        this.emitRaw(`<span class="ltx-alg-comment">▷ ${this.renderInline(this.argNodes(node, 0))}</span>`);
        return;
      case "multicolumn":
        this.renderNodes(this.argNodes(node, 2));
        return;
      case "multirow":
        this.renderNodes(this.argNodes(node, 4));
        return;
      default:
        break;
    }

    if (SILENT_COMMANDS.has(name) || name.startsWith("acm")) return;
    if (this.inPreamble) return;
    this.reportOnce(`cmd:${name}`, "warning", `Unknown command \\${name} — the preview shows its arguments as plain text.`);
  }

  private fontChange(kind: string): Partial<Style> {
    switch (kind) {
      case "bf":
        return { weight: "bold" };
      case "md":
        return { weight: "normal" };
      case "it":
        return { shape: "italic" };
      case "em":
        return { shape: this.style.shape === "italic" ? "upright" : "italic" };
      case "sl":
        return { shape: "slanted" };
      case "sc":
        return { shape: "smallcaps" };
      case "up":
        return { shape: "upright" };
      case "tt":
        return { family: "mono" };
      case "sf":
        return { family: "sans" };
      case "rm":
        return { family: "roman" };
      case "normal":
        return { weight: "normal", shape: "upright", family: "roman" };
      default:
        return {};
    }
  }

  private fontCommand(kind: string, arg: Argument | null | undefined): void {
    const children = arg?.children ?? [];
    const wrappers: Record<string, [string, string]> = {
      underline: ["<u>", "</u>"],
      strike: ["<s>", "</s>"],
      highlight: ['<mark class="ltx-hl">', "</mark>"],
      sup: ["<sup>", "</sup>"],
      sub: ["<sub>", "</sub>"],
    };
    const wrapper = wrappers[kind];
    if (wrapper) {
      this.emitRaw(`${wrapper[0]}${this.renderInline(children)}${wrapper[1]}`);
      return;
    }
    this.withStyle(this.fontChange(kind), () => this.renderNodes(children));
  }

  private accent(accent: string, arg: Argument | null | undefined): void {
    const nodes = arg?.children ?? [];
    let base = "";
    for (const node of nodes) {
      if (node.type === "text") base += node.value;
      else if (node.type === "command" && node.name in TEXT_SYMBOLS) base += TEXT_SYMBOLS[node.name];
      else if (node.type === "group") base += nodesToText(node.children);
    }
    this.inline(esc(applyAccent(accent, base)));
  }

  /** Classes whose \\maketitle also typesets an abstract written before it. */
  private titleAfterFrontMatter(): boolean {
    return this.layout.theme === "acm" || this.layout.theme === "revtex" || this.layout.theme === "amsart";
  }

  // ── Document class, packages, layout ────────────────────────────────────

  private documentClass(name: string, optionsRaw: string): void {
    const cls = name.trim();
    const options = optionsRaw.split(",").map((option) => option.trim());
    const layout = this.layout;
    layout.documentClass = cls;
    switch (cls) {
      case "IEEEtran":
        Object.assign(layout, { theme: "ieee", columns: 2, fontSize: 10, paper: "letter", font: "times" });
        break;
      case "acmart":
        Object.assign(layout, {
          theme: "acm",
          columns: options.some((option) => /^sig(conf|plan|chi-a)$/.test(option)) ? 2 : 1,
          fontSize: 9,
          paper: "letter",
          font: "times",
        });
        break;
      case "llncs":
        Object.assign(layout, { theme: "llncs", columns: 1, fontSize: 10, paper: "a4", font: "cm" });
        break;
      case "revtex4-2":
      case "revtex4-1":
      case "revtex4":
        // reprint is the two-column journal look; preprint is one column.
        Object.assign(layout, {
          theme: "revtex",
          columns: options.includes("reprint") || options.includes("twocolumn") ? 2 : 1,
          fontSize: 10,
          paper: "letter",
          font: "cm",
        });
        break;
      case "amsart":
      case "amsproc":
        Object.assign(layout, { theme: "amsart", columns: 1, fontSize: 10, paper: "letter", font: "cm" });
        break;
      case "report":
      case "book":
      case "scrreprt":
      case "scrbook":
        Object.assign(layout, { theme: "report", columns: 1 });
        break;
      default:
        layout.theme = "article";
        break;
    }
    for (const option of options) {
      if (option === "twocolumn") layout.columns = 2;
      else if (option === "onecolumn" || option === "draftclsnofoot") layout.columns = 1;
      else if (/^(9|10|11|12)pt$/.test(option)) layout.fontSize = Number.parseInt(option, 10);
      else if (option === "a4paper") layout.paper = "a4";
      else if (option === "letterpaper") layout.paper = "letter";
      else if (option === "5p" && cls === "elsarticle") layout.columns = 2;
    }
  }

  private usePackage(names: string, optionsRaw: string): void {
    for (const raw of names.split(",")) {
      const name = raw.trim();
      if (["times", "mathptmx", "newtxtext", "txfonts", "ptm", "tgtermes", "newtxmath"].includes(name)) this.layout.font = "times";
      else if (["mathpazo", "palatino", "newpxtext", "pxfonts", "tgpagella", "mathpple"].includes(name)) this.layout.font = "palatino";
      // Preprint layouts: our own style files and the usual venue packages.
      else if (name === "arxiv-preprint" || name === "arxiv" || /^neurips_\d{4}$/.test(name) || /^iclr\d{4}_conference$/.test(name)) this.layout.theme = "arxiv";
      else if (name === "ml-preprint" || /^icml\d{4}$/.test(name)) this.layout.theme = "mlconf";
      else if (name === "natbib") {
        this.natbib = true;
        this.natbibNumbers = /\bnumbers\b/.test(optionsRaw);
      } else if (name === "biblatex") {
        const options = parseKeyValues(optionsRaw);
        this.biblatexStyle = options.style ?? options.citestyle ?? "numeric";
      }
    }
  }

  private applyMacroLayout(): void {
    const family = this.macros.get("familydefault");
    if (family && /\\sfdefault/.test(family.body)) this.layout.font = "sans";
  }

  private lineSpacingCommand(name: string, value: string): void {
    if (name === "doublespacing") this.layout.lineSpacing = 2;
    else if (name === "onehalfspacing") this.layout.lineSpacing = 1.5;
    else if (name === "singlespacing") this.layout.lineSpacing = 1;
    else {
      const amount = Number.parseFloat(value);
      if (Number.isFinite(amount) && amount > 0.5 && amount < 4) this.layout.lineSpacing = amount;
    }
  }

  // ── Counters and labels ─────────────────────────────────────────────────

  private step(counter: string): number {
    const value = (this.counters[counter] ?? 0) + 1;
    this.counters[counter] = value;
    const reset = (name: string, depth: number) => {
      if (depth > 8) return;
      for (const child of this.counterChildren[name] ?? []) {
        this.counters[child] = 0;
        reset(child, depth + 1);
      }
    };
    reset(counter, 0);
    return value;
  }

  private setLabel(key: string): void {
    if (!key) return;
    if (this.inPreamble) return;
    if (this.labels.has(key)) {
      this.report("warning", `Label "${key}" is defined more than once.`);
      return;
    }
    if (!this.target) {
      this.labels.set(key, { text: "", anchor: "", kind: "none" });
      return;
    }
    this.labels.set(key, { ...this.target });
  }

  private labelText(target: LabelTarget): string {
    if (target.parent) return `${target.parent.number ?? "?"}${target.text}`;
    return target.text;
  }

  /** Number text of a counter "within" another, e.g. theorem 2.3 within section 2. */
  private withinPrefix(within: string | null): string {
    if (!within) return "";
    const section = this.sectionNumber(within);
    return `${section ? section.ref : this.counters[within] ?? 0}.`;
  }

  private sectionNumber(kind: string): { display: string; ref: string } | null {
    const counters = this.counters;
    const theme = this.layout.theme;
    if (theme === "ieee" || theme === "revtex") {
      const section = this.appendix ? toAlpha(counters.section ?? 0, true) : toRoman(counters.section ?? 0, true);
      const sub = toAlpha(counters.subsection ?? 0, true);
      const subsub = counters.subsubsection ?? 0;
      if (kind === "section") return { display: `${section}.`, ref: section };
      if (theme === "revtex") {
        if (kind === "subsection") return { display: `${sub}.`, ref: `${section} ${sub}` };
        if (kind === "subsubsection") return { display: `${subsub}.`, ref: `${section} ${sub} ${subsub}` };
        return null;
      }
      if (kind === "subsection") return { display: `${sub}.`, ref: `${section}-${sub}` };
      if (kind === "subsubsection") return { display: `${subsub})`, ref: `${section}-${sub}${subsub}` };
      return null;
    }
    if (theme === "amsart" || theme === "mlconf") {
      // "1. Introduction", "1.1. Background".
      const section = this.appendix ? toAlpha(counters.section ?? 0, true) : String(counters.section ?? 0);
      const parts = kind === "section" ? [section] : kind === "subsection" ? [section, counters.subsection ?? 0] : kind === "subsubsection" ? [section, counters.subsection ?? 0, counters.subsubsection ?? 0] : null;
      if (!parts) return null;
      const value = parts.join(".");
      return { display: `${value}.`, ref: value };
    }
    if (theme === "report") {
      const chapter = this.appendix ? toAlpha(counters.chapter ?? 0, true) : String(counters.chapter ?? 0);
      if (kind === "chapter") return { display: chapter, ref: chapter };
      if (kind === "section") return { display: `${chapter}.${counters.section ?? 0}`, ref: `${chapter}.${counters.section ?? 0}` };
      if (kind === "subsection") {
        const value = `${chapter}.${counters.section ?? 0}.${counters.subsection ?? 0}`;
        return { display: value, ref: value };
      }
      return null;
    }
    const section = this.appendix ? toAlpha(counters.section ?? 0, true) : String(counters.section ?? 0);
    if (kind === "section") return { display: section, ref: section };
    if (kind === "subsection") return { display: `${section}.${counters.subsection ?? 0}`, ref: `${section}.${counters.subsection ?? 0}` };
    if (kind === "subsubsection") {
      const value = `${section}.${counters.subsection ?? 0}.${counters.subsubsection ?? 0}`;
      return { display: value, ref: value };
    }
    if (kind === "part") return { display: toRoman(counters.part ?? 0, true), ref: toRoman(counters.part ?? 0, true) };
    return null;
  }

  /** Equation, figure and table numbers; within the chapter for reports. */
  private floatNumber(counter: string): string {
    const value = this.step(counter);
    if (counter === "table" && this.design().romanTables) return toRoman(value, true);
    const within = this.numberWithin[counter];
    if (within) return `${this.sectionNumber(within)?.ref ?? this.counters[within] ?? 0}.${value}`;
    if (this.layout.theme === "report" && (this.counters.chapter ?? 0) > 0) return `${this.counters.chapter}.${value}`;
    return String(value);
  }

  /** Caption and numbering conventions of the current design. */
  private design(): ThemeConventions {
    return (THEMES as Record<string, ThemeConventions>)[this.layout.theme] ?? THEMES.article;
  }

  // ── Headings and front matter ───────────────────────────────────────────

  private heading(node: CommandNode): void {
    const kind = node.name;
    const level = SECTION_LEVELS[kind];
    const titleNodes = node.args[1]?.children ?? [];
    if (this.inPreamble) return;
    if (level >= 4) {
      // \paragraph and \subparagraph are run-in heads.
      this.closePara();
      this.emitRaw(`<strong class="ltx-runin">${this.renderInline(titleNodes)}</strong>`);
      this.inline(" ");
      return;
    }
    const numberedDepth = this.layout.theme === "report" ? 2 : 3;
    let numbers: { display: string; ref: string } | null = null;
    if (!node.star && level <= numberedDepth) {
      this.step(kind);
      numbers = this.sectionNumber(kind);
    }
    const anchor = this.nextId("sec");
    const titleHtml = this.renderInline(titleNodes);
    if (numbers) {
      this.target = { text: numbers.ref, anchor, kind, title: htmlToText(titleHtml) };
    }
    const tag = level <= 0 ? "h2" : `h${Math.min(level + 1, 4)}`;
    const cls = level === -1 ? "paper-part" : level === 0 ? "paper-chapter" : `paper-h${level}`;
    const number = numbers ? `<span class="paper-secnum">${esc(numbers.display)}</span>` : "";
    this.block(`<${tag} class="paper-heading ${cls}" id="${anchor}" data-line="${this.currentLine}">${number}${titleHtml}</${tag}>`);
    this.outline.push({
      level: Math.max(level, 0),
      number: numbers?.display.replace(/[.)]$/, "") ?? "",
      title: htmlToText(titleHtml),
      line: this.currentLine,
      anchor,
    });
  }

  private renderAuthorParts(nodes: LatexNode[]): string[] {
    const parts: LatexNode[][] = [[]];
    for (const node of nodes) {
      if (node.type === "command" && (node.name === "and" || node.name === "AND")) parts.push([]);
      else parts[parts.length - 1].push(node);
    }
    return parts.map((part) => this.renderInline(part)).filter(Boolean);
  }

  private maketitle(): void {
    if (this.inPreamble) return;
    const pieces: string[] = [];
    if (this.titleNodes) pieces.push(`<h1 class="paper-title">${this.renderInline(this.titleNodes)}</h1>`);
    else this.report("warning", "\\maketitle is used but no \\title is given.");
    const authors = this.authors.flatMap((author) => author.html);
    if (authors.length) {
      pieces.push(`<div class="paper-authors">${authors.map((html) => `<div class="paper-author">${html}</div>`).join("")}</div>`);
    }
    if (this.dateNodes === undefined) {
      if (["article", "report", "book", "scrartcl", "scrreprt"].includes(this.layout.documentClass)) {
        pieces.push(`<div class="paper-date">${esc(formatToday(this.options.today))}</div>`);
      }
    } else if (this.dateNodes && significant(this.dateNodes).length) {
      pieces.push(`<div class="paper-date">${this.renderInline(this.dateNodes)}</div>`);
    }
    this.block(`<header class="paper-titleblock" data-line="${this.currentLine}">${pieces.join("")}</header>`);
    for (const html of this.stashed) this.block(html);
    this.stashed.length = 0;
    this.titleShown = true;
  }

  // ── Footnotes ───────────────────────────────────────────────────────────

  private footnoteMark(html: string, symbol: boolean, explicit = ""): string {
    let mark: string;
    if (symbol) {
      mark = FOOTNOTE_SYMBOLS[this.symbolFootnotes % FOOTNOTE_SYMBOLS.length];
      this.symbolFootnotes += 1;
    } else if (explicit.trim()) {
      mark = explicit.trim();
    } else {
      mark = String(this.step("footnote"));
    }
    const id = this.nextId("fn");
    this.footnotes.push({ id, mark, html });
    if (!symbol) this.target = { text: mark, anchor: id, kind: "footnote" };
    return `<sup class="paper-footnote-ref"><a href="#${id}" id="${id}-ref">${esc(mark)}</a></sup>`;
  }

  // ── Citations ───────────────────────────────────────────────────────────

  private noteCited(key: string): void {
    if (!this.citedKeys.includes(key)) this.citedKeys.push(key);
  }

  private cite(node: CommandNode): void {
    const name = node.name;
    const keys = this.argRaw(node, node.args.length - 1)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    if (name === "nocite") {
      for (const key of keys) {
        if (key === "*") this.nociteAll = true;
        else this.noteCited(key);
      }
      return;
    }
    for (const key of keys) this.noteCited(key);
    let pre = "";
    let post = "";
    const first = node.args[0];
    const second = node.args[1];
    if (first && second) {
      pre = this.renderInline(first.children);
      post = this.renderInline(second.children);
    } else if (first) {
      post = this.renderInline(first.children);
    }
    let mode: CiteUse["mode"] = "paren";
    if (["citet", "Citet", "textcite", "citealt"].includes(name)) mode = "text";
    else if (name === "citeauthor") mode = "author";
    else if (name === "citeyear") mode = "year";
    else if (name === "citeyearpar") mode = "yearpar";
    else if ((name === "cite" || name === "Cite") && this.natbib && !this.natbibNumbers) mode = "text";
    const index = this.cites.push({ keys, mode, pre, post, pos: this.currentPos }) - 1;
    if (name === "footcite") {
      this.emitRaw(this.footnoteMark(this.token("C", index), false));
      return;
    }
    this.emitRaw(this.token("C", index));
  }

  private citationStyle(): CitationStyle {
    if (this.options.citationStyle) return this.options.citationStyle;
    if (this.biblatexStyle) return /apa|authoryear|author-year|chicago|harvard/i.test(this.biblatexStyle) ? "apa" : "ieee";
    const style = (this.bibStyle ?? "").toLowerCase();
    if (this.natbib && this.natbibNumbers) return "ieee";
    if (/apa|apalike|plainnat|abbrvnat|unsrtnat|chicago|agsm|harvard|dcu|kluwer|harv|authoryear|named|acl|aaai/.test(style)) return "apa";
    if (!style && this.natbib) return "apa";
    return "ieee";
  }

  private lookupFile(name: string): { name: string; content: string } | null {
    const files = { ...(this.options.files ?? {}), ...this.virtualFiles };
    for (const candidate of [name, `${name}.bib`, name.replace(/^\.\//, ""), `${name.replace(/^\.\//, "")}.bib`]) {
      if (candidate in files) return { name: candidate, content: files[candidate] };
    }
    return null;
  }

  private buildBibliography(): Bibliography | null {
    const sources: { name: string; content: string }[] = [];
    for (const file of this.bibFiles) {
      const found = this.lookupFile(file);
      if (found) sources.push(found);
      else this.reportOnce(`bib:${file}`, "warning", `Bibliography file "${file}" was not found in this project.`);
    }
    if (this.options.bibliography?.trim()) sources.push({ name: "references", content: this.options.bibliography });
    if (!sources.length) return null;
    const entries: BibEntry[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      const database = parseBibtex(source.content);
      for (const problem of database.diagnostics) {
        if (this.warned.has(`bibdiag:${source.name}:${problem.line}`)) continue;
        this.warned.add(`bibdiag:${source.name}:${problem.line}`);
        this.diagnostics.push({ severity: "warning", message: `${source.name}, line ${problem.line}: ${problem.message}`, pos: 0, file: source.name });
      }
      for (const entry of database.entries) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        entries.push(entry);
      }
    }
    return buildBibliography(entries, {
      style: this.citationStyle(),
      citedKeys: this.citedKeys,
      includeAll: this.nociteAll,
      renderText: (latex) => this.renderFragment(latex),
    });
  }

  private citationHtml(use: CiteUse, bibliography: Bibliography | null): string {
    const style = this.citationStyle();
    const missing = use.keys.filter((key) =>
      this.manualBib ? !this.manualBib.has(key) : !bibliography || !(key in bibliography.labels),
    );
    for (const key of missing) {
      if (!this.warned.has(`cite:${key}`)) {
        this.warned.add(`cite:${key}`);
        this.diagnostics.push({ severity: "warning", message: `Citation "${key}" is not in the bibliography.`, pos: use.pos });
      }
    }
    let text: string;
    if (this.manualBib) {
      const labels = use.keys.map((key) => this.manualBib?.get(key) ?? "?");
      text = use.mode === "author" || use.mode === "year" ? labels.join(", ") : `[${labels.join(", ")}]`;
    } else if (!bibliography) {
      text = style === "ieee" ? use.keys.map(() => "[?]").join(", ") : `(${use.keys.join("; ")}?)`;
    } else {
      const labels = bibliography.labels;
      switch (use.mode) {
        case "author":
          text = use.keys.map((key) => labels[key]?.textAuthors ?? `${key}?`).join(", ");
          break;
        case "year":
          text = use.keys.map((key) => labels[key]?.year ?? "?").join(", ");
          break;
        case "yearpar":
          text = `(${use.keys.map((key) => labels[key]?.year ?? "?").join(", ")})`;
          break;
        case "text":
          text = style === "ieee"
            ? use.keys.map((key) => `${labels[key]?.textAuthors ?? key} ${formatCitation([key], bibliography)}`).join(", ")
            : formatCitation(use.keys, bibliography, "text");
          break;
        default:
          text = formatCitation(use.keys, bibliography, "paren");
      }
    }
    let html = esc(text);
    if (use.post) {
      const close = html.lastIndexOf(style === "apa" && !this.manualBib ? ")" : "]");
      if (close !== -1) html = `${html.slice(0, close)}, ${use.post}${html.slice(close)}`;
      else html = `${html}, ${use.post}`;
    }
    if (use.pre) {
      const open = html.indexOf(style === "apa" && !this.manualBib ? "(" : "[");
      if (open !== -1) html = `${html.slice(0, open + 1)}${use.pre} ${html.slice(open + 1)}`;
      else html = `${use.pre} ${html}`;
    }
    const first = use.keys.find((key) => !missing.includes(key));
    return first
      ? `<a class="ltx-cite" href="#${this.prefix}bib-${slug(first)}">${html}</a>`
      : `<span class="ltx-cite ltx-cite-missing">${html}</span>`;
  }

  private bibliographyHtml(bibliography: Bibliography | null, title?: string): string {
    const heading = title ?? (this.layout.theme === "report" ? "Bibliography" : "References");
    return `<section class="paper-references">${referenceListHtml(bibliography, heading, this.prefix)}</section>`;
  }

  // ── References ──────────────────────────────────────────────────────────

  private refHtml(use: RefUse, math: boolean): string {
    const target = this.labels.get(use.key);
    if (!target || !target.anchor) {
      if (!this.warned.has(`ref:${use.key}`)) {
        this.warned.add(`ref:${use.key}`);
        this.diagnostics.push({ severity: "warning", message: `Reference "${use.key}" is not defined by any \\label.`, pos: use.pos });
      }
      return math ? "??" : '<span class="ltx-ref-missing" title="Undefined reference">??</span>';
    }
    let text = this.labelText(target);
    switch (use.kind) {
      case "eqref":
        text = `(${text})`;
        break;
      case "nameref":
        text = target.title ?? text;
        break;
      case "autoref":
        text = `${this.refName(target.kind, "autoref")}\u00a0${text}`;
        break;
      case "cref":
        text = `${this.refName(target.kind, "cref")}\u00a0${target.kind === "equation" ? `(${text})` : text}`;
        break;
      case "Cref":
        text = `${this.refName(target.kind, "Cref")}\u00a0${target.kind === "equation" ? `(${text})` : text}`;
        break;
      default:
        break;
    }
    if (math) return esc(text);
    return `<a class="ltx-ref" href="#${target.anchor}">${esc(text)}</a>`;
  }

  private refName(kind: string, style: "autoref" | "cref" | "Cref"): string {
    const names: Record<string, [string, string, string]> = {
      part: ["Part", "part", "Part"],
      chapter: ["chapter", "chapter", "Chapter"],
      section: ["section", "section", "Section"],
      subsection: ["subsection", "section", "Section"],
      subsubsection: ["subsubsection", "section", "Section"],
      figure: ["Figure", "fig.", "Figure"],
      subfigure: ["Figure", "fig.", "Figure"],
      table: ["Table", "table", "Table"],
      subtable: ["Table", "table", "Table"],
      equation: ["Equation", "eq.", "Equation"],
      algorithm: ["Algorithm", "algorithm", "Algorithm"],
      listing: ["Listing", "listing", "Listing"],
      footnote: ["footnote", "footnote", "Footnote"],
      item: ["item", "item", "Item"],
    };
    const entry = names[kind];
    if (entry) return entry[style === "autoref" ? 0 : style === "cref" ? 1 : 2];
    const theorem = this.theorems.get(kind);
    if (theorem) return htmlToText(theorem.title);
    return "";
  }

  // ── Resolution ──────────────────────────────────────────────────────────

  private structuralBlock(kind: "toc" | "lof" | "lot" | "bib", title?: string): void {
    if (this.inPreamble) {
      return;
    }
    const index = this.structural.push({ kind, title }) - 1;
    this.block(this.token("S", index));
  }

  private resolve(html: string): string {
    let bibliography: Bibliography | null | undefined;
    const getBibliography = () => {
      if (bibliography === undefined) bibliography = this.manualBib ? null : this.buildBibliography();
      return bibliography;
    };
    const structuralPattern = new RegExp(`${this.nonce}S(\\d+)Z`, "g");
    let out = html.replace(structuralPattern, (_match, index: string) => {
      const entry = this.structural[Number(index)];
      if (!entry) return "";
      switch (entry.kind) {
        case "toc":
          return this.tocHtml();
        case "lof":
          return this.captionListHtml("figure", "List of Figures");
        case "lot":
          return this.captionListHtml("table", "List of Tables");
        case "bib":
          return this.bibliographyHtml(getBibliography(), entry.title);
        default:
          return "";
      }
    });
    const tokenPattern = new RegExp(`${this.nonce}([RMC])(\\d+)Z`, "g");
    out = out.replace(tokenPattern, (_match, kind: string, index: string) => {
      const at = Number(index);
      if (kind === "C") {
        const use = this.cites[at];
        return use ? this.citationHtml(use, getBibliography()) : "";
      }
      const use = this.refs[at];
      return use ? this.refHtml(use, kind === "M") : "";
    });
    return out;
  }

  private tocHtml(): string {
    const items = this.outline
      .filter((entry) => entry.level <= 3)
      .map((entry) => `<li class="paper-toc-l${entry.level}"><a href="#${entry.anchor}">${entry.number ? `<span class="paper-toc-num">${esc(entry.number)}</span>` : ""}${esc(entry.title)}</a></li>`)
      .join("");
    return `<nav class="paper-toc" aria-label="Contents"><h2 class="paper-heading paper-toc-title">Contents</h2><ol>${items}</ol></nav>`;
  }

  private captionListHtml(kind: string, title: string): string {
    const items = this.captions
      .filter((caption) => caption.kind === kind)
      .map((caption) => `<li><a href="#${caption.anchor}"><span class="paper-toc-num">${esc(caption.number)}</span>${caption.html}</a></li>`)
      .join("");
    return `<nav class="paper-toc" aria-label="${esc(title)}"><h2 class="paper-heading paper-toc-title">${esc(title)}</h2><ol>${items}</ol></nav>`;
  }

  // ── Math ────────────────────────────────────────────────────────────────

  /** Swaps \ref-style commands inside math for tokens KaTeX prints as text. */
  private prepareMath(tex: string): string {
    return tex.replace(/\\(eqref|ref|autoref|cref|Cref)\*?\s*\{([^{}]*)\}/g, (_match, kind: string, key: string) => {
      const index = this.refs.push({ key: key.trim(), kind, pos: this.currentPos }) - 1;
      const token = this.token("M", index);
      return `\\text{${token}}`;
    });
  }

  private katex(tex: string, display: boolean): string {
    const { html, error } = renderKatex(this.prepareMath(tex), display, this.katexMacros, this.macrosKey);
    if (error !== null) {
      this.report("error", `Math error: ${error.replace(/^KaTeX parse error:\s*/, "")}`);
      return `<span class="ltx-math-error" title="${esc(error)}">${esc(tex)}</span>`;
    }
    return html;
  }

  private inlineMath(tex: string): string {
    if (this.inPreamble) return "";
    return this.katex(tex, false);
  }

  private equationNumber(): string {
    if (this.subequation) {
      this.subequation.count += 1;
      return `${this.subequation.parent}${toAlpha(this.subequation.count)}`;
    }
    return this.floatNumber("equation");
  }

  private displayMath(node: MathNode): void {
    if (this.inPreamble) return;
    const env = node.env;
    const base = env ? env.replace(/\*$/, "") : null;
    const starred = env === null || env.endsWith("*") || env === "displaymath";
    const anchor = this.nextId("eq");
    let tex: string;

    if (base === null || base === "displaymath" || base === "equation" || base === "dmath") {
      const info = mathRowInfo(node.content);
      tex = info.tex;
      let number: string | null = info.tag;
      if (!starred && !info.notag && !info.tag) {
        number = this.equationNumber();
        tex = `${tex} \\tag{${number}}`;
      }
      for (const label of info.labels) {
        this.target = { text: number ?? "", anchor, kind: "equation" };
        this.setLabel(label);
      }
    } else {
      const { rows, separators } = splitMathRows(node.content);
      const multline = base === "multline";
      const out: string[] = [];
      rows.forEach((row, index) => {
        const info = mathRowInfo(base === "eqnarray" ? row.replace(/&([^&]*)&/, "&$1") : row);
        let rowTex = info.tex;
        const blank = !rowTex.trim();
        let number: string | null = info.tag;
        const isLast = index === rows.length - 1 || rows.slice(index + 1).every((next) => !next.trim());
        const wantsNumber = !starred && !info.notag && !info.tag && !blank && (!multline || isLast);
        if (wantsNumber) {
          number = this.equationNumber();
          rowTex = `${rowTex} \\tag{${number}}`;
        }
        for (const label of info.labels) {
          this.target = { text: number ?? "", anchor, kind: "equation" };
          this.setLabel(label);
        }
        out.push(rowTex + (separators[index] ?? ""));
      });
      const katexEnv = base === "gather" || base === "multline" ? "gather*" : base === "alignat" ? "alignat*" : "align*";
      const arg = base === "alignat" && node.envArg ? `{${node.envArg}}` : "";
      tex = `\\begin{${katexEnv}}${arg}${out.join("")}\\end{${katexEnv}}`;
    }

    const html = this.katex(tex, true);
    this.block(`<div class="paper-equation" id="${anchor}" data-line="${this.currentLine}">${html}</div>`);
    this.sink.noIndentNext = true;
  }

  // ── Environments ────────────────────────────────────────────────────────

  private environment(node: EnvironmentNode): void {
    const name = node.name;
    if (this.inPreamble) {
      if (name === "abstract") this.stashed.push(this.abstract(node));
      if (name === "filecontents" || name === "filecontents*") this.virtualFiles[this.argRaw(node, 1).trim()] = node.raw ?? "";
      return;
    }
    switch (name) {
      case "document":
      case "titlepage":
      case "landscape":
      case "spacing":
      case "singlespace":
      case "onehalfspace":
      case "doublespace":
      case "adjustbox":
      case "frontmatter":
      case "mainmatter":
        this.renderNodes(node.children);
        return;
      case "appendices":
        this.appendix = true;
        this.counters.section = 0;
        this.renderNodes(node.children);
        return;
      case "abstract": {
        const html = this.abstract(node);
        if (this.titleAfterFrontMatter() && !this.titleShown) this.stashed.push(html);
        else this.block(html);
        return;
      }
      case "IEEEkeywords": {
        const body = this.withBlockSink(() => {
          this.emitRaw('<span class="paper-keywords-label">Index Terms—</span>');
          this.renderNodes(node.children);
        }, "p", "paper-keywords");
        this.block(body);
        return;
      }
      case "acknowledgments":
      case "acknowledgements":
      case "acks": {
        this.block(`<h2 class="paper-heading paper-h1" data-line="${this.currentLine}">Acknowledgments</h2>`);
        this.renderNodes(node.children);
        return;
      }
      case "itemize":
      case "enumerate":
      case "description":
        this.list(node, name);
        return;
      case "quote":
      case "quotation":
      case "verse":
        this.block(`<blockquote class="ltx-quote" data-line="${this.currentLine}">${this.withBlockSink(() => this.renderNodes(node.children))}</blockquote>`);
        this.sink.noIndentNext = true;
        return;
      case "center":
      case "flushleft":
      case "flushright": {
        const align = name === "center" ? "center" : name === "flushleft" ? "left" : "right";
        const body = this.withBlockSink(() => {
          this.style = { ...this.style, align };
          this.renderNodes(node.children);
        });
        this.block(`<div class="ltx-${name}">${body}</div>`);
        this.sink.noIndentNext = true;
        return;
      }
      case "figure":
      case "figure*":
      case "wrapfigure":
        this.float(node, "figure");
        return;
      case "table":
      case "table*":
      case "wraptable":
        this.float(node, "table");
        return;
      case "algorithm":
      case "algorithm*":
        this.float(node, "algorithm");
        return;
      case "subfigure":
      case "subtable":
        this.subfigure(node, name);
        return;
      case "tabular":
      case "tabular*":
      case "tabularx":
      case "tabulary":
      case "longtable":
      case "array":
        this.tabular(node);
        return;
      case "ruledtabular": {
        // REVTeX: a table framed by double rules at top and bottom.
        this.block(`<div class="ltx-ruledtabular">${this.withBlockSink(() => this.renderNodes(node.children), "div")}</div>`);
        return;
      }
      case "minipage": {
        const width = cssLength(this.argRaw(node, 3)) ?? "100%";
        const body = this.withBlockSink(() => this.renderNodes(node.children));
        this.block(`<div class="ltx-minipage" style="width:${width}">${body}</div>`);
        return;
      }
      case "multicols":
      case "multicols*": {
        const count = Math.min(Math.max(Number.parseInt(this.argRaw(node, 0), 10) || 2, 1), 4);
        this.block(`<div class="ltx-multicols" style="column-count:${count}">${this.withBlockSink(() => this.renderNodes(node.children))}</div>`);
        return;
      }
      case "proof":
        this.proof(node);
        return;
      case "thebibliography":
        this.thebibliography(node);
        return;
      case "algorithmic":
        this.algorithmic(node);
        return;
      case "verbatim":
      case "verbatim*":
      case "Verbatim":
      case "lstlisting":
      case "minted":
        this.verbatim(node);
        return;
      case "filecontents":
      case "filecontents*":
        this.virtualFiles[this.argRaw(node, 1).trim()] = node.raw ?? "";
        return;
      case "tikzpicture":
      case "tikzcd":
      case "pgfpicture":
      case "forest":
      case "circuitikz":
        this.reportOnce(`env:${name}`, "info", `${name} drawings are not drawn in the preview; they still compile with LaTeX.`);
        this.block(`<div class="ltx-unsupported" data-line="${this.currentLine}">${esc(name)} drawing — not shown in the preview</div>`);
        return;
      case "subequations": {
        const parent = this.floatNumber("equation");
        const anchor = this.nextId("eq");
        const saved = this.subequation;
        this.subequation = { parent, count: 0 };
        this.target = { text: parent, anchor, kind: "equation" };
        this.block(`<span id="${anchor}"></span>`);
        this.renderNodes(node.children);
        this.subequation = saved;
        return;
      }
      default:
        break;
    }

    if (name in FONT_SIZES) {
      const saved = this.style;
      this.style = { ...this.style, size: FONT_SIZES[name] === 1 ? null : FONT_SIZES[name] };
      this.renderNodes(node.children);
      this.style = saved;
      return;
    }

    const theorem = this.theoremFor(name);
    if (theorem) {
      this.theorem(node, theorem);
      return;
    }

    this.reportOnce(`env:${name}`, "warning", `Unknown environment "${name}" — its content is shown without formatting.`);
    this.block(`<div class="ltx-env" data-line="${this.currentLine}">${this.withBlockSink(() => this.renderNodes(node.children))}</div>`);
  }

  private abstract(node: EnvironmentNode): string {
    const nameMacro = this.macros.get("abstractname");
    const title = nameMacro ? this.renderFragment(nameMacro.body) : "Abstract";
    if (this.layout.theme === "ieee") {
      const body = this.withBlockSink(() => {
        this.emitRaw(`<span class="paper-abstract-inline">${title}—</span>`);
        this.renderNodes(node.children);
      });
      return `<section class="paper-abstract paper-abstract--runin" data-line="${this.currentLine}">${body}</section>`;
    }
    const body = this.withBlockSink(() => this.renderNodes(node.children));
    return `<section class="paper-abstract" data-line="${this.currentLine}"><h2 class="paper-abstract-title">${title}</h2>${body}</section>`;
  }

  private list(node: EnvironmentNode, kind: "itemize" | "enumerate" | "description"): void {
    const items: { label: Argument | null; nodes: LatexNode[] }[] = [];
    for (const child of node.children) {
      if (child.type === "command" && child.name === "item") {
        items.push({ label: child.args[0] ?? null, nodes: [] });
      } else if (items.length) {
        items[items.length - 1].nodes.push(child);
      } else if (!isBlank(child)) {
        this.reportOnce(`list-text:${node.start}`, "warning", `Text before the first \\item in ${kind}.`);
      }
    }

    const options = this.argRaw(node, 0);
    const keyValues = options.includes("=") ? parseKeyValues(options) : {};
    let counter = Math.max(0, (Number.parseInt(keyValues.start ?? "1", 10) || 1) - 1);
    const depth = kind === "enumerate" ? ++this.enumDepth : kind === "itemize" ? ++this.itemDepth : 0;
    const parentRef = this.enumRefs[this.enumRefs.length - 1] ?? "";

    const html = items.map((item) => {
      const id = this.nextId("item");
      let labelHtml = "";
      if (item.label) {
        labelHtml = this.renderInline(item.label.children);
      } else if (kind === "enumerate") {
        counter += 1;
        const formatted = this.enumLabel(counter, depth, options, keyValues);
        labelHtml = formatted.html;
        this.target = { text: `${depth > 1 ? parentRef : ""}${formatted.ref}`, anchor: id, kind: "item" };
        this.enumRefs.push(this.target.text);
      } else if (kind === "itemize") {
        labelHtml = keyValues.label ? this.renderFragment(keyValues.label) : ["•", "–", "∗", "·"][(depth - 1) % 4];
      }
      if (kind === "description") {
        const body = this.withBlockSink(() => {
          this.emitRaw(`<span class="ltx-desc-label">${labelHtml}</span> `);
          this.renderNodes(item.nodes);
        });
        return `<div class="ltx-desc-item" id="${id}">${body}</div>`;
      }
      const body = this.withBlockSink(() => this.renderNodes(item.nodes));
      if (kind === "enumerate" && !item.label) this.enumRefs.pop();
      return `<li class="ltx-item" id="${id}"><span class="ltx-item-label">${labelHtml}</span><div class="ltx-item-body">${body}</div></li>`;
    });

    if (kind === "enumerate") this.enumDepth -= 1;
    if (kind === "itemize") this.itemDepth -= 1;
    const line = this.position(node.start).line;
    if (kind === "description") this.block(`<div class="ltx-description" data-line="${line}">${html.join("")}</div>`);
    else this.block(`<${kind === "enumerate" ? "ol" : "ul"} class="ltx-list ltx-${kind}" data-line="${line}">${html.join("")}</${kind === "enumerate" ? "ol" : "ul"}>`);
    this.sink.noIndentNext = true;
  }

  private enumLabel(value: number, depth: number, options: string, keyValues: Record<string, string>): { html: string; ref: string } {
    const formats: Record<string, (n: number) => string> = {
      arabic: (n) => String(n),
      alph: (n) => toAlpha(n),
      Alph: (n) => toAlpha(n, true),
      roman: (n) => toRoman(n),
      Roman: (n) => toRoman(n, true),
    };
    if (keyValues.label) {
      const template = keyValues.label;
      const kind = /\\(arabic|alph|Alph|roman|Roman)\*/.exec(template)?.[1] ?? "arabic";
      const ref = formats[kind](value);
      const html = this.renderFragment(template.replace(/\\(arabic|alph|Alph|roman|Roman)\*/g, (_match, format: string) => formats[format](value)));
      return { html, ref };
    }
    if (options.trim() && !options.includes("=")) {
      // enumerate package style: [(a)], [i.], [A)]; the first 1/a/A/i/I is the counter.
      const match = /[1aAiI]/.exec(options);
      if (match) {
        const kind = { "1": "arabic", a: "alph", A: "Alph", i: "roman", I: "Roman" }[match[0]] ?? "arabic";
        const ref = formats[kind](value);
        return { html: esc(`${options.slice(0, match.index)}${ref}${options.slice(match.index + 1)}`), ref };
      }
    }
    switch ((depth - 1) % 4) {
      case 1:
        return { html: `(${toAlpha(value)})`, ref: toAlpha(value) };
      case 2:
        return { html: `${toRoman(value)}.`, ref: toRoman(value) };
      case 3:
        return { html: `${toAlpha(value, true)}.`, ref: toAlpha(value, true) };
      default:
        return { html: `${value}.`, ref: String(value) };
    }
  }

  // ── Floats ──────────────────────────────────────────────────────────────

  private float(node: EnvironmentNode, kind: "figure" | "table" | "algorithm"): void {
    const context: FloatContext = { kind, anchor: null, number: null, parent: null, subCount: 0 };
    this.floats.push(context);
    const body = this.withBlockSink(() => this.renderNodes(node.children), "div", "ltx-float-row");
    this.floats.pop();
    const id = context.anchor ?? this.nextId(kind);
    const wide = node.name.endsWith("*") ? " paper-float-wide" : "";
    const cls = kind === "table" ? "paper-table-figure" : kind === "algorithm" ? "paper-algorithm" : "paper-figure";
    this.block(`<figure class="${cls}${wide}" id="${id}" data-line="${this.position(node.start).line}">${body}</figure>`);
  }

  private subfigure(node: EnvironmentNode, name: string): void {
    const parent = this.floats[this.floats.length - 1] ?? null;
    const context: FloatContext = { kind: name === "subtable" ? "subtable" : "subfigure", anchor: null, number: null, parent, subCount: 0 };
    this.floats.push(context);
    const body = this.withBlockSink(() => this.renderNodes(node.children), "div", "ltx-float-row");
    this.floats.pop();
    const width = cssLength(this.argRaw(node, 1)) ?? "45%";
    this.block(`<div class="ltx-subfigure" id="${context.anchor ?? this.nextId("sub")}" style="width:${width}">${body}</div>`);
  }

  private subfloat(node: CommandNode): void {
    const parent = this.floats[this.floats.length - 1] ?? null;
    const context: FloatContext = { kind: "subfigure", anchor: null, number: null, parent, subCount: 0 };
    this.floats.push(context);
    const body = this.withBlockSink(() => {
      this.renderNodes(this.argNodes(node, 1));
      if (node.args[0]) this.caption(node.args[0].children);
    }, "div", "ltx-float-row");
    this.floats.pop();
    this.emitRaw(`<span class="ltx-subfigure" id="${context.anchor ?? this.nextId("sub")}">${body}</span>`);
  }

  private caption(nodes: LatexNode[], explicit?: "figure" | "table"): void {
    const context = this.floats[this.floats.length - 1];
    const kind = explicit ?? context?.kind;
    if (!kind) {
      this.reportOnce("caption-outside", "warning", "\\caption is used outside a figure or table.");
      this.renderNodes(nodes);
      return;
    }
    const anchor = this.nextId(kind);
    let label: string;
    let number: string;
    if (kind === "subfigure" || kind === "subtable") {
      const parent = context?.parent ?? null;
      if (parent) parent.subCount += 1;
      number = toAlpha(parent ? parent.subCount : 1);
      label = `(${number})`;
      this.target = { text: number, anchor, kind, parent: parent ?? undefined };
    } else {
      number = this.floatNumber(kind);
      const design = this.design();
      label =
        kind === "figure"
          ? design.figureLabel(number)
          : kind === "table"
            ? design.tableLabel(number)
            : kind === "algorithm"
              ? `Algorithm ${number}`
              : `Listing ${number}:`;
      this.target = { text: number, anchor, kind };
    }
    if (context && !explicit) {
      context.anchor = anchor;
      context.number = number;
    }
    const html = this.renderInline(nodes);
    if (kind === "figure" || kind === "table") this.captions.push({ kind, number, html, anchor });
    this.block(`<figcaption class="paper-caption" id="${explicit || !context ? anchor : `${anchor}-caption`}"><span class="paper-caption-label">${esc(label)}</span> ${html}</figcaption>`);
  }

  private includeGraphics(node: CommandNode): void {
    const options = parseKeyValues(this.argRaw(node, 0));
    const path = this.argRaw(node, 1).trim();
    const url = this.resolveAsset(path);
    const css: string[] = [];
    const width = options.width ? cssLength(options.width) : null;
    const height = options.height ? cssLength(options.height, "height") : null;
    if (width) css.push(`width:${width}`);
    if (height) css.push(`height:${height}`);
    if (options.scale && !width) {
      const scale = Number.parseFloat(options.scale);
      if (Number.isFinite(scale) && scale > 0) css.push(`width:${round(Math.min(scale, 1) * 100)}%`);
    }
    const style = css.length ? ` style="${css.join(";")}"` : "";
    if (url) {
      this.emitRaw(`<img class="ltx-graphic" src="${esc(url)}" alt="${esc(path)}"${style}>`);
      return;
    }
    const isPdf = /\.(pdf|eps|ps)$/i.test(path);
    this.reportOnce(
      `img:${path}`,
      "warning",
      isPdf
        ? `"${path}" is a PDF/EPS figure, which browsers cannot preview. Upload a PNG or JPG with the same name to see it here.`
        : `Image "${path}" was not found. Upload it in the project files.`,
    );
    this.emitRaw(`<span class="ltx-missing-graphic"${style}>${esc(path || "image")}</span>`);
  }

  private resolveAsset(path: string): string | null {
    const assets = this.options.assets ?? {};
    const clean = path.replace(/^\.\//, "");
    const names = Object.keys(assets);
    const stem = clean.replace(/\.[A-Za-z0-9]+$/, "");
    const candidates = [clean, ...IMAGE_EXTENSIONS.map((ext) => `${stem}${ext}`)];
    const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
    for (const candidate of candidates) {
      const found = assets[candidate] !== undefined ? candidate : lower.get(candidate.toLowerCase());
      if (found !== undefined) {
        const url = assets[found];
        if (/^(data:image\/|blob:)/.test(url)) return url;
      }
    }
    // Same file name in another folder (figures/plot.png vs plot.png).
    const base = stem.split("/").pop()?.toLowerCase();
    for (const name of names) {
      const nameStem = name.replace(/\.[A-Za-z0-9]+$/, "").split("/").pop()?.toLowerCase();
      if (base && nameStem === base && /^(data:image\/|blob:)/.test(assets[name])) return assets[name];
    }
    return null;
  }

  // ── Tables ──────────────────────────────────────────────────────────────

  private tabular(node: EnvironmentNode): void {
    const specIndex = node.name === "tabular*" || node.name === "tabularx" || node.name === "tabulary" ? 2 : 1;
    const layout = parseColumnSpec(this.argRaw(node, specIndex));
    const rows = splitTableRows(node.children);
    const columnCount = Math.max(layout.columns.length, ...rows.map((row) => row.cells.length));
    const covered = new Array<number>(columnCount).fill(0);
    const rowHtml: string[] = [];

    rows.forEach((row, rowIndex) => {
      const classes: string[] = [];
      const clines: { from: number; to: number }[] = [];
      const ruleClasses = (rules: Rule[], where: "above" | "below") => {
        const plain = rules.filter((rule) => rule.kind === "hline").length;
        if (plain >= 2) classes.push(`ltx-rule-${where}-double`);
        else if (plain === 1 || rules.some((rule) => rule.kind === "mid")) classes.push(`ltx-rule-${where}`);
        if (rules.some((rule) => rule.kind === "thick")) classes.push(`ltx-rule-${where}-thick`);
        if (rules.some((rule) => rule.kind === "space") && where === "above") classes.push("ltx-row-space");
      };
      ruleClasses(row.above, "above");
      ruleClasses(row.below, "below");
      for (const rule of row.above) if (rule.kind === "cline") clines.push(rule);
      if (rowIndex === rows.length - 1 && row.cells.every((cell) => significant(cell).length === 0)) {
        return;
      }

      const cells: string[] = [];
      let column = 0;
      for (const cell of row.cells) {
        let content = cell;
        let span = 1;
        let rowspan = 1;
        let spec = layout.columns[column] ?? { align: "l" as const, width: null, bold: false, italic: false };
        let leftBorder = column === 0 ? layout.borders[0] ?? 0 : 0;
        let rightBorder = layout.borders[column + 1] ?? 0;
        const parts = significant(content);
        const first = parts[0];
        if (parts.length === 1 && first.type === "command" && first.name === "multicolumn") {
          span = Math.max(1, Math.min(Number.parseInt(this.argRaw(first, 0), 10) || 1, columnCount - column || 1));
          const own = parseColumnSpec(this.argRaw(first, 1));
          spec = own.columns[0] ?? spec;
          leftBorder = column === 0 ? own.borders[0] ?? 0 : 0;
          rightBorder = own.borders[1] ?? 0;
          content = first.args[2]?.children ?? [];
        }
        if (covered[column] > 0) {
          // This source cell sits under a \multirow from a row above.
          for (let c = column; c < column + span; c++) covered[c] = Math.max(0, covered[c] - 1);
          column += span;
          continue;
        }
        const inner = significant(content);
        if (inner.length === 1 && inner[0].type === "command" && inner[0].name === "multirow") {
          const multirow = inner[0];
          rowspan = Math.max(1, Math.min(Math.abs(Number.parseInt(this.argRaw(multirow, 0), 10) || 1), rows.length - rowIndex));
          content = multirow.args[4]?.children ?? [];
          for (let c = column; c < column + span; c++) covered[c] = rowspan - 1;
        }
        const cellClasses = [`ltx-al-${spec.align}`];
        if (leftBorder) cellClasses.push(leftBorder > 1 ? "ltx-vl-double" : "ltx-vl");
        if (rightBorder) cellClasses.push(rightBorder > 1 ? "ltx-vr-double" : "ltx-vr");
        if (clines.some((rule) => rule.from - 1 <= column && column < rule.to)) cellClasses.push("ltx-cline-above");
        const attrs = [
          `class="${cellClasses.join(" ")}"`,
          span > 1 ? `colspan="${span}"` : "",
          rowspan > 1 ? `rowspan="${rowspan}"` : "",
          spec.width ? `style="width:${spec.width}"` : "",
        ].filter(Boolean);
        const change: Partial<Style> = {};
        if (spec.bold) change.weight = "bold";
        if (spec.italic) change.shape = "italic";
        let html = "";
        this.withStyle(change, () => {
          html = this.renderInline(content);
        });
        cells.push(`<td ${attrs.join(" ")}>${html}</td>`);
        column += span;
      }
      for (let c = column; c < columnCount; c++) if (covered[c] > 0) covered[c] -= 1;
      rowHtml.push(`<tr${classes.length ? ` class="${classes.join(" ")}"` : ""}>${cells.join("")}</tr>`);
    });

    const full = /tabularx|tabular\*/.test(node.name) ? " ltx-tabular--full" : "";
    this.block(`<div class="ltx-tabular-wrap" data-line="${this.position(node.start).line}"><table class="ltx-tabular${full}"><tbody>${rowHtml.join("")}</tbody></table></div>`);
  }

  // ── Theorems and proofs ─────────────────────────────────────────────────

  private defineTheorem(node: CommandNode): void {
    const name = this.argRaw(node, 0).trim();
    if (!name) return;
    const shared = node.args[1]?.raw.trim() || null;
    const within = node.args[3]?.raw.trim() || null;
    const title = this.renderInline(node.args[2]?.children ?? []);
    const sharedDef = shared ? this.theorems.get(shared) : undefined;
    const counter = shared ?? name;
    if (within) {
      this.counterChildren[within] = [...(this.counterChildren[within] ?? []), counter];
    }
    this.theorems.set(name, {
      title,
      counter,
      within: sharedDef ? sharedDef.within : within,
      numbered: !node.star,
      style: this.theoremStyle,
    });
  }

  private theoremFor(name: string): TheoremDef | null {
    const known = this.theorems.get(name);
    if (known) return known;
    const base = name.replace(/\*$/, "");
    if (base in IMPLICIT_THEOREMS) {
      this.reportOnce(`thm:${name}`, "info", `Environment "${name}" is not declared with \\newtheorem; the preview numbers it on its own.`);
      const def: TheoremDef = {
        title: IMPLICIT_THEOREMS[base],
        counter: base,
        within: null,
        numbered: !name.endsWith("*"),
        style: ["definition", "example", "remark", "note", "assumption", "hypothesis", "observation"].includes(base) ? "definition" : "plain",
      };
      this.theorems.set(name, def);
      return def;
    }
    return null;
  }

  private theorem(node: EnvironmentNode, def: TheoremDef): void {
    const anchor = this.nextId("thm");
    let number = "";
    if (def.numbered) {
      number = `${this.withinPrefix(def.within)}${this.step(def.counter)}`;
      this.target = { text: number, anchor, kind: node.name };
    }
    const note = node.args[0] ? ` (${this.renderInline(node.args[0].children)})` : "";
    const head = `<span class="ltx-theorem-head">${def.title}${number ? ` ${esc(number)}` : ""}${note}.</span> `;
    const body = this.withBlockSink(() => {
      this.emitRaw(head);
      if (def.style === "plain") this.style = { ...this.style, shape: "italic" };
      this.renderNodes(node.children);
    });
    this.block(`<div class="ltx-theorem ltx-theorem--${def.style}" id="${anchor}" data-line="${this.position(node.start).line}">${body}</div>`);
  }

  private proof(node: EnvironmentNode): void {
    const title = node.args[0] ? this.renderInline(node.args[0].children) : "Proof";
    const body = this.withBlockSink(() => {
      this.emitRaw(`<span class="ltx-proof-head">${title}.</span> `);
      this.renderNodes(node.children);
      this.emitRaw('<span class="ltx-qed" aria-label="End of proof">∎</span>');
    });
    this.block(`<div class="ltx-proof" data-line="${this.position(node.start).line}">${body}</div>`);
  }

  // ── Bibliography environment ────────────────────────────────────────────

  private thebibliography(node: EnvironmentNode): void {
    const items: { label: string | null; key: string; nodes: LatexNode[] }[] = [];
    for (const child of node.children) {
      if (child.type === "command" && child.name === "bibitem") {
        items.push({ label: child.args[0]?.raw.trim() || null, key: this.argRaw(child, 1).trim(), nodes: [] });
      } else if (items.length) items[items.length - 1].nodes.push(child);
    }
    this.manualBib = this.manualBib ?? new Map();
    const html = items.map((item, index) => {
      const label = item.label ?? String(index + 1);
      this.manualBib?.set(item.key, label);
      const body = this.withBlockSink(() => this.renderNodes(item.nodes), "div", "paper-ref-body");
      return `<li class="paper-ref" id="${this.prefix}bib-${slug(item.key)}"><span class="paper-ref-label">[${esc(label)}]</span>${body}</li>`;
    });
    const title = this.layout.theme === "report" ? "Bibliography" : "References";
    this.block(`<section class="paper-references" data-line="${this.position(node.start).line}"><h2 class="paper-heading paper-references-title">${title}</h2><ol class="paper-reflist paper-reflist--ieee">${html.join("")}</ol></section>`);
  }

  // ── Algorithms and code ─────────────────────────────────────────────────

  private algorithmic(node: EnvironmentNode): void {
    const numbered = (Number.parseInt(this.argRaw(node, 0), 10) || 0) > 0;
    const lines: { indent: number; html: string; numbered: boolean }[] = [];
    let indent = 0;
    let current: { prefix: string; nodes: LatexNode[]; suffix: string; indent: number; numbered: boolean } | null = null;
    const keyword = (text: string) => `<strong class="ltx-alg-kw">${text}</strong>`;
    const flush = () => {
      if (current) {
        const html = `${current.prefix}${this.renderInline(current.nodes)}${current.suffix}`;
        if (trimSpaces(html)) lines.push({ indent: current.indent, html, numbered: current.numbered });
      }
      current = null;
    };
    const start = (prefix: string, line = true, suffix = "") => {
      flush();
      current = { prefix, nodes: [], suffix, indent, numbered: line };
    };
    const arg = (child: CommandNode, index = 0) => this.renderInline(child.args[index]?.children ?? []);
    for (const child of node.children) {
      if (child.type === "command" && ALGORITHM_COMMANDS.has(child.name)) {
        const name = normalizeAlgorithmic(child.name);
        switch (name) {
          case "State":
            start("");
            break;
          case "Statex":
            start("", false);
            break;
          case "If":
            start(`${keyword("if")} ${arg(child)} ${keyword("then")}`);
            indent++;
            break;
          case "ElsIf":
            indent = Math.max(0, indent - 1);
            start(`${keyword("else if")} ${arg(child)} ${keyword("then")}`);
            indent++;
            break;
          case "Else":
            indent = Math.max(0, indent - 1);
            start(keyword("else"));
            indent++;
            break;
          case "For":
            start(`${keyword("for")} ${arg(child)} ${keyword("do")}`);
            indent++;
            break;
          case "ForAll":
            start(`${keyword("for all")} ${arg(child)} ${keyword("do")}`);
            indent++;
            break;
          case "While":
            start(`${keyword("while")} ${arg(child)} ${keyword("do")}`);
            indent++;
            break;
          case "Repeat":
            start(keyword("repeat"));
            indent++;
            break;
          case "Loop":
            start(keyword("loop"));
            indent++;
            break;
          case "Until":
            indent = Math.max(0, indent - 1);
            start(`${keyword("until")} ${arg(child)}`);
            break;
          case "Function":
          case "Procedure":
            start(`${keyword(name.toLowerCase())} <span class="ltx-sc">${arg(child)}</span>(${arg(child, 1)})`);
            indent++;
            break;
          case "EndIf":
          case "EndFor":
          case "EndWhile":
          case "EndLoop":
          case "EndFunction":
          case "EndProcedure":
            indent = Math.max(0, indent - 1);
            start(keyword(`end ${name.slice(3).toLowerCase()}`));
            break;
          case "Return":
            start(`${keyword("return")} `);
            break;
          case "Require":
            start(`${keyword("Require:")} `, false);
            break;
          case "Ensure":
            start(`${keyword("Ensure:")} `, false);
            break;
          default:
            break;
        }
        continue;
      }
      if (!current) {
        if (isBlank(child)) continue;
        start("", false);
      }
      (current as { nodes: LatexNode[] } | null)?.nodes.push(child);
    }
    flush();
    let number = 0;
    const html = lines
      .map((line) => {
        const label = numbered && line.numbered ? `<span class="ltx-alg-num">${++number}:</span>` : "";
        return `<div class="ltx-alg-line" style="padding-left:${round(line.indent * 1.5 + (numbered ? 2 : 0))}em">${label}${line.html}</div>`;
      })
      .join("");
    this.block(`<div class="ltx-algorithmic" data-line="${this.position(node.start).line}">${html}</div>`);
  }

  private verbatim(node: EnvironmentNode): void {
    const code = (node.raw ?? "").replace(/^[ \t]*\n/, "").replace(/\n[ \t]*$/, "");
    let caption = "";
    if (node.name === "lstlisting") {
      const options = parseKeyValues(this.argRaw(node, 0));
      if (options.caption) {
        const number = this.floatNumber("listing");
        const anchor = this.nextId("listing");
        this.target = { text: number, anchor, kind: "listing" };
        if (options.label) this.setLabel(options.label);
        caption = `<figcaption class="paper-caption" id="${anchor}"><span class="paper-caption-label">Listing ${esc(number)}:</span> ${this.renderFragment(options.caption)}</figcaption>`;
      }
    }
    const pre = `<pre class="ltx-verbatim"><code>${esc(code)}</code></pre>`;
    this.block(caption ? `<figure class="paper-listing" data-line="${this.position(node.start).line}">${caption}${pre}</figure>` : pre);
  }

  private lipsum(range: string): void {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(range.trim());
    const from = match ? Number(match[1]) : 1;
    const to = match ? Number(match[2] ?? match[1]) : 3;
    for (let index = from; index <= Math.min(to, from + 20); index++) {
      this.parbreak();
      this.inline(this.textHtml(LIPSUM[(index - 1) % LIPSUM.length]));
      this.parbreak();
    }
  }

  // ── Colours ─────────────────────────────────────────────────────────────

  private parseColor(model: string | null, spec: string): string | null {
    if (model) {
      const numbers = spec.split(",").map((part) => Number.parseFloat(part));
      switch (model) {
        case "HTML":
          return /^[0-9a-fA-F]{6}$/.test(spec) ? `#${spec.toLowerCase()}` : null;
        case "rgb":
          return numbers.length === 3 && numbers.every((n) => n >= 0 && n <= 1) ? `#${numbers.map((n) => hex(n * 255)).join("")}` : null;
        case "RGB":
          return numbers.length === 3 && numbers.every((n) => n >= 0 && n <= 255) ? `#${numbers.map((n) => hex(n)).join("")}` : null;
        case "gray":
          return numbers.length === 1 && numbers[0] >= 0 && numbers[0] <= 1 ? `#${hex(numbers[0] * 255).repeat(3)}` : null;
        case "cmyk": {
          if (numbers.length !== 4) return null;
          const [c, m, y, k] = numbers;
          return `#${[c, m, y].map((n) => hex(255 * (1 - n) * (1 - k))).join("")}`;
        }
        default:
          return null;
      }
    }
    // xcolor expressions: red, red!40, red!40!blue.
    const parts = spec.split("!").map((part) => part.trim());
    const named = (name: string) => this.colors[name] ?? NAMED_COLORS[name] ?? null;
    let color = named(parts[0]);
    if (!color) {
      this.reportOnce(`color:${parts[0]}`, "warning", `Unknown colour "${parts[0]}".`);
      return null;
    }
    for (let i = 1; i < parts.length; i += 2) {
      const percent = Number.parseFloat(parts[i]);
      const other = parts[i + 1] ? named(parts[i + 1]) : "#ffffff";
      if (!Number.isFinite(percent) || !other) break;
      color = mixColors(color, other, Math.min(Math.max(percent, 0), 100) / 100);
    }
    return color;
  }
}

/** Heading and list of a formatted bibliography; shared with the visual editor. */
export function referenceListHtml(bibliography: Bibliography | null, heading: string, idPrefix: string): string {
  const title = `<h2 class="paper-heading paper-references-title">${esc(heading)}</h2>`;
  if (!bibliography || !bibliography.items.length) {
    return `${title}<p class="paper-references-empty">No cited references yet.</p>`;
  }
  const items = bibliography.items
    .map((item) => `<li class="paper-ref" id="${idPrefix}bib-${slug(item.key)}">${item.label ? `<span class="paper-ref-label">${esc(item.label)}</span>` : ""}<span class="paper-ref-body">${item.html}</span></li>`)
    .join("");
  return `${title}<ol class="paper-reflist paper-reflist--${bibliography.style}">${items}</ol>`;
}

/** KaTeX through the shared cache, for math outside a full document render. */
export function renderMath(tex: string, display: boolean, macros: Record<string, string> = {}): { html: string; error: string | null } {
  return renderKatex(tex, display, macros, Object.keys(macros).length ? JSON.stringify(Object.entries(macros).sort()) : "");
}

function mixColors(a: string, b: string, weight: number): string {
  const channel = (color: string, index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2].map((index) => hex(channel(a, index) * weight + channel(b, index) * (1 - weight))).join("")}`;
}

function normalizeAlgorithmic(name: string): string {
  const map: Record<string, string> = {
    STATE: "State",
    IF: "If",
    ELSIF: "ElsIf",
    ELSE: "Else",
    ENDIF: "EndIf",
    FOR: "For",
    FORALL: "ForAll",
    ENDFOR: "EndFor",
    WHILE: "While",
    ENDWHILE: "EndWhile",
    REPEAT: "Repeat",
    UNTIL: "Until",
    LOOP: "Loop",
    ENDLOOP: "EndLoop",
    RETURN: "Return",
    REQUIRE: "Require",
    ENSURE: "Ensure",
  };
  return map[name] ?? name;
}

/** Renders a LaTeX document or fragment to HTML for the paper preview. */
export function renderLatex(source: string, options: RenderOptions = {}): RenderResult {
  return new LatexRenderer(source, options).render();
}
