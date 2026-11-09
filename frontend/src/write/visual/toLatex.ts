/**
 * Visual document → LaTeX source.
 *
 * Produces a compilable article (or IEEEtran) with the packages the document
 * actually needs, real \label/\ref cross-references, \cite with a BibTeX
 * database, figures as files under figures/, and booktabs tables. Content the
 * visual editor only approximates (highlight colours, alignment) maps to the
 * closest standard LaTeX; raw LaTeX blocks pass through untouched.
 */

import type { JSONContent } from "@tiptap/core";
import { isEmbeddableImageSource, mimeForImageSource } from "../assetSource.ts";
import type { PaperSettings } from "../documents.ts";
import { conventions } from "../themes.ts";
import { PREPRINT_STYLES } from "../preprintStyles.ts";
import type { PreprintStyle } from "../preprintStyles.ts";
import { AMSART_THEOREMS, MARGIN_LENGTHS, effectiveMargins, exportPreamble, loadsPackage, scanPreamble, withHyperref } from "../latexPreamble.ts";
import { marksKey, sortMarks } from "./marks.ts";
import { MULTILINE_MATH, columnAligns } from "./latexShapes.ts";

export interface LatexImage {
  path: string;
  /** A data URL, or a /api/v1/assets/... URL that the exporter fetches. */
  dataUrl: string;
  mime: string;
}

export interface LatexExport {
  tex: string;
  bib: string;
  images: LatexImage[];
  /** Other text files the project needs, such as a preprint style (.sty). */
  files: { name: string; content: string }[];
  warnings: string[];
}

export interface LatexExportOptions {
  /** Embed the .bib (and any .sty) in the .tex, for a single-file download. */
  embedBibliography?: boolean;
  /**
   * The author's own preamble kept from LaTeX mode (macros, packages,
   * colours, theorems); see latexPreamble.ts.
   */
  preamble?: string;
}

const SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\u00a0": "~",
  "\u00ad": "\\-",
  // Characters pdfLaTeX's UTF-8 input does not know, from symbol commands.
  "\u2713": "\\checkmark{}",
  "\u2217": "\\textasteriskcentered{}",
};

export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_~^\u00a0\u00ad\u2713\u2217]/g, (ch) => SPECIALS[ch]);
}

function escapeUrl(url: string): string {
  return url.replace(/[%#\\{}]/g, (ch) => (ch === "\\" ? "" : `\\${ch}`));
}

/**
 * Math that spans lines needs an alignment environment to compile (and to
 * render in KaTeX). Line breaks and `&` inside braces or inside an
 * environment of their own (cases, matrix) do not count.
 */
export function wrapMultiline(latex: string): string {
  const trimmed = latex.trim();
  if (/^\\begin\{/.test(trimmed)) return trimmed;
  let depth = 0;
  let nested = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\") {
      if (trimmed.startsWith("\\begin{", i)) nested++;
      else if (trimmed.startsWith("\\end{", i)) nested = Math.max(0, nested - 1);
      else if (trimmed[i + 1] === "\\" && depth === 0 && nested === 0) return `\\begin{aligned}${trimmed}\\end{aligned}`;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "&" && depth === 0 && nested === 0) return `\\begin{aligned}${trimmed}\\end{aligned}`;
  }
  return trimmed;
}

const HEADING_COMMANDS = ["section", "subsection", "subsubsection", "paragraph"];

interface Context {
  settings: PaperSettings;
  referenced: Set<string>;
  kinds: Map<string, { type: string; numbered: boolean; label?: string }>;
  images: LatexImage[];
  warnings: string[];
  packages: Set<string>;
  usesRowspan: boolean;
  /** Highlight colours (hex) used, each defined once in the preamble for soul. */
  highlights: Set<string>;
  /** Sources of raw LaTeX blocks, to find the packages they use. */
  raw: string[];
  /** Inside a table cell, where \\ would end the row. */
  inCell: boolean;
  /** Line breaks written in the current cell. */
  cellBreaks: number;
}

/** natbib's citation commands; \cite itself works without natbib. */
const NATBIB_COMMANDS = /^(?:citep|citet|citealp|citealt|Citep|Citet|Citealp|Citealt|citeauthor|Citeauthor|citeyear|citeyearpar|citenum)\*?$/;

/** Reference commands a cross-reference may keep from its LaTeX source. */
const REFERENCE_COMMANDS = /^(?:ref|eqref|autoref|cref|Cref|nameref|vref|pageref)\*?$/;

function attr<T>(node: JSONContent, name: string, fallback: T): T {
  const value = node.attrs?.[name];
  return value === undefined || value === null ? fallback : (value as T);
}

/**
 * `fig-overview` becomes `fig:overview`, the usual LaTeX label convention.
 * IDs imported from LaTeX already carry a label (`sec:intro`), and those are
 * kept exactly so switching editors does not rename the document's labels.
 */
function labelFor(type: string, id: string): string {
  if (isImportedLabel(id)) return id;
  const prefix = type === "heading" ? "sec" : type === "figure" ? "fig" : type === "tableFigure" ? "tab" : "eq";
  return `${prefix}:${id.replace(/^(sec|fig|tab|eq)-/, "")}`;
}

/**
 * A node's LaTeX label: the label it was imported with (`label`, as long as
 * the node still has the id it was given for it), or one made from its id.
 */
function nodeLabel(node: JSONContent): string {
  const id = attr(node, "id", "");
  const label = attr(node, "label", "");
  return label && label === id ? label : labelFor(node.type ?? "", id);
}

/** Whether a node's label is written: when something refers to it, or it came from LaTeX. */
function writesLabel(node: JSONContent, context: Context): boolean {
  const id = attr(node, "id", "");
  return Boolean(id) && (context.referenced.has(id) || isImportedLabel(id) || attr(node, "label", "") === id);
}

/** Labels that kept LaTeX defines, so references to them stay references. */
function rawLabels(source: string, context: Context, type = "raw"): void {
  for (const match of source.matchAll(/\\label\s*\{([^}]+)\}/g)) {
    const label = match[1].trim();
    if (label && !context.kinds.has(label)) context.kinds.set(label, { type, numbered: true, label });
  }
}

