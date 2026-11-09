/**
 * The author's own LaTeX preamble, kept across a trip through the visual editor.
 *
 * The visual editor represents the page settings (class, fonts, margins,
 * spacing, citation style) and the title block, and the LaTeX exporter
 * regenerates those. Everything else in a preamble — macros, packages,
 * colours, theorem definitions, hyperref setup — belongs to the author, and a
 * paper that uses `\R` or `\begin{lemma}` breaks without it. The importer keeps
 * that part as text (`PaperDocument.latexPreamble`) and the exporter writes it
 * back next to the lines it generates, without loading a package twice.
 */

import type { PaperSettings } from "./documents.ts";

export interface PreambleArgument {
  optional: boolean;
  value: string;
}

export interface PreambleStatement {
  /** Command name without the backslash; "" for text that is not a command. */
  name: string;
  /** Arguments in source order, without their brackets. */
  args: PreambleArgument[];
  /** The statement's source text. */
  text: string;
}

type Margins = PaperSettings["margins"];

/** The theorem set the exporter defines for amsart papers. */
export const AMSART_THEOREMS = [
  "\\newtheorem{theorem}{Theorem}[section]",
  "\\newtheorem{lemma}[theorem]{Lemma}",
  "\\newtheorem{proposition}[theorem]{Proposition}",
  "\\newtheorem{corollary}[theorem]{Corollary}",
  "\\theoremstyle{definition}",
  "\\newtheorem{definition}[theorem]{Definition}",
  "\\newtheorem{example}[theorem]{Example}",
  "\\theoremstyle{remark}",
  "\\newtheorem{remark}[theorem]{Remark}",
];

export const MARGIN_LENGTHS: Record<Margins, string> = { narrow: "0.5in", normal: "1in", wide: "1.5in" };

// ── Scanning ────────────────────────────────────────────────────────────────

const DEFINERS = new Set(["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "DeclareMathOperator"]);
const DEFS = new Set(["def", "gdef", "edef", "xdef"]);
const PREFIXES = new Set(["long", "global", "protected", "outer"]);
/** Commands whose first argument may be an unbraced control sequence. */
const CS_ARGUMENT = new Set(["setlength", "addtolength", "newlength", "settowidth", "settoheight", "settodepth"]);

class Scanner {
  index = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  peek(offset = 0): string {
    return this.text[this.index + offset] ?? "";
  }

  eof(): boolean {
    return this.index >= this.text.length;
  }

  skipComment(): void {
    const end = this.text.indexOf("\n", this.index);
    this.index = end === -1 ? this.text.length : end;
  }

  /** Spaces, comments and at most one line break: a blank line ends a statement. */
  skipArgumentSpace(): void {
    let lines = 0;
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r") this.index++;
      else if (ch === "%") this.skipComment();
      else if (ch === "\n" && lines === 0) {
        lines++;
        this.index++;
      } else return;
    }
  }

  skipSpaces(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index++;
  }

  /** At a backslash: the control sequence's name. */
  controlSequence(): string {
    this.index++;
    if (/[A-Za-z]/.test(this.peek())) {
      const start = this.index;
      while (/[A-Za-z]/.test(this.peek())) this.index++;
      return this.text.slice(start, this.index);
    }
    const name = this.peek();
    this.index++;
    return name;
  }

  /** At `{` or `[`: the balanced content, without the brackets. */
  group(): string {
    const open = this.peek();
    const close = open === "{" ? "}" : "]";
    this.index++;
    const start = this.index;
    let depth = 0;
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === "\\") {
        this.index += 2;
        continue;
      }
      if (ch === "%") {
        this.skipComment();
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 0 && close === "}") break;
        depth--;
      } else if (ch === close && depth === 0) break;
      this.index++;
    }
    const value = this.text.slice(start, this.index);
    if (!this.eof()) this.index++;
    return value;
  }

  /** `{...}`, `[...]` or a lone control sequence (`\newcommand\R{...}`). */
  argument(allowControlSequence: boolean): PreambleArgument | null {
    const ch = this.peek();
    if (ch === "{" || ch === "[") return { optional: ch === "[", value: this.group() };
    if (allowControlSequence && ch === "\\") {
      const start = this.index;
      this.controlSequence();
      return { optional: false, value: this.text.slice(start, this.index) };
    }
    return null;
  }
}

