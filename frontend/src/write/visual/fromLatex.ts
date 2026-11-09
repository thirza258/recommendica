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
import { COMMAND_SIGNATURES, parseLatex, nodesToText } from "../latex/parser.ts";
import type { Argument, CommandNode, EnvironmentNode, LatexNode, MacroDefinition } from "../latex/parser.ts";
import { ACCENTS, CONTROL_SYMBOLS, TEXT_SYMBOLS, applyAccent, resolveColor } from "../latex/symbols.ts";
import { importPreamble, scanPreamble } from "../latexPreamble.ts";
import type { ImportedPreamble, PreambleStatement } from "../latexPreamble.ts";
import { marksKey, sortMarks } from "./marks.ts";
import { columnAligns, MULTILINE_MATH } from "./latexShapes.ts";
import { isImageSource } from "../assetSource.ts";

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

const RULE_COMMANDS = new Set(["toprule", "midrule", "bottomrule", "hline", "cline", "cmidrule", "addlinespace", "specialrule"]);
const SILENT_COMMANDS = new Set([
  "documentclass",
  "usepackage",
  "RequirePackage",
  "date",
  "affiliation",
  "institute",
  "institution",
  "address",
  "email",
  "orcid",
  "country",
  "city",
  "IEEEoverridecommandlockouts",
  "IEEEpeerreviewmaketitle",
  "protect",
  "relax",
  "null",
  "nobreak",
  "allowbreak",
  "leavevmode",
  "nopagebreak",
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
  "bibliographystyle",
  "addbibresource",
  "keywords",
  "title",
  "author",
  "item",
  "caption",
  "smallskip",
  "medskip",
  "bigskip",
  "hfill",
  "vfill",
  "par",
]);

/**
 * Definitions and settings that hold for the whole document wherever they are
 * written. When one is in the body, the visual editor keeps it with the
 * author's preamble (where the exporter writes it), so nothing that uses it
 * breaks.
 */