/**
 * IDs with a colon come from imported LaTeX (`sec:intro`). The visual editor
 * generates hyphenated IDs (`sec-a1b2c3`), so a colon is unambiguous.
 */
function isImportedLabel(id: string): boolean {
  return id.includes(":");
}

function collect(node: JSONContent, context: Context): void {
  if (node.type === "crossRef") {
    const target = attr(node, "target", "");
    if (target) context.referenced.add(target);
  }
  if (node.type && ["heading", "figure", "tableFigure", "mathBlock"].includes(node.type)) {
    const id = attr(node, "id", "");
    if (id) context.kinds.set(id, { type: node.type, numbered: attr<boolean>(node, "numbered", true) !== false, label: nodeLabel(node) });
  }
  if (node.type === "mathBlock" && attr(node, "env", "")) {
    // A multi-line equation keeps its labels in its rows.
    rawLabels(attr(node, "latex", ""), context, "mathBlock");
  }
  if (node.type === "rawLatex" || node.type === "rawInline") {
    // Labels inside preserved LaTeX still exist, so references to them can
    // point at the same label instead of becoming "??" after a round trip.
    const source = attr(node, "source", "");
    context.raw.push(source);
    rawLabels(source, context);
  }
  if (node.type === "footnote" && attr(node, "latex", "")) {
    context.raw.push(attr(node, "latex", ""));
    rawLabels(attr(node, "latex", ""), context);
  }
  node.content?.forEach((child) => collect(child, context));
}

function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) return short[1].split("").map((ch) => ch + ch).join("").toUpperCase();
  const long = /^#([0-9a-f]{6})$/i.exec(value);
  if (long) return long[1].toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value);
  if (rgb) return rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}