function readStatement(scanner: Scanner): PreambleStatement | "document" {
  const start = scanner.index;
  let name = scanner.controlSequence();
  const args: PreambleArgument[] = [];
  const finish = (): PreambleStatement => ({ name, args, text: scanner.text.slice(start, scanner.index).trim() });

  if (PREFIXES.has(name)) {
    scanner.skipSpaces();
    if (scanner.peek() !== "\\") return finish();
    const inner = readStatement(scanner);
    if (inner === "document") return finish();
    return { ...inner, text: scanner.text.slice(start, scanner.index).trim() };
  }

  if (name === "makeatletter") {
    const end = scanner.text.indexOf("\\makeatother", scanner.index);
    scanner.index = end === -1 ? scanner.text.length : end + "\\makeatother".length;
    return finish();
  }

  if (name === "begin") {
    const env = scanner.argument(false);
    if (!env) return finish();
    if (env.value.trim() === "document") return "document";
    args.push(env);
    for (;;) {
      const at = scanner.index;
      scanner.skipSpaces();
      const extra = scanner.argument(false);
      if (!extra) {
        scanner.index = at;
        break;
      }
      args.push(extra);
    }
    const close = `\\end{${env.value}}`;
    const end = scanner.text.indexOf(close, scanner.index);
    scanner.index = end === -1 ? scanner.text.length : end + close.length;
    return finish();
  }

  if (DEFS.has(name)) {
    scanner.skipSpaces();
    if (scanner.peek() === "\\") {
      const at = scanner.index;
      scanner.controlSequence();
      args.push({ optional: false, value: scanner.text.slice(at, scanner.index) });
    }
    const params = scanner.index;
    while (!scanner.eof() && scanner.peek() !== "{" && scanner.peek() !== "\n" && scanner.index - params < 60) scanner.index++;
    args.push({ optional: false, value: scanner.text.slice(params, scanner.index) });
    if (scanner.peek() === "{") args.push({ optional: false, value: scanner.group() });
    return finish();
  }

  if (name === "let") {
    scanner.skipSpaces();
    if (scanner.peek() === "\\") {
      const at = scanner.index;
      scanner.controlSequence();
      args.push({ optional: false, value: scanner.text.slice(at, scanner.index) });
    }
    scanner.skipSpaces();
    if (scanner.peek() === "=") scanner.index++;
    scanner.skipSpaces();
    const at = scanner.index;
    if (scanner.peek() === "\\") scanner.controlSequence();
    else if (!scanner.eof()) scanner.index++;
    args.push({ optional: false, value: scanner.text.slice(at, scanner.index) });
    return finish();
  }

  if (scanner.peek() === "*") {
    scanner.index++;
    name = `${name}*`;
  }

  if (DEFINERS.has(name.replace(/\*$/, ""))) {
    // \newcommand{\name}[n][default]{body}, each part possibly unbraced.
    scanner.skipArgumentSpace();
    const target = scanner.argument(true);
    if (target) args.push(target);
    for (;;) {
      const at = scanner.index;
      scanner.skipArgumentSpace();
      if (scanner.peek() !== "[") {
        scanner.index = at;
        break;
      }
      args.push({ optional: true, value: scanner.group() });
    }
    const at = scanner.index;
    scanner.skipArgumentSpace();
    const body = scanner.argument(true);
    if (body) args.push(body);
    else scanner.index = at;
    return finish();
  }

  for (;;) {
    const at = scanner.index;
    scanner.skipArgumentSpace();
    const next = scanner.argument(!args.length && CS_ARGUMENT.has(name));
    if (!next) {
      scanner.index = at;
      break;
    }
    args.push(next);
  }
  return finish();
}

