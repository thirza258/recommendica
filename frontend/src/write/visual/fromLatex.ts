/**
 * LaTeX source → visual editor JSON.
 *
 * This is the counterpart of toLatex.ts and exists so one paper can move
 * between the visual and LaTeX editors without becoming two documents. It maps
 * the constructs the visual schema understands (headings, paragraphs, lists,
 * equations, citations, cross-references, figures, tables, …) and keeps
 * everything else as a raw LaTeX block, which the visual editor previews and
 * the LaTeX exporter passes through unchanged.
 *
 * The parser is deliberately tolerant, so this importer never rejects a paper
 * being typed: unsupported constructs become raw blocks and warnings, not
 * errors.
 */

import type { JSONContent } from "@tiptap/core";
import type { PaperSettings } from "../documents.ts";
import { DEFAULT_SETTINGS, normalizeSettings, plainText } from "../documents.ts";
import { parseLatex, nodesToText } from "../latex/parser.ts";
import type { Argument, CommandNode, EnvironmentNode, LatexNode } from "../latex/parser.ts";
import { ACCENTS, CONTROL_SYMBOLS, TEXT_SYMBOLS, applyAccent, formatToday, resolveColor } from "../latex/symbols.ts";
import { importPreamble, scanPreamble } from "../latexPreamble.ts";
import type { ImportedPreamble, PreambleStatement } from "../latexPreamble.ts";

export interface LatexImportOptions {
  /** Other project files, used for images and included text. */
  files?: Record<string, string>;
  /** Uploaded images by file name, as data: or https URLs. */
  assets?: Record<string, string>;
  /** BibTeX stored on the document, when no .bib file exists. */
  bib?: string;
}

export interface LatexImportResult {
  content: JSONContent;
  settings: Partial<PaperSettings>;
  bib: string;
  title: string;
  /**
   * The author's own preamble statements (macros, packages, colours, theorem
   * definitions), which the exporter writes back; "" when there are none.
   */
  preamble: string;
  warnings: string[];
}

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * Authors that share affiliations. REVTeX lists `\author{A}\author{B}` and
 * then their `\affiliation`; amsart gives each `\author` its `\address`;
 * other classes put everyone in one `\author{… \and …}`.
 */
interface AuthorGroup {
  names: JSONContent[][];
  lines: JSONContent[][];
  /** A finished block (`Name \\ Dept`, IEEE blocks) that takes no more names. */
  content: JSONContent[] | null;
  /** Has an affiliation, so the next \author starts a new group. */
  affiliated: boolean;
}

type LabelKind = "heading" | "figure" | "tableFigure" | "mathBlock" | "unknown";

const LABEL_PREFIX: Record<Exclude<LabelKind, "unknown">, string> = {
  heading: "sec",
  figure: "fig",
  tableFigure: "tab",
  mathBlock: "eq",
};

const SETTING_KEYS: (keyof PaperSettings)[] = [
  "theme",
  "paper",
  "margins",
  "columns",
  "font",
  "fontSize",
  "lineSpacing",
  "paragraphStyle",
  "citationStyle",
  "numberedHeadings",
];

/** Layout a LaTeX document has when its preamble does not say otherwise. */
const LATEX_DEFAULTS: Partial<PaperSettings> = {
  paper: "letter",
  columns: 1,
  font: "cm",
  fontSize: 10,
  lineSpacing: 1,
  paragraphStyle: "indent",
  citationStyle: "ieee",
  numberedHeadings: true,
};

/** Title-page declarations without a visual counterpart. */
const FRONT_MATTER = new Set(["date", "subjclass", "dedicatory", "translator", "pacs", "preprint", "received", "revised", "accepted", "published", "communicated"]);

const HEADING_LEVELS: Record<string, number> = {
  part: 1,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 4,
};

const THEOREM_ENVIRONMENTS = new Set([
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "conjecture",
  "definition",
  "example",
  "remark",
  "claim",
  "assumption",
  "hypothesis",
  "observation",
  "note",
  "proof",
]);

const RAW_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "algorithm",
  "algorithm*",
  "algorithmic",
  "tikzpicture",
  "tikzcd",
  "pgfpicture",
  "forest",
  "circuitikz",
  "minipage",
  "multicols",
  "multicols*",
  "wrapfigure",
  "wraptable",
  "subfigure",
  "subtable",
  "thebibliography",
]);

const RULE_COMMANDS = new Set(["toprule", "midrule", "bottomrule", "hline", "cline", "cmidrule", "addlinespace", "specialrule"]);
const SILENT_COMMANDS = new Set([
  "documentclass",
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
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
  "def",
  "gdef",
  "edef",
  "xdef",
  "let",
  "newenvironment",
  "renewenvironment",
  "newtheorem",
  "DeclareMathOperator",
  "makeatletter",
  "makeatother",
  "hypersetup",
  "geometry",
  "lstset",
  "captionsetup",
  "setcitestyle",
  "newcolumntype",
  "urlstyle",
  "usetikzlibrary",
  "pgfplotsset",
  "tikzset",
  "definecolor",
  "graphicspath",
  "numberwithin",
  "titleformat",
  "titlespacing",
  "bibliographystyle",
  "addbibresource",
  "nocite",
  "date",
  "thanks",
  "affiliation",
  "institute",
  "institution",
  "address",
  "email",
  "orcid",
  "country",
  "city",
  "markboth",
  "markright",
  "IEEEoverridecommandlockouts",
  "IEEEpeerreviewmaketitle",
  "IEEEtriggeratref",
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
  "small",
  "footnotesize",
  "scriptsize",
  "tiny",
  "normalsize",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
  "bfseries",
  "itshape",
  "slshape",
  "upshape",
  "mdseries",
  "rmfamily",
  "sffamily",
  "ttfamily",
  "centering",
  "raggedright",
  "raggedleft",
  "noindent",
  "indent",
  "maketitle",
  "tableofcontents",
  "listoffigures",
  "listoftables",
  "printbibliography",
  "bibliography",
  "keywords",
  "title",
  "author",
  "item",
  "caption",
  "label",
]);

const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "alignat",
  "alignat*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arg(node: CommandNode | EnvironmentNode, index: number): Argument | null {
  return node.args[index] ?? null;
}

function argRaw(node: CommandNode | EnvironmentNode, index: number): string {
  return arg(node, index)?.raw ?? "";
}

function argChildren(node: CommandNode | EnvironmentNode, index: number): LatexNode[] {
  return arg(node, index)?.children ?? [];
}

/** The last mandatory parsed argument, which is where most commands put their text. */
function lastParsedArg(node: CommandNode | EnvironmentNode): LatexNode[] {
  for (let index = node.args.length - 1; index >= 0; index--) {
    const value = node.args[index];
    if (value && value.children.length) return value.children;
  }
  return [];
}

function lastRawArg(node: CommandNode | EnvironmentNode): string {
  for (let index = node.args.length - 1; index >= 0; index--) {
    const value = node.args[index];
    if (value && value.raw) return value.raw;
  }
  return "";
}