/** URLs that \\url prints as written, wherever it is used. */
const PLAIN_URL = /^https?:\/\/[^\s%#\\{}^~&$_]+$/;

function wrapMarks(text: string, marks: JSONContent["marks"], context: Context, plain = ""): string {
  let out = text;
  // The schema's mark order, so the same text always gives the same LaTeX;
  // soul's \hl cannot take commands inside its argument, so it wraps the text first.
  const sorted = sortMarks(marks ?? []);
  const ordered = [...sorted.filter((mark) => mark.type === "highlight"), ...sorted.filter((mark) => mark.type !== "highlight")];
  for (const mark of ordered) {
    switch (mark.type) {
      case "bold":
        out = `\\textbf{${out}}`;
        break;
      case "italic":
        out = `\\textit{${out}}`;
        break;
      case "underline":
        out = `\\underline{${out}}`;
        break;
      case "strike":
        context.packages.add("ulem");
        out = `\\sout{${out}}`;
        break;
      case "code":
        out = `\\texttt{${out}}`;
        break;
      case "superscript":
        out = `\\textsuperscript{${out}}`;
        break;
      case "subscript":
        out = `\\textsubscript{${out}}`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        if (plain === href && out === escapeLatex(plain) && PLAIN_URL.test(href)) out = `\\url{${href}}`;
        else if (/^(https?:|mailto:)/i.test(href)) {
          out = `\\href{${escapeUrl(href)}}{${out}}`;
        }
        break;
      }
      case "textStyle": {
        const color = hexColor(mark.attrs?.color);
        if (color) {
          context.packages.add("xcolor");
          out = `\\textcolor[HTML]{${color}}{${out}}`;
        }
        break;
      }
      case "highlight": {
        context.packages.add("xcolor");
        context.packages.add("soul");
        const color = hexColor(mark.attrs?.color) ?? "FFF59D";
        context.highlights.add(color);
        out = `{\\sethlcolor{paperhl${color}}\\hl{${out}}}`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Text nodes with the same marks, joined: the editor stores them that way too. */
function joinText(nodes: JSONContent[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes ?? []) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text" && marksKey(last.marks) === marksKey(node.marks)) {
      out[out.length - 1] = { ...last, text: `${last.text ?? ""}${node.text ?? ""}` };
    } else out.push(node);
  }
  return out;
}

/** `\\cite[p.~5]{key}`, `\\citet[see][]{key}`: the citation as its attributes describe it. */
function citation(node: JSONContent, context: Context): string {
  const keys = (attr<string[]>(node, "keys", []) ?? []).filter(Boolean);
  if (!keys.length) return "";
  let command = attr(node, "command", "");
  if (!/^[A-Za-z]+\*?$/.test(command)) command = "";
  // IEEEtran's cite package and natbib do not mix: there the plain form is used.
  if (command && NATBIB_COMMANDS.test(command)) {
    if (context.settings.theme === "ieee") command = "";
    else context.packages.add("natbib");
  }
  if (!command) command = context.settings.citationStyle === "apa" ? "citep" : "cite";
  const pre = attr(node, "pre", "");
  const post = attr(node, "post", "");
  if (pre && command === "cite" && context.settings.theme !== "ieee") context.packages.add("natbib");
  const notes = pre && context.settings.theme !== "ieee" ? `[${pre}][${post}]` : post || pre ? `[${post || pre}]` : "";
  return `\\${command}${notes}{${keys.join(",")}}`;
}

function inline(nodes: JSONContent[] | undefined, context: Context): string {
  let out = "";
  for (const node of joinText(nodes)) {
    // A control word written by kept LaTeX must not run into a following letter.
    if (/\\[A-Za-z@]+$/.test(out) && node.type === "text" && /^[A-Za-z@]/.test(node.text ?? "")) out += " ";
    switch (node.type) {
      case "text":
        out += wrapMarks(escapeLatex(node.text ?? ""), node.marks, context, node.text ?? "");
        break;
      case "hardBreak":
        // In a cell, \\ would end the table row; \makecell takes it.
        if (context.inCell) context.cellBreaks++;
        out += context.inCell ? "\\\\" : "\\\\\n";
        break;
      case "mathInline":
        out += `$${attr(node, "latex", "").trim()}$`;
        break;
      case "citation":
        out += citation(node, context);
        break;
      case "crossRef":
        out += crossRef(attr(node, "target", ""), context, attr(node, "command", ""));
        break;
      case "footnote": {
        const latex = attr(node, "latex", "");
        out += `\\footnote{${latex || escapeLatex(attr(node, "text", ""))}}`;
        break;
      }
      case "rawInline":
        out += attr(node, "source", "");
        break;
      default:
        if (node.content) out += inline(node.content, context);
        break;
    }
  }
  return out;
}

function crossRef(target: string, context: Context, written = ""): string {
  const kind = context.kinds.get(target);
  const command = REFERENCE_COMMANDS.test(written) ? written : "";
  if (!kind) {
    // LaTeX prints ?? for a label it does not know; the reference itself is kept.
    context.warnings.push("A cross-reference points to something that no longer exists; LaTeX shows it as ??.");
    return target ? `\\${command || "ref"}{${target}}` : "??";
  }
  const label = kind.label ?? labelFor(kind.type, target);
  // A reference written with its own command in LaTeX keeps that command.
  if (command) return `\\${command}{${label}}`;
  if (kind.type === "raw") return `\\ref{${label}}`;
  const style = conventions(context.settings.theme);
  switch (kind.type) {
    case "heading":
      if (!kind.numbered || !context.settings.numberedHeadings || !style.numbered) {
        context.packages.add("hyperref");
        return "``\\nameref{" + label + "}''";
      }
      return `${style.sectionRef}~\\ref{${label}}`;
    case "figure":
      return `${style.figureRef}~\\ref{${label}}`;
    case "tableFigure":
      return `${style.tableRef}~\\ref{${label}}`;
    default:
      return `${style.equationRef}~\\eqref{${label}}`;
  }
}

function alignmentWrap(body: string, align: unknown): string {
  switch (align) {
    case "center":
      return `\\begin{center}\n${body}\n\\end{center}`;
    case "right":
      return `\\begin{flushright}\n${body}\n\\end{flushright}`;
    case "left":
      return `{\\raggedright ${body}\\par}`;
    default:
      return body;
  }
}

function extensionFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  // pdfLaTeX reads PNG, JPEG and PDF; other formats are converted to PNG on export.
  return "png";
}

function figure(node: JSONContent, context: Context): string {
  const src = attr(node, "src", "");
  const width = Math.min(Math.max(Number(attr(node, "width", 80)) || 80, 10), 100) / 100;
  const caption = inline(node.content?.[0]?.content, context);
  const path = attr(node, "path", "");
  let graphic: string;
  if (isEmbeddableImageSource(src)) {
    const mime = mimeForImageSource(src);
    const file = `figures/figure-${context.images.length + 1}.${extensionFor(mime)}`;
    context.images.push({ path: file, dataUrl: src, mime });
    graphic = `\\includegraphics[width=${width}\\linewidth]{${file}}`;
  } else if (!src && path && !/[{}\\%#]/.test(path)) {
    // An image the LaTeX source includes but the project does not have yet.
    graphic = `\\includegraphics[width=${width}\\linewidth]{${path}}`;
  } else {
    if (src) {
      context.warnings.push(`A figure uses a web image (${src}); download it into figures/ to compile.`);
    }
    // The placeholder links to a web image, which keeps it for the visual editor.
    const text = src && /^https:\/\//i.test(src) ? `\\href{${escapeUrl(src)}}{Figure placeholder}` : "Figure placeholder";
    graphic = `\\fbox{\\parbox[c][4cm][c]{${width}\\linewidth}{\\centering ${text}}}`;
  }
  const env = attr<boolean>(node, "wide", false) ? "figure*" : "figure";
  const lines = [`\\begin{${env}}[htbp]`, "  \\centering", `  ${graphic}`, `  \\caption{${caption}}`];
  if (writesLabel(node, context)) lines.push(`  \\label{${nodeLabel(node)}}`);
  lines.push(`\\end{${env}}`);
  return lines.join("\n");
}

function cellText(cell: JSONContent, context: Context, align: string): string {
  context.inCell = true;
  context.cellBreaks = 0;
  const text = (cell.content ?? []).map((paragraph) => inline(paragraph.content, context)).filter(Boolean).join(" ");
  context.inCell = false;
  // Line breaks inside a cell need \makecell (\\ alone would end the row).
  if (!context.cellBreaks) return text;
  context.packages.add("makecell");
  return `\\makecell[${align}]{${text}}`;
}

/**
 * The horizontal rules a table had in LaTeX, one entry per row boundary,
 * fitted to its current number of rows: the top, header and bottom rules
 * stay, and rows added in the visual editor get the rule between body rows.
 */
function fitRules(written: unknown, rows: number): string[] | null {
  if (!Array.isArray(written) || written.length < 2 || !written.every((rule) => typeof rule === "string")) return null;
  const rules = written as string[];
  if (rules.length === rows + 1) return rules;
  const inner = rules.slice(1, -1);
  const header = inner[0] ?? "";
  const counts = new Map<string, number>();
  for (const rule of inner.slice(1)) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  const body = inner.length > 1 ? [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0] : /^\\hline$/.test(header) ? header : "";
  const fitted = [rules[0]];
  for (let row = 1; row < rows; row++) fitted.push(row === 1 ? header : body);
  fitted.push(rules[rules.length - 1]);
  return fitted;
}

/**
 * The alignment the visual table gives each column: that of the first cell
 * of the column that spans only it (a cell spanning several columns says
 * nothing about each of them).
 */
function tableAligns(rows: JSONContent[], width: number): string[] {
  const aligns: (string | null)[] = new Array<string | null>(width).fill(null);
  const covered = new Array<number>(width).fill(0);
  for (const row of rows) {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (column < width && covered[column] > 0) column++;
      const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan) || 1);
      if (colspan === 1 && column < width && aligns[column] === null) {
        const align = cell.content?.[0]?.attrs?.textAlign;
        aligns[column] = align === "center" ? "c" : align === "right" ? "r" : "l";
      }
      for (let span = 0; span < colspan && column + span < width; span++) if (rowspan > 1) covered[column + span] = rowspan;
      column += colspan;
    }
    for (let index = 0; index < width; index++) if (covered[index] > 0) covered[index]--;
  }
  return aligns.map((align) => align ?? "l");
}

