/**
 * Tolerant LaTeX parser.
 *
 * Turns LaTeX source into a small syntax tree for the renderer. It never
 * throws: problems become diagnostics and parsing continues, because a paper
 * being typed is invalid most of the time.
 *
 * Argument counts are not part of LaTeX syntax, so known commands carry a
 * signature (see COMMAND_SIGNATURES); unknown commands take no arguments and
 * any following `{...}` is an ordinary group. Math is captured as raw source
 * for KaTeX. User macros (`\newcommand`, `\def`, `\let`, `\newenvironment`)
 * are expanded into the input stream the way TeX does it, so a macro may
 * expand to half a construct (`\newcommand{\be}{\begin{equation}}`). Expansion
 * is capped so a recursive or exploding macro cannot hang the tab.
 */

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  message: string;
  start: number;
  end: number;
}

interface Span {
  start: number;
  end: number;
}

export interface Argument {
  optional: boolean;
  /** Parsed content; empty for raw arguments. */
  children: LatexNode[];
  /** Source text for raw arguments; empty for parsed ones. */
  raw: string;
}

export interface TextNode extends Span {
  type: "text";
  value: string;
}
export interface SpaceNode extends Span {
  type: "space";
}
export interface ParbreakNode extends Span {
  type: "parbreak";
}
export interface TabNode extends Span {
  type: "tab";
}
export interface GroupNode extends Span {
  type: "group";
  children: LatexNode[];
}
export interface CommandNode extends Span {
  type: "command";
  name: string;
  star: boolean;
  args: (Argument | null)[];
}
export interface EnvironmentNode extends Span {
  type: "environment";
  name: string;
  args: (Argument | null)[];
  children: LatexNode[];
  /** Body source for verbatim-like environments; null otherwise. */
  raw: string | null;
}
export interface MathNode extends Span {
  type: "math";
  display: boolean;
  /** Environment name for `\begin{align}`-style math, null for `$`, `\[`. */
  env: string | null;
  /** The `{n}` of alignat. */
  envArg: string | null;
  content: string;
}
export interface VerbNode extends Span {
  type: "verb";
  value: string;
}

export type LatexNode =
  | TextNode
  | SpaceNode
  | ParbreakNode
  | TabNode
  | GroupNode
  | CommandNode
  | EnvironmentNode
  | MathNode
  | VerbNode;

export interface MacroDefinition {
  params: number;
  /** Default for an optional first parameter, or null when all are mandatory. */
  defaultArg: string | null;
  body: string;
}

interface EnvironmentDefinition {
  params: number;
  defaultArg: string | null;
  begin: string;
  end: string;
}

export interface ParseOptions {
  /** Other project files, for `\input` and `\include`. */
  files?: Record<string, string>;
  maxExpansions?: number;
  /** Macros already defined, e.g. by the document a fragment belongs to. */
  macros?: Map<string, MacroDefinition>;
}

export interface ParseResult {
  nodes: LatexNode[];
  macros: Map<string, MacroDefinition>;
  /** User macros in KaTeX's `macros` format, for math. */
  mathMacros: Record<string, string>;
  diagnostics: Diagnostic[];
}

/*
 * Argument signatures, one letter per argument:
 *   s  optional star       o  optional [..], parsed    R  optional [..], raw
 *   m  mandatory, parsed   r  mandatory, raw           u  mandatory, raw URL
 *   p  optional (..), raw  (booktabs' \cmidrule trim)
 */