function applyLigatures(value: string): string {
  return value
    .replace(/!`/g, "¡")
    .replace(/\?`/g, "¿")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/---/g, "—")
    .replace(/--/g, "–");
}

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return [...marks.filter((entry) => entry.type !== mark.type), mark];
}

function withoutMark(marks: Mark[], type: string): Mark[] {
  return marks.filter((entry) => entry.type !== type);
}

function marksKey(marks: Mark[] | undefined): string {
  return marks?.length ? JSON.stringify(marks) : "";
}

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

function pushText(out: JSONContent[], value: string, marks: Mark[]): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last?.type === "text" && marksKey(last.marks as Mark[] | undefined) === marksKey(marks)) {
    last.text = (last.text ?? "") + value;
    return;
  }
  out.push(textNode(value, marks));
}

function isWhitespaceNode(node: LatexNode): boolean {
  return node.type === "space" || node.type === "parbreak" || node.type === "tab";
}

const REFERENCE_COMMANDS = new Set(["ref", "eqref", "autoref", "cref", "Cref", "nameref", "vref", "pageref"]);

/**
 * "Section~\ref{sec:x}" becomes a cross-reference atom that already renders
 * "Section 2", so the word before it must not be exported twice.
 */
function trimReferenceWord(out: JSONContent[]): void {
  const last = out[out.length - 1];
  if (last?.type !== "text" || !last.text) return;
  last.text = last.text.replace(/\b(?:section|figure|fig\.?|table|equation|eq\.?)\s+$/i, "");
  if (!last.text) out.pop();
}

function trimInline(content: JSONContent[]): JSONContent[] {
  const trimmed = [...content];
  while (trimmed.length) {
    const first = trimmed[0];
    if (first.type !== "text" || (first.text ?? "").trim()) break;
    trimmed.shift();
  }
  while (trimmed.length) {
    const last = trimmed[trimmed.length - 1];
    if (last.type !== "text" || (last.text ?? "").trim()) break;
    trimmed.pop();
  }
  if (trimmed.length) {
    const first = trimmed[0];
    if (first.type === "text") first.text = (first.text ?? "").replace(/^\s+/, "");
    const last = trimmed[trimmed.length - 1];
    if (last.type === "text") last.text = (last.text ?? "").replace(/\s+$/, "");
  }
  // \\ swallows the spaces around it, so "Line one\\ Line two" has none.
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index].type !== "hardBreak") continue;
    const before = trimmed[index - 1];
    if (before?.type === "text") before.text = (before.text ?? "").replace(/\s+$/, "");
    const after = trimmed[index + 1];
    if (after?.type === "text") after.text = (after.text ?? "").replace(/^\s+/, "");
  }
  return trimmed.filter((node) => node.type !== "text" || (node.text ?? "").length > 0);
}

function hasContent(node: JSONContent): boolean {
  if (node.type === "text") return Boolean(node.text?.trim());
  if (node.type === "mathInline" || node.type === "mathBlock" || node.type === "citation" || node.type === "crossRef" || node.type === "footnote") return true;
  if (node.type === "figure" || node.type === "tableFigure" || node.type === "pageBreak" || node.type === "bibliography") return true;
  if (node.type === "rawLatex" || node.type === "horizontalRule") return true;
  return Boolean(node.content?.some(hasContent));
}

function cleanMath(content: string): { latex: string; labels: string[]; numbered: boolean } {
  const labels: string[] = [];
  let latex = content.replace(/\\label\{([^}]*)\}/g, (_match, label: string) => {
    if (label.trim()) labels.push(label.trim());
    return "";
  });
  const nonumber = /\\(?:nonumber|notag)\b/.test(latex);
  latex = latex.replace(/\\(?:nonumber|notag)\b/g, "");
  return { latex: latex.trim(), labels, numbered: !nonumber };
}


function imageWidth(raw: string): number {
  const fraction = /width\s*=\s*([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth|hsize)/.exec(raw);
  if (fraction) return Math.min(100, Math.max(10, Math.round(Number(fraction[1]) * 100)));
  const absolute = /width\s*=\s*([\d.]+)\s*(cm|mm|in|pt)/.exec(raw);
  if (absolute) {
    const value = Number(absolute[1]);
    const inches = absolute[2] === "cm" ? value / 2.54 : absolute[2] === "mm" ? value / 25.4 : absolute[2] === "pt" ? value / 72.27 : value;
    if (inches > 0) return Math.min(100, Math.max(10, Math.round((inches / 6.5) * 100)));
  }
  return 80;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Splits nodes at the given commands (`\and`), dropping blank parts. */
function splitAt(nodes: LatexNode[], names: Set<string>): LatexNode[][] {
  const parts: LatexNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "command" && names.has(node.name)) parts.push([]);
    else parts[parts.length - 1].push(node);
  }
  return parts.filter((part) => part.some((node) => !isWhitespaceNode(node)));
}

const AUTHOR_SEPARATORS = new Set(["and", "AND"]);
const IEEE_AUTHOR_BLOCKS = new Set(["IEEEauthorblockN", "IEEEauthorblockA"]);

function hasLineBreak(nodes: LatexNode[]): boolean {
  return nodes.some((node) => node.type === "command" && (node.name === "\\" || node.name === "newline"));
}

const VERBATIM_START = /^\\begin\{(verbatim\*?|Verbatim\*?|lstlisting|minted|comment|filecontents\*?|alltt)\}/;

/**
 * `%` comments in LaTeX source: not `\%`, not inside verbatim text, \verb or
 * URLs, and not the exporter's settings line.
 */
export function countComments(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch === "\\") {
      const rest = text.slice(index, index + 40);
      const verbatim = VERBATIM_START.exec(rest);
      if (verbatim) {
        const close = `\\end{${verbatim[1]}}`;
        const end = text.indexOf(close, index + verbatim[0].length);
        index = end === -1 ? text.length : end + close.length - 1;
        continue;
      }
      const verb = /^\\(?:verb|lstinline)\*?([^A-Za-z\s*{])/.exec(rest);
      if (verb) {
        const end = text.indexOf(verb[1], index + verb[0].length);
        index = end === -1 ? text.length : end;
        continue;
      }
      const url = /^\\(?:url|href)\{/.exec(rest);
      if (url) {
        const end = text.indexOf("}", index + url[0].length);
        index = end === -1 ? text.length : end;
        continue;
      }
      index++;
      continue;
    }
    if (ch === "%") {
      const end = text.indexOf("\n", index);
      const comment = text.slice(index, end === -1 ? text.length : end);
      if (!/^%\s*recommendica-write-settings:/.test(comment)) count++;
      index = end === -1 ? text.length : end;
    }
  }
  return count;
}