function tabular(table: JSONContent, context: Context): string {
  const rows = table.content ?? [];
  const width = Math.max(1, ...rows.map((row) => (row.content ?? []).reduce((sum, cell) => sum + (Number(cell.attrs?.colspan) || 1), 0)));
  const aligns = tableAligns(rows, width);
  // The column spec the LaTeX source had (rules, p{} columns) stays while the
  // table still has its columns and alignments.
  const spec = attr(table, "latexSpec", "");
  const specAligns = spec ? columnAligns(spec) : [];
  const keepSpec = spec.length > 0 && specAligns.length === width && specAligns.every((letter, index) => letter === aligns[index]);
  const rules = rows.length ? fitRules(attr<unknown>(table, "latexRules", null), rows.length) : null;

  // Cells covered by a rowspan from above must be emitted as empty cells.
  const covered = new Array<number>(width).fill(0);
  const lines: string[] = [];
  rows.forEach((row, index) => {
    const out: string[] = [];
    let column = 0;
    const cells = [...(row.content ?? [])];
    while (column < width) {
      if (covered[column] > 0) {
        covered[column] -= 1;
        out.push("");
        column += 1;
        continue;
      }
      const cell = cells.shift();
      if (!cell) {
        out.push("");
        column += 1;
        continue;
      }
      const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan) || 1);
      let text = cellText(cell, context, aligns[column] ?? "l");
      if (rowspan > 1) {
        context.usesRowspan = true;
        text = `\\multirow{${rowspan}}{*}{${text}}`;
        for (let k = 0; k < colspan; k++) covered[column + k] = rowspan - 1;
      }
      if (colspan > 1) text = `\\multicolumn{${colspan}}{c}{${text}}`;
      out.push(text);
      column += colspan;
    }
    if (rules?.[index]) lines.push(`    ${rules[index]}`);
    else if (!rules && index === 0) lines.push("    \\toprule");
    lines.push(`    ${out.join(" & ")} \\\\`);
    const isHeader = (row.content ?? []).length > 0 && (row.content ?? []).every((cell) => cell.type === "tableHeader");
    if (!rules && index === 0 && isHeader && rows.length > 1) lines.push("    \\midrule");
  });
  if (rules?.[rows.length]) lines.push(`    ${rules[rows.length]}`);
  else if (!rules) lines.push("    \\bottomrule");
  if (!rows.length && !rules) lines.unshift("    \\toprule");
  return [`  \\begin{tabular}{${keepSpec ? spec : aligns.join("")}}`, ...lines, "  \\end{tabular}"].join("\n");
}

