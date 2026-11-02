import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { baseExtensions } from "../src/write/visual/extensions.ts";
import { createFromTemplate, TEMPLATES } from "../src/write/templates.ts";
import { switchToLatex, switchToVisual } from "../src/write/modeSwitch.ts";
import { importLatex } from "../src/write/visual/fromLatex.ts";
import { documentToLatex } from "../src/write/visual/toLatex.ts";
import { renderMath } from "../src/write/latex/render.ts";
import { parseLatex } from "../src/write/latex/parser.ts";
import { anchorAt, findAnchor, headingKey, latexHeadings } from "../src/write/modeAnchor.ts";

const schema = getSchema(baseExtensions());

const files = (doc) => Object.fromEntries(doc.files.map((file) => [file.name, file.content]));

/** LaTeX → visual → LaTeX, the way a switch there and back would do it. */
function cycle(tex, extra = {}) {
  const imported = importLatex(tex, { files: extra.files ?? {}, assets: extra.assets ?? {}, bib: extra.bib ?? "" });
  const settings = { ...(extra.settings ?? createFromTemplate("blank").settings), ...imported.settings };
  return { imported, tex: documentToLatex(imported.content, settings, imported.bib, { preamble: imported.preamble }).tex };
}

const body = (tex) => String.raw`\documentclass{article}
\begin{document}
${tex}
\end{document}`;

const firstParagraph = (content) => content.content.find((node) => node.type === "paragraph");

test("every visual template survives export → import → export unchanged", () => {
  for (const template of TEMPLATES.filter((entry) => entry.kind === "visual")) {
    const doc = createFromTemplate(template.id, 0);
    const exported = documentToLatex(doc.content, doc.settings, doc.bib);
    const again = cycle(exported.tex, { settings: doc.settings, bib: doc.bib, files: { ...Object.fromEntries(exported.files.map((file) => [file.name, file.content])), "references.bib": exported.bib } });
    assert.equal(again.tex, exported.tex, `${template.id} changed after one round trip`);
  }
});

test("every LaTeX template reaches a fixed point after one cycle", () => {
  for (const template of TEMPLATES.filter((entry) => entry.kind === "latex")) {
    const doc = createFromTemplate(template.id, 0);
    const first = cycle(doc.source, { files: files(doc), bib: doc.bib });
    const second = cycle(first.tex, { files: files(doc), bib: doc.bib });
    assert.equal(second.tex, first.tex, `${template.id} keeps changing on every switch`);
  }
});

test("switching without edits returns the original representation byte for byte", async () => {
  const latex = createFromTemplate("latex-revtex", 0);
  const visual = await switchToVisual(latex);
  const back = await switchToLatex(visual.document);
  assert.equal(back.document.source, latex.source);
  const article = createFromTemplate("research-article", 0);
  const there = await switchToLatex(article);
  const home = await switchToVisual(there.document);
  assert.deepEqual(home.document.content, article.content);
});

test("opening a converted paper in the visual editor does not count as an edit", async () => {
  for (const template of TEMPLATES.filter((entry) => entry.kind === "latex")) {
    const latex = createFromTemplate(template.id, 0);
    const visual = await switchToVisual(latex);
    // What the editor hands back: normalized JSON (default attributes filled
    // in) and the empty paragraph TipTap keeps at the end of the document.
    const loaded = Node.fromJSON(schema, visual.document.content);
    loaded.check();
    const normalized = loaded.toJSON();
    normalized.content.push({ type: "paragraph" });
    const back = await switchToLatex({ ...visual.document, content: normalized });
    assert.equal(back.document.source, latex.source, `${template.id}: the original source must be kept`);
    assert.equal(back.notice, "");
  }
});

test("list items, line breaks and keywords keep their text", () => {
  const { imported } = cycle(body(String.raw`\noindent\textbf{Keywords:} alpha, beta

\begin{itemize}
  \item A first item with spaces
  \item Second
\end{itemize}

Line one\\
Line two`));
  const nodes = imported.content.content;
  assert.equal(nodes[0].type, "paperKeywords");
  assert.equal(nodes[0].content.map((node) => node.text).join(""), "alpha, beta");
  const item = nodes.find((node) => node.type === "bulletList").content[0].content[0].content[0].text;
  assert.equal(item, "A first item with spaces");
  const lines = nodes.find((node) => node.type === "paragraph" && node.content.some((child) => child.type === "hardBreak")).content;
  assert.deepEqual(lines.map((node) => node.text ?? node.type), ["Line one", "hardBreak", "Line two"]);
});

test("authors keep their affiliations in REVTeX, amsart and IEEE sources", () => {
  const revtex = cycle(String.raw`\documentclass[aps,reprint]{revtex4-2}
\begin{document}
\title{T}
\author{Ann One}
\author{Bob Two}
\affiliation{Lab A, City}
\author{Cy Three}
\affiliation{Lab B, Town}
\maketitle
Text.
\end{document}`);
  const groups = revtex.imported.content.content.filter((node) => node.type === "paperAuthors");
  assert.equal(groups.length, 2);
  assert.match(revtex.tex, /\\author\{Ann One\}\n\\author\{Bob Two\}\n\\affiliation\{Lab A, City\}\n\\author\{Cy Three\}\n\\affiliation\{Lab B, Town\}/);

  const amsart = cycle(String.raw`\documentclass{amsart}
\begin{document}
\title{T}
\author{Ann One}
\address{Dept A}
\author{Bob Two}
\address{Dept B}
\maketitle
Text.
\end{document}`);
  assert.match(amsart.tex, /\\author\{Ann One\}\n\\address\{Dept A\}\n\\author\{Bob Two\}\n\\address\{Dept B\}/);

  const ieee = cycle(String.raw`\documentclass[conference]{IEEEtran}
\begin{document}
\title{T}
\author{\IEEEauthorblockN{Ann One}
\IEEEauthorblockA{Dept A\\ Uni A}
\and
\IEEEauthorblockN{Bob Two}
\IEEEauthorblockA{Dept B}}
\maketitle
Text.
\end{document}`);
  assert.doesNotMatch(ieee.imported.warnings.join(" "), /IEEEauthorblock/);
  assert.match(ieee.tex, /\\IEEEauthorblockN\{Ann One\}\\IEEEauthorblockA\{Dept A\\\\\s*Uni A\}\s*\\and\s*\\IEEEauthorblockN\{Bob Two\}\\IEEEauthorblockA\{Dept B\}/);
});