const FONT_ARG = "m";
export const COMMAND_SIGNATURES: Record<string, string> = {
  // Document structure
  documentclass: "Rr",
  usepackage: "Rr",
  RequirePackage: "Rr",
  part: "som",
  chapter: "som",
  section: "som",
  subsection: "som",
  subsubsection: "som",
  paragraph: "som",
  subparagraph: "som",
  title: "om",
  author: "om",
  date: "m",
  thanks: "m",
  keywords: "m",
  affiliation: "m",
  institute: "m",
  institution: "m",
  email: "m",
  address: "m",
  orcid: "m",
  country: "m",
  city: "m",
  IEEEauthorblockN: "m",
  IEEEauthorblockA: "m",
  IEEEPARstart: "mm",
  IEEEmembership: "m",
  item: "o",
  caption: "om",
  captionof: "rom",
  subcaption: "om",
  subfloat: "om",
  label: "r",
  // Cross references and citations
  ref: "sr",
  eqref: "sr",
  pageref: "sr",
  autoref: "sr",
  cref: "sr",
  Cref: "sr",
  nameref: "sr",
  vref: "sr",
  cite: "soor",
  citep: "soor",
  citet: "soor",
  citealp: "soor",
  citealt: "soor",
  Cite: "soor",
  Citep: "soor",
  Citet: "soor",
  parencite: "soor",
  textcite: "soor",
  autocite: "soor",
  footcite: "soor",
  citeauthor: "sr",
  citeyear: "sr",
  citeyearpar: "sr",
  citetitle: "sr",
  nocite: "r",
  bibliography: "r",
  bibliographystyle: "r",
  addbibresource: "Rr",
  printbibliography: "R",
  bibitem: "Rr",
  // Text
  textbf: FONT_ARG,
  textmd: FONT_ARG,
  textit: FONT_ARG,
  emph: FONT_ARG,
  textsl: FONT_ARG,
  textsc: FONT_ARG,
  textup: FONT_ARG,
  texttt: FONT_ARG,
  textsf: FONT_ARG,
  textrm: FONT_ARG,
  textnormal: FONT_ARG,
  underline: FONT_ARG,
  uline: FONT_ARG,
  sout: FONT_ARG,
  st: FONT_ARG,
  hl: FONT_ARG,
  textsuperscript: FONT_ARG,
  textsubscript: FONT_ARG,
  text: FONT_ARG,
  MakeUppercase: "m",
  MakeLowercase: "m",
  uppercase: "m",
  lowercase: "m",
  mbox: "m",
  fbox: "m",
  makebox: "RRm",
  framebox: "RRm",
  parbox: "RRRrm",
  raisebox: "rRRm",
  scalebox: "rRm",
  resizebox: "srrm",
  rotatebox: "Rrm",
  adjustbox: "rm",
  makecell: "Rm",
  shortstack: "Rm",
  ensuremath: "r",
  textcolor: "Rrm",
  color: "Rr",
  colorbox: "Rrm",
  fcolorbox: "Rrrm",
  definecolor: "rrr",
  url: "u",
  nolinkurl: "u",
  href: "um",
  footnote: "Rm",
  footnotemark: "R",
  footnotetext: "Rm",
  includegraphics: "sRr",
  // Spacing and layout
  "\\": "sR",
  newline: "",
  linebreak: "R",
  pagebreak: "R",
  nopagebreak: "R",
  vspace: "sr",
  hspace: "sr",
  rule: "Rrr",
  lipsum: "RR",
  blindtext: "R",
  // Tables
  multicolumn: "rrm",
  multirow: "rRrRm",
  cline: "r",
  cmidrule: "Rpr",
  toprule: "R",
  midrule: "R",
  bottomrule: "R",
  addlinespace: "R",
  specialrule: "rrr",
  // Configuration commands that are parsed so their arguments never print
  setlength: "rr",
  addtolength: "rr",
  setcounter: "rr",
  addtocounter: "rr",
  stepcounter: "r",
  refstepcounter: "r",
  newcounter: "rR",
  newlength: "r",
  pagestyle: "r",
  thispagestyle: "r",
  pagenumbering: "r",
  graphicspath: "r",
  hypersetup: "r",
  geometry: "r",
  lstset: "r",
  captionsetup: "Rr",
  setcitestyle: "r",
  theoremstyle: "r",
  newcolumntype: "rRr",
  linespread: "r",
  setstretch: "r",
  urlstyle: "r",
  usetikzlibrary: "r",
  pgfplotsset: "r",
  tikzset: "r",
  fontsize: "rr",
  enlargethispage: "sr",
  setcopyright: "r",
  copyrightyear: "r",
  acmYear: "r",
  acmDOI: "r",
  acmISBN: "r",
  acmPrice: "r",
  acmConference: "Rrrr",
  acmBooktitle: "r",
  acmJournal: "r",
  acmVolume: "r",
  acmNumber: "r",
  acmArticle: "r",
  acmMonth: "r",
  acmSubmissionID: "r",
  ccsdesc: "Rr",
  received: "Rr",
  settopmatter: "r",
  subjclass: "Rm",
  numberwithin: "rr",
  markboth: "mm",
  markright: "m",
  IEEEtriggeratref: "r",
  bstctlcite: "r",
  titleformat: "smRmmmmR",
  titlespacing: "smmmR",
  // Algorithms (algpseudocode and the older algorithmic)
  If: "m",
  ElsIf: "m",
  For: "m",
  ForAll: "m",
  While: "m",
  Until: "m",
  Function: "mm",
  Procedure: "mm",
  Comment: "m",
  Call: "mm",
  IF: "m",
  ELSIF: "m",
  FOR: "m",
  FORALL: "m",
  WHILE: "m",
  UNTIL: "m",
  COMMENT: "m",
};

/** Accent control symbols (`\'e`) and accent letters (`\c{c}`) take one argument. */
const ACCENT_NAMES = new Set(["'", "`", "^", '"', "~", "=", ".", "u", "v", "H", "c", "d", "b", "r", "k", "t"]);

export const ENV_SIGNATURES: Record<string, string> = {
  figure: "R",
  "figure*": "R",
  table: "R",
  "table*": "R",
  tabular: "Rr",
  "tabular*": "rRr",
  tabularx: "rRr",
  tabulary: "rRr",
  longtable: "Rr",
  array: "Rr",
  minipage: "RRRr",
  subfigure: "Rr",
  subtable: "Rr",
  wrapfigure: "RrRr",
  wraptable: "RrRr",
  thebibliography: "r",
  enumerate: "R",
  itemize: "R",
  description: "R",
  multicols: "rR",
  "multicols*": "rR",
  algorithm: "R",
  "algorithm*": "R",
  algorithmic: "R",
  proof: "o",
  spacing: "r",
  adjustbox: "r",
};

/** Math environments: captured raw and rendered by KaTeX. */
export const MATH_ENVIRONMENTS = new Set([
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
  "dmath",
  "dmath*",
]);

/** Environments whose body is kept verbatim. */
const RAW_ENVIRONMENTS: Record<string, string> = {
  verbatim: "",
  "verbatim*": "",
  Verbatim: "R",
  lstlisting: "R",
  minted: "Rr",
  comment: "",
  filecontents: "Rr",
  "filecontents*": "Rr",
  tikzpicture: "R",
  tikzcd: "R",
  pgfpicture: "",
  forest: "",
  circuitikz: "R",
};

/** Theorem-like environments accepted (with a note) even when never declared. */
export const IMPLICIT_THEOREMS: Record<string, string> = {
  theorem: "Theorem",
  lemma: "Lemma",
  corollary: "Corollary",
  proposition: "Proposition",
  conjecture: "Conjecture",
  definition: "Definition",
  example: "Example",
  remark: "Remark",
  claim: "Claim",
  assumption: "Assumption",
  hypothesis: "Hypothesis",
  observation: "Observation",
  note: "Note",
};

