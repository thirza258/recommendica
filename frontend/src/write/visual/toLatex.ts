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
import type { PaperSettings } from "../documents.ts";
import { conventions } from "../themes.ts";
import { PREPRINT_STYLES } from "../preprintStyles.ts";
import type { PreprintStyle } from "../preprintStyles.ts";

export interface LatexImage {
  path: string;
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
};

export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_~^\u00a0]/g, (ch) => SPECIALS[ch]);
}

function escapeUrl(url: string): string {
  return url.replace(/[%#\\{}]/g, (ch) => (ch === "\\" ? "" : `\\${ch}`));
}

/** Math that spans lines needs an alignment environment to compile (and to render in KaTeX). */
export function wrapMultiline(latex: string): string {
  const trimmed = latex.trim();
  if (/^\\begin\{/.test(trimmed)) return trimmed;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\") {
      if (trimmed[i + 1] === "\\" && depth === 0) return `\\begin{aligned}${trimmed}\\end{aligned}`;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "&" && depth === 0) return `\\begin{aligned}${trimmed}\\end{aligned}`;
  }
  return trimmed;
}

const HEADING_COMMANDS = ["section", "subsection", "subsubsection", "paragraph"];

interface Context {
  settings: PaperSettings;
  referenced: Set<string>;
  kinds: Map<string, { type: string; numbered: boolean }>;
  images: LatexImage[];
  warnings: string[];
  packages: Set<string>;
  usesRowspan: boolean;
  /** Highlight colours (hex) used, each defined once in the preamble for soul. */
  highlights: Set<string>;
}

function attr<T>(node: JSONContent, name: string, fallback: T): T {
  const value = node.attrs?.[name];
  return value === undefined || value === null ? fallback : (value as T);
}

/** `fig-overview` becomes `fig:overview`, the usual LaTeX label convention. */
function labelFor(type: string, id: string): string {
  const prefix = type === "heading" ? "sec" : type === "figure" ? "fig" : type === "tableFigure" ? "tab" : "eq";
  return `${prefix}:${id.replace(/^(sec|fig|tab|eq)-/, "")}`;
}

function collect(node: JSONContent, context: Context): void {
  if (node.type === "crossRef") {
    const target = attr(node, "target", "");
    if (target) context.referenced.add(target);
  }
  if (node.type && ["heading", "figure", "tableFigure", "mathBlock"].includes(node.type)) {
    const id = attr(node, "id", "");
    if (id) context.kinds.set(id, { type: node.type, numbered: attr<boolean>(node, "numbered", true) !== false });
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

function wrapMarks(text: string, marks: JSONContent["marks"], context: Context): string {
  let out = text;
  // soul's \hl cannot take commands inside its argument, so it wraps the text first.
  const ordered = [...(marks ?? [])].sort((a, b) => Number(b.type === "highlight") - Number(a.type === "highlight"));
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
        if (/^(https?:|mailto:)/i.test(href)) {
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

function inline(nodes: JSONContent[] | undefined, context: Context): string {
  let out = "";
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
        out += wrapMarks(escapeLatex(node.text ?? ""), node.marks, context);
        break;
      case "hardBreak":
        out += "\\\\\n";
        break;
      case "mathInline":
        out += `$${attr(node, "latex", "").trim()}$`;
        break;
      case "citation": {
        const keys = (attr<string[]>(node, "keys", []) ?? []).filter(Boolean);
        if (keys.length) out += context.settings.citationStyle === "apa" ? `\\citep{${keys.join(",")}}` : `\\cite{${keys.join(",")}}`;
        break;
      }
      case "crossRef":
        out += crossRef(attr(node, "target", ""), context);
        break;
      case "footnote":
        out += `\\footnote{${escapeLatex(attr(node, "text", ""))}}`;
        break;
      default:
        if (node.content) out += inline(node.content, context);
        break;
    }
  }
  return out;
}

function crossRef(target: string, context: Context): string {
  const kind = context.kinds.get(target);
  if (!kind) {
    context.warnings.push("A cross-reference points to something that no longer exists; it is exported as ??.");
    return "??";
  }
  const label = labelFor(kind.type, target);
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
  const id = attr(node, "id", "");
  let graphic: string;
  if (src.startsWith("data:image/")) {
    const mime = /^data:(image\/[a-z+.-]+)/i.exec(src)?.[1].toLowerCase() ?? "image/png";
    const path = `figures/figure-${context.images.length + 1}.${extensionFor(mime)}`;
    context.images.push({ path, dataUrl: src, mime });
    graphic = `\\includegraphics[width=${width}\\linewidth]{${path}}`;
  } else {
    if (src) {
      context.warnings.push(`A figure uses a web image (${src}); download it into figures/ to compile.`);
    }
    graphic = `\\fbox{\\parbox[c][4cm][c]{${width}\\linewidth}{\\centering Figure placeholder}}`;
  }
  const lines = ["\\begin{figure}[htbp]", "  \\centering", `  ${graphic}`, `  \\caption{${caption}}`];
  if (id && context.referenced.has(id)) lines.push(`  \\label{${labelFor("figure", id)}}`);
  lines.push("\\end{figure}");
  return lines.join("\n");
}

function cellText(cell: JSONContent, context: Context): string {
  return (cell.content ?? [])
    .map((paragraph) => inline(paragraph.content, context))
    .filter(Boolean)
    .join(" ");
}

function tabular(table: JSONContent, context: Context): string {
  const rows = table.content ?? [];
  const width = Math.max(1, ...rows.map((row) => (row.content ?? []).reduce((sum, cell) => sum + (Number(cell.attrs?.colspan) || 1), 0)));
  const firstRow = rows[0]?.content ?? [];
  const aligns: string[] = [];
  for (const cell of firstRow) {
    const align = cell.content?.[0]?.attrs?.textAlign;
    const letter = align === "center" ? "c" : align === "right" ? "r" : "l";
    for (let k = 0; k < (Number(cell.attrs?.colspan) || 1); k++) aligns.push(letter);
  }
  while (aligns.length < width) aligns.push("l");

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
      let text = cellText(cell, context);
      if (rowspan > 1) {
        context.usesRowspan = true;
        text = `\\multirow{${rowspan}}{*}{${text}}`;
        for (let k = 0; k < colspan; k++) covered[column + k] = rowspan - 1;
      }
      if (colspan > 1) text = `\\multicolumn{${colspan}}{c}{${text}}`;
      out.push(text);
      column += colspan;
    }
    lines.push(`    ${out.join(" & ")} \\\\`);
    const isHeader = (row.content ?? []).length > 0 && (row.content ?? []).every((cell) => cell.type === "tableHeader");
    if (index === 0 && isHeader && rows.length > 1) lines.push("    \\midrule");
  });
  return [`  \\begin{tabular}{${aligns.join("")}}`, "    \\toprule", ...lines, "    \\bottomrule", "  \\end{tabular}"].join("\n");
}