test("macros, packages and colours of the LaTeX preamble survive the visual editor", async () => {
  const source = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{siunitx}
\usepackage[dvipsnames]{xcolor}
\usepackage{soul}
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator{\argmax}{arg\,max}
\definecolor{brand}{HTML}{1D4ED8}
\begin{document}
Let $x \in \R$ and $\argmax_x f$. {\sethlcolor{yellow}\hl{marked}} \textcolor[HTML]{FF0000}{red} \textcolor{brand}{brand} \textcolor{Maroon}{m}.
\end{document}`;
  const latex = { ...createFromTemplate("latex-blank", 0), source, files: [] };
  const visual = await switchToVisual(latex);
  assert.match(visual.document.latexPreamble, /\\newcommand\{\\R\}\{\\mathbb\{R\}\}/);
  const marks = firstParagraph(visual.document.content).content.flatMap((node) => node.marks ?? []);
  assert.ok(marks.some((mark) => mark.type === "highlight"), "highlight kept");
  assert.ok(marks.some((mark) => mark.type === "textStyle" && /^#ff0000$/i.test(mark.attrs.color)), "HTML colour kept");
  assert.ok(marks.some((mark) => mark.type === "textStyle" && /^#1d4ed8$/i.test(mark.attrs.color)), "\\definecolor colour kept");
  assert.equal(visual.notice, "");

  // The visual editor renders the macros…
  const macros = parseLatex(visual.document.latexPreamble).mathMacros;
  assert.equal(renderMath("x \\in \\R", false, macros).error, null);
  assert.equal(renderMath("\\argmax_x f", false, macros).error, null);

  // …and a later edit there still exports them, without doubling packages.
  const edited = { ...visual.document, content: { ...visual.document.content, content: [...visual.document.content.content, { type: "paragraph", content: [{ type: "text", text: "New." }] }] } };
  const back = (await switchToLatex(edited)).document.source;
  for (const line of ["\\usepackage{siunitx}", "\\usepackage[dvipsnames]{xcolor}", "\\newcommand{\\R}{\\mathbb{R}}", "\\DeclareMathOperator{\\argmax}{arg\\,max}", "\\definecolor{brand}{HTML}{1D4ED8}"]) {
    assert.ok(back.includes(line), `${line} missing after the round trip`);
  }
  assert.equal((back.match(/\\usepackage(\[[^\]]*\])?\{xcolor\}/g) ?? []).length, 1, "xcolor loaded once");
  assert.ok(back.indexOf("\\usepackage[dvipsnames]{xcolor}") < back.indexOf("\\definecolor{brand}"), "colours defined after xcolor");
  assert.ok(back.indexOf("\\newcommand{\\R}") < back.indexOf("\\usepackage{hyperref}"), "definitions before hyperref");
});

test("preserved theorem definitions do not clash with the amsart export", () => {
  const doc = createFromTemplate("latex-amsart", 0);
  const once = cycle(doc.source, { files: files(doc) });
  assert.equal((once.tex.match(/\\newtheorem\{theorem\}/g) ?? []).length, 1);
  assert.equal((once.tex.match(/\\newtheorem\{remark\}/g) ?? []).length, 1);
});

test("comments in the body are reported only when an import actually runs", async () => {
  const commented = { ...createFromTemplate("latex-blank", 0), source: body("Text % a note\n\\verb|50%| and 10\\% here.") };
  const first = await switchToVisual(commented);
  assert.match(first.notice, /comment/i);
  const clean = { ...createFromTemplate("latex-blank", 0), source: body("Text with 10\\% and \\verb|50%|.\n\\begin{verbatim}\n% not a comment\n\\end{verbatim}") };
  assert.doesNotMatch((await switchToVisual(clean)).notice, /comment/i);
  const back = await switchToLatex(first.document);
  const again = await switchToVisual(back.document);
  assert.doesNotMatch(again.notice, /comment/i, "unchanged source is reused silently");
});

test("the reading position maps between visual headings and LaTeX sections", () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
Text.
% \section{Old}
\subsection*{Results \& $x^2$ Analysis}
\section{Introduction}
\end{document}`;
  const headings = latexHeadings(source);
  assert.deepEqual(headings.map((heading) => [heading.key, heading.line]), [["introduction", 3], ["results analysis", 6], ["introduction", 7]]);
  const anchor = anchorAt(headings, 2);
  assert.deepEqual(anchor, { heading: "introduction", occurrence: 1 });
  // Visual heading text has no math (equations are atoms) and no numbers.
  const visual = ["Introduction", "Results & Analysis", "Introduction"].map((text) => ({ key: headingKey(text) }));
  assert.equal(findAnchor(visual, anchor), 2);
  assert.equal(findAnchor(visual, anchorAt(headings, 1)), 1);
  assert.equal(anchorAt(headings, -1), null);
});