const DEFAULT_MAX_EXPANSIONS = 20000;
const MAX_EXPANDED_CHARS = 2_000_000;
const MAX_INCLUDE_DEPTH = 8;

interface Frame {
  text: string;
  pos: number;
  /** Where in the root source this text came from (macro call, `\input`). */
  anchor: Span | null;
  include: boolean;
}

function isLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/**
 * The input stream: the document, with macro expansions and included files
 * pushed on top as frames that are read before the text below them.
 */
class Reader {
  private readonly frames: Frame[];

  constructor(text: string) {
    this.frames = [{ text, pos: 0, anchor: null, include: false }];
  }

  private top(): Frame {
    let frame = this.frames[this.frames.length - 1];
    while (frame.pos >= frame.text.length && this.frames.length > 1) {
      this.frames.pop();
      frame = this.frames[this.frames.length - 1];
    }
    return frame;
  }

  eof(): boolean {
    const frame = this.top();
    return frame.pos >= frame.text.length;
  }

  peek(offset = 0): string {
    const frame = this.top();
    if (frame.pos + offset < frame.text.length) return frame.text[frame.pos + offset];
    let remaining = offset - (frame.text.length - frame.pos);
    for (let i = this.frames.length - 2; i >= 0; i--) {
      const below = this.frames[i];
      const available = below.text.length - below.pos;
      if (remaining < available) return below.text[below.pos + remaining];
      remaining -= available;
    }
    return "";
  }

  advance(count = 1): void {
    let left = count;
    while (left > 0) {
      const frame = this.top();
      if (frame.pos >= frame.text.length) return;
      const step = Math.min(left, frame.text.length - frame.pos);
      frame.pos += step;
      left -= step;
    }
  }

  startsWith(value: string): boolean {
    const frame = this.top();
    if (frame.pos + value.length <= frame.text.length) {
      return frame.text.startsWith(value, frame.pos);
    }
    for (let i = 0; i < value.length; i++) {
      if (this.peek(i) !== value[i]) return false;
    }
    return true;
  }

  /** Reads characters until one is in `stops`, staying fast inside one frame. */
  readUntil(stops: Set<string>): string {
    let out = "";
    while (true) {
      const frame = this.top();
      if (frame.pos >= frame.text.length) return out;
      const begin = frame.pos;
      let index = begin;
      const text = frame.text;
      while (index < text.length && !stops.has(text[index])) index++;
      out += text.slice(begin, index);
      frame.pos = index;
      if (index < text.length) return out;
    }
  }

  /** Root-source offset of the next character; inside an expansion, its call site. */
  offset(): number {
    this.top();
    if (this.frames.length === 1) return this.frames[0].pos;
    return this.frames[1].anchor?.start ?? 0;
  }

  endOffset(): number {
    this.top();
    if (this.frames.length === 1) return this.frames[0].pos;
    return this.frames[1].anchor?.end ?? 0;
  }

  includeDepth(): number {
    return this.frames.filter((frame) => frame.include).length;
  }

  push(text: string, anchor: Span, include = false): void {
    this.top();
    const outer = this.frames.length > 1 ? this.frames[1].anchor : null;
    this.frames.push({ text, pos: 0, anchor: outer ?? anchor, include });
  }
}

type Mode = "eof" | "group" | "optional" | "env";

function substituteParams(body: string, args: string[]): string {
  return body.replace(/#(#|[1-9])/g, (match, which: string) => {
    if (which === "#") return "#";
    const value = args[Number(which) - 1];
    return value === undefined ? match : value;
  });
}

class Parser {
  readonly diagnostics: Diagnostic[] = [];
  readonly macros = new Map<string, MacroDefinition>();
  readonly mathMacros: Record<string, string> = {};
  private readonly reader: Reader;
  private readonly envDefs = new Map<string, EnvironmentDefinition>();
  private readonly theorems = new Set<string>();
  private readonly envStack: string[] = [];
  private readonly files: Record<string, string>;
  private readonly maxExpansions: number;
  private pendingEnd: { name: string; start: number; end: number } | null = null;
  private expansions = 0;
  private expandedChars = 0;
  private expansionStopped = false;
  private atLetter = false;
  private atLineStart = true;
  private finished = false;

  constructor(source: string, options: ParseOptions) {
    this.reader = new Reader(source.replace(/\r\n?/g, "\n"));
    this.files = options.files ?? {};
    this.maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;
    for (const [name, def] of options.macros ?? []) this.define(name, def);
  }

  parse(): LatexNode[] {
    const { nodes } = this.parseSequence("eof");
    if (this.pendingEnd) this.pendingEnd = null;
    return nodes;
  }

  private report(severity: Severity, message: string, start: number, end = start): void {
    this.diagnostics.push({ severity, message, start, end: Math.max(start, end) });
  }

  // ── Sequences ─────────────────────────────────────────────────────────────