function tableFigure(node: JSONContent, context: Context): string {
  const caption = node.content?.find((child) => child.type === "figcaption");
  const table = node.content?.find((child) => child.type === "table");
  const env = attr<boolean>(node, "wide", false) ? "table*" : "table";
  const lines = [`\\begin{${env}}[htbp]`, "  \\centering", `  \\caption{${inline(caption?.content, context)}}`];
  if (writesLabel(node, context)) lines.push(`  \\label{${nodeLabel(node)}}`);
  if (table) lines.push(tabular(table, context));
  lines.push(`\\end{${env}}`);
  return lines.join("\n");
}

/** A description item's label: the bold text it starts with. */
function descriptionItem(item: JSONContent, context: Context, depth: number): string {
  const [first, ...rest] = item.content ?? [];
  const content = joinText(first?.content);
  const head = content[0];
  let label = "";
  let body = content;
  if (head?.type === "text" && head.marks?.length === 1 && head.marks[0].type === "bold") {
    label = escapeLatex(head.text ?? "").trim();
    body = content.slice(1);
    if (body[0]?.type === "text") body = [{ ...body[0], text: (body[0].text ?? "").replace(/^\s+/, "") }, ...body.slice(1)];
  }
  const blocks = [inline(body, context), ...rest.map((child) => block(child, context, depth + 1))].filter(Boolean).join("\n");
  return label ? `\\item[${label}] ${blocks}` : `\\item ${blocks}`;
}

function list(node: JSONContent, context: Context, depth: number): string {
  const description = node.type === "bulletList" && attr<string>(node, "latexEnv", "") === "description";
  const env = description ? "description" : node.type === "orderedList" ? "enumerate" : "itemize";
  const options = attr(node, "latexOptions", "");
  const lines = [`\\begin{${env}}${options && !/[\]\n]/.test(options) ? `[${options}]` : ""}`];
  const start = Number(node.attrs?.start) || 1;
  if (env === "enumerate" && start !== 1) lines.push(`  \\setcounter{enum${["i", "ii", "iii", "iv"][Math.min(depth, 3)]}}{${start - 1}}`);
  for (const item of node.content ?? []) {
    if (description) {
      lines.push(`  ${descriptionItem(item, context, depth).replace(/\n/g, "\n  ")}`);
      continue;
    }
    const body = (item.content ?? []).map((child) => block(child, context, depth + 1)).filter(Boolean).join("\n");
    lines.push(`  \\item ${body.replace(/\n/g, "\n  ")}`);
  }
  lines.push(`\\end{${env}}`);
  return lines.join("\n");
}

/** A multi-line equation environment kept from LaTeX (align, gather, …). */
function equationEnvironment(node: JSONContent, context: Context): string {
  const base = attr(node, "env", "").replace(/\*$/, "");
  const latex = attr(node, "latex", "").trim();
  if (!latex) return "";
  const env = attr<boolean>(node, "numbered", true) === false ? `${base}*` : base;
  let argument = "";
  if (base === "alignat") {
    // alignat needs its number of column pairs.
    const written = attr(node, "envArg", "").trim();
    const tabs = (latex.split("\\\\")[0].match(/&/g) ?? []).length;
    argument = `{${/^\d+$/.test(written) ? written : Math.max(1, Math.ceil((tabs + 1) / 2))}}`;
  }
  // The block's own label is written in its first row if no row has it.
  const id = attr(node, "id", "");
  const label = id && writesLabel(node, context) && !latex.includes(`\\label{${nodeLabel(node)}}`) ? `\\label{${nodeLabel(node)}}\n  ` : "";
  return `\\begin{${env}}${argument}\n  ${label}${latex}\n\\end{${env}}`;
}