function tableFigure(node: JSONContent, context: Context): string {
  const caption = node.content?.find((child) => child.type === "figcaption");
  const table = node.content?.find((child) => child.type === "table");
  const id = attr(node, "id", "");
  const lines = ["\\begin{table}[htbp]", "  \\centering", `  \\caption{${inline(caption?.content, context)}}`];
  if (id && context.referenced.has(id)) lines.push(`  \\label{${labelFor("tableFigure", id)}}`);
  if (table) lines.push(tabular(table, context));
  lines.push("\\end{table}");
  return lines.join("\n");
}

function list(node: JSONContent, context: Context, depth: number): string {
  const env = node.type === "orderedList" ? "enumerate" : "itemize";
  const lines = [`\\begin{${env}}`];
  const start = Number(node.attrs?.start) || 1;
  if (env === "enumerate" && start !== 1) lines.push(`  \\setcounter{enum${["i", "ii", "iii", "iv"][Math.min(depth, 3)]}}{${start - 1}}`);
  for (const item of node.content ?? []) {
    const body = (item.content ?? []).map((child) => block(child, context, depth + 1)).filter(Boolean).join("\n");
    lines.push(`  \\item ${body.replace(/\n/g, "\n  ")}`);
  }
  lines.push(`\\end{${env}}`);
  return lines.join("\n");
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
      const id = attr(node, "id", "");
      const label = id && context.referenced.has(id) ? `\\label{${labelFor("heading", id)}}` : "";
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
      const latex = wrapMultiline(attr(node, "latex", ""));
      if (!latex) return "";
      const id = attr(node, "id", "");
      if (attr<boolean>(node, "numbered", true) === false) return `\\[\n  ${latex}\n\\]`;
      const label = id && context.referenced.has(id) ? `\\label{${labelFor("mathBlock", id)}}\n  ` : "";
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
function fontPackages(settings: PaperSettings): string[] {
  switch (settings.font) {
    case "times":
      return ["\\usepackage{amsmath}", "\\usepackage{newtxtext,newtxmath}"];
    case "palatino":
      return ["\\usepackage{amsmath}", "\\usepackage{newpxtext,newpxmath}"];
    case "sans":
      return ["\\usepackage{amsmath,amssymb}", "\\usepackage{lmodern}", "\\renewcommand{\\familydefault}{\\sfdefault}"];
    default:
      return ["\\usepackage{amsmath,amssymb}", "\\usepackage{lmodern}"];
  }
}

/** A visual authors block: the first line names, the following lines affiliations. */
function splitAuthors(latex: string): { names: string[]; affiliations: string[] } {
  const lines = latex.split(/\\\\\n?/).map((line) => line.trim()).filter(Boolean);
  const [first = "", ...rest] = lines;
  const names = first.split(/\s*,\s*|\s+and\s+|\s*;\s*/).map((name) => name.trim()).filter(Boolean);
  return { names, affiliations: rest };
}

const PREPRINT_PACKAGE: Partial<Record<PaperSettings["theme"], PreprintStyle>> = { arxiv: "arxiv-preprint", mlconf: "ml-preprint" };

const MARGINS: Record<PaperSettings["margins"], string> = { narrow: "0.5in", normal: "1in", wide: "1.5in" };

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
    const titleBlock: string[] = [`\\title{${title || "Untitled paper"}}`];
    for (const block of authors) {
      const { names, affiliations } = splitAuthors(block);
      for (const name of names) {
        titleBlock.push(`\\author{${name}}`);
        if (amsart) for (const affiliation of affiliations) titleBlock.push(`\\address{${affiliation}}`);
      }
      if (revtex) for (const affiliation of affiliations) titleBlock.push(`\\affiliation{${affiliation}}`);
    }
    body.unshift(...titleBlock, ...front, "\\maketitle");
  } else if (!titleWritten && title) {
    body.unshift("\\maketitle");
  }

  const usesBibliography = /\\(cite|citep)\{/.test(body.join("\n")) || nodes.some((node) => node.type === "bibliography");
  if (usesBibliography && !nodes.some((node) => node.type === "bibliography")) {
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

  const preamble = [documentClass, "\\usepackage[utf8]{inputenc}", "\\usepackage[T1]{fontenc}"];
  // IEEEtran and REVTeX choose their own fonts (and REVTeX loads the AMS packages).
  if (ieee) preamble.push("\\usepackage{amsmath,amssymb}");
  else if (!revtex) preamble.push(...fontPackages(settings));
  if (amsart) {
    preamble.push(
      "\\newtheorem{theorem}{Theorem}[section]",
      "\\newtheorem{lemma}[theorem]{Lemma}",
      "\\newtheorem{proposition}[theorem]{Proposition}",
      "\\newtheorem{corollary}[theorem]{Corollary}",
      "\\theoremstyle{definition}",
      "\\newtheorem{definition}[theorem]{Definition}",
      "\\newtheorem{example}[theorem]{Example}",
      "\\theoremstyle{remark}",
      "\\newtheorem{remark}[theorem]{Remark}",
    );
  }
  preamble.push("\\usepackage{graphicx}", "\\usepackage{booktabs}");
  if (context.usesRowspan) preamble.push("\\usepackage{multirow}");
  if (context.packages.has("ulem")) preamble.push("\\usepackage[normalem]{ulem}");
  if (context.packages.has("xcolor")) preamble.push("\\usepackage{xcolor}");
  if (context.packages.has("soul")) preamble.push("\\usepackage{soul}");
  for (const color of context.highlights) preamble.push(`\\definecolor{paperhl${color}}{HTML}{${color}}`);
  const classLayout = ieee || revtex || amsart;
  if (!classLayout) preamble.push(`\\usepackage[margin=${MARGINS[settings.margins]}]{geometry}`);
  const spacing = theme === "apa" ? 2 : settings.lineSpacing;
  if (spacing !== 1 && !ieee && !revtex) {
    preamble.push("\\usepackage{setspace}");
    preamble.push(spacing === 2 ? "\\doublespacing" : `\\setstretch{${spacing}}`);
  }
  if (settings.paragraphStyle === "spaced" && !classLayout) preamble.push("\\usepackage{parskip}");
  // REVTeX has natbib built in.
  if (settings.citationStyle === "apa" && !revtex) preamble.push("\\usepackage[round]{natbib}");
  else if (ieee) preamble.push("\\usepackage{cite}");
  if (preprint) preamble.push(`\\usepackage{${preprint}}`);
  preamble.push("\\usepackage{hyperref}");
  if (!frontMatterFirst) {
    preamble.push("");
    preamble.push(`\\title{${title || "Untitled paper"}}`);
    if (authors.length) preamble.push(`\\author{${authors.join(" \\and\n  ")}}`);
    if (!ieee) preamble.push("\\date{}");
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