/**
 * Splits a preamble into top-level statements, comments removed. Scanning
 * stops at `\begin{document}`, whose offset is returned as `bodyStart`.
 */
export function scanPreamble(source: string): { statements: PreambleStatement[]; bodyStart: number | null } {
  const scanner = new Scanner(source.replace(/\r\n?/g, "\n"));
  const statements: PreambleStatement[] = [];
  while (!scanner.eof()) {
    const ch = scanner.peek();
    if (/\s/.test(ch)) {
      scanner.index++;
      continue;
    }
    if (ch === "%") {
      scanner.skipComment();
      continue;
    }
    if (ch === "\\") {
      const start = scanner.index;
      const statement = readStatement(scanner);
      if (statement === "document") return { statements, bodyStart: start };
      if (statement.text) statements.push(statement);
      continue;
    }
    const start = scanner.index;
    while (!scanner.eof() && !"\\%\n".includes(scanner.peek())) scanner.index++;
    const text = scanner.text.slice(start, scanner.index).trim();
    if (text) statements.push({ name: "", args: [], text });
  }
  return { statements, bodyStart: null };
}

// ── Packages ────────────────────────────────────────────────────────────────

/** `\usepackage[options]{a,b}` → its options and package names. */
export function packagesOf(statement: PreambleStatement): { options: string; names: string[] } | null {
  if (statement.name !== "usepackage" && statement.name !== "RequirePackage") return null;
  const options = statement.args.find((arg) => arg.optional)?.value.trim() ?? "";
  const list = statement.args.find((arg) => !arg.optional)?.value ?? "";
  const names = list.split(",").map((name) => name.trim()).filter(Boolean);
  return { options, names };
}

function usepackage(options: string, name: string): string {
  return `\\usepackage${options ? `[${options}]` : ""}{${name}}`;
}

/** Packages chosen through the page settings; the exporter loads its own. */
const FONT_PACKAGES = new Set(["times", "mathptmx", "newtxtext", "newtxmath", "txfonts", "ptm", "tgtermes", "mathpazo", "palatino", "newpxtext", "newpxmath", "pxfonts", "tgpagella", "mathpple", "lmodern"]);
const SETTING_PACKAGES = new Set(["setspace", "parskip", "natbib", "cite", "arxiv-preprint", "ml-preprint", "biblatex"]);

/**
 * Packages the exporter loads itself (when the paper needs them), with the
 * options it uses. The same line in a preamble is the exporter's own and is
 * dropped on import; with other options it is the author's choice and the
 * exporter loads the package that way instead.
 */
export const MANAGED_PACKAGES: Record<string, string> = {
  inputenc: "utf8",
  fontenc: "T1",
  amsmath: "",
  amssymb: "",
  graphicx: "",
  booktabs: "",
  multirow: "",
  makecell: "",
  ulem: "normalem",
  xcolor: "",
  soul: "",
  geometry: "",
};

const BIBLATEX_COMMANDS = new Set([
  "addbibresource",
  "ExecuteBibliographyOptions",
  "DeclareFieldFormat",
  "DeclareNameAlias",
  "DefineBibliographyStrings",
  "AtEveryBibitem",
  "DeclareSourcemap",
  "renewbibmacro",
  "DeclareBibliographyDriver",
  "DeclareLanguageMapping",
  "defbibheading",
  "DeclareDelimFormat",
]);

/** Commands the visual editor represents itself (title block, page settings). */
const REPRESENTED = new Set([
  "documentclass",
  "title",
  "author",
  "and",
  "thanks",
  "affiliation",
  "altaffiliation",
  "address",
  "curraddr",
  "email",
  "urladdr",
  "orcid",
  "institute",
  "institution",
  "keywords",
  "maketitle",
  "doublespacing",
  "onehalfspacing",
  "singlespacing",
  "setstretch",
  "linespread",
  "bibliographystyle",
  "bibliography",
]);