function block(node: JSONContent, context: Context, depth = 0): string {
  switch (node.type) {
    case "paragraph": {
      const body = inline(node.content, context);
      if (!body.trim()) return "";
      return alignmentWrap(body, node.attrs?.textAlign);
    }
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 4);
      const numbered = context.settings.numberedHeadings && context.settings.theme !== "apa" && node.attrs?.numbered !== false && level <= 3;
      const label = writesLabel(node, context) ? `\\label{${nodeLabel(node)}}` : "";
      return `\\${HEADING_COMMANDS[level - 1]}${numbered ? "" : "*"}{${inline(node.content, context)}}${label}`;
    }
    case "paperTitle":
    case "paperAuthors":
      return "";
    case "paperAbstract":
      return `\\begin{abstract}\n${(node.content ?? []).map((child) => block(child, context)).filter(Boolean).join("\n\n")}\n\\end{abstract}`;
    case "paperKeywords": {
      const body = inline(node.content, context);
      if (!body.trim()) return "";
      switch (context.settings.theme) {
        case "ieee":
          return `\\begin{IEEEkeywords}\n${body}\n\\end{IEEEkeywords}`;
        case "arxiv":
        case "mlconf":
        case "revtex":
        case "amsart":
          return `\\keywords{${body}}`;
        default:
          return `\\noindent\\textbf{Keywords:} ${body}`;
      }
    }
    case "mathBlock": {
      if (MULTILINE_MATH.has(attr(node, "env", "").replace(/\*$/, ""))) return equationEnvironment(node, context);
      const latex = wrapMultiline(attr(node, "latex", ""));
      if (!latex) return "";
      if (attr<boolean>(node, "numbered", true) === false) return `\\[\n  ${latex}\n\\]`;
      const label = writesLabel(node, context) ? `\\label{${nodeLabel(node)}}\n  ` : "";
      return `\\begin{equation}\n  ${label}${latex}\n\\end{equation}`;
    }
    case "figure":
      return figure(node, context);
    case "tableFigure":
      return tableFigure(node, context);
    case "table":
      return `\\begin{center}\n${tabular(node, context)}\n\\end{center}`;
    case "bulletList":
    case "orderedList":
      return list(node, context, depth);
    case "blockquote":
      return `\\begin{quote}\n${(node.content ?? []).map((child) => block(child, context, depth)).filter(Boolean).join("\n\n")}\n\\end{quote}`;
    case "codeBlock": {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("").replace(/\\end\{verbatim\}/g, "\\end {verbatim}");
      return `\\begin{verbatim}\n${code}\n\\end{verbatim}`;
    }
    case "horizontalRule":
      return "\\noindent\\rule{\\linewidth}{0.4pt}";
    case "pageBreak":
      return "\\newpage";
    case "rawLatex":
      return attr(node, "source", "");
    case "bibliography": {
      // REVTeX picks apsrev4-2 by itself.
      const style = bibliographyStyle(context.settings);
      return style ? `\\bibliographystyle{${style}}\n\\bibliography{references}` : "\\bibliography{references}";
    }
    default:
      return node.content ? (node.content ?? []).map((child) => block(child, context, depth)).filter(Boolean).join("\n\n") : "";
  }
}

function bibliographyStyle(settings: PaperSettings): string | null {
  switch (settings.theme) {
    case "revtex":
      return null;
    case "ieee":
      return "IEEEtran";
    case "apa":
      return "apalike";
    case "amsart":
      return settings.citationStyle === "apa" ? "plainnat" : "amsplain";
    case "arxiv":
    case "mlconf":
      return settings.citationStyle === "apa" ? "plainnat" : "unsrt";
    default:
      return settings.citationStyle === "apa" ? "apalike" : "unsrt";
  }
}

/**
 * Math and text fonts, in a safe order: amsmath first, and no amssymb next to
 * newtxmath/newpxmath, which define the same symbols (\\Bbbk clashes).
 */