  private parseSequence(mode: Mode): { nodes: LatexNode[]; closed: boolean } {
    const nodes: LatexNode[] = [];
    const reader = this.reader;
    while (true) {
      if (this.pendingEnd || this.finished) return { nodes, closed: false };
      if (reader.eof()) return { nodes, closed: mode === "eof" };
      const ch = reader.peek();
      const start = reader.offset();
      switch (ch) {
        case "\\": {
          // Reset first: a control word may itself swallow a line end, and the
          // blank line after it must still end the paragraph.
          this.atLineStart = false;
          const result = this.parseControl(start);
          if (result) push(nodes, result);
          break;
        }
        case "{": {
          reader.advance();
          this.atLineStart = false;
          const { nodes: children, closed } = this.parseSequence("group");
          if (!closed && !this.finished) {
            this.report("error", "Missing } — this group is never closed.", start);
          }
          push(nodes, { type: "group", children, start, end: reader.endOffset() });
          break;
        }
        case "}": {
          reader.advance();
          this.atLineStart = false;
          if (mode === "group") return { nodes, closed: true };
          this.report("error", "Unmatched } — there is no { to close.", start, start + 1);
          break;
        }
        case "]": {
          reader.advance();
          this.atLineStart = false;
          if (mode === "optional") return { nodes, closed: true };
          push(nodes, { type: "text", value: "]", start, end: start + 1 });
          break;
        }
        case "$": {
          this.atLineStart = false;
          push(nodes, this.parseDollarMath(start));
          break;
        }
        case "%": {
          this.skipComment();
          break;
        }
        case "&": {
          reader.advance();
          this.atLineStart = false;
          nodes.push({ type: "tab", start, end: start + 1 });
          break;
        }
        case "~": {
          reader.advance();
          this.atLineStart = false;
          push(nodes, { type: "text", value: "\u00a0", start, end: start + 1 });
          break;
        }
        case " ":
        case "\t":
        case "\n": {
          let newlines = 0;
          while (!reader.eof()) {
            const c = reader.peek();
            if (c === "\n") newlines += 1;
            else if (c !== " " && c !== "\t") break;
            reader.advance();
          }
          const isPar = newlines >= 2 || (newlines >= 1 && this.atLineStart);
          this.atLineStart = newlines > 0;
          const end = reader.offset();
          if (isPar) {
            const last = nodes[nodes.length - 1];
            if (last?.type === "space") nodes.pop();
            if (last?.type !== "parbreak") nodes.push({ type: "parbreak", start, end });
          } else if (nodes[nodes.length - 1]?.type !== "space") {
            nodes.push({ type: "space", start, end });
          }
          break;
        }
        default: {
          const value = reader.readUntil(TEXT_STOPS);
          this.atLineStart = false;
          if (value) push(nodes, { type: "text", value, start, end: reader.offset() });
          else {
            // A stop character this switch does not handle; consume it as text.
            reader.advance();
            push(nodes, { type: "text", value: ch, start, end: start + 1 });
          }
        }
      }
    }
  }

  private skipComment(): void {
    const reader = this.reader;
    while (!reader.eof() && reader.peek() !== "\n") reader.advance();
    if (!reader.eof()) reader.advance();
    while (!reader.eof() && (reader.peek() === " " || reader.peek() === "\t")) reader.advance();
    this.atLineStart = true;
  }

  // ── Control sequences ─────────────────────────────────────────────────────

  private readControlName(): string {
    const reader = this.reader;
    reader.advance(); // the backslash
    if (reader.eof()) return "";
    const first = reader.peek();
    if (!isLetter(first) && !(this.atLetter && first === "@")) {
      reader.advance();
      return first === "\n" || first === "\t" ? " " : first;
    }
    let name = "";
    while (!reader.eof()) {
      const c = reader.peek();
      if (isLetter(c) || (this.atLetter && c === "@")) {
        name += c;
        reader.advance();
      } else break;
    }
    if (name !== "verb") this.skipBlanksAfterWord();
    return name;
  }

  /** TeX drops spaces, and one line end, after a control word. */
  private skipBlanksAfterWord(): void {
    const reader = this.reader;
    while (!reader.eof() && (reader.peek() === " " || reader.peek() === "\t")) reader.advance();
    if (reader.peek() === "\n") {
      reader.advance();
      while (!reader.eof() && (reader.peek() === " " || reader.peek() === "\t")) reader.advance();
      this.atLineStart = true;
    }
  }

  private parseControl(start: number): LatexNode | null {
    const reader = this.reader;
    const name = this.readControlName();
    if (name === "") return { type: "text", value: "\\", start, end: start + 1 };

    // A macro of the user's always wins, as in LaTeX after \renewcommand.
    const macro = this.macros.get(name);
    if (macro && !this.expansionStopped) {
      this.expandMacro(name, macro, start);
      return null;
    }

    switch (name) {
      case "begin":
        return this.parseEnvironment(start);
      case "end": {
        const envName = this.readRawArgument(true).trim();
        if (this.envStack.includes(envName)) {
          this.pendingEnd = { name: envName, start, end: reader.endOffset() };
        } else {
          this.report("error", `\\end{${envName}} has no matching \\begin{${envName}}.`, start, reader.endOffset());
        }
        return null;
      }
      case "(":
        return this.parseDelimitedMath(start, "\\)", false);
      case "[":
        return this.parseDelimitedMath(start, "\\]", true);
      case ")":
      case "]":
        this.report("error", `\\${name} without a matching opening delimiter.`, start, start + 2);
        return null;
      case "verb":
        return this.parseVerb(start);
      case "newcommand":
      case "renewcommand":
      case "providecommand":
      case "DeclareRobustCommand":
        this.parseNewCommand(name, start);
        return null;
      case "def":
      case "gdef":
      case "edef":
      case "xdef":
        this.parseDef(start);
        return null;
      case "let":
        this.parseLet();
        return null;
      case "newenvironment":
      case "renewenvironment":
        this.parseNewEnvironment(start);
        return null;
      case "newtheorem":
        return this.parseNewTheorem(start);
      case "DeclareMathOperator":
        this.parseMathOperator();
        return null;
      case "makeatletter":
        this.atLetter = true;
        return null;
      case "makeatother":
        this.atLetter = false;
        return null;
      case "iffalse":
        this.skipConditional(start);
        return null;
      case "fi":
      case "iftrue":
      case "else":
        return null;
      case "input":
      case "include":
      case "subfile":
        this.parseInclude(name, start);
        return null;
      case "vskip":
      case "hskip":
      case "kern":
        return this.parseGlue(name, start);
      case "pdfoutput":
      case "tolerance":
      case "hbadness":
      case "pretolerance": {
        // `\pdfoutput=1`: swallow the assignment so it never prints.
        this.readAssignment();
        return null;
      }
      default:
        break;
    }

    const signature = COMMAND_SIGNATURES[name] ?? (ACCENT_NAMES.has(name) ? "m" : "");
    const { star, args } = this.parseArgs(signature);
    return { type: "command", name, star, args, start, end: reader.endOffset() };
  }