const optionsKey = (options: string) => options.split(",").map((option) => option.trim()).filter(Boolean).sort().join(",");

/** Margins a geometry option list sets, rounded to the visual editor's three choices. */
export function geometryMargins(options: string): Margins | null {
  const match = /(?:^|,)\s*(?:margin|hmargin|left|lmargin|inner)\s*=\s*\{?([\d.]+)\s*(in|cm|mm|pt)/.exec(options);
  if (!match) return null;
  const value = Number(match[1]);
  const inches = match[2] === "cm" ? value / 2.54 : match[2] === "mm" ? value / 25.4 : match[2] === "pt" ? value / 72.27 : value;
  if (!(inches > 0)) return null;
  return inches < 0.75 ? "narrow" : inches > 1.25 ? "wide" : "normal";
}

/** Margins that geometry statements leave in force, starting from `initial`. */
export function effectiveMargins(statements: PreambleStatement[], initial: Margins | null): Margins | null {
  let margins = initial;
  for (const statement of statements) {
    const packages = packagesOf(statement);
    if (packages?.names.includes("geometry")) margins = geometryMargins(packages.options) ?? "normal";
    else if (statement.name === "geometry") margins = geometryMargins(statement.args[0]?.value ?? "") ?? margins;
  }
  return margins;
}

export interface ImportedPreamble {
  /** The author's own statements, one per line; "" when there are none. */
  preamble: string;
  /** Margins set by geometry, if any. */
  margins: Margins | null;
  /** `\renewcommand{\familydefault}{\sfdefault}`. */
  sansSerif: boolean;
  /** Line spacing set through setspace options. */
  lineSpacing: number | null;
  /** biblatex was replaced by BibTeX. */
  biblatex: boolean;
}

/** The statements of a source preamble that the visual editor must keep. */
export function importPreamble(statements: PreambleStatement[]): ImportedPreamble {
  const kept: { text: string; anchor: boolean }[] = [];
  let sansSerif = false;
  let lineSpacing: number | null = null;
  let biblatex = false;
  const theorems = statements.filter((statement) => statement.name === "newtheorem" || statement.name === "newtheorem*" || statement.name === "theoremstyle");
  // The exporter's own amsart theorem set comes back as it was written.
  const ownTheorems = theorems.length === AMSART_THEOREMS.length && theorems.every((statement, index) => statement.text === AMSART_THEOREMS[index]);

  for (const statement of statements) {
    const { name } = statement;
    if (!name) {
      kept.push({ text: statement.text, anchor: false });
      continue;
    }
    if (REPRESENTED.has(name)) continue;
    if (BIBLATEX_COMMANDS.has(name)) {
      biblatex = true;
      continue;
    }
    if (name === "date" && !statement.args[0]?.value.trim()) continue;
    if (ownTheorems && theorems.includes(statement)) continue;
    if (name === "definecolor" && /^paperhl[0-9A-F]{6}$/.test(statement.args[0]?.value.trim() ?? "")) continue;
    if ((name === "renewcommand" || name === "renewcommand*") && /^\\familydefault\s*$/.test(statement.args[0]?.value ?? "") && /\\sfdefault/.test(statement.args[statement.args.length - 1]?.value ?? "")) {
      sansSerif = true;
      continue;
    }
    if (name === "begin" && /^filecontents\*?$/.test(statement.args[0]?.value ?? "")) {
      const file = statement.args.filter((arg) => !arg.optional).slice(1)[0]?.value.trim() ?? "";
      if (file === "references.bib" || file === "arxiv-preprint.sty" || file === "ml-preprint.sty") continue;
    }
    const packages = packagesOf(statement);
    if (packages) {
      const names: string[] = [];
      for (const packageName of packages.names) {
        if (FONT_PACKAGES.has(packageName)) continue;
        if (SETTING_PACKAGES.has(packageName)) {
          if (packageName === "biblatex") biblatex = true;
          if (packageName === "setspace") {
            if (/\bdoublespacing\b/.test(packages.options)) lineSpacing = 2;
            else if (/\bonehalfspacing\b/.test(packages.options)) lineSpacing = 1.5;
          }
          continue;
        }
        if (packageName === "hyperref" && !packages.options) {
          // Kept only as a position: what comes after it must stay after it.
          names.push(packageName);
          continue;
        }
        if (packageName in MANAGED_PACKAGES) {
          if (packageName === "geometry") {
            const margins = geometryMargins(packages.options);
            const exact = margins && optionsKey(packages.options) === `margin=${MARGIN_LENGTHS[margins]}`;
            if (!packages.options || exact) continue;
          } else if (optionsKey(packages.options) === optionsKey(MANAGED_PACKAGES[packageName])) continue;
        }
        names.push(packageName);
      }
      if (names.length === 1 && packages.names.length === 1) {
        kept.push({ text: statement.text, anchor: names[0] === "hyperref" && !packages.options });
      } else {
        for (const packageName of names) kept.push({ text: usepackage(packages.options, packageName), anchor: packageName === "hyperref" && !packages.options });
      }
      continue;
    }
    kept.push({ text: statement.text, anchor: false });
  }

  // A bare \usepackage{hyperref} with nothing of the author's after it is the
  // exporter's own last line.
  while (kept.length && kept[kept.length - 1].anchor) kept.pop();

  return {
    preamble: kept.map((entry) => entry.text).join("\n"),
    margins: effectiveMargins(statements, null),
    sansSerif,
    lineSpacing,
    biblatex,
  };
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Packages the exporter loads in a fixed place, taking the author's options. */
const ABSORBED = new Set(["inputenc", "fontenc", "amsmath", "amssymb", "graphicx", "booktabs", "multirow", "makecell", "ulem", "xcolor", "soul", "geometry"]);

/** Statements that only work after hyperref has been loaded. */
function needsHyperref(statement: PreambleStatement): boolean {
  if (/^(?:hypersetup|crefname|Crefname|crefformat|Crefformat|creflabelformat)$/.test(statement.name)) return true;
  const packages = packagesOf(statement);
  return Boolean(packages?.names.some((name) => name === "cleveref" || name === "bookmark" || name === "hypcap"));
}

export interface ExportPreamble {
  /** `\usepackage` lines with the author's options, by package. */
  absorbed: Map<string, string>;
  /** Everything else, in the author's order. */
  statements: PreambleStatement[];
}

export function exportPreamble(preamble: string): ExportPreamble {
  const absorbed = new Map<string, string>();
  const statements: PreambleStatement[] = [];
  for (const statement of scanPreamble(preamble).statements) {
    const packages = packagesOf(statement);
    if (packages && packages.names.length === 1 && ABSORBED.has(packages.names[0]) && !absorbed.has(packages.names[0])) {
      absorbed.set(packages.names[0], statement.text);
      continue;
    }
    statements.push(statement);
  }
  return { absorbed, statements };
}

/** Whether these statements load one of `names`. */
export function loadsPackage(statements: PreambleStatement[], ...names: string[]): boolean {
  return statements.some((statement) => packagesOf(statement)?.names.some((name) => names.includes(name)));
}

/**
 * The author's statements with the exporter's hyperref line placed where it
 * works: before the first statement that needs it, or after all of them.
 */
export function withHyperref(statements: PreambleStatement[], hyperref: string): string[] {
  const lines = statements.map((statement) => statement.text);
  if (loadsPackage(statements, "hyperref")) return lines;
  const index = statements.findIndex(needsHyperref);
  if (index === -1) return [...lines, hyperref];
  return [...lines.slice(0, index), hyperref, ...lines.slice(index)];
}