class LatexImporter {
  private readonly source: string;
  private readonly files: Record<string, string>;
  private readonly assets: Record<string, string>;
  private readonly fallbackBib: string;
  private readonly warnings: string[] = [];
  private readonly labels = new Map<string, { kind: LabelKind; id: string }>();
  private readonly usedIds = new Set<string>();
  private readonly missingRefs = new Set<string>();
  private readonly unknownCommands = new Set<string>();
  /** Colours from \definecolor and \colorlet, by name. */
  private readonly colors: Record<string, string> = {};
  /** soul's highlight colour (\sethlcolor), scoped like a TeX group. */
  private highlightColor: string | null = null;
  /** \thanks notes were left out. */
  private droppedNotes = false;
  /** Title-page declarations from the body (\subjclass, \date), kept with the preamble. */
  private readonly frontMatter: string[] = [];
  /** Source spans of raw blocks, so adjacent ones can be joined again. */
  private readonly rawSpans = new WeakMap<JSONContent, { start: number; end: number }>();

  constructor(source: string, options: LatexImportOptions) {
    this.source = source.replace(/\r\n?/g, "\n");
    this.files = options.files ?? {};
    this.assets = options.assets ?? {};
    this.fallbackBib = options.bib ?? "";
  }

  import(): LatexImportResult {
    const parsed = parseLatex(this.source, { files: this.files });
    const document = parsed.nodes.find((node): node is EnvironmentNode => node.type === "environment" && node.name === "document");
    const preamble = document ? parsed.nodes.slice(0, parsed.nodes.indexOf(document)) : [];
    const body = document ? document.children : parsed.nodes;
    const scanned = scanPreamble(this.source);
    const own = scanned.bodyStart === null ? null : importPreamble(scanned.statements);
    for (const statement of scanned.statements) this.defineColorFrom(statement);

    const metadata = this.metadata(preamble, body);
    this.collectLabels(body);
    for (const node of preamble) this.collectLabels([node]);

    const blocks = this.blocks(body);
    if (!blocks.some((node) => node.type === "paperKeywords")) {
      // \noindent\textbf{Keywords:} … is how article-class papers write them.
      const index = blocks.findIndex((node) => this.keywordsContent(node) !== null);
      if (index !== -1) blocks[index] = { type: "paperKeywords", content: this.keywordsContent(blocks[index]) ?? [] };
    }
    const hasKeywords = blocks.some((node) => node.type === "paperKeywords");
    if (metadata.keywords && !hasKeywords) {
      const abstract = blocks.findIndex((node) => node.type === "paperAbstract");
      blocks.splice(abstract === -1 ? 0 : abstract + 1, 0, { type: "paperKeywords", content: metadata.keywords });
    }

    if (metadata.title.length) blocks.unshift({ type: "paperTitle", content: metadata.title });
    if (metadata.authors.length) {
      blocks.splice(metadata.title.length ? 1 : 0, 0, ...metadata.authors.map((content) => ({ type: "paperAuthors", content })));
    }

    const bib = this.bibText();
    if (bib && !blocks.some((node) => node.type === "bibliography") && this.hasCitations(blocks)) {
      blocks.push({ type: "bibliography" });
    }

    if (this.unknownCommands.size) {
      this.warnings.push(`Unsupported LaTeX commands were kept as text or omitted: ${[...this.unknownCommands].slice(0, 6).map((name) => `\\${name}`).join(", ")}${this.unknownCommands.size > 6 ? "…" : ""}.`);
    }
    if (this.missingRefs.size) {
      this.warnings.push(`${this.missingRefs.size} cross-reference${this.missingRefs.size === 1 ? "" : "s"} point to labels that were not found; they are kept as links and export as ??.`);
    }
    if (this.droppedNotes) this.warnings.push("Notes on the title or authors (\\thanks) are not shown in the visual editor and were left out.");
    if (own?.biblatex) this.warnings.push("biblatex was replaced by BibTeX (\\bibliography), which the visual editor formats; biblatex options were left out.");
    const comments = countComments(this.source);
    if (comments) {
      const them = comments === 1 ? "it" : "them";
      this.warnings.push(`This paper has ${comments} LaTeX comment${comments === 1 ? "" : "s"}. The visual editor does not show comments, so editing here removes ${them} from the source.`);
    }

    return {
      content: { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] },
      settings: this.settings(preamble, body, own),
      bib,
      title: plainText({ type: "doc", content: metadata.title }),
      preamble: [own?.preamble ?? "", ...this.frontMatter].filter(Boolean).join("\n"),
      warnings: [...new Set(this.warnings)],
    };
  }

  // ── Metadata and settings ─────────────────────────────────────────────────

  private metadata(preamble: LatexNode[], body: LatexNode[]): { title: JSONContent[]; authors: JSONContent[][]; keywords: JSONContent[] | null } {
    let title: JSONContent[] = [];
    const groups: AuthorGroup[] = [];
    let keywords: JSONContent[] | null = null;
    const open = (): AuthorGroup => {
      const last = groups[groups.length - 1];
      if (last && !last.content) return last;
      const group: AuthorGroup = { names: [], lines: [], content: null, affiliated: false };
      groups.push(group);
      return group;
    };
    const visit = (nodes: LatexNode[]) => {
      for (const node of nodes) {
        if (node.type === "command") {
          switch (node.name) {
            case "title":
              if (!title.length) title = this.inline(lastParsedArg(node));
              break;
            case "author":
              this.author(lastParsedArg(node), groups);
              break;
            case "affiliation":
            case "address":
            case "curraddr":
            case "institute":
            case "institution":
            case "email":
            case "urladdr": {
              const line = trimInline(this.inline(lastParsedArg(node)));
              if (!line.length) break;
              const group = open();
              group.lines.push(line);
              if (node.name !== "email" && node.name !== "urladdr") group.affiliated = true;
              break;
            }
            case "keywords":
              if (!keywords) keywords = this.inline(lastParsedArg(node));
              break;
            default:
              break;
          }
        } else if (node.type === "environment" && (node.name === "IEEEkeywords" || node.name === "keywords")) {
          if (!keywords) keywords = this.inline(node.children);
        } else if (node.type === "environment" && node.name !== "document") {
          // Title and author commands are usually in the preamble, but some
          // classes put them after \begin{document}.
          visit(node.children);
        }
      }
    };
    visit(preamble);
    visit(body);
    const authors = groups
      .map((group) => {
        if (group.content) return group.content;
        const content: JSONContent[] = [];
        group.names.forEach((name, index) => {
          if (index) content.push({ type: "text", text: ", " });
          content.push(...name);
        });
        for (const line of group.lines) {
          if (content.length) content.push({ type: "hardBreak" });
          content.push(...line);
        }
        return trimInline(content);
      })
      .filter((content) => content.length);
    return { title: trimInline(title), authors, keywords: keywords ? trimInline(keywords) : null };
  }

  /** One \author command: a name, or complete blocks split at \and. */
  private author(children: LatexNode[], groups: AuthorGroup[]): void {
    const ieee = children.some((node) => node.type === "command" && IEEE_AUTHOR_BLOCKS.has(node.name));
    const parts = splitAt(children, AUTHOR_SEPARATORS);
    if (ieee || parts.length > 1 || hasLineBreak(children)) {
      for (const part of parts) {
        const content = ieee ? this.ieeeAuthor(part) : trimInline(this.inline(part));
        if (content.length) groups.push({ names: [], lines: [], content, affiliated: true });
      }
      return;
    }
    const name = trimInline(this.inline(children));
    if (!name.length) return;
    let group = groups[groups.length - 1];
    if (!group || group.content || group.affiliated) {
      group = { names: [], lines: [], content: null, affiliated: false };
      groups.push(group);
    }
    group.names.push(name);
  }

  /** `\IEEEauthorblockN{Name}\IEEEauthorblockA{Dept\\ University}` → lines. */
  private ieeeAuthor(nodes: LatexNode[]): JSONContent[] {
    const out: JSONContent[] = [];
    for (const node of nodes) {
      if (node.type !== "command" || !IEEE_AUTHOR_BLOCKS.has(node.name)) continue;
      const content = trimInline(this.inline(lastParsedArg(node)));
      if (!content.length) continue;
      if (out.length) out.push({ type: "hardBreak" });
      out.push(...content);
    }
    return trimInline(out);
  }

  /** The keywords of a "Keywords: a, b" paragraph, or null for any other block. */
  private keywordsContent(block: JSONContent): JSONContent[] | null {
    if (block.type !== "paragraph" || !block.content?.length) return null;
    const [first, ...rest] = block.content;
    if (first.type !== "text" || !first.text) return null;
    const marks = (first.marks ?? []) as Mark[];
    const labelled = marks.some((mark) => mark.type === "bold" || mark.type === "italic");
    const match = /^\s*(?:key\s*-?\s*words|index\s+terms)\s*([:.\u2014\u2013-])?\s*/i.exec(first.text);
    if (!match || (!labelled && !match[1])) return null;
    const content: JSONContent[] = [];
    const remainder = first.text.slice(match[0].length);
    if (remainder) content.push(textNode(remainder, marks));
    content.push(...rest.map((node) => ({ ...node })));
    const head = content[0];
    if (head?.type === "text") head.text = (head.text ?? "").replace(/^[\s:.\u2014\u2013-]+/, "");
    const keywords = trimInline(content);
    return keywords.length ? keywords : null;
  }

  /**
   * Settings written into the exported source win over detection, except where
   * the user has visibly changed the preamble (margins, fonts, document class).
   * The theme needs special care: APA and article share the same class.
   */
  private settings(preamble: LatexNode[], body: LatexNode[], own: ImportedPreamble | null): Partial<PaperSettings> {
    const detected = this.detectedSettings(preamble, body);
    if (own?.margins) detected.margins = own.margins;
    if (own?.sansSerif) detected.font = "sans";
    if (own?.lineSpacing && detected.lineSpacing === undefined) detected.lineSpacing = own.lineSpacing;
    const marker = this.markerSettings();
    if (marker.theme && (!detected.theme || detected.theme === "article")) detected.theme = marker.theme;
    // A complete document states its layout: whatever it leaves unset is
    // LaTeX's default, not the visual editor's (1.15 spacing, 1in margins).
    const defaults: Partial<PaperSettings> = own ? { ...LATEX_DEFAULTS } : {};
    const classLayout = detected.theme === "ieee" || detected.theme === "revtex" || detected.theme === "amsart";
    if (own && !classLayout) defaults.margins = "wide";
    return { ...defaults, ...marker, ...detected };
  }

  /** Visual-only settings stored in a comment by toLatex.ts. */
  private markerSettings(): Partial<PaperSettings> {
    const match = /^\s*%\s*recommendica-write-settings:\s*(\{.*\})\s*$/m.exec(this.source);
    if (!match) return {};
    try {
      const raw: unknown = JSON.parse(match[1]);
      if (!isRecord(raw)) return {};
      const safe = normalizeSettings({ ...DEFAULT_SETTINGS, ...raw });
      const settings: Partial<PaperSettings> = {};
      for (const key of SETTING_KEYS) {
        if (key in raw) (settings as Record<string, unknown>)[key] = safe[key];
      }
      return settings;
    } catch {
      return {};
    }
  }

  private detectedSettings(preamble: LatexNode[], body: LatexNode[]): Partial<PaperSettings> {
    const settings: Partial<PaperSettings> = {};
    const nodes = [...preamble, ...body];
    for (const node of nodes) {
      if (node.type !== "command") continue;
      switch (node.name) {
        case "documentclass": {
          const options = argRaw(node, 0).split(",").map((option) => option.trim());
          const name = argRaw(node, 1).trim();
          if (name === "IEEEtran") Object.assign(settings, { theme: "ieee", columns: 2, fontSize: 10, paper: "letter", font: "times" });
          else if (name === "revtex4" || name === "revtex4-1" || name === "revtex4-2") Object.assign(settings, { theme: "revtex", columns: options.includes("reprint") ? 2 : 1, fontSize: 10, paper: "letter", font: "cm" });
          else if (name === "amsart" || name === "amsproc") Object.assign(settings, { theme: "amsart", columns: 1, fontSize: 10, paper: "letter", font: "cm" });
          else if (name === "article" || name === "scrartcl") settings.theme = "article";
          if (options.includes("twocolumn")) settings.columns = 2;
          if (options.includes("onecolumn")) settings.columns = 1;
          const size = options.find((option) => /^(9|10|11|12)pt$/.test(option));
          if (size) settings.fontSize = Number.parseInt(size, 10) as PaperSettings["fontSize"];
          if (options.includes("a4paper")) settings.paper = "a4";
          if (options.includes("letterpaper")) settings.paper = "letter";
          break;
        }
        case "usepackage": {
          const names = argRaw(node, 1).split(",").map((name) => name.trim());
          if (names.some((name) => ["times", "mathptmx", "newtxtext", "newtxmath", "txfonts", "ptm", "tgtermes"].includes(name))) settings.font = "times";
          else if (names.some((name) => ["mathpazo", "palatino", "newpxtext", "newpxmath", "pxfonts", "tgpagella", "mathpple"].includes(name))) settings.font = "palatino";
          else if (names.includes("lmodern")) settings.font = "cm";
          if (names.includes("arxiv-preprint")) settings.theme = "arxiv";
          if (names.includes("ml-preprint")) settings.theme = "mlconf";
          if (names.includes("parskip")) settings.paragraphStyle = "spaced";
          if (names.includes("fullpage")) settings.margins = "normal";
          const options = argRaw(node, 0);
          if (names.includes("natbib") && !options.includes("numbers") && !settings.citationStyle) settings.citationStyle = "apa";
          break;
        }
        case "bibliographystyle": {
          const style = argRaw(node, 0).trim();
          if (style === "IEEEtran") settings.citationStyle = "ieee";
          else if (style === "apalike" || style === "plainnat") settings.citationStyle = "apa";
          break;
        }
        case "doublespacing":
          settings.lineSpacing = 2;
          break;
        case "onehalfspacing":
          settings.lineSpacing = 1.5;
          break;
        case "singlespacing":
          settings.lineSpacing = 1;
          break;
        case "linespread":
        case "setstretch": {
          const value = Number.parseFloat(argRaw(node, 0));
          if (Number.isFinite(value) && value >= 1 && value <= 3) settings.lineSpacing = value;
          break;
        }
        default:
          break;
      }
    }
    return settings;
  }

  private bibText(): string {
    const names = Object.keys(this.files);
    const referenced = new Set<string>();
    for (const match of this.source.matchAll(/\\(?:bibliography|addbibresource)\{([^}]+)\}/g)) {
      for (const name of match[1].split(",")) referenced.add(name.trim());
    }
    const candidates = [...referenced].flatMap((name) => [name, `${name}.bib`]);
    const preferred = candidates.find((name) => name in this.files) ?? names.find((name) => name.toLowerCase() === "references.bib") ?? names.find((name) => name.toLowerCase().endsWith(".bib"));
    return preferred ? this.files[preferred] : this.fallbackBib;
  }

  private hasCitations(nodes: JSONContent[]): boolean {
    return nodes.some((node) => {
      if (node.type === "citation") return true;
      return Boolean(node.content?.some((child) => this.hasCitations([child])));
    });
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  private registerLabel(label: string, kind: LabelKind): string {
    const clean = label.trim();
    if (!clean) return "";
    const existing = this.labels.get(clean);
    if (existing) return existing.id;
    const id = this.idFor(clean, kind);
    this.labels.set(clean, { kind, id });
    return id;
  }

  private idFor(label: string, kind: LabelKind): string {
    let id = kind === "unknown" ? label : /^(?:sec|fig|tab|eq):/.test(label) ? label : `${LABEL_PREFIX[kind]}:${safeSlug(label)}`;
    if (!id) id = "ref:item";
    let unique = id;
    let index = 2;
    while (this.usedIds.has(unique)) unique = `${id}-${index++}`;
    this.usedIds.add(unique);
    return unique;
  }

  private labelId(label: string): string {
    const clean = label.trim();
    if (!clean) return "";
    const existing = this.labels.get(clean);
    if (existing) return existing.id;
    this.missingRefs.add(clean);
    return this.registerLabel(clean, "unknown");
  }

  private collectLabels(nodes: LatexNode[]): void {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "command") {
        if (node.name in HEADING_LEVELS) {
          for (let next = index + 1; next < nodes.length; next++) {
            const following = nodes[next];
            if (following.type === "space") continue;
            if (following.type === "command" && following.name === "label") this.registerLabel(argRaw(following, 0), "heading");
            break;
          }
        } else if (node.name === "label") {
          // A stray label outside a float: keep it as an unknown target so a
          // reference to it can survive the round trip inside a raw block.
          const label = argRaw(node, 0);
          if (label) this.registerLabel(label, "unknown");
        }
        continue;
      }
      if (node.type === "environment") {
        if (node.name.startsWith("figure")) {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, "figure");
        } else if (node.name.startsWith("table")) {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, "tableFigure");
        } else if (node.name === "tabular" || node.name === "tabular*" || node.name === "tabularx" || node.name === "longtable" || node.name === "array") {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, "tableFigure");
        } else if (THEOREM_ENVIRONMENTS.has(node.name) || RAW_ENVIRONMENTS.has(node.name)) {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, "unknown");
        } else {
          this.collectLabels(node.children);
        }
        continue;
      }
      if (node.type === "math") {
        for (const label of cleanMath(node.content).labels) this.registerLabel(label, "mathBlock");
      } else if (node.type === "group") {
        this.collectLabels(node.children);
      }
    }
  }

  private findLabels(nodes: LatexNode[]): string[] {
    const labels: string[] = [];
    for (const node of nodes) {
      if (node.type === "command" && node.name === "label") {
        const label = argRaw(node, 0);
        if (label) labels.push(label);
      } else if (node.type === "environment") {
        labels.push(...this.findLabels(node.children));
      } else if (node.type === "group") {
        labels.push(...this.findLabels(node.children));
      }
    }
    return labels;
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  private blocks(nodes: LatexNode[]): JSONContent[] {
    const out: JSONContent[] = [];
    let inlineRun: LatexNode[] = [];
    // A blank line (or the start) since the last block: raw blocks with only a
    // line break between them were one block in the visual editor.
    let separated = true;
    const flush = () => {
      const content = trimInline(this.inline(inlineRun));
      inlineRun = [];
      if (content.length) out.push({ type: "paragraph", content });
    };
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "space") {
        if (inlineRun.length) inlineRun.push(node);
        continue;
      }
      if (node.type === "parbreak") {
        flush();
        separated = true;
        continue;
      }
      const block = this.blockAt(nodes, index);
      if (block) {
        flush();
        for (const produced of block.nodes) {
          const last = out[out.length - 1];
          const before = last ? this.rawSpans.get(last) : undefined;
          const span = this.rawSpans.get(produced);
          if (!separated && last && before && span && span.start >= before.end && !this.source.slice(before.end, span.start).trim()) {
            last.attrs = { ...(last.attrs ?? {}), source: this.source.slice(before.start, span.end) };
            this.rawSpans.set(last, { start: before.start, end: span.end });
          } else {
            out.push(produced);
          }
          separated = false;
        }
        index = block.next - 1;
        continue;
      }
      inlineRun.push(node);
    }
    flush();
    return out.filter(hasContent);
  }

  private blockAt(nodes: LatexNode[], index: number): { nodes: JSONContent[]; next: number } | null {
    const node = nodes[index];
    if (node.type === "math" && node.display) {
      const math = cleanMath(node.content);
      if (!math.latex) return { nodes: [], next: index + 1 };
      const id = math.labels.length ? this.registerLabel(math.labels[0], "mathBlock") : "";
      return { nodes: [{ type: "mathBlock", attrs: { latex: math.latex, numbered: math.numbered, id } }], next: index + 1 };
    }
    if (node.type === "environment") return this.environmentBlock(node, index + 1);
    if (node.type !== "command") return null;

    if (node.name in HEADING_LEVELS) {
      let next = index + 1;
      let label = "";
      while (next < nodes.length) {
        const following = nodes[next];
        if (following.type === "space") {
          next++;
          continue;
        }
        if (following.type === "command" && following.name === "label") {
          label = argRaw(following, 0);
          next++;
        }
        break;
      }
      const content = trimInline(this.inline(lastParsedArg(node)));
      if (!content.length) return { nodes: [], next };
      const level = HEADING_LEVELS[node.name];
      const id = label ? this.registerLabel(label, "heading") : "";
      return { nodes: [{ type: "heading", attrs: { level, numbered: !node.star, id }, content }], next };
    }

    if (FRONT_MATTER.has(node.name)) {
      // Declarations \maketitle typesets: valid in the preamble, where the
      // exporter writes the author's statements back.
      const text = this.source.slice(node.start, node.end).trim();
      if (text && (node.name !== "date" || lastRawArg(node).trim() || lastParsedArg(node).length)) this.frontMatter.push(text);
      return { nodes: [], next: index + 1 };
    }

    switch (node.name) {
      case "maketitle":
      case "title":
      case "author":
      case "thanks":
      case "affiliation":
      case "institute":
      case "institution":
      case "address":
      case "email":
      case "keywords":
      case "bibliographystyle":
      case "addbibresource":
      case "nocite":
      case "label":
      case "caption":
      case "centering":
      case "raggedright":
      case "raggedleft":
      case "noindent":
      case "indent":
      case "tableofcontents":
      case "listoffigures":
      case "listoftables":
        return { nodes: [], next: index + 1 };
      case "bibliography":
      case "printbibliography":
        return { nodes: [{ type: "bibliography" }], next: index + 1 };
      case "newpage":
      case "clearpage":
      case "pagebreak":
        return { nodes: [{ type: "pageBreak" }], next: index + 1 };
      case "rule":
        return { nodes: [{ type: "horizontalRule" }], next: index + 1 };
      case "includegraphics": {
        const graphic = this.figureGraphic(node);
        return { nodes: [graphic], next: index + 1 };
      }
      case "vspace":
      case "hspace":
      case "smallskip":
      case "medskip":
      case "bigskip":
        return { nodes: [], next: index + 1 };
      default:
        return null;
    }
  }

  private environmentBlock(node: EnvironmentNode, next: number): { nodes: JSONContent[]; next: number } | null {
    if (node.name === "document") return { nodes: this.blocks(node.children), next };
    if (node.name === "abstract") {
      const children = this.blocks(node.children);
      // Keywords are often the abstract's last line; they become their own block.
      const keywords = children.findIndex((child) => this.keywordsContent(child) !== null);
      const keywordsNode = keywords === -1 ? null : { type: "paperKeywords", content: this.keywordsContent(children[keywords]) ?? [] };
      const content = children.filter((child, index) => child.type === "paragraph" && index !== keywords);
      const abstract = { type: "paperAbstract", content: content.length ? content : [{ type: "paragraph" }] };
      return { nodes: keywordsNode ? [abstract, keywordsNode] : [abstract], next };
    }
    if (node.name === "IEEEkeywords" || node.name === "keywords") {
      return { nodes: [{ type: "paperKeywords", content: trimInline(this.inline(node.children)) }], next };
    }
    if (node.name === "itemize" || node.name === "enumerate" || node.name === "description") {
      return { nodes: [this.list(node)], next };
    }
    if (node.name === "figure" || node.name === "figure*") {
      return { nodes: [this.figure(node)], next };
    }
    if (node.name === "table" || node.name === "table*") {
      const table = this.tableFigure(node);
      return table ? { nodes: [table], next } : { nodes: [this.raw(node)], next };
    }
    if (node.name === "tabular" || node.name === "tabular*" || node.name === "tabularx" || node.name === "longtable" || node.name === "array") {
      return { nodes: [{ type: "tableFigure", attrs: { id: "" }, content: [{ type: "figcaption" }, this.tableNode(node)] }], next };
    }
    if (node.name === "verbatim" || node.name === "verbatim*" || node.name === "Verbatim" || node.name === "lstlisting" || node.name === "minted") {
      const raw = node.raw ?? "";
      const language = node.name === "minted" ? lastRawArg(node).trim() : "";
      return {
        nodes: [{ type: "codeBlock", attrs: language ? { language } : undefined, content: raw ? [{ type: "text", text: raw }] : [] }],
        next,
      };
    }
    if (node.name === "quote" || node.name === "quotation") {
      const content = this.blocks(node.children);
      return { nodes: [{ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] }], next };
    }
    if (node.name === "center" || node.name === "flushleft" || node.name === "flushright") {
      const align = node.name === "center" ? "center" : node.name === "flushright" ? "right" : "left";
      return { nodes: this.alignBlocks(this.blocks(node.children), align), next };
    }
    if (node.name === "acknowledgments") {
      return {
        nodes: [
          { type: "heading", attrs: { level: 1, numbered: false, id: "" }, content: [{ type: "text", text: "Acknowledgments" }] },
          ...this.blocks(node.children),
        ],
        next,
      };
    }
    if (MATH_ENVIRONMENTS.has(node.name)) {
      // The parser normally returns math environments as MathNode; this is a
      // fallback for one nested inside a group.
      const content = node.raw ?? nodesToText(node.children);
      const math = cleanMath(content);
      if (!math.latex) return { nodes: [], next };
      const id = math.labels.length ? this.registerLabel(math.labels[0], "mathBlock") : "";
      return { nodes: [{ type: "mathBlock", attrs: { latex: math.latex, numbered: math.numbered, id } }], next };
    }
    if (THEOREM_ENVIRONMENTS.has(node.name) || RAW_ENVIRONMENTS.has(node.name)) return { nodes: [this.raw(node)], next };
    return { nodes: [this.raw(node)], next };
  }

  private alignBlocks(blocks: JSONContent[], align: string): JSONContent[] {
    for (const block of blocks) {
      if (block.type === "paragraph" || block.type === "heading") block.attrs = { ...(block.attrs ?? {}), textAlign: align };
    }
    return blocks;
  }

  private raw(node: LatexNode): JSONContent {
    const raw = { type: "rawLatex", attrs: { source: this.source.slice(node.start, node.end) } };
    this.rawSpans.set(raw, { start: node.start, end: node.end });
    return raw;
  }

  // ── Lists, figures and tables ─────────────────────────────────────────────

  private list(node: EnvironmentNode): JSONContent {
    const ordered = node.name === "enumerate";
    const items: JSONContent[] = [];
    let current: LatexNode[] = [];
    let label = "";
    const flush = () => {
      const hasText = current.some((child) => !isWhitespaceNode(child));
      if (!hasText && !label) {
        current = [];
        return;
      }
      const content = this.blocks(current);
      if (!content.length) content.push({ type: "paragraph" });
      if (label) {
        const first = content[0];
        if (first.type === "paragraph") {
          first.content = [{ type: "text", text: label, marks: [{ type: "bold" }] }, { type: "text", text: " " }, ...(first.content ?? [])];
        }
      }
      items.push({ type: "listItem", content });
      current = [];
      label = "";
    };
    let started = false;
    for (const child of node.children) {
      if (child.type === "command" && child.name === "item") {
        // Anything before the first \item is list setup, not an item.
        if (started) flush();
        else current = [];
        started = true;
        label = argRaw(child, 0) || nodesToText(argChildren(child, 0)).trim();
      } else if (started || !isWhitespaceNode(child)) {
        current.push(child);
      }
    }
    flush();
    if (!items.length) items.push({ type: "listItem", content: [{ type: "paragraph" }] });
    return { type: ordered ? "orderedList" : "bulletList", content: items };
  }

  private findCommand(nodes: LatexNode[], name: string): CommandNode | null {
    for (const node of nodes) {
      if (node.type === "command" && node.name === name) return node;
      if (node.type === "environment") {
        const found = this.findCommand(node.children, name);
        if (found) return found;
      } else if (node.type === "group") {
        const found = this.findCommand(node.children, name);
        if (found) return found;
      }
    }
    return null;
  }

  private findEnvironment(nodes: LatexNode[], names: Set<string>): EnvironmentNode | null {
    for (const node of nodes) {
      if (node.type === "environment" && names.has(node.name)) return node;
      if (node.type === "environment") {
        const found = this.findEnvironment(node.children, names);
        if (found) return found;
      } else if (node.type === "group") {
        const found = this.findEnvironment(node.children, names);
        if (found) return found;
      }
    }
    return null;
  }

  private assetUrl(path: string): string {
    const clean = path.trim().replace(/^["']|["']$/g, "");
    if (!clean) return "";
    if (/^https:\/\//i.test(clean)) return clean;
    const candidates = [clean, clean.replace(/^\.\//, ""), basename(clean)];
    for (const candidate of candidates) {
      if (candidate in this.assets) return this.assets[candidate];
    }
    return "";
  }

  private figureGraphic(node: CommandNode): JSONContent {
    const path = argRaw(node, 1).trim();
    const src = this.assetUrl(path);
    if (path && !src) this.warnings.push(`Image “${path}” was not found in this project.`);
    return {
      type: "figure",
      attrs: { src, alt: basename(path).replace(/\.[^.]+$/, ""), width: imageWidth(argRaw(node, 0)), id: "" },
      content: [{ type: "figcaption" }],
    };
  }

  private figure(node: EnvironmentNode): JSONContent {
    const labels = this.findLabels(node.children);
    const id = labels.length ? this.registerLabel(labels[0], "figure") : "";
    const graphic = this.findCommand(node.children, "includegraphics");
    const caption = this.findCommand(node.children, "caption");
    let src = "";
    let alt = "";
    let width = 80;
    if (graphic) {
      const path = argRaw(graphic, 1).trim();
      src = this.assetUrl(path);
      alt = basename(path).replace(/\.[^.]+$/, "");
      width = imageWidth(argRaw(graphic, 0));
      if (path && !src) this.warnings.push(`Image “${path}” was not found in this project.`);
    }
    const captionContent = caption ? trimInline(this.inline(lastParsedArg(caption))) : [];
    return {
      type: "figure",
      attrs: { src, alt, width, id },
      content: [{ type: "figcaption", content: captionContent }],
    };
  }

  private tableFigure(node: EnvironmentNode): JSONContent | null {
    const tabular = this.findEnvironment(node.children, new Set(["tabular", "tabular*", "tabularx", "longtable", "array"]));
    if (!tabular) return null;
    const labels = this.findLabels(node.children);
    const id = labels.length ? this.registerLabel(labels[0], "tableFigure") : "";
    const caption = this.findCommand(node.children, "caption");
    return {
      type: "tableFigure",
      attrs: { id },
      content: [{ type: "figcaption", content: caption ? trimInline(this.inline(lastParsedArg(caption))) : [] }, this.tableNode(tabular)],
    };
  }

  private tableNode(node: EnvironmentNode): JSONContent {
    const rows = this.tableRows(node.children);
    if (!rows.length) rows.push([{ content: [], colspan: 1, rowspan: 1 }]);
    const columns = Math.max(1, ...rows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)));
    return {
      type: "table",
      content: rows.map((row, rowIndex) => {
        const cells: JSONContent[] = row.map((cell) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          attrs: { colspan: cell.colspan, rowspan: cell.rowspan, colwidth: null },
          content: [{ type: "paragraph", content: cell.content }],
        }));
        let width = row.reduce((sum, cell) => sum + cell.colspan, 0);
        while (width < columns) {
          cells.push({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph" }],
          });
          width += 1;
        }
        return { type: "tableRow", content: cells };
      }),
    };
  }

  private tableRows(nodes: LatexNode[]): { content: JSONContent[]; colspan: number; rowspan: number }[][] {
    const rows: { content: JSONContent[]; colspan: number; rowspan: number }[][] = [];
    let row: { content: JSONContent[]; colspan: number; rowspan: number }[] = [];
    let cell: LatexNode[] = [];
    const flushCell = () => {
      row.push(this.tableCell(cell));
      cell = [];
    };
    const flushRow = () => {
      if (cell.length || row.length) {
        flushCell();
        rows.push(row);
        row = [];
      }
    };
    for (const child of nodes) {
      if (child.type === "tab") {
        flushCell();
        continue;
      }
      if (child.type === "command" && (child.name === "\\" || child.name === "tabularnewline")) {
        flushRow();
        continue;
      }
      if (child.type === "command" && RULE_COMMANDS.has(child.name)) continue;
      if (child.type === "space" || child.type === "parbreak") {
        if (cell.length) cell.push(child);
        continue;
      }
      cell.push(child);
    }
    flushRow();
    return rows.filter((entry) => entry.some((value) => value.content.length || value.colspan > 1 || value.rowspan > 1));
  }

  private tableCell(nodes: LatexNode[]): { content: JSONContent[]; colspan: number; rowspan: number } {
    let content = nodes;
    let colspan = 1;
    let rowspan = 1;
    const meaningful = nodes.filter((node) => node.type !== "space" && node.type !== "parbreak");
    const first = meaningful[0];
    if (first?.type === "command" && first.name === "multicolumn") {
      colspan = Math.max(1, Number.parseInt(argRaw(first, 0), 10) || 1);
      content = argChildren(first, 2);
    } else if (first?.type === "command" && first.name === "multirow") {
      rowspan = Math.max(1, Number.parseInt(argRaw(first, 0), 10) || 1);
      content = argChildren(first, 4);
    } else if (first?.type === "command" && (first.name === "makecell" || first.name === "shortstack")) {
      content = lastParsedArg(first);
    }
    return { content: trimInline(this.inline(content)), colspan, rowspan };
  }

  // ── Inline content ────────────────────────────────────────────────────────

  private inline(nodes: LatexNode[], marks: Mark[] = []): JSONContent[] {
    const out: JSONContent[] = [];
    // Declarations such as \bfseries or \color{red} apply to the rest of the group.
    let current = marks;
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          pushText(out, applyLigatures(node.value), current);
          break;
        case "space":
        case "parbreak":
        case "tab":
          pushText(out, " ", current);
          break;
        case "verb":
          pushText(out, node.value, withMark(current, { type: "code" }));
          break;
        case "group": {
          const highlight = this.highlightColor;
          out.push(...this.inline(node.children, current));
          this.highlightColor = highlight;
          break;
        }
        case "math": {
          const math = cleanMath(node.content);
          if (math.latex) out.push({ type: "mathInline", attrs: { latex: math.latex } });
          break;
        }
        case "command": {
          const declared = this.declaration(node, current);
          if (declared) {
            current = declared;
            break;
          }
          if (REFERENCE_COMMANDS.has(node.name)) {
            const target = lastRawArg(node).trim();
            const label = this.labels.get(target);
            if (label && label.kind !== "unknown") trimReferenceWord(out);
          }
          out.push(...this.inlineCommand(node, current));
          break;
        }
        case "environment": {
          // Inline formatting environments (\begin{small} … \end{small})
          // carry text but no block structure of their own.
          const highlight = this.highlightColor;
          out.push(...this.inline(node.children, current));
          this.highlightColor = highlight;
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** Marks after a font or colour declaration, or null for other commands. */
  private declaration(node: CommandNode, marks: Mark[]): Mark[] | null {
    switch (node.name) {
      case "bfseries":
      case "bf":
        return withMark(marks, { type: "bold" });
      case "mdseries":
        return withoutMark(marks, "bold");
      case "itshape":
      case "it":
      case "slshape":
      case "sl":
        return withMark(marks, { type: "italic" });
      case "em":
        return marks.some((mark) => mark.type === "italic") ? withoutMark(marks, "italic") : withMark(marks, { type: "italic" });
      case "upshape":
        return withoutMark(marks, "italic");
      case "ttfamily":
      case "tt":
        return withMark(marks, { type: "code" });
      case "rmfamily":
      case "sffamily":
        return withoutMark(marks, "code");
      case "normalfont":
      case "rm":
        return withoutMark(withoutMark(withoutMark(marks, "bold"), "italic"), "code");
      case "color": {
        const color = this.color(argRaw(node, 0).trim() || null, argRaw(node, 1));
        return color ? withMark(marks, { type: "textStyle", attrs: { color } }) : marks;
      }
      case "sethlcolor":
        this.highlightColor = this.color(null, argRaw(node, 0));
        return marks;
      default:
        return null;
    }
  }

  private color(model: string | null, spec: string): string | null {
    return resolveColor(model, spec.trim(), this.colors);
  }

  private defineColor(name: string, model: string | null, spec: string): void {
    const color = this.color(model, spec);
    if (name.trim() && color) this.colors[name.trim()] = color;
  }

  /** \definecolor and \colorlet in the preamble. */
  private defineColorFrom(statement: PreambleStatement): void {
    const values = statement.args.filter((arg) => !arg.optional).map((arg) => arg.value);
    if (statement.name === "definecolor" && values.length >= 3) this.defineColor(values[0], values[1], values[2]);
    else if (statement.name === "colorlet" && values.length >= 2) this.defineColor(values[0], null, values[1]);
  }

  private inlineCommand(node: CommandNode, marks: Mark[]): JSONContent[] {
    const name = node.name;
    const formatting: Record<string, Mark> = {
      textbf: { type: "bold" },
      textit: { type: "italic" },
      emph: { type: "italic" },
      textsl: { type: "italic" },
      underline: { type: "underline" },
      uline: { type: "underline" },
      sout: { type: "strike" },
      st: { type: "strike" },
      ul: { type: "underline" },
      textsuperscript: { type: "superscript" },
      textsubscript: { type: "subscript" },
      texttt: { type: "code" },
    };
    if (formatting[name]) return this.inline(lastParsedArg(node), withMark(marks, formatting[name]));
    if (name === "textup" || name === "textnormal") return this.inline(lastParsedArg(node), withoutMark(withoutMark(marks, "italic"), "bold"));
    if (name === "textsc" || name === "so" || name === "caps") return this.inline(lastParsedArg(node), marks);
    if (name === "textcolor") {
      const color = this.color(argRaw(node, 0).trim() || null, argRaw(node, 1));
      return this.inline(argChildren(node, 2), color ? withMark(marks, { type: "textStyle", attrs: { color } }) : marks);
    }
    if (name === "colorbox" || name === "fcolorbox") {
      // A coloured background is what the visual editor calls a highlight.
      const color = this.color(argRaw(node, 0).trim() || null, argRaw(node, name === "fcolorbox" ? 2 : 1));
      const children = argChildren(node, name === "fcolorbox" ? 3 : 2);
      return this.inline(children, color ? withMark(marks, { type: "highlight", attrs: { color } }) : marks);
    }
    if (name === "hl") {
      const color = this.highlightColor;
      return this.inline(lastParsedArg(node), withMark(marks, color ? { type: "highlight", attrs: { color } } : { type: "highlight" }));
    }
    if (name === "definecolor") {
      this.defineColor(argRaw(node, 0), argRaw(node, 1).trim() || null, argRaw(node, 2));
      return [];
    }
    if (name === "colorlet") {
      this.defineColor(argRaw(node, 0), null, argRaw(node, 1));
      return [];
    }
    if (name === "thanks") {
      this.droppedNotes = true;
      return [];
    }
    if (name === "href") {
      const href = argRaw(node, 0).trim();
      return this.inline(lastParsedArg(node), href ? withMark(marks, { type: "link", attrs: { href } }) : marks);
    }
    if (name === "url" || name === "nolinkurl") {
      const href = argRaw(node, 0).trim();
      return href ? [textNode(href, name === "url" ? withMark(marks, { type: "link", attrs: { href } }) : marks)] : [];
    }
    if (/^(?:cite|citep|citet|citealp|citealt|parencite|textcite|autocite|footcite|citeauthor|citeyear|citeyearpar|citetitle)/i.test(name)) {
      const keys = lastRawArg(node).split(",").map((key) => key.trim()).filter(Boolean);
      return keys.length ? [{ type: "citation", attrs: { keys } }] : [];
    }
    if (name === "ref" || name === "eqref" || name === "autoref" || name === "cref" || name === "Cref" || name === "nameref" || name === "vref" || name === "pageref") {
      const target = this.labelId(lastRawArg(node));
      return target ? [{ type: "crossRef", attrs: { target } }] : [];
    }
    if (name === "footnote" || name === "footnotetext") {
      const text = nodesToText(lastParsedArg(node)).trim();
      return text ? [{ type: "footnote", attrs: { text } }] : [];
    }
    if (name === "\\" || name === "newline" || name === "linebreak") return [{ type: "hardBreak" }];
    if (name === "and") return [{ type: "hardBreak" }];
    if (name === "quad" || name === "qquad" || name === "enspace" || name === "enskip" || name === "thinspace") {
      return [textNode(name === "qquad" ? "  " : " ", marks)];
    }
    if (name in ACCENTS) {
      const text = applyAccent(ACCENTS[name], nodesToText(lastParsedArg(node)));
      return text ? [textNode(text, marks)] : [];
    }
    if (name === "LaTeX") return [textNode("LaTeX", marks)];
    if (name === "TeX") return [textNode("TeX", marks)];
    if (name === "BibTeX") return [textNode("BibTeX", marks)];
    if (name === "today") return [textNode(formatToday(), marks)];
    if (name === "includegraphics") return [];
    if (name === "hspace" || name === "vspace") return [textNode(" ", marks)];
    if (name in TEXT_SYMBOLS) return [textNode(TEXT_SYMBOLS[name], marks)];
    if (name in CONTROL_SYMBOLS) return CONTROL_SYMBOLS[name] ? [textNode(CONTROL_SYMBOLS[name], marks)] : [];
    if (SILENT_COMMANDS.has(name)) return [];
    if (name === "text" || name === "mbox" || name === "fbox" || name === "makebox" || name === "framebox" || name === "ensuremath") {
      return this.inline(lastParsedArg(node), marks);
    }
    // Unknown commands: keep any text they carry instead of dropping a whole
    // sentence. The command itself is reported in the conversion notice.
    const carried = node.args.flatMap((value) => (value && value.children.length ? value.children : []));
    if (carried.length) {
      this.unknownCommands.add(name);
      return this.inline(carried, marks);
    }
    if (!node.args.length) this.unknownCommands.add(name);
    return [];
  }
}

/** Converts LaTeX source to the visual editor's document JSON. */
export function importLatex(source: string, options: LatexImportOptions = {}): LatexImportResult {
  return new LatexImporter(source, options).import();
}