  private parseVerb(start: number): LatexNode {
    const reader = this.reader;
    if (reader.peek() === "*") reader.advance();
    const delimiter = reader.peek();
    if (!delimiter || isLetter(delimiter) || delimiter === " " || delimiter === "\n") {
      this.report("error", "\\verb needs a delimiter, as in \\verb|code|.", start);
      return { type: "verb", value: "", start, end: reader.endOffset() };
    }
    reader.advance();
    let value = "";
    while (!reader.eof() && reader.peek() !== delimiter && reader.peek() !== "\n") {
      value += reader.peek();
      reader.advance();
    }
    if (reader.peek() === delimiter) reader.advance();
    else this.report("error", "\\verb is not closed on the same line.", start, reader.endOffset());
    return { type: "verb", value, start, end: reader.endOffset() };
  }

  private readAssignment(): void {
    const reader = this.reader;
    while (reader.peek() === " " || reader.peek() === "=") reader.advance();
    while (/[0-9.]/.test(reader.peek())) reader.advance();
  }

  private parseGlue(name: string, start: number): CommandNode {
    const reader = this.reader;
    let raw = "";
    // A TeX dimension: number, unit, and optional stretch/shrink parts.
    const pattern = /^\s*-?(\d+(\.\d*)?|\.\d+)\s*(pt|bp|mm|cm|in|em|ex|pc|sp|dd|cc|mu)(\s+(plus|minus)\s*-?(\d+(\.\d*)?|\.\d+)\s*(pt|bp|mm|cm|in|em|ex|pc|sp|fil+))*/;
    let probe = "";
    for (let i = 0; i < 80 && reader.peek(i); i++) probe += reader.peek(i);
    const match = pattern.exec(probe);
    if (match) {
      raw = match[0].trim();
      reader.advance(match[0].length);
    }
    const arg: Argument = { optional: false, children: [], raw };
    return { type: "command", name: name === "kern" || name === "hskip" ? "hspace" : "vspace", star: false, args: [arg], start, end: reader.endOffset() };
  }

  // ── Arguments ─────────────────────────────────────────────────────────────

  /** Offset of the next non-blank character, without crossing a blank line. */
  private blankLength(): number {
    let i = 0;
    let newlines = 0;
    while (true) {
      const c = this.reader.peek(i);
      if (c === " " || c === "\t") i++;
      else if (c === "\n" && newlines === 0) {
        newlines++;
        i++;
      } else return i;
    }
  }

  parseArgs(signature: string): { star: boolean; args: (Argument | null)[] } {
    const reader = this.reader;
    let star = false;
    const args: (Argument | null)[] = [];
    for (const kind of signature) {
      if (this.pendingEnd) {
        if (kind !== "s") args.push(null);
        continue;
      }
      switch (kind) {
        case "s":
          if (reader.peek() === "*") {
            reader.advance();
            star = true;
          }
          break;
        case "o":
        case "R": {
          const blanks = this.blankLength();
          if (reader.peek(blanks) !== "[") {
            args.push(null);
            break;
          }
          reader.advance(blanks + 1);
          if (kind === "R") {
            args.push({ optional: true, children: [], raw: this.readBalanced("]") });
          } else {
            const at = reader.offset();
            const { nodes, closed } = this.parseSequence("optional");
            if (!closed && !this.pendingEnd) this.report("error", "Missing ] — this optional argument is never closed.", at);
            args.push({ optional: true, children: nodes, raw: "" });
          }
          break;
        }
        case "p": {
          const blanks = this.blankLength();
          if (reader.peek(blanks) !== "(") {
            args.push(null);
            break;
          }
          reader.advance(blanks + 1);
          args.push({ optional: true, children: [], raw: this.readBalanced(")") });
          break;
        }
        case "m":
          args.push(this.parseMandatory());
          break;
        case "r":
        case "u":
          args.push({ optional: false, children: [], raw: this.readRawArgument(kind === "r") });
          break;
        default:
          break;
      }
    }
    return { star, args };
  }

  private parseMandatory(): Argument {
    const reader = this.reader;
    let blanks = this.blankLength();
    // A comment may sit between a command and its argument.
    while (reader.peek(blanks) === "%") {
      reader.advance(blanks);
      this.skipComment();
      blanks = this.blankLength();
    }
    const next = reader.peek(blanks);
    const at = reader.offset();
    if (next === "{") {
      reader.advance(blanks + 1);
      const { nodes, closed } = this.parseSequence("group");
      if (!closed && !this.pendingEnd && !this.finished) {
        this.report("error", "Missing } — this argument is never closed.", at);
      }
      return { optional: false, children: nodes, raw: "" };
    }
    if (next === "" || next === "}" || next === "%" || next === "\n") {
      this.report("error", "Missing argument.", at);
      return { optional: false, children: [], raw: "" };
    }
    reader.advance(blanks);
    if (next === "\\") {
      const start = reader.offset();
      const name = this.readControlName();
      const node: LatexNode = { type: "command", name, star: false, args: [], start, end: reader.endOffset() };
      return { optional: false, children: [node], raw: "" };
    }
    reader.advance();
    return { optional: false, children: [{ type: "text", value: next, start: at, end: at + 1 }], raw: "" };
  }