function fontPackages(settings: PaperSettings, load: (names: string[]) => string[]): string[] {
  switch (settings.font) {
    case "times":
      return [...load(["amsmath"]), ...load(["newtxtext", "newtxmath"])];
    case "palatino":
      return [...load(["amsmath"]), ...load(["newpxtext", "newpxmath"])];
    case "sans":
      return [...load(["amsmath", "amssymb"]), ...load(["lmodern"]), "\\renewcommand{\\familydefault}{\\sfdefault}"];
    default:
      return [...load(["amsmath", "amssymb"]), ...load(["lmodern"])];
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A visual authors block as LaTeX lines: names first, then affiliations and e-mails. */
function authorLines(node: JSONContent, context: Context): { tex: string; email: boolean }[] {
  const lines: JSONContent[][] = [[]];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") lines.push([]);
    else lines[lines.length - 1].push(child);
  }
  return lines
    .map((line) => ({ tex: inline(line, context).trim(), email: EMAIL.test(line.map((child) => child.text ?? "").join("").trim()) }))
    .filter((line) => line.tex);
}

/** `\\IEEEauthorblockN{Name}\\IEEEauthorblockA{Dept\\\\ University}`. */
function ieeeAuthorBlock(node: JSONContent, context: Context): string {
  const [first, ...rest] = authorLines(node, context);
  if (!first) return "";
  const affiliation = rest.length ? `\\IEEEauthorblockA{${rest.map((line) => line.tex).join("\\\\\n")}}` : "";
  return `\\IEEEauthorblockN{${first.tex}}${affiliation}`;
}

const PREPRINT_PACKAGE: Partial<Record<PaperSettings["theme"], PreprintStyle>> = { arxiv: "arxiv-preprint", mlconf: "ml-preprint" };

export function documentToLatex(doc: JSONContent, settings: PaperSettings, bib: string, options: LatexExportOptions = {}): LatexExport {
  const context: Context = {
    settings,
    referenced: new Set(),
    kinds: new Map(),
    images: [],
    warnings: [],
    packages: new Set(),
    usesRowspan: false,
    highlights: new Set(),
    raw: [],
    inCell: false,
    cellBreaks: 0,
  };
  collect(doc, context);

  const theme = settings.theme;
  const ieee = theme === "ieee";
  const revtex = theme === "revtex";
  const amsart = theme === "amsart";
  // REVTeX and amsart typeset the abstract inside \maketitle, so it comes first.
  const frontMatterFirst = revtex || amsart;
  const preprint = PREPRINT_PACKAGE[theme] ?? null;

  const nodes = doc.content ?? [];
  const titleNode = nodes.find((node) => node.type === "paperTitle");
  const authorNodes = nodes.filter((node) => node.type === "paperAuthors");
  const title = titleNode ? inline(titleNode.content, context) : "";
  const authors = authorNodes.map((node) => inline(node.content, context)).filter((text) => text.trim());

  const front: string[] = [];
  const body: string[] = [];
  let titleWritten = false;
  for (const node of nodes) {
    if (node.type === "paperTitle" || node.type === "paperAuthors") {
      if (!frontMatterFirst && !titleWritten && (title || authors.length)) {
        body.push("\\maketitle");
        titleWritten = true;
      }
      continue;
    }
    const text = block(node, context);
    if (!text) continue;
    if (frontMatterFirst && (node.type === "paperAbstract" || node.type === "paperKeywords")) front.push(text);
    else body.push(text);
  }
  if (frontMatterFirst) {
    // A completely blank paper needs no front matter (and no fallback title).
    if (title || authors.length || front.length) {
      const titleBlock: string[] = [`\\title{${title || "Untitled paper"}}`];
      // REVTeX: authors, then the affiliation they share. amsart: each
      // author with an address. Lines that look like e-mails become \\email.
      const lineCommand = (line: { tex: string; email: boolean }) => (line.email ? `\\email{${line.tex}}` : `\\${revtex ? "affiliation" : "address"}{${line.tex}}`);
      for (const node of authorNodes) {
        const [first, ...rest] = authorLines(node, context);
        if (!first) continue;
        const names = first.tex.split(/\s*,\s*|\s+and\s+|\s*;\s*/).map((name) => name.trim()).filter(Boolean);
        for (const name of names) {
          titleBlock.push(`\\author{${name}}`);
          if (amsart) titleBlock.push(...rest.map(lineCommand));
        }
        if (revtex) titleBlock.push(...rest.map(lineCommand));
      }
      body.unshift(titleBlock.join("\n"), ...front, "\\maketitle");
    }
  } else if (!titleWritten && title) {
    body.unshift("\\maketitle");
  }

  const usesBibliography = /\\(cite|citep)\{/.test(body.join("\n")) || nodes.some((node) => node.type === "bibliography");
  // A reference list kept as LaTeX (thebibliography, \bibliography) is the paper's own.
  const ownList = context.raw.some((source) => /\\begin\{thebibliography\}|\\bibliography\{|\\printbibliography/.test(source));
  if (usesBibliography && !ownList && !nodes.some((node) => node.type === "bibliography")) {
    body.push(block({ type: "bibliography" }, context));
  }

  const paperOption = settings.paper === "a4" ? "a4paper" : "letterpaper";
  let documentClass: string;
  if (ieee) {
    documentClass = `\\documentclass[${["conference", ...(settings.paper === "a4" ? ["a4paper"] : []), ...(settings.columns === 1 ? ["onecolumn"] : [])].join(",")}]{IEEEtran}`;
  } else if (revtex) {
    documentClass = `\\documentclass[${["aps", settings.columns === 2 ? "reprint" : "preprint", "amsmath", "amssymb", ...(settings.paper === "a4" ? ["a4paper"] : [])].join(",")}]{revtex4-2}`;
  } else if (amsart) {
    documentClass = `\\documentclass[${settings.fontSize}pt${settings.paper === "a4" ? ",a4paper" : ""}]{amsart}`;
  } else {
    documentClass = `\\documentclass[${[`${theme === "apa" ? 12 : settings.fontSize}pt`, paperOption, ...(settings.columns === 2 ? ["twocolumn"] : [])].join(",")}]{article}`;
  }

  // The author's preamble from LaTeX mode. Packages the exporter also loads
  // are written once, in the exporter's place, with the author's options.
  const user = exportPreamble(options.preamble ?? "");
  const usage = [...context.raw, ...user.statements.map((statement) => statement.text)].join("\n");
  // newtxmath/newpxmath already define amssymb's symbols (\\Bbbk clashes).
  if (!ieee && !revtex && (settings.font === "times" || settings.font === "palatino")) user.absorbed.delete("amssymb");
  const packageLines = (names: string[], packageOptions = ""): string[] => {
    const lines: string[] = [];
    let run: string[] = [];
    const flush = () => {
      if (run.length) lines.push(`\\usepackage${packageOptions ? `[${packageOptions}]` : ""}{${run.join(",")}}`);
      run = [];
    };
    for (const name of names) {
      const own = user.absorbed.get(name);
      if (own === undefined) {
        run.push(name);
        continue;
      }
      flush();
      lines.push(own);
      user.absorbed.delete(name);
    }
    flush();
    return lines;
  };
  const wants = (name: string) => user.absorbed.has(name);

  const preamble = [
    // Lets the importer restore visual-only settings (such as the APA theme,
    // which shares the article class) after the source has been edited.
    `% recommendica-write-settings: ${JSON.stringify(settings)}`,
    documentClass,
    ...packageLines(["inputenc"], "utf8"),
    ...packageLines(["fontenc"], "T1"),
  ];
  // IEEEtran and REVTeX choose their own fonts (and REVTeX loads the AMS packages).
  if (ieee) preamble.push(...packageLines(["amsmath", "amssymb"]));
  else if (!revtex) preamble.push(...fontPackages(settings, (names) => packageLines(names)));
  // The author's own theorem definitions replace the default set.
  if (amsart && !user.statements.some((statement) => /^newtheorem\*?$/.test(statement.name))) preamble.push(...AMSART_THEOREMS);
  preamble.push(...packageLines(["graphicx"]), ...packageLines(["booktabs"]));
  // Raw LaTeX blocks and the author's preamble may need packages too.
  if (context.usesRowspan || wants("multirow") || /\\multirow\b/.test(usage)) preamble.push(...packageLines(["multirow"]));
  if (context.packages.has("makecell") || wants("makecell") || /\\makecell\b/.test(usage)) preamble.push(...packageLines(["makecell"]));
  if (context.packages.has("ulem") || wants("ulem") || /\\(?:sout|uline|uwave|xout)\b/.test(usage)) preamble.push(...packageLines(["ulem"], "normalem"));
  const usesColour = /\\(?:textcolor|color|colorbox|fcolorbox|definecolor|colorlet|rowcolor|cellcolor|pagecolor)\b/.test(usage) && !loadsPackage(user.statements, "xcolor", "color");
  if (context.packages.has("xcolor") || wants("xcolor") || usesColour) preamble.push(...packageLines(["xcolor"]));
  if (context.packages.has("soul") || wants("soul") || /\\(?:hl|sethlcolor|st|ul|so|caps)\b/.test(usage)) preamble.push(...packageLines(["soul"]));
  const classLayout = ieee || revtex || amsart;
  const ownGeometry = classLayout ? undefined : user.absorbed.get("geometry");
  if (!classLayout) preamble.push(...packageLines(["geometry"], `margin=${MARGIN_LENGTHS[settings.margins]}`));
  const spacing = theme === "apa" ? 2 : settings.lineSpacing;
  if (spacing !== 1 && !ieee && !revtex) {
    preamble.push("\\usepackage{setspace}");
    preamble.push(spacing === 2 ? "\\doublespacing" : `\\setstretch{${spacing}}`);
  }
  if (settings.paragraphStyle === "spaced" && !classLayout) preamble.push("\\usepackage{parskip}");
  // REVTeX has natbib built in; natbib's own commands need it elsewhere.
  if (settings.citationStyle === "apa" && !revtex) preamble.push("\\usepackage[round]{natbib}");
  else if (ieee) preamble.push("\\usepackage{cite}");
  else if (context.packages.has("natbib") && !revtex && !loadsPackage(user.statements, "natbib")) preamble.push("\\usepackage[numbers]{natbib}");
  if (preprint) preamble.push(`\\usepackage{${preprint}}`);
  // The author's statements, in their order, after every package they may
  // build on; hyperref goes before the first statement that needs it.
  preamble.push(...user.absorbed.values());
  preamble.push(...withHyperref(user.statements, "\\usepackage{hyperref}"));
  if (!classLayout) {
    // Geometry the author set in LaTeX stays until the margins are changed here.
    const initial = ownGeometry === undefined ? settings.margins : effectiveMargins(scanPreamble(ownGeometry).statements, null);
    if (effectiveMargins(user.statements, initial) !== settings.margins) preamble.push(`\\geometry{margin=${MARGIN_LENGTHS[settings.margins]}}`);
  }
  for (const color of context.highlights) preamble.push(`\\definecolor{paperhl${color}}{HTML}{${color}}`);
  if (!frontMatterFirst && (title || authors.length)) {
    preamble.push("");
    preamble.push(`\\title{${title || "Untitled paper"}}`);
    if (authors.length) {
      preamble.push(
        ieee
          ? `\\author{${authorNodes.map((node) => ieeeAuthorBlock(node, context)).filter(Boolean).join("\n\\and\n")}}`
          : `\\author{${authors.join(" \\and\n  ")}}`,
      );
    }
    if (!ieee && !user.statements.some((statement) => statement.name === "date")) preamble.push("\\date{}");
  }

  const bibText = bib.trim();
  const files = preprint ? [{ name: `${preprint}.sty`, content: PREPRINT_STYLES[preprint] }] : [];
  const head: string[] = [];
  if (options.embedBibliography) {
    for (const file of files) head.push(`\\begin{filecontents*}[overwrite]{${file.name}}`, file.content.trimEnd(), "\\end{filecontents*}", "");
    if (usesBibliography && bibText) head.push("\\begin{filecontents*}[overwrite]{references.bib}", bibText, "\\end{filecontents*}", "");
  }
  const tex = [...head, ...preamble, "", "\\begin{document}", "", body.join("\n\n"), "", "\\end{document}", ""].join("\n");
  return {
    tex,
    bib: bibText ? `${bibText}\n` : "",
    images: context.images,
    files: options.embedBibliography ? [] : files,
    warnings: [...new Set(context.warnings)],
  };
}