const DEFINITION_COMMANDS = new Set([
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
  "DeclareMathOperator",
  "newtheorem",
  "theoremstyle",
  "makeatletter",
  "makeatother",
  "newcounter",
  "newlength",
  "newcolumntype",
  "definecolor",
  "colorlet",
  "hypersetup",
  "lstset",
  "captionsetup",
  "setcitestyle",
  "urlstyle",
  "usetikzlibrary",
  "pgfplotsset",
  "tikzset",
  "graphicspath",
  "numberwithin",
  "titleformat",
  "titlespacing",
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

/** Text-formatting commands with a visual counterpart. */
const FORMATTING: Record<string, Mark> = {
  textbf: { type: "bold" },
  textit: { type: "italic" },
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

/**
 * Citation commands and the natbib command each one exports as ("" is the
 * theme's own \cite or \citep). biblatex's are mapped to natbib's, since the
 * exporter writes BibTeX. Other \cite… commands are kept as raw LaTeX.
 */
const CITE_COMMANDS: Record<string, string> = {
  cite: "",
  Cite: "",
  citep: "citep",
  citet: "citet",
  citealp: "citealp",
  citealt: "citealt",
  Citep: "Citep",
  Citet: "Citet",
  Citealp: "Citealp",
  Citealt: "Citealt",
  citeauthor: "citeauthor",
  Citeauthor: "Citeauthor",
  citeyear: "citeyear",
  citeyearpar: "citeyearpar",
  citenum: "citenum",
  parencite: "citep",
  Parencite: "Citep",
  textcite: "citet",
  Textcite: "Citet",
  autocite: "citep",
  Autocite: "Citep",
  footcite: "",
  supercite: "",
};

/** Environments that only change the font inside a paragraph. */
const INLINE_ENVIRONMENTS = new Set([
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
  "em",
  "sffamily",
  "ttfamily",
  "rmfamily",
  "upshape",
  "slshape",
  "mdseries",
  "normalfont",
]);

/** Commands a figure or table float may hold besides its picture, table and caption. */
const FLOAT_LAYOUT = new Set([
  "centering",
  "label",
  "vspace",
  "hspace",
  "smallskip",
  "medskip",
  "bigskip",
  "small",
  "footnotesize",
  "scriptsize",
  "tiny",
  "normalsize",
  "large",
  "noindent",
  "par",
  "protect",
  "relax",
  "hfill",
]);

/** An accent written over nothing (`\^{}`) is the accent character itself. */
const LONE_ACCENTS: Record<string, string> = {
  "'": "´",
  "`": "`",
  "^": "^",
  '"': "¨",
  "~": "~",
  "=": "¯",
  ".": "˙",
  u: "˘",
  v: "ˇ",
  H: "˝",
  c: "¸",
  k: "˛",
  r: "˚",
};

/** Font declarations: they change the marks of the text after them. */
const DECLARATIONS = new Set(["bfseries", "bf", "mdseries", "itshape", "it", "slshape", "sl", "em", "upshape", "ttfamily", "tt", "rmfamily", "sffamily", "normalfont", "rm", "sf", "sc", "scshape"]);

/** Commands the importer knows to take no arguments, so a group after them is text. */
const NO_ARGUMENTS = new Set(["and", "AND", "par", "item", "newpage", "clearpage", "appendix", "tableofcontents", "listoffigures", "listoftables", "maketitle", "hline", "tabularnewline", "quad", "qquad", "enspace", "enskip", "thinspace"]);

/** Environments the importer turns into visual blocks (others are kept as written). */
const STRUCTURAL_ENVIRONMENTS = new Set(["document", "abstract", "itemize", "enumerate", "description", "quote", "quotation", "center", "flushleft", "flushright", "acknowledgments"]);

/** Commands that stand for something other than their text (logos, today's date). */
const KEPT_AS_WRITTEN = new Set(["LaTeX", "LaTeXe", "TeX", "BibTeX", "today", "footnotemark", "footnotetext"]);

/** Commands whose body may sit in a paragraph as a kept LaTeX snippet. */
const BLOCK_ONLY_IN_MACROS =
  /\\(?:begin|end|par|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|item|maketitle|caption|label|newpage|clearpage|pagebreak|bibliography|printbibliography|input|include|title|author|footnote|footnotetext|cite[a-zA-Z]*|ref|eqref|autoref|cref|Cref|nameref|vref|pageref|newcommand|renewcommand|providecommand|def|gdef|edef|xdef|let|newenvironment|noindent|centering|vspace|\[|\]|\\)(?![a-zA-Z])/;

/**
 * Whether calls of a user macro can stay as written (`\method`, `\eg`): its
 * body makes text inside a paragraph, not structure. Macros that open
 * environments, make headings, citations or references are expanded instead,
 * so what they make is edited as itself.
 */
function inlineMacro(definition: MacroDefinition): boolean {
  const body = definition.body;
  return body.length < 600 && !BLOCK_ONLY_IN_MACROS.test(body) && !/\n[ \t]*\n/.test(body) && !body.includes("&") && !body.includes("$$");
}

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

/** The balanced `[…]` or `{…}` group at `index`, as written, and where it ends. */
function bracketGroup(source: string, index: number): { body: string; next: number } | null {
  const open = source[index];
  const close = open === "[" ? "]" : open === "{" ? "}" : "";
  if (!close) return null;
  let depth = 0;
  for (let at = index + 1; at < source.length; at++) {
    const ch = source[at];
    if (ch === "\\") {
      at++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      if (depth === 0) return close === "}" ? { body: source.slice(index + 1, at), next: at + 1 } : null;
      depth--;
    } else if (ch === close && depth === 0) return { body: source.slice(index + 1, at), next: at + 1 };
  }
  return null;
}

/** A command's arguments as written: `\citep[see][p.~5]{key}` → optional ["see", "p.~5"], braced ["key"]. */
function writtenArgs(source: string): { optional: string[]; braced: string[] } {
  const optional: string[] = [];
  const braced: string[] = [];
  const name = /^\\(?:[A-Za-z@]+|.)\*?/.exec(source);
  let index = name ? name[0].length : 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index++;
    const group = bracketGroup(source, index);
    if (!group) break;
    (source[index] === "[" ? optional : braced).push(group.body);
    index = group.next;
  }
  return { optional, braced };
}

/** `\href` and `\url` addresses escape a few characters that the link itself does not have. */
function unescapeUrl(url: string): string {
  return url.replace(/\\([%#&_~$])/g, "$1");
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

/** A text node with its marks in the schema's order, as the editor would store it. */
function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text, marks: sortMarks(marks) } : { type: "text", text };
}

/**
 * Adds text, joining it to the previous text node when the marks are the
 * same. Spaces collapse the way TeX collapses them, so a dropped command
 * between two spaces does not leave a double space in the paragraph.
 */
function pushText(out: JSONContent[], value: string, marks: Mark[]): void {
  const last = out[out.length - 1];
  const text = last?.type === "text" && last.text?.endsWith(" ") ? value.replace(/^ +/, "") : value;
  if (!text) return;
  if (last?.type === "text" && marksKey(last.marks as Mark[] | undefined) === marksKey(marks)) {
    last.text = (last.text ?? "") + text;
    return;
  }
  out.push(textNode(text, marks));
}

/** Adds converted inline content, joining text as `pushText` does. */
function append(out: JSONContent[], nodes: JSONContent[]): void {
  for (const node of nodes) {
    if (node.type === "text") pushText(out, node.text ?? "", (node.marks ?? []) as Mark[]);
    else out.push(node);
  }
}

function isWhitespaceNode(node: LatexNode): boolean {
  return node.type === "space" || node.type === "parbreak" || node.type === "tab";
}

const REFERENCE_COMMANDS = new Set(["ref", "eqref", "autoref", "cref", "Cref", "nameref", "vref", "pageref"]);

/**
 * "Section~\ref{sec:x}" becomes a cross-reference atom that already renders
 * "Section 2", so the word before it must not be exported twice. Returns
 * whether a word was removed.
 */
function trimReferenceWord(out: JSONContent[]): boolean {
  const last = out[out.length - 1];
  if (last?.type !== "text" || !last.text) return false;
  const trimmed = last.text.replace(/\b(?:section|sec\.|figure|fig\.?|table|tab\.|equation|eq\.?|eqn\.?)\s+$/i, "");
  if (trimmed === last.text) return false;
  last.text = trimmed;
  if (!last.text) out.pop();
  return true;
}

/**
 * The exporter writes a reference to an unnumbered heading as
 * ``\nameref{…}''; the quotes belong to that reference, not to the text.
 */
function stripNamerefQuotes(out: JSONContent[], namerefs: Set<JSONContent>): void {
  for (let index = 0; index < out.length; index++) {
    const node = out[index];
    if (!namerefs.has(node)) continue;
    const before = out[index - 1];
    const after = out[index + 1];
    if (before?.type !== "text" || after?.type !== "text" || !before.text?.endsWith("“") || !after.text?.startsWith("”")) continue;
    before.text = before.text.slice(0, -1);
    after.text = after.text.slice(1);
    // The exporter's own form, which it writes again from a plain reference.
    if (node.attrs) delete node.attrs.command;
  }
  for (let index = out.length - 1; index >= 0; index--) {
    if (out[index].type === "text" && !out[index].text) out.splice(index, 1);
  }
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
  if (node.type === "figure" || node.type === "tableFigure" || node.type === "table" || node.type === "pageBreak" || node.type === "bibliography") return true;
  if (node.type === "rawLatex" || node.type === "rawInline" || node.type === "horizontalRule" || node.type === "codeBlock") return true;
  return Boolean(node.content?.some(hasContent));
}

/** Plain text of converted inline content, for the text a footnote shows. */
function inlineText(content: JSONContent[]): string {
  return content
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text ?? "";
        case "mathInline":
          return `$${String(node.attrs?.latex ?? "")}$`;
        case "rawInline":
          return String(node.attrs?.source ?? "");
        case "citation":
          return `[${((node.attrs?.keys as string[] | undefined) ?? []).join(", ")}]`;
        case "hardBreak":
          return " ";
        default:
          return node.content ? inlineText(node.content) : "";
      }
    })
    .join("");
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

/** Verbatim text starts after the line of \begin{…} and ends before the line of \end{…}. */
function verbatimBody(raw: string): string {
  return raw.replace(/^[ \t]*\n/, "").replace(/\n[ \t]*$/, "");
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

type TableCell = { content: JSONContent[]; colspan: number; rowspan: number };

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
  /** Title-page declarations from the body (\subjclass, \date), kept with the preamble. */
  private readonly frontMatter: string[] = [];
  /** Definitions written in the body, kept with the preamble. */
  private readonly definitions: string[] = [];
  private readonly keptDefinitions = new Set<LatexNode>();
  /** Source spans of raw blocks, so adjacent ones can be joined again. */
  private readonly rawSpans = new WeakMap<JSONContent, { start: number; end: number }>();

  constructor(source: string, options: LatexImportOptions) {
    this.source = source.replace(/\r\n?/g, "\n");
    this.files = options.files ?? {};
    this.assets = options.assets ?? {};
    this.fallbackBib = options.bib ?? "";
  }

  import(): LatexImportResult {
    const parsed = parseLatex(this.source, {
      files: this.files,
      captureSource: true,
      keepDefinitions: true,
      keepEnvironments: true,
      keepMacro: (name, definition) => this.keepsMacro(name, definition),
      greedyArgs: (name) => !(SILENT_COMMANDS.has(name) || DECLARATIONS.has(name) || NO_ARGUMENTS.has(name) || DEFINITION_COMMANDS.has(name) || RULE_COMMANDS.has(name) || name in TEXT_SYMBOLS),
    });
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
    if (bib && !blocks.some((node) => node.type === "bibliography") && this.hasCitations(blocks) && !this.hasOwnReferenceList(blocks)) {
      blocks.push({ type: "bibliography" });
    }

    if (this.unknownCommands.size) {
      this.warnings.push(`Unsupported LaTeX commands were kept as text or omitted: ${[...this.unknownCommands].slice(0, 6).map((name) => `\\${name}`).join(", ")}${this.unknownCommands.size > 6 ? "…" : ""}.`);
    }
    if (this.missingRefs.size) {
      this.warnings.push(`${this.missingRefs.size} cross-reference${this.missingRefs.size === 1 ? "" : "s"} point to labels that were not found; they are kept and show as ?? until the label exists.`);
    }
    if (own?.biblatex) this.warnings.push("biblatex was replaced by BibTeX (\\bibliography), which the visual editor formats; biblatex options were left out.");
    const included = this.includedFiles();
    if (included.length) {
      this.warnings.push(`The text of ${included.map((name) => `“${name}”`).join(", ")} is edited here as part of the paper; after an edit, switching back writes it into main.tex.`);
    }
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
      preamble: [own?.preamble ?? "", ...this.definitions, ...this.frontMatter].filter(Boolean).join("\n"),
      warnings: [...new Set(this.warnings)],
    };
  }

  /** Text macros stay as written; redefined LaTeX commands and structural macros are expanded. */
  private keepsMacro(name: string, definition: MacroDefinition): boolean {
    if (name in COMMAND_SIGNATURES || SILENT_COMMANDS.has(name) || DEFINITION_COMMANDS.has(name) || name in FORMATTING) return false;
    if (name in TEXT_SYMBOLS || name in ACCENTS || name in CITE_COMMANDS || REFERENCE_COMMANDS.has(name)) return false;
    return inlineMacro(definition);
  }

  /** Project files the body pulls in with \input, \include or \subfile. */
  private includedFiles(): string[] {
    const body = this.source.slice(Math.max(0, this.source.indexOf("\\begin{document}")));
    const names: string[] = [];
    for (const match of body.matchAll(/^[^%\n]*?\\(?:input|include|subfile)\s*\{([^}]+)\}/gm)) {
      const name = match[1].trim();
      const found = [name, `${name}.tex`].find((candidate) => candidate in this.files);
      if (found && !names.includes(found)) names.push(found);
    }
    return names;
  }

  /** A raw thebibliography or a \bibliography in a raw block is the paper's own reference list. */
  private hasOwnReferenceList(blocks: JSONContent[]): boolean {
    return blocks.some((block) => block.type === "rawLatex" && /\\begin\{thebibliography\}|\\bibliography\{|\\printbibliography/.test(String(block.attrs?.source ?? "")));
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
    const match = /^\s*(?:key\s*-?\s*words|index\s+terms)\s*([:.—–-])?\s*/i.exec(first.text);
    if (!match || (!labelled && !match[1])) return null;
    const content: JSONContent[] = [];
    const remainder = first.text.slice(match[0].length);
    if (remainder) content.push(textNode(remainder, marks));
    content.push(...rest.map((node) => ({ ...node })));
    const head = content[0];
    if (head?.type === "text") head.text = (head.text ?? "").replace(/^[\s:.—–-]+/, "");
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

  /**
   * Labels become node ids exactly as written (`intro`, `fig:plot`), so the
   * exporter writes the same \label and every \ref to it — including those
   * inside kept LaTeX — still finds it.
   */
  private registerLabel(label: string, kind: LabelKind): string {
    const clean = label.trim();
    if (!clean) return "";
    const existing = this.labels.get(clean);
    if (existing) return existing.id;
    let id = clean;
    let index = 2;
    while (this.usedIds.has(id)) id = `${clean}-${index++}`;
    this.usedIds.add(id);
    this.labels.set(clean, { kind, id });
    return id;
  }

  private labelId(label: string): string {
    const clean = label.trim();
    if (!clean) return "";
    const existing = this.labels.get(clean);
    if (existing) return existing.id;
    this.missingRefs.add(clean);
    return this.registerLabel(clean, "unknown");
  }

  /** The attributes that tie a node to its LaTeX label. */
  private labelAttrs(label: string, kind: LabelKind): { id: string; label?: string } {
    const clean = label.trim();
    if (!clean) return { id: "" };
    const id = this.registerLabel(clean, kind);
    return id === clean ? { id, label: clean } : { id };
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
          // A label outside a float or heading stays as written in the text,
          // so references to it keep working.
          const label = argRaw(node, 0);
          if (label) this.registerLabel(label, "unknown");
        }
        continue;
      }
      if (node.type === "environment") {
        // Labels get the kind of the block they end up in: a visual float,
        // or LaTeX kept as written.
        const kind = this.floatKind(node);
        if (kind) {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, kind);
        } else if (STRUCTURAL_ENVIRONMENTS.has(node.name) || INLINE_ENVIRONMENTS.has(node.name)) {
          this.collectLabels(node.children);
        } else {
          for (const label of this.findLabels(node.children)) this.registerLabel(label, "unknown");
        }
        continue;
      }
      if (node.type === "math") {
        const base = node.env?.replace(/\*$/, "") ?? "";
        if (MULTILINE_MATH.has(base)) {
          for (const match of node.content.matchAll(/\\label\s*\{([^}]*)\}/g)) this.registerLabel(match[1], "mathBlock");
        } else {
          const [first, ...rest] = cleanMath(node.content).labels;
          if (first) this.registerLabel(first, "mathBlock");
          for (const label of rest) this.registerLabel(label, "unknown");
        }
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
    const add = (produced: JSONContent) => {
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
    };
    const flush = () => {
      const run = inlineRun;
      inlineRun = [];
      const content = trimInline(this.inline(run));
      if (!content.length) return;
      const raw = this.rawRun(run, content);
      if (raw) add(raw);
      else {
        out.push({ type: "paragraph", content });
        separated = false;
      }
    };
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "space") {
        if (inlineRun.length) inlineRun.push(node);
        continue;
      }
      if (node.type === "parbreak" || (node.type === "command" && node.name === "par")) {
        flush();
        separated = true;
        continue;
      }
      const block = this.blockAt(nodes, index);
      if (block) {
        flush();
        for (const produced of block.nodes) add(produced);
        index = block.next - 1;
        continue;
      }
      inlineRun.push(node);
    }
    flush();
    return out.filter(hasContent);
  }

  /**
   * A paragraph that is only kept LaTeX (`\FloatBarrier`, `\setlength…`, a
   * user macro on its own line) is a LaTeX block, not text.
   */
  private rawRun(run: LatexNode[], content: JSONContent[]): JSONContent | null {
    if (!content.some((node) => node.type === "rawInline")) return null;
    if (!content.every((node) => node.type === "rawInline" || (node.type === "text" && !node.text?.trim()))) return null;
    const written = run.filter((node) => !isWhitespaceNode(node));
    // Definitions in the run already went to the preamble.
    const exact = written.every((node) => (node.type === "command" || node.type === "environment") && !node.generated && !this.keptDefinitions.has(node));
    if (exact && written.length) {
      const start = written[0].start;
      const end = written[written.length - 1].end;
      const block = { type: "rawLatex", attrs: { source: this.source.slice(start, end).trim() } };
      this.rawSpans.set(block, { start, end });
      return block;
    }
    const source = content.map((node) => (node.type === "rawInline" ? String(node.attrs?.source ?? "") : " ")).join("").trim();
    return { type: "rawLatex", attrs: { source } };
  }

  private blockAt(nodes: LatexNode[], index: number): { nodes: JSONContent[]; next: number } | null {
    const node = nodes[index];
    if (node.type === "math" && node.display) return { nodes: this.mathBlock(node), next: index + 1 };
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
      return { nodes: [{ type: "heading", attrs: { level, numbered: !node.star, ...this.labelAttrs(label, "heading") }, content }], next };
    }

    if (FRONT_MATTER.has(node.name)) {
      // Declarations \maketitle typesets: valid in the preamble, where the
      // exporter writes the author's statements back.
      const text = this.exactSource(node)?.trim() ?? "";
      if (text && (node.name !== "date" || lastRawArg(node).trim() || lastParsedArg(node).length)) this.frontMatter.push(text);
      return { nodes: [], next: index + 1 };
    }

    switch (node.name) {
      case "maketitle":
      case "title":
      case "author":
      case "affiliation":
      case "institute":
      case "institution":
      case "address":
      case "email":
      case "keywords":
      case "bibliographystyle":
      case "addbibresource":
      case "caption":
      case "centering":
      case "raggedright":
      case "raggedleft":
      case "noindent":
      case "indent":
        return { nodes: [], next: index + 1 };
      case "tableofcontents":
      case "listoffigures":
      case "listoftables":
      case "appendix":
      case "nocite":
        // Whole-document lists and switches the visual editor cannot show
        // stay in the paper as written.
        return { nodes: [this.raw(node)], next: index + 1 };
      case "bibliography":
      case "printbibliography":
        return { nodes: [{ type: "bibliography" }], next: index + 1 };
      case "newpage":
      case "clearpage":
      case "pagebreak":
        return { nodes: [{ type: "pageBreak" }], next: index + 1 };
      case "rule":
        // A full-width rule is a horizontal line; other rules are inline.
        if (/^\\(?:linewidth|textwidth|columnwidth|hsize)$/.test(argRaw(node, 1).trim())) return { nodes: [{ type: "horizontalRule" }], next: index + 1 };
        return null;
      case "includegraphics":
        // A picture outside a figure has no caption or number; it stays as written.
        return { nodes: [this.raw(node)], next: index + 1 };
      default:
        return null;
    }
  }

  /** Display math: one equation, or a multi-line environment kept as written. */
  private mathBlock(node: { content: string; env: string | null; envArg: string | null }): JSONContent[] {
    const env = node.env;
    const base = env ? env.replace(/\*$/, "") : null;
    // \[…\], $$…$$, displaymath and starred environments have no number.
    const starred = env === null || env.endsWith("*") || base === "displaymath" || base === "math";
    if (base && MULTILINE_MATH.has(base)) {
      const latex = node.content.trim();
      if (!latex) return [];
      // The labels stay in the rows they label; the first one names the block.
      const first = /\\label\s*\{([^}]*)\}/.exec(latex)?.[1] ?? "";
      for (const match of latex.matchAll(/\\label\s*\{([^}]*)\}/g)) this.registerLabel(match[1], "mathBlock");
      const attrs: Record<string, unknown> = { latex, numbered: !starred, ...this.labelAttrs(first, "mathBlock"), env: base };
      if (base === "alignat" && node.envArg) attrs.envArg = node.envArg.trim();
      return [{ type: "mathBlock", attrs }];
    }
    const math = cleanMath(node.content);
    if (!math.latex) return [];
    return [{ type: "mathBlock", attrs: { latex: math.latex, numbered: !starred && math.numbered, ...this.labelAttrs(math.labels[0] ?? "", "mathBlock") } }];
  }

  private environmentBlock(node: EnvironmentNode, next: number): { nodes: JSONContent[]; next: number } | null {
    if (node.name === "document") return { nodes: this.blocks(node.children), next };
    if (node.name === "abstract") {
      const children = this.blocks(node.children);
      // Keywords are often the abstract's last line; they become their own block.
      const keywords = children.findIndex((child) => this.keywordsContent(child) !== null);
      const keywordsNode = keywords === -1 ? null : { type: "paperKeywords", content: this.keywordsContent(children[keywords]) ?? [] };
      const rest = children.filter((_child, index) => index !== keywords);
      // The abstract holds paragraphs; anything else keeps it as written.
      if (rest.some((child) => child.type !== "paragraph")) return { nodes: [this.raw(node)], next };
      const abstract = { type: "paperAbstract", content: rest.length ? rest : [{ type: "paragraph" }] };
      return { nodes: keywordsNode ? [abstract, keywordsNode] : [abstract], next };
    }
    if (node.name === "IEEEkeywords" || node.name === "keywords") {
      return { nodes: [{ type: "paperKeywords", content: trimInline(this.inline(node.children)) }], next };
    }
    if (node.name === "itemize" || node.name === "enumerate" || node.name === "description") {
      return { nodes: [this.list(node)], next };
    }
    const float = this.floatKind(node);
    if (float === "figure") return { nodes: [this.figure(node)], next };
    if (float === "tableFigure") return { nodes: [this.tableFigure(node)], next };
    if (node.name === "tabular" && this.simpleTabular(node)) {
      return { nodes: [this.tableNode(node)], next };
    }
    if (node.name === "verbatim") {
      const raw = verbatimBody(node.raw ?? "");
      return { nodes: [{ type: "codeBlock", content: raw ? [{ type: "text", text: raw }] : [] }], next };
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
      return { nodes: this.mathBlock({ content, env: node.name, envArg: null }), next };
    }
    return { nodes: [this.raw(node)], next };
  }

  private alignBlocks(blocks: JSONContent[], align: string): JSONContent[] {
    for (const block of blocks) {
      if (block.type === "paragraph" || block.type === "heading") block.attrs = { ...(block.attrs ?? {}), textAlign: align };
    }
    return blocks;
  }

  /** A command's or environment's LaTeX as written, or null when it cannot be known exactly. */
  private exactSource(node: LatexNode): string | null {
    if (node.type !== "command" && node.type !== "environment") return null;
    if (node.source !== undefined) return node.source;
    return node.generated ? null : this.source.slice(node.start, node.end);
  }

  private raw(node: LatexNode): JSONContent {
    const exact = this.exactSource(node);
    const raw = { type: "rawLatex", attrs: { source: (exact ?? this.source.slice(node.start, node.end)).trim() } };
    if ((node.type === "command" || node.type === "environment") && !node.generated) this.rawSpans.set(raw, { start: node.start, end: node.end });
    return raw;
  }

  /** LaTeX the visual editor keeps as written inside a paragraph; null when it cannot be known exactly. */
  private rawInline(node: LatexNode): JSONContent[] | null {
    const source = this.exactSource(node);
    if (source === null) return null;
    const written = source.replace(/\s+$/, "");
    if (!written) return [];
    // Blanks after a control word belong to the text after it.
    return written.length < source.length ? [{ type: "rawInline", attrs: { source: written } }, { type: "text", text: " " }] : [{ type: "rawInline", attrs: { source: written } }];
  }

  /** Body definitions go with the preamble, in their order. */
  private keepDefinition(node: LatexNode): void {
    if (this.keptDefinitions.has(node)) return;
    this.keptDefinitions.add(node);
    const source = this.exactSource(node)?.trim();
    if (source) this.definitions.push(source);
  }

  // ── Lists, figures and tables ─────────────────────────────────────────────

  private list(node: EnvironmentNode): JSONContent {
    const ordered = node.name === "enumerate";
    const description = node.name === "description";
    const items: JSONContent[] = [];
    let current: LatexNode[] = [];
    let label = "";
    let start = 1;
    const flush = () => {
      const hasText = current.some((child) => !isWhitespaceNode(child));
      if (!hasText && !label) {
        current = [];
        return;
      }
      const content = this.blocks(current);
      if (!content.length || content[0].type !== "paragraph") content.unshift({ type: "paragraph" });
      if (label) {
        const first = content[0];
        first.content = [{ type: "text", text: label, marks: [{ type: "bold" }] }, { type: "text", text: " " }, ...(first.content ?? [])];
      }
      items.push({ type: "listItem", content });
      current = [];
      label = "";
    };
    let started = false;
    for (const child of node.children) {
      if (child.type === "command" && child.name === "item") {
        if (started) flush();
        else {
          // Anything before the first \item is list setup, such as the
          // counter a numbered list continues from.
          for (const setup of current) {
            if (setup.type === "command" && setup.name === "setcounter" && /^enum(?:i|ii|iii|iv)$/.test(argRaw(setup, 0).trim())) {
              const value = Number.parseInt(argRaw(setup, 1), 10);
              if (Number.isFinite(value) && value >= 0) start = value + 1;
            }
          }
          current = [];
        }
        started = true;
        label = child.args[0] ? plainText({ type: "doc", content: [{ type: "paragraph", content: trimInline(this.inline(argChildren(child, 0))) }] }) : "";
      } else if (started || !isWhitespaceNode(child)) {
        current.push(child);
      }
    }
    flush();
    if (!items.length) items.push({ type: "listItem", content: [{ type: "paragraph" }] });
    const attrs: Record<string, unknown> = {};
    if (ordered && start !== 1) attrs.start = start;
    if (description) attrs.latexEnv = "description";
    const options = argRaw(node, 0).trim();
    if (options) attrs.latexOptions = options;
    const list: JSONContent = { type: ordered ? "orderedList" : "bulletList", content: items };
    if (Object.keys(attrs).length) list.attrs = attrs;
    return list;
  }

  private findCommand(nodes: LatexNode[], name: string): CommandNode | null {
    for (const node of nodes) {
      if (node.type === "command" && node.name === name) return node;
      if (node.type === "command") {
        for (const value of node.args) {
          const found = value ? this.findCommand(value.children, name) : null;
          if (found) return found;
        }
      } else if (node.type === "environment") {
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

  /**
   * Whether a figure or table environment is one the visual editor shows as
   * it is: at most one picture (figures) or exactly one plain tabular (tables),
   * at most one caption, and nothing else but labels and layout commands.
   * Subfigures, several pictures, table notes, resized tables and the like
   * stay as written.
   */
  private floatKind(node: EnvironmentNode): "figure" | "tableFigure" | null {
    const figure = node.name === "figure" || node.name === "figure*";
    const table = node.name === "table" || node.name === "table*";
    if (!figure && !table) return null;
    let pictures = 0;
    let captions = 0;
    let tabulars = 0;
    let simple = true;
    const visit = (nodes: LatexNode[]) => {
      for (const child of nodes) {
        if (!simple) return;
        switch (child.type) {
          case "space":
          case "parbreak":
            break;
          case "text":
            if (child.value.trim()) simple = false;
            break;
          case "group":
            visit(child.children);
            break;
          case "environment":
            if (child.name === "center") visit(child.children);
            else if (table && child.name === "tabular" && this.simpleTabular(child)) tabulars++;
            else simple = false;
            break;
          case "command":
            if (child.name === "includegraphics") pictures++;
            else if (child.name === "caption") {
              captions++;
              // A short caption (\caption[…]{…}) or \caption* has no visual counterpart.
              if (child.args[0] || child.star) simple = false;
            } else if (figure && child.name === "fbox" && /Figure placeholder/.test(nodesToText(lastParsedArg(child)))) {
              // The exporter's stand-in for a picture it could not include.
            } else if (!FLOAT_LAYOUT.has(child.name)) simple = false;
            break;
          default:
            simple = false;
        }
      }
    };
    visit(node.children);
    if (!simple || captions > 1) return null;
    if (figure) return pictures <= 1 ? "figure" : null;
    return tabulars === 1 && pictures === 0 ? "tableFigure" : null;
  }

  /** A tabular the visual table can hold: rows of cells, rules and spans. */
  private simpleTabular(node: EnvironmentNode): boolean {
    return !node.children.some((child) => child.type === "environment" && !INLINE_ENVIRONMENTS.has(child.name));
  }

  private assetUrl(path: string): string {
    const clean = path.trim().replace(/^["']|["']$/g, "");
    if (!clean) return "";
    if (/^https:\/\//i.test(clean)) return clean;
    const candidates = [clean, clean.replace(/^\.\//, ""), basename(clean)];
    // Only pictures the visual editor can show; a PDF figure keeps its path.
    const shown = (url: string | undefined) => (url && isImageSource(url) ? url : "");
    for (const candidate of candidates) {
      if (candidate in this.assets) return shown(this.assets[candidate]);
      // \includegraphics may leave out the extension.
      const withExtension = Object.keys(this.assets).find((name) => name.replace(/\.[a-z0-9]+$/i, "") === candidate && isImageSource(this.assets[name]));
      if (withExtension) return this.assets[withExtension];
    }
    return "";
  }

  private figure(node: EnvironmentNode): JSONContent {
    const labels = this.findLabels(node.children);
    const graphic = this.findCommand(node.children, "includegraphics");
    const caption = this.findCommand(node.children, "caption");
    const attrs: Record<string, unknown> = { src: "", alt: "", width: 80, ...this.labelAttrs(labels[0] ?? "", "figure") };
    if (graphic) {
      const path = argRaw(graphic, 1).trim();
      attrs.src = this.assetUrl(path);
      attrs.alt = basename(path).replace(/\.[^.]+$/, "");
      attrs.width = imageWidth(argRaw(graphic, 0));
      if (path && !attrs.src) {
        this.warnings.push(`Image “${path}” was not found in this project.`);
        // Kept, so the LaTeX source still includes it once the file is uploaded.
        attrs.path = path;
      }
    } else {
      // The exporter's placeholder for a web image links to the image.
      const link = this.findCommand(node.children, "href");
      const href = link ? unescapeUrl(argRaw(link, 0).trim()) : "";
      if (/^https:\/\//i.test(href)) attrs.src = href;
      const box = this.findCommand(node.children, "parbox");
      const width = box ? /^([\d.]+)\\(?:linewidth|textwidth|columnwidth)$/.exec(argRaw(box, 3).trim()) : null;
      if (width) attrs.width = Math.min(100, Math.max(10, Math.round(Number(width[1]) * 100)));
    }
    if (node.name === "figure*") attrs.wide = true;
    const captionContent = caption ? trimInline(this.inline(lastParsedArg(caption))) : [];
    return { type: "figure", attrs, content: [{ type: "figcaption", content: captionContent }] };
  }

  private tableFigure(node: EnvironmentNode): JSONContent {
    const tabular = this.findEnvironment(node.children, new Set(["tabular"])) as EnvironmentNode;
    const labels = this.findLabels(node.children);
    const caption = this.findCommand(node.children, "caption");
    const attrs: Record<string, unknown> = this.labelAttrs(labels[0] ?? "", "tableFigure");
    if (node.name === "table*") attrs.wide = true;
    return {
      type: "tableFigure",
      attrs,
      content: [{ type: "figcaption", content: caption ? trimInline(this.inline(lastParsedArg(caption))) : [] }, this.tableNode(tabular)],
    };
  }

  private tableNode(node: EnvironmentNode): JSONContent {
    const spec = argRaw(node, 1).trim();
    const aligns = columnAligns(spec);
    const { rows: parsed, rules } = this.tableRows(node.children);
    // A cell under a \multirow is an empty placeholder in the source; the
    // table model leaves it out, as the spanning cell covers it.
    const covered: number[] = [];
    const rows = parsed.map((row) => {
      const kept: TableCell[] = [];
      let column = 0;
      for (const cell of row) {
        if (covered[column] > 0 && !cell.content.length && cell.rowspan === 1) {
          for (let span = 0; span < cell.colspan; span++) covered[column + span] = Math.max(0, (covered[column + span] ?? 0) - 1);
          column += cell.colspan;
          continue;
        }
        if (covered[column] > 0) covered[column]--;
        kept.push(cell);
        for (let span = 0; span < cell.colspan; span++) {
          if (cell.rowspan > 1) covered[column + span] = cell.rowspan - 1;
        }
        column += cell.colspan;
      }
      for (let rest = column; rest < covered.length; rest++) if (covered[rest] > 0) covered[rest]--;
      return kept;
    });
    if (!rows.length) rows.push([{ content: [], colspan: 1, rowspan: 1 }]);
    const width = (row: TableCell[]) => row.reduce((sum, cell) => sum + cell.colspan, 0);
    const columns = Math.max(1, aligns.length, ...rows.map(width));
    // The first row is a header when a rule separates it from the rest.
    const header = rows.length > 1 && Boolean(rules[1]?.trim());
    const table: JSONContent = {
      type: "table",
      content: rows.map((row, rowIndex) => {
        let column = 0;
        const cellType = rowIndex === 0 && header ? "tableHeader" : "tableCell";
        const cells: JSONContent[] = row.map((cell) => {
          const align = aligns[column];
          column += cell.colspan;
          const paragraph: JSONContent = { type: "paragraph", content: cell.content };
          if (cell.colspan === 1 && (align === "c" || align === "r")) paragraph.attrs = { textAlign: align === "c" ? "center" : "right" };
          return { type: cellType, attrs: { colspan: cell.colspan, rowspan: cell.rowspan, colwidth: null }, content: [paragraph] };
        });
        return { type: "tableRow", content: cells };
      }),
    };
    // Rows covered by a rowspan are short; the rest are padded to full width.
    const occupied = new Array<number>(rows.length).fill(0);
    rows.forEach((row, rowIndex) => {
      for (const cell of row) for (let below = 1; below < cell.rowspan && rowIndex + below < rows.length; below++) occupied[rowIndex + below] += cell.colspan;
    });
    table.content?.forEach((row, rowIndex) => {
      let filled = width(rows[rowIndex]) + occupied[rowIndex];
      while (filled < columns) {
        row.content?.push({ type: rowIndex === 0 && header ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] });
        filled++;
      }
    });
    const attrs: Record<string, unknown> = {};
    if (spec) attrs.latexSpec = spec;
    if (rules.length === rows.length + 1 && rules.some(Boolean)) attrs.latexRules = rules;
    if (Object.keys(attrs).length) table.attrs = attrs;
    return table;
  }

  /** Cells by row, and the rule commands written at each row boundary (before row 0 … after the last). */
  private tableRows(nodes: LatexNode[]): { rows: TableCell[][]; rules: string[] } {
    const rows: TableCell[][] = [];
    const rules: string[] = [""];
    let row: TableCell[] = [];
    let cell: LatexNode[] = [];
    const flushCell = () => {
      row.push(this.tableCell(cell));
      cell = [];
    };
    const flushRow = () => {
      if (cell.some((node) => !isWhitespaceNode(node)) || row.length) {
        flushCell();
        rows.push(row);
        rules.push("");
        row = [];
      }
      cell = [];
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
      if (child.type === "command" && RULE_COMMANDS.has(child.name)) {
        const written = this.exactSource(child)?.trim() ?? `\\${child.name}`;
        rules[rules.length - 1] = rules[rules.length - 1] ? `${rules[rules.length - 1]} ${written}` : written;
        continue;
      }
      if (child.type === "space" || child.type === "parbreak") {
        if (cell.length) cell.push(child);
        continue;
      }
      cell.push(child);
    }
    flushRow();
    return { rows, rules };
  }

  private tableCell(nodes: LatexNode[]): TableCell {
    let content = nodes;
    let colspan = 1;
    let rowspan = 1;
    // \multicolumn and \multirow may follow a prefix such as \cellcolor;
    // the prefix moves inside the spanning cell.
    const unwrap = (name: string, take: (found: CommandNode) => LatexNode[]): void => {
      const found = content.find((node): node is CommandNode => node.type === "command" && node.name === name);
      if (!found) return;
      const value = Math.max(1, Number.parseInt(argRaw(found, 0), 10) || 1);
      if (name === "multicolumn") colspan = value;
      else rowspan = value;
      content = [...content.filter((node) => node !== found), ...take(found)];
    };
    unwrap("multicolumn", (found) => argChildren(found, 2));
    unwrap("multirow", (found) => argChildren(found, 4));
    const meaningful = content.filter((node) => node.type !== "space" && node.type !== "parbreak");
    const first = meaningful[0];
    if (meaningful.length === 1 && first?.type === "command" && (first.name === "makecell" || first.name === "shortstack")) {
      content = lastParsedArg(first);
    }
    return { content: trimInline(this.inline(content)), colspan, rowspan };
  }

  // ── Inline content ────────────────────────────────────────────────────────

  private inline(nodes: LatexNode[], marks: Mark[] = []): JSONContent[] {
    const out: JSONContent[] = [];
    const namerefs = new Set<JSONContent>();
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
          append(out, this.inline(node.children, current));
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
            const reference = this.reference(node, out);
            for (const produced of reference) if (node.name === "nameref") namerefs.add(produced);
            append(out, reference);
            break;
          }
          append(out, this.inlineCommand(node, current));
          break;
        }
        case "environment": {
          if (INLINE_ENVIRONMENTS.has(node.name)) {
            // Font environments (\begin{small} … \end{small}) carry text
            // but no structure of their own.
            const highlight = this.highlightColor;
            append(out, this.inline(node.children, this.environmentMarks(node.name, current)));
            this.highlightColor = highlight;
          } else {
            append(out, this.rawInline(node) ?? this.inline(node.children, current));
          }
          break;
        }
        default:
          break;
      }
    }
    if (namerefs.size) stripNamerefQuotes(out, namerefs);
    return out;
  }

  private environmentMarks(name: string, marks: Mark[]): Mark[] {
    switch (name) {
      case "bfseries":
        return withMark(marks, { type: "bold" });
      case "itshape":
      case "slshape":
      case "em":
        return withMark(marks, { type: "italic" });
      case "ttfamily":
        return withMark(marks, { type: "code" });
      default:
        return marks;
    }
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

  /**
   * A reference: a cross-reference atom, which keeps the command it was
   * written with unless the word before it was taken in ("Section~\ref{…}").
   * References to several labels at once stay as written.
   */
  private reference(node: CommandNode, out: JSONContent[]): JSONContent[] {
    const targets = lastRawArg(node).split(",").map((target) => target.trim()).filter(Boolean);
    if (targets.length !== 1) return this.rawInline(node) ?? [];
    const known = this.labels.get(targets[0]);
    const trimmed = node.name !== "pageref" && node.name !== "nameref" && known !== undefined && known.kind !== "unknown" && trimReferenceWord(out);
    const target = this.labelId(targets[0]);
    if (!target) return [];
    if (trimmed) return [{ type: "crossRef", attrs: { target } }];
    return [{ type: "crossRef", attrs: { target, command: `${node.name}${node.star ? "*" : ""}` } }];
  }

  private citation(node: CommandNode): JSONContent[] | null {
    const command = CITE_COMMANDS[node.name];
    if (command === undefined) return null;
    const keys = lastRawArg(node).split(",").map((key) => key.trim()).filter(Boolean);
    if (!keys.length) return [];
    const attrs: Record<string, unknown> = { keys };
    if (command) attrs.command = `${command}${node.star ? "*" : ""}`;
    const source = this.exactSource(node);
    const notes = source ? writtenArgs(source).optional : [];
    if (notes.length >= 2) {
      attrs.pre = notes[0].trim();
      attrs.post = notes[1].trim();
    } else if (notes.length === 1) {
      attrs.post = notes[0].trim();
    }
    if (attrs.pre === "") delete attrs.pre;
    if (attrs.post === "" && !attrs.pre) delete attrs.post;
    return [{ type: "citation", attrs }];
  }

  /**
   * A footnote keeps its LaTeX when it holds more than plain text (math,
   * citations, formatting), so nothing in it is lost; `text` is what the
   * visual editor shows.
   */
  private footnote(node: CommandNode): JSONContent[] | null {
    if (node.args[0]) return null;
    const content = trimInline(this.inline(lastParsedArg(node), []));
    const text = inlineText(content).replace(/\s+/g, " ").trim();
    const plain = content.every((child) => child.type === "text" && !child.marks?.length);
    if (plain) return text ? [{ type: "footnote", attrs: { text } }] : [];
    const source = this.exactSource(node);
    const latex = source ? writtenArgs(source).braced.pop()?.trim() ?? "" : "";
    if (!latex) return null;
    return [{ type: "footnote", attrs: { text, latex } }];
  }

  private inlineCommand(node: CommandNode, marks: Mark[]): JSONContent[] {
    const name = node.name;
    // A user macro kept as written (\method, \eg).
    if (node.macro) return this.rawInline(node) ?? [];
    if (DEFINITION_COMMANDS.has(name)) {
      if (name === "definecolor") this.defineColor(argRaw(node, 0), argRaw(node, 1).trim() || null, argRaw(node, 2));
      if (name === "colorlet") this.defineColor(argRaw(node, 0), null, argRaw(node, 1));
      this.keepDefinition(node);
      return [];
    }
    if (FORMATTING[name]) return this.inline(lastParsedArg(node), withMark(marks, FORMATTING[name]));
    if (name === "emph") {
      // \emph inside italic text is upright.
      const italic = marks.some((mark) => mark.type === "italic");
      return this.inline(lastParsedArg(node), italic ? withoutMark(marks, "italic") : withMark(marks, { type: "italic" }));
    }
    if (name === "textup" || name === "textnormal") return this.inline(lastParsedArg(node), withoutMark(withoutMark(marks, "italic"), "bold"));
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
    if (name === "href") {
      const href = unescapeUrl(argRaw(node, 0).trim());
      return this.inline(lastParsedArg(node), href ? withMark(marks, { type: "link", attrs: { href } }) : marks);
    }
    if (name === "url" || name === "nolinkurl") {
      const href = unescapeUrl(argRaw(node, 0).trim());
      return href ? [textNode(href, name === "url" ? withMark(marks, { type: "link", attrs: { href } }) : marks)] : [];
    }
    if (/^cite/i.test(name) || name in CITE_COMMANDS) return this.citation(node) ?? this.rawInline(node) ?? [];
    if (name === "footnote") return this.footnote(node) ?? this.rawInline(node) ?? [];
    if (name === "\\" || name === "newline" || name === "linebreak") return [{ type: "hardBreak" }];
    if (name === "and") return [{ type: "hardBreak" }];
    if (name === "-") return [textNode("­", marks)];
    if (name === "quad" || name === "qquad" || name === "enspace" || name === "enskip" || name === "thinspace") {
      return [textNode(name === "qquad" ? "  " : " ", marks)];
    }
    if (name in ACCENTS) {
      const base = inlineText(this.inline(lastParsedArg(node)));
      const text = base ? applyAccent(name, base) : LONE_ACCENTS[name] ?? "";
      return text ? [textNode(text, marks)] : [];
    }
    if (name === "ensuremath") {
      const latex = argRaw(node, 0).trim();
      return latex ? [{ type: "mathInline", attrs: { latex } }] : [];
    }
    if (name === "text" || name === "mbox") return this.inline(lastParsedArg(node), marks);
    // A paragraph break inside a footnote, cell or caption still separates words.
    if (name === "hspace" || name === "par") return [textNode(" ", marks)];
    if (name === "vspace") return [];
    if (name === "label" || KEPT_AS_WRITTEN.has(name)) return this.rawInline(node) ?? [];
    if (name in TEXT_SYMBOLS) return [textNode(TEXT_SYMBOLS[name], marks)];
    if (name in CONTROL_SYMBOLS) return CONTROL_SYMBOLS[name] ? [textNode(CONTROL_SYMBOLS[name], marks)] : [];
    if (SILENT_COMMANDS.has(name)) return [];
    // Anything else stays exactly as written, so the LaTeX source keeps it.
    const kept = this.rawInline(node);
    if (kept) return kept;
    // Without its exact text (a command made by a macro across its call), keep
    // any text it carries instead of dropping a whole sentence.
    const carried = node.args.flatMap((value) => (value && value.children.length ? value.children : []));
    this.unknownCommands.add(name);
    return carried.length ? this.inline(carried, marks) : [];
  }
}

/** Converts LaTeX source to the visual editor's document JSON. */
export function importLatex(source: string, options: LatexImportOptions = {}): LatexImportResult {
  return new LatexImporter(source, options).import();
}

/** Plain text for a piece of LaTeX (a footnote's), as the visual editor shows it. */
export function latexText(source: string): string {
  const imported = importLatex(source);
  return plainText(imported.content);
}