  /** A `{...}` argument as source text, or a single token without braces. */
  private readRawArgument(commentsAware: boolean): string {
    const reader = this.reader;
    const blanks = this.blankLength();
    const next = reader.peek(blanks);
    if (next === "{") {
      reader.advance(blanks + 1);
      return this.readBalanced("}", commentsAware);
    }
    if (next === "" || next === "}") {
      this.report("error", "Missing argument.", reader.offset());
      return "";
    }
    reader.advance(blanks);
    if (next === "\\") {
      let token = "\\";
      reader.advance();
      if (isLetter(reader.peek())) {
        while (isLetter(reader.peek())) {
          token += reader.peek();
          reader.advance();
        }
      } else {
        token += reader.peek();
        reader.advance();
      }
      return token;
    }
    reader.advance();
    return next;
  }

  /** Reads to the closing delimiter, keeping nested braces balanced. */
  private readBalanced(close: string, commentsAware = true): string {
    const reader = this.reader;
    const start = reader.offset();
    let depth = 0;
    let out = "";
    while (!reader.eof()) {
      const c = reader.peek();
      if (c === "\\") {
        out += c + reader.peek(1);
        reader.advance(2);
        continue;
      }
      if (c === "%" && commentsAware) {
        while (!reader.eof() && reader.peek() !== "\n") reader.advance();
        if (!reader.eof()) reader.advance();
        while (reader.peek() === " " || reader.peek() === "\t") reader.advance();
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) {
          if (close === "}") {
            reader.advance();
            return out;
          }
          // A stray } inside [...] or (...): stop rather than run away.
          this.report("error", `Missing ${close}.`, start);
          return out;
        }
        depth--;
      } else if (c === close && depth === 0) {
        reader.advance();
        return out;
      }
      out += c;
      reader.advance();
    }
    this.report("error", `Missing ${close} — the argument runs to the end of the file.`, start);
    return out;
  }

  // ── Math ──────────────────────────────────────────────────────────────────

  private parseDollarMath(start: number): LatexNode {
    const reader = this.reader;
    const display = reader.peek(1) === "$";
    reader.advance(display ? 2 : 1);
    const { content, closed } = this.scanMath(display ? "$$" : "$");
    if (!closed) this.report("error", `Missing closing ${display ? "$$" : "$"} for math.`, start, reader.endOffset());
    return { type: "math", display, env: null, envArg: null, content, start, end: reader.endOffset() };
  }

  private parseDelimitedMath(start: number, closer: string, display: boolean): LatexNode {
    const reader = this.reader;
    const { content, closed } = this.scanMath(closer);
    if (!closed) this.report("error", `Missing ${closer} for math.`, start, reader.endOffset());
    return { type: "math", display, env: null, envArg: null, content, start, end: reader.endOffset() };
  }

  /**
   * Raw math up to the closer; comments are dropped as TeX would. Braces are
   * not balanced here on purpose: while a formula is being typed it is often
   * unbalanced, and that must not pull the rest of the document into math.
   */
  private scanMath(closer: string): { content: string; closed: boolean } {
    const reader = this.reader;
    let out = "";
    while (!reader.eof()) {
      if (reader.startsWith(closer)) {
        reader.advance(closer.length);
        return { content: out, closed: true };
      }
      const c = reader.peek();
      if (c === "\\") {
        out += c + reader.peek(1);
        reader.advance(2);
        continue;
      }
      if (c === "%") {
        while (!reader.eof() && reader.peek() !== "\n") reader.advance();
        continue;
      }
      if (c === "\n" && closer.startsWith("$") && closer.length === 1) {
        // Inline math cannot span a blank line.
        let i = 1;
        while (reader.peek(i) === " " || reader.peek(i) === "\t") i++;
        if (reader.peek(i) === "\n") return { content: out, closed: false };
      }
      out += c;
      reader.advance();
    }
    return { content: out, closed: false };
  }

  private parseMathEnvironment(name: string, start: number): MathNode {
    let envArg: string | null = null;
    if (name === "alignat" || name === "alignat*") envArg = this.readRawArgument(true);
    const { content, closed } = this.scanEnvironmentBody(name, true);
    if (!closed) this.report("error", `Missing \\end{${name}}.`, start, this.reader.endOffset());
    const display = name !== "math";
    return { type: "math", display, env: name, envArg, content, start, end: this.reader.endOffset() };
  }

  /**
   * Raw body up to `\end{name}`. A user macro that expands to exactly that
   * `\end` also closes it, so `\be ... \ee` shorthands work for math.
   */
  private scanEnvironmentBody(name: string, stripComments: boolean): { content: string; closed: boolean } {
    const reader = this.reader;
    const endTag = `\\end{${name}}`;
    let out = "";
    while (!reader.eof()) {
      if (reader.startsWith(endTag)) {
        reader.advance(endTag.length);
        return { content: out, closed: true };
      }
      const c = reader.peek();
      if (c === "\\") {
        if (isLetter(reader.peek(1))) {
          let word = "";
          let i = 1;
          while (isLetter(reader.peek(i))) word += reader.peek(i++);
          const macro = this.macros.get(word);
          if (macro && macro.params === 0 && macro.body.trim() === endTag) {
            reader.advance(i);
            return { content: out, closed: true };
          }
          out += `\\${word}`;
          reader.advance(i);
          continue;
        }
        out += c + reader.peek(1);
        reader.advance(2);
        continue;
      }
      if (c === "%" && stripComments) {
        while (!reader.eof() && reader.peek() !== "\n") reader.advance();
        continue;
      }
      out += c;
      reader.advance();
    }
    return { content: out, closed: false };
  }

  // ── Environments ──────────────────────────────────────────────────────────

  private parseEnvironment(start: number): LatexNode | null {
    const reader = this.reader;
    const name = this.readRawArgument(true).trim();
    if (!name) {
      this.report("error", "\\begin needs an environment name.", start);
      return null;
    }

    const userEnv = this.envDefs.get(name);
    if (userEnv && !this.expansionStopped) {
      this.expandEnvironment(name, userEnv, start);
      return null;
    }
    if (MATH_ENVIRONMENTS.has(name)) return this.parseMathEnvironment(name, start);
    if (name in RAW_ENVIRONMENTS) {
      const { args } = this.parseArgs(RAW_ENVIRONMENTS[name]);
      const { content, closed } = this.scanEnvironmentBody(name, false);
      if (!closed) this.report("error", `Missing \\end{${name}}.`, start, reader.endOffset());
      if (name === "comment") return null;
      return { type: "environment", name, args, children: [], raw: content, start, end: reader.endOffset() };
    }

    const signature =
      ENV_SIGNATURES[name] ??
      (this.theorems.has(name) || name in IMPLICIT_THEOREMS || name.replace(/\*$/, "") in IMPLICIT_THEOREMS ? "o" : "");
    const { args } = this.parseArgs(signature);
    this.envStack.push(name);
    const { nodes } = this.parseSequence("env");
    this.envStack.pop();

    if (this.pendingEnd && this.pendingEnd.name === name) {
      this.pendingEnd = null;
    } else if (this.pendingEnd) {
      this.report("error", `\\begin{${name}} is closed by \\end{${this.pendingEnd.name}} — missing \\end{${name}}.`, start, this.pendingEnd.end);
    } else if (!this.finished) {
      this.report("error", `Missing \\end{${name}}.`, start);
    }
    const node: EnvironmentNode = { type: "environment", name, args, children: nodes, raw: null, start, end: reader.endOffset() };
    if (name === "document" && this.envStack.length === 0) {
      // LaTeX ignores everything after \end{document}.
      this.finished = true;
    }
    return node;
  }

  private expandEnvironment(name: string, def: EnvironmentDefinition, start: number): void {
    const args = this.readMacroArgs(def.params, def.defaultArg);
    // Find the matching \end{name} in the raw source, counting nested uses.
    const reader = this.reader;
    const beginTag = `\\begin{${name}}`;
    const endTag = `\\end{${name}}`;
    let depth = 0;
    let body = "";
    let closed = false;
    while (!reader.eof()) {
      if (reader.startsWith(beginTag)) depth++;
      if (reader.startsWith(endTag)) {
        if (depth === 0) {
          reader.advance(endTag.length);
          closed = true;
          break;
        }
        depth--;
      }
      body += reader.peek();
      reader.advance();
    }
    if (!closed) this.report("error", `Missing \\end{${name}}.`, start);
    this.pushExpansion(`{${substituteParams(def.begin, args)}${body}${def.end}}`, { start, end: reader.endOffset() });
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  private readMacroName(): string {
    const reader = this.reader;
    const blanks = this.blankLength();
    reader.advance(blanks);
    if (reader.peek() === "{") {
      reader.advance();
      return this.readBalanced("}").trim().replace(/^\\/, "");
    }
    if (reader.peek() === "\\") {
      reader.advance();
      let name = "";
      if (isLetter(reader.peek()) || (this.atLetter && reader.peek() === "@")) {
        while (isLetter(reader.peek()) || (this.atLetter && reader.peek() === "@")) {
          name += reader.peek();
          reader.advance();
        }
      } else {
        name = reader.peek();
        reader.advance();
      }
      return name;
    }
    return "";
  }

  private readOptionalRaw(): string | null {
    const blanks = this.blankLength();
    if (this.reader.peek(blanks) !== "[") return null;
    this.reader.advance(blanks + 1);
    return this.readBalanced("]");
  }

  private parseNewCommand(kind: string, start: number): void {
    if (this.reader.peek() === "*") this.reader.advance();
    const name = this.readMacroName();
    const countRaw = this.readOptionalRaw();
    const defaultArg = this.readOptionalRaw();
    const body = this.readRawArgument(true);
    if (!name) {
      this.report("error", `\\${kind} needs a command name.`, start, this.reader.endOffset());
      return;
    }
    const params = Math.min(9, Math.max(0, Number.parseInt(countRaw ?? "0", 10) || 0));
    if (kind === "providecommand" && this.macros.has(name)) return;
    this.define(name, { params, defaultArg, body });
  }

  private define(name: string, def: MacroDefinition): void {
    this.macros.set(name, def);
    if (def.defaultArg === null) this.mathMacros[`\\${name}`] = def.body;
  }

  private parseDef(start: number): void {
    const reader = this.reader;
    const name = this.readMacroName();
    let paramText = "";
    while (!reader.eof() && reader.peek() !== "{") {
      paramText += reader.peek();
      reader.advance();
      if (paramText.length > 40) break;
    }
    const params = (paramText.match(/#[1-9]/g) ?? []).length;
    if (/[^#1-9\s]/.test(paramText)) {
      this.report("warning", `\\def\\${name} uses delimited parameters, which the preview does not support.`, start);
    }
    const body = this.readRawArgument(true);
    if (name) this.define(name, { params, defaultArg: null, body });
  }

  private parseLet(): void {
    const reader = this.reader;
    const name = this.readMacroName();
    while (reader.peek() === " " || reader.peek() === "=") reader.advance();
    const target = this.readMacroName();
    if (!name || !target) return;
    const existing = this.macros.get(target);
    this.define(name, existing ?? { params: 0, defaultArg: null, body: `\\${target} ` });
  }

  private parseNewEnvironment(start: number): void {
    if (this.reader.peek() === "*") this.reader.advance();
    const name = this.readRawArgument(true).trim();
    const countRaw = this.readOptionalRaw();
    const defaultArg = this.readOptionalRaw();
    const begin = this.readRawArgument(true);
    const end = this.readRawArgument(true);
    if (!name) {
      this.report("error", "\\newenvironment needs a name.", start);
      return;
    }
    const params = Math.min(9, Math.max(0, Number.parseInt(countRaw ?? "0", 10) || 0));
    this.envDefs.set(name, { params, defaultArg, begin, end });
  }

  private parseNewTheorem(start: number): CommandNode {
    const reader = this.reader;
    let star = false;
    if (reader.peek() === "*") {
      reader.advance();
      star = true;
    }
    const name = this.readRawArgument(true).trim();
    const shared = this.readOptionalRaw();
    const title = this.parseMandatory();
    const within = this.readOptionalRaw();
    if (name) this.theorems.add(name);
    const raw = (value: string | null): Argument | null => (value === null ? null : { optional: true, children: [], raw: value });
    return {
      type: "command",
      name: "newtheorem",
      star,
      args: [{ optional: false, children: [], raw: name }, raw(shared), title, raw(within)],
      start,
      end: reader.endOffset(),
    };
  }

  private parseMathOperator(): void {
    let star = false;
    if (this.reader.peek() === "*") {
      this.reader.advance();
      star = true;
    }
    const name = this.readMacroName();
    const body = this.readRawArgument(true);
    if (name) this.mathMacros[`\\${name}`] = `\\operatorname${star ? "*" : ""}{${body}}`;
  }

  private skipConditional(start: number): void {
    const reader = this.reader;
    let depth = 0;
    while (!reader.eof()) {
      if (reader.peek() === "\\" && isLetter(reader.peek(1))) {
        let word = "";
        let i = 1;
        while (isLetter(reader.peek(i))) word += reader.peek(i++);
        reader.advance(i);
        if (word === "fi") {
          if (depth === 0) return;
          depth--;
        } else if (word.startsWith("if")) depth++;
        continue;
      }
      if (reader.peek() === "\\") reader.advance(2);
      else reader.advance();
    }
    this.report("error", "\\iffalse without a matching \\fi.", start);
  }

  private parseInclude(name: string, start: number): void {
    const file = this.readRawArgument(true).trim();
    const candidates = [file, `${file}.tex`];
    const found = candidates.find((candidate) => candidate in this.files);
    if (found === undefined) {
      this.report("warning", `File "${file}" was not found in this project.`, start, this.reader.endOffset());
      return;
    }
    if (this.reader.includeDepth() >= MAX_INCLUDE_DEPTH) {
      this.report("error", `\\${name}{${file}} is nested too deeply.`, start);
      return;
    }
    const text = this.files[found].replace(/\r\n?/g, "\n");
    this.reader.push(name === "include" ? `\\clearpage ${text}\n\\clearpage ` : `${text}\n`, { start, end: this.reader.endOffset() }, true);
  }

  // ── Expansion ─────────────────────────────────────────────────────────────

  private readMacroArgs(params: number, defaultArg: string | null): string[] {
    const args: string[] = [];
    let index = 0;
    if (defaultArg !== null && params > 0) {
      args.push(this.readOptionalRaw() ?? defaultArg);
      index = 1;
    }
    for (; index < params; index++) args.push(this.readRawArgument(true));
    return args;
  }

  private expandMacro(name: string, def: MacroDefinition, start: number): void {
    const args = this.readMacroArgs(def.params, def.defaultArg);
    const end = this.reader.endOffset();
    this.pushExpansion(substituteParams(def.body, args), { start, end }, name);
  }

  private pushExpansion(text: string, anchor: Span, name?: string): void {
    this.expansions += 1;
    this.expandedChars += text.length;
    if (this.expansions > this.maxExpansions || this.expandedChars > MAX_EXPANDED_CHARS) {
      this.expansionStopped = true;
      this.report(
        "error",
        `Macro expansion limit reached${name ? ` while expanding \\${name}` : ""} — is a macro defined in terms of itself?`,
        anchor.start,
        anchor.end,
      );
      return;
    }
    this.reader.push(text, anchor);
  }
}

const TEXT_STOPS = new Set(["\\", "{", "}", "$", "%", "&", "~", "]", " ", "\t", "\n"]);

function push(nodes: LatexNode[], node: LatexNode): void {
  const last = nodes[nodes.length - 1];
  if (node.type === "text" && last?.type === "text") {
    nodes[nodes.length - 1] = { ...last, value: last.value + node.value, end: node.end };
    return;
  }
  nodes.push(node);
}

export function parseLatex(source: string, options: ParseOptions = {}): ParseResult {
  // Control characters are never valid input and are reserved by the renderer.
  // eslint-disable-next-line no-control-regex
  const clean = source.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const parser = new Parser(clean, options);
  const nodes = parser.parse();
  return { nodes, macros: parser.macros, mathMacros: parser.mathMacros, diagnostics: parser.diagnostics };
}

/** Plain text of parsed nodes: for labels, keys and other attribute values. */
export function nodesToText(nodes: LatexNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "space":
      case "parbreak":
        out += " ";
        break;
      case "group":
        out += nodesToText(node.children);
        break;
      case "command":
        if (node.args.length) out += node.args.map((arg) => (arg ? arg.raw || nodesToText(arg.children) : "")).join("");
        break;
      case "environment":
        out += nodesToText(node.children);
        break;
      case "math":
        out += node.content;
        break;
      case "verb":
        out += node.value;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Splits `key=value` option lists, keeping braces and commas inside braces intact. */
export function parseKeyValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of raw) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const index = part.indexOf("=");
    const key = (index === -1 ? part : part.slice(0, index)).trim();
    if (!key) continue;
    let value = index === -1 ? "" : part.slice(index + 1).trim();
    if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
