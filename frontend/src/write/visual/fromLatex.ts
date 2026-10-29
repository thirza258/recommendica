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
import { ACCENTS, CONTROL_SYMBOLS, NAMED_COLORS, TEXT_SYMBOLS, applyAccent, formatToday } from "../latex/symbols.ts";

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
  warnings: string[];
}

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
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

function colorValue(raw: string): string | null {
  const name = raw.trim().replace(/^\{|\}$/g, "");
  if (!name) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(name)) return name;
  if (/^[a-z]+$/i.test(name)) return NAMED_COLORS[name.toLowerCase()] ?? null;
  return null;
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

    const metadata = this.metadata(preamble, body);
    this.collectLabels(body);
    for (const node of preamble) this.collectLabels([node]);

    const blocks = this.blocks(body);
    const hasKeywords = blocks.some((node) => node.type === "paperKeywords");
    if (metadata.keywords && !hasKeywords) {
      const abstract = blocks.findIndex((node) => node.type === "paperAbstract");
      blocks.splice(abstract === -1 ? 0 : abstract + 1, 0, { type: "paperKeywords", content: metadata.keywords });
    }

    if (metadata.title.length) blocks.unshift({ type: "paperTitle", content: metadata.title });
    if (metadata.authors.length) blocks.splice(metadata.title.length ? 1 : 0, 0, { type: "paperAuthors", content: metadata.authors });

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

    return {
      content: { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] },
      settings: this.settings(preamble, body),
      bib,
      title: plainText({ type: "doc", content: metadata.title }),
      warnings: [...new Set(this.warnings)],
    };
  }

  // ── Metadata and settings ─────────────────────────────────────────────────

  private metadata(preamble: LatexNode[], body: LatexNode[]): { title: JSONContent[]; authors: JSONContent[]; keywords: JSONContent[] | null } {
    let title: JSONContent[] = [];
    const authors: JSONContent[] = [];
    let keywords: JSONContent[] | null = null;
    const visit = (nodes: LatexNode[]) => {
      for (const node of nodes) {
        if (node.type === "command") {
          switch (node.name) {
            case "title":
              if (!title.length) title = this.inline(lastParsedArg(node));
              break;
            case "author":
              if (authors.length) authors.push({ type: "hardBreak" });
              authors.push(...this.inline(lastParsedArg(node)));
              break;
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
    return { title: trimInline(title), authors: trimInline(authors), keywords: keywords ? trimInline(keywords) : null };
  }

  /**
   * Settings written into the exported source win over detection, except where
   * the user has visibly changed the preamble (margins, fonts, document class).
   * The theme needs special care: APA and article share the same class.
   */
  private settings(preamble: LatexNode[], body: LatexNode[]): Partial<PaperSettings> {
    const detected = this.detectedSettings(preamble, body);
    const marker = this.markerSettings();
    if (!Object.keys(marker).length) return detected;
    if (marker.theme && (!detected.theme || detected.theme === "article")) detected.theme = marker.theme;
    return { ...marker, ...detected };
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
          const options = argRaw(node, 0);
          if (names.includes("geometry")) {
            const margin = /(?:^|,)\s*margin\s*=\s*([\d.]+)\s*(in|cm|mm|pt)/.exec(options);
            if (margin) {
              const value = Number(margin[1]);
              const inches = margin[2] === "cm" ? value / 2.54 : margin[2] === "mm" ? value / 25.4 : margin[2] === "pt" ? value / 72.27 : value;
              settings.margins = inches < 0.75 ? "narrow" : inches > 1.25 ? "wide" : "normal";
            }
          }
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
        continue;
      }
      const block = this.blockAt(nodes, index);
      if (block) {
        flush();
        out.push(...block.nodes);
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

    switch (node.name) {
      case "maketitle":
      case "title":
      case "author":
      case "date":
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
      const content = this.blocks(node.children).filter((child) => child.type === "paragraph");
      return { nodes: [{ type: "paperAbstract", content: content.length ? content : [{ type: "paragraph" }] }], next };
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
    return { type: "rawLatex", attrs: { source: this.source.slice(node.start, node.end) } };
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
    for (const child of node.children) {
      if (child.type === "command" && child.name === "item") {
        flush();
        label = argRaw(child, 0) || nodesToText(argChildren(child, 0)).trim();
      } else {
        // Whitespace before the first \item (or after the last one) is not an
        // empty list item.
        if (!items.length && !label && isWhitespaceNode(child)) continue;
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
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          pushText(out, applyLigatures(node.value), marks);
          break;
        case "space":
        case "parbreak":
        case "tab":
          pushText(out, " ", marks);
          break;
        case "verb":
          pushText(out, node.value, withMark(marks, { type: "code" }));
          break;
        case "group":
          out.push(...this.inline(node.children, marks));
          break;
        case "math": {
          const math = cleanMath(node.content);
          if (math.latex) out.push({ type: "mathInline", attrs: { latex: math.latex } });
          break;
        }
        case "command": {
          if (REFERENCE_COMMANDS.has(node.name)) {
            const target = lastRawArg(node).trim();
            const label = this.labels.get(target);
            if (label && label.kind !== "unknown") trimReferenceWord(out);
          }
          out.push(...this.inlineCommand(node, marks));
          break;
        }
        case "environment":
          // Inline formatting environments (\begin{small} … \end{small})
          // carry text but no block structure of their own.
          out.push(...this.inline(node.children, marks));
          break;
        default:
          break;
      }
    }
    return out;
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
      textsuperscript: { type: "superscript" },
      textsubscript: { type: "subscript" },
      texttt: { type: "code" },
    };
    if (formatting[name]) return this.inline(lastParsedArg(node), withMark(marks, formatting[name]));
    if (name === "textup" || name === "textnormal") return this.inline(lastParsedArg(node), withoutMark(withoutMark(marks, "italic"), "bold"));
    if (name === "textsc") return this.inline(lastParsedArg(node), marks);
    if (name === "textcolor" || name === "colorbox" || name === "fcolorbox") {
      const color = colorValue(name === "fcolorbox" ? argRaw(node, 2) : argRaw(node, 1));
      const children = name === "fcolorbox" ? argChildren(node, 3) : argChildren(node, 2);
      return this.inline(children, color ? withMark(marks, { type: "textStyle", attrs: { color } }) : marks);
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
