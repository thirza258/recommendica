import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { baseExtensions } from "../src/write/visual/extensions.ts";
import { createFromTemplate } from "../src/write/templates.ts";
import { importLatex } from "../src/write/visual/fromLatex.ts";
import { documentToLatex } from "../src/write/visual/toLatex.ts";
import { loadableContent, switchToLatex, switchToVisual } from "../src/write/modeSwitch.ts";
import { parseLatex } from "../src/write/latex/parser.ts";
import { analyzeDoc } from "../src/write/visual/analysis.ts";
import { MARK_ORDER } from "../src/write/visual/marks.ts";
import { validBlock } from "../src/write/visual/contentCheck.ts";

const schema = getSchema(baseExtensions());

const page = (tex, preamble = "") => `\\documentclass{article}\n${preamble}\\begin{document}\n${tex}\n\\end{document}\n`;
const bodyOf = (tex) => /\\begin\{document\}\n([\s\S]*)\n\\end\{document\}/.exec(tex)?.[1].trim() ?? tex;

/** What the editor makes of content it loads: defaults filled in, marks sorted, text joined. */
function loaded(content) {
  const node = Node.fromJSON(schema, content);
  node.check();
  return node.toJSON();
}

/** LaTeX → visual, as the editor holds it → LaTeX. */
function cycle(tex, options = {}) {
  const imported = importLatex(tex, { files: options.files ?? {}, assets: options.assets ?? {}, bib: options.bib ?? "" });
  const settings = { ...createFromTemplate("blank", 0).settings, ...imported.settings };
  const content = loaded(imported.content);
  const exported = documentToLatex(content, settings, imported.bib, { preamble: imported.preamble });
  return { imported, content, settings, exported, tex: exported.tex, body: bodyOf(exported.tex) };
}

const latexDoc = (source, files = []) => ({ ...createFromTemplate("latex-blank", 0), source, files });

const find = (content, type) => {
  const found = [];
  const visit = (node) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(visit);
  };
  visit(content);
  return found;
};

/** Sources the visual editor cannot show as anything but themselves. */
const KEPT_EXACTLY = {
  theorem: String.raw`\begin{theorem}[Main]\label{thm:main} Every $x$ is fine.\end{theorem}`,
  proof: String.raw`\begin{proof} Trivial. \end{proof}`,
  "unknown command with arguments": String.raw`Fix \todo{check this} here.`,
  "siunitx and mhchem": String.raw`It is \SI{5}{\meter} of \ce{H2O} and \num{1e3}.`,
  "glossary entry": String.raw`An \gls{api} call.`,
  "optional arguments": String.raw`See \todo[inline]{note} now.`,
  "font commands without a visual mark": String.raw`\textsc{NASA} and \textsf{sans} and \raisebox{1pt}{up}.`,
  logos: String.raw`Typeset with \LaTeX{} on \today.`,
  "citation notes and natbib commands": String.raw`\cite[p.~5]{a} and \citep[see][]{b} and \citet{c} and \citeauthor{d}.`,
  "reference to several labels": String.raw`See \cref{sec:a,sec:b}.`,
  "references written with their own command": String.raw`In \eqref{eq:x}, \ref{sec:y}, \pageref{sec:y} and \nameref{sec:y}.`,
  "a label inside a paragraph": String.raw`Para \label{p:x} text, see \ref{p:x}.`,
  "disabled text": String.raw`Keep \iffalse not this \fi that.`,
  "footnote with markup": String.raw`Text\footnote{See \textbf{bold}, $x^2$ and \url{https://a.b}.} end.`,
  "separate footnote mark and text": String.raw`A\footnotemark\footnotetext{note}`,
  "multi-line equations": String.raw`\begin{align}
  a&=b\label{eq:a}\\
  c&=d\label{eq:c}
\end{align}`,
  "starred multi-line equation": String.raw`\begin{gather*}
  a=b\\
  c=d
\end{gather*}`,
  alignat: String.raw`\begin{alignat}{2}
  a&=b&c&=d
\end{alignat}`,
  subfigures: String.raw`\begin{figure}\centering\begin{subfigure}{0.4\linewidth}\includegraphics{a.png}\caption{A}\end{subfigure}\caption{Both}\label{fig:ab}\end{figure}`,
  "two pictures in a figure": String.raw`\begin{figure}\includegraphics{a.png}\includegraphics{b.png}\caption{Two}\end{figure}`,
  "a picture outside a figure": String.raw`\includegraphics[width=0.5\textwidth]{fig.png}`,
  "table notes": String.raw`\begin{table}\caption{T}\begin{tabular}{lc}A & B\\\end{tabular}\begin{tablenotes}\item note\end{tablenotes}\end{table}`,
  longtable: String.raw`\begin{longtable}{ll}A&B\\\end{longtable}`,
  tabularx: String.raw`\begin{tabularx}{\linewidth}{lX}A&B\\\end{tabularx}`,
  listings: "\\begin{lstlisting}[language=Python]\ndef f(x):\n    return x % 2\n\\end{lstlisting}",
  minted: "\\begin{minted}{python}\nprint(1)\n\\end{minted}",
  tikz: String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`,
  "document lists and switches": String.raw`\tableofcontents`,
  appendix: String.raw`\appendix`,
  "own reference list": String.raw`\begin{thebibliography}{9}\bibitem{k1} A. Author, Title.\end{thebibliography}`,
  "user environment": String.raw`\begin{myenv}content\end{myenv}`,
  "user text macro": String.raw`We propose \method{} here and \method again.`,
};

const PREAMBLES = {
  "user environment": "\\newenvironment{myenv}{\\begin{center}}{\\end{center}}\n",
  "user text macro": "\\newcommand{\\method}{\\textsc{FooNet}\\xspace}\n",
};

test("LaTeX the visual editor has no node for is kept exactly as written", () => {
  for (const [name, tex] of Object.entries(KEPT_EXACTLY)) {
    const { body, imported } = cycle(page(tex, PREAMBLES[name] ?? ""));
    assert.ok(body.includes(tex), `${name}: expected the source to be kept\n  kept: ${tex}\n  got:  ${body}`);
    assert.doesNotMatch(imported.warnings.join(" "), /Unsupported LaTeX commands/, name);
  }
});

const FIXED_POINT = {
  ...KEPT_EXACTLY,
  accents: String.raw`caf\'e na\"ive \c{c}a \v{s} \H{o} \~n \^o and \^{}`,
  specials: "50\\% of \\$5 \\& \\#1 \\_x \\{y\\} \\textbackslash{} a\\textasciitilde b --- -- ``q'' \\ldots",
  marks: String.raw`\textbf{\textit{bi}} \underline{\textbf{ub}} \emph{a \emph{b} c} \texttt{x\_y} \verb|a_b{c}|`,
  links: String.raw`\href{https://x.org/a_b%20c}{link}, \url{https://y.org/~u} and \url{https://plain.org/path}`,
  colours: String.raw`\textcolor{red}{r} \textcolor{blue!50}{b} {\color{green} g} \colorbox{yellow}{y}`,
  "unnumbered display math": String.raw`\[ a \] $$ b $$ \begin{equation*} c \end{equation*}`,
  cases: String.raw`\[ f(x)=\begin{cases}1&x>0\\0&\text{else}\end{cases} \]`,
  "numbered equation": String.raw`\begin{equation}\label{eq:e}E=mc^2\end{equation} see \eqref{eq:e} and Eq.~\eqref{eq:e}`,
  "equation with split": String.raw`\begin{equation}\label{eq:s}\begin{split}a&=b\\&=c\end{split}\end{equation}`,
  "sections and references": String.raw`\section{Intro}\label{intro} See Section~\ref{intro}. \section*{Notes}\label{sec:n} See \ref{sec:n}.`,
  "paragraph breaks": String.raw`A\par B \begin{quote}Q1\par Q2\end{quote}`,
  "hyphenation hints": String.raw`state\-of\-the\-art`,
  lists: String.raw`\begin{itemize}\item a \begin{enumerate}\item b\end{enumerate}\end{itemize}`,
  "numbered list that continues": String.raw`\begin{enumerate}\setcounter{enumi}{4}\item five\end{enumerate}`,
  "list options": String.raw`\begin{enumerate}[label=(\alph*)]\item a\end{enumerate}`,
  "description list": String.raw`\begin{description}\item[Alpha] first\item[Beta] second\end{description}`,
  "item starting with an equation": String.raw`\begin{itemize}\item \[ x \] after\end{itemize}`,
  verbatim: "\\begin{verbatim}\nliteral \\end{verbatim\n\\end{verbatim}",
  "ruled table": String.raw`\begin{table}\centering\begin{tabular}{|r|c|p{3cm}|}\hline A & B & C\\\hline 1 & 2 & 3\\\hline\end{tabular}\caption{X}\label{tab:x}\end{table}`,
  "booktabs table": String.raw`\begin{table}\centering\caption{Y}\begin{tabular}{lcr}\toprule A & B & C\\\midrule 1 & 2 & 3\\\bottomrule\end{tabular}\end{table}`,
  "spanning cells": String.raw`\begin{tabular}{ccc}\multicolumn{2}{c}{AB}&C\\\multirow{2}{*}{D}&E&F\\&G&H\\\end{tabular}`,
  "line breaks in a cell": String.raw`\begin{tabular}{c}\makecell{a\\b}\\\end{tabular}`,
  "cell colour before a span": String.raw`\begin{tabular}{cc}\cellcolor{gray}\multicolumn{2}{c}{AB}\\x&y\\\end{tabular}`,
  "title notes": String.raw`\title{T\thanks{fund}}\author{A\thanks{x}}\maketitle Body`,
  "inline math forms": String.raw`Inline \(x+y\) and \ensuremath{\alpha} math.`,
  "spacing commands": String.raw`A\vspace{1cm}B\\[2mm]C \hspace{1em} D`,
  "abstract with keywords": String.raw`\begin{abstract}Abs.\par\textbf{Keywords:} a, b\end{abstract}`,
  "missing label": String.raw`See \ref{nowhere}.`,
  "rules and lines": String.raw`\noindent\rule{\linewidth}{0.4pt} and \rule{2cm}{1pt} and \hrule`,
  "body definitions": String.raw`\newcommand{\later}{L}\definecolor{mine}{HTML}{112233}Text \later{} and \textcolor{mine}{c}.`,
  "unbalanced input": String.raw`\textbf{open`,
};

test("every conversion is valid for the editor and stable after one switch there and back", () => {
  for (const [name, tex] of Object.entries(FIXED_POINT)) {
    const source = page(tex, PREAMBLES[name] ?? "");
    const first = cycle(source);
    const second = cycle(first.tex);
    assert.equal(second.tex, first.tex, `${name} keeps changing on every switch`);
  }
});

test("text, labels and cells survive the switch", () => {
  assert.match(cycle(page(FIXED_POINT.accents)).body, /café naïve ça š ő ñ ô and \\textasciicircum\{\}/);
  assert.match(cycle(page(String.raw`\newcommand{\eg}{e.g.\xspace}\eg again`)).tex, /again/, "the word after a macro is kept");
  const align = cycle(page(String.raw`\begin{align}a&=b\label{eq:a}\\c&=d\label{eq:c}\end{align} see \eqref{eq:a} and \eqref{eq:c}`));
  assert.match(align.body, /see \\eqref\{eq:a\} and \\eqref\{eq:c\}/);
  const spans = cycle(page(FIXED_POINT["spanning cells"]));
  assert.match(spans.body, /\\multirow\{2\}\{\*\}\{D\} & E & F \\\\\n\s+& G & H \\\\/, "the cell under a \\multirow is not lost");
  assert.match(spans.body, /\\begin\{tabular\}\{ccc\}/, "column alignment is kept");
  assert.match(cycle(page(FIXED_POINT["paragraph breaks"])).body, /^A\n\nB\n\n\\begin\{quote\}\nQ1\n\nQ2\n\\end\{quote\}$/);
  assert.match(cycle(page(FIXED_POINT["hyphenation hints"])).body, /state\\-of\\-the\\-art/);
  const verbatim = cycle(page(FIXED_POINT.verbatim));
  assert.equal(verbatim.body, FIXED_POINT.verbatim, "a code block does not gain blank lines");
  const cell = cycle(page(FIXED_POINT["line breaks in a cell"]));
  assert.match(cell.body, /\\makecell\[c\]\{a\\\\b\} \\\\/, "a line break in a cell does not end the row");
  assert.match(cell.tex, /\\usepackage\{makecell\}/);
  const breaks = cycle(page(String.raw`A\footnote{one\par two} \begin{tabular}{p{3cm}}x\par y\\\end{tabular}`));
  assert.deepEqual(find(breaks.content, "footnote").map((note) => note.attrs.text), ["one two"], "words around \\par in a footnote stay apart");
  assert.match(breaks.body, /x y \\\\/, "words around \\par in a cell stay apart");
  const item = cycle(page(FIXED_POINT["item starting with an equation"]));
  assert.equal(find(item.content, "listItem")[0].content[0].type, "paragraph");
});

test("unnumbered display math stays unnumbered and multi-line environments keep their rows", () => {
  const { content, body } = cycle(page(FIXED_POINT["unnumbered display math"]));
  assert.deepEqual(find(content, "mathBlock").map((node) => node.attrs.numbered), [false, false, false]);
  assert.doesNotMatch(body, /\\begin\{equation\}/);
  const gathered = cycle(page(KEPT_EXACTLY["starred multi-line equation"]));
  assert.equal(find(gathered.content, "mathBlock")[0].attrs.env, "gather");
  assert.equal(find(gathered.content, "mathBlock")[0].attrs.numbered, false);
});

test("the visual editor numbers each row of a multi-line equation", () => {
  const { content } = cycle(page(String.raw`\begin{align}a&=b\label{eq:a}\\c&=d\nonumber\\e&=f\label{eq:e}\end{align}
\begin{equation}g\label{eq:g}\end{equation}
See \eqref{eq:a}, Eq.~\eqref{eq:e} and \eqref{eq:g}.`));
  const analysis = analyzeDoc(Node.fromJSON(schema, content), { theme: "article", numberedHeadings: true, citationStyle: "ieee", bib: "" });
  const numbers = Object.fromEntries(analysis.targets.map((target) => [target.id, target.number]));
  assert.deepEqual(numbers, { "eq:a": "1", "eq:e": "2", "eq:g": "3" });
  const labels = analysis.labels.filter((label) => label.attrs["data-label"]).map((label) => label.attrs["data-label"]);
  assert.deepEqual(labels, ["(1)", "Eq. (2)", "(3)"]);
});

test("references keep the command they were written with and labels keep their names", () => {
  const { content, body } = cycle(page(String.raw`\section{Intro}\label{intro}
Bare \ref{intro}, worded Section~\ref{intro}.
\begin{theorem}Proved in Section~\ref{intro}.\end{theorem}`));
  const refs = find(content, "crossRef");
  assert.deepEqual(refs.map((ref) => ref.attrs.command ?? ""), ["ref", ""]);
  assert.match(body, /\\section\{Intro\}\\label\{intro\}/, "the label is not renamed");
  assert.match(body, /Bare \\ref\{intro\}, worded Section~\\ref\{intro\}\./);
  assert.match(body, /Proved in Section~\\ref\{intro\}/, "references inside kept LaTeX still match the label");
});

test("a reference to an unnumbered heading does not gain quotes on every switch", () => {
  const visual = createFromTemplate("blank", 0);
  visual.content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, numbered: false, id: "sec-notes" }, content: [{ type: "text", text: "Notes" }] },
      { type: "paragraph", content: [{ type: "text", text: "See " }, { type: "crossRef", attrs: { target: "sec-notes" } }, { type: "text", text: "." }] },
    ],
  };
  const tex = documentToLatex(visual.content, visual.settings, "").tex;
  assert.match(tex, /See ``\\nameref\{sec:notes\}''\./);
  assert.equal(cycle(tex).tex, cycle(cycle(tex).tex).tex);
  assert.match(cycle(tex).body, /See ``\\nameref\{sec:notes\}''\./);
});

test("citation notes and natbib commands load natbib, except with IEEEtran's cite package", () => {
  const { content, tex } = cycle(page(KEPT_EXACTLY["citation notes and natbib commands"]));
  const citations = find(content, "citation");
  assert.deepEqual(citations.map((node) => [node.attrs.command, node.attrs.pre, node.attrs.post]), [
    ["", "", "p.~5"],
    ["citep", "see", ""],
    ["citet", "", ""],
    ["citeauthor", "", ""],
  ]);
  assert.match(tex, /\\usepackage\[numbers\]\{natbib\}/);
  const ieee = documentToLatex(content, { ...createFromTemplate("blank", 0).settings, theme: "ieee" }, "").tex;
  assert.doesNotMatch(ieee, /natbib|\\citet|\\citep/);
  assert.match(ieee, /\\cite\[p.~5\]\{a\}/);
});

test("pictures the project does not have yet and web pictures survive the switch", () => {
  const missing = cycle(page(String.raw`\begin{figure}\centering\includegraphics[width=0.5\linewidth]{plots/loss.pdf}\caption{Loss}\end{figure}`));
  assert.match(missing.body, /\\includegraphics\[width=0.5\\linewidth\]\{plots\/loss.pdf\}/);
  assert.equal(cycle(missing.tex).tex, missing.tex);
  const web = { type: "doc", content: [{ type: "figure", attrs: { src: "https://example.org/a.png", alt: "", width: 60, id: "" }, content: [{ type: "figcaption" }] }] };
  const tex = documentToLatex(web, createFromTemplate("blank", 0).settings, "").tex;
  assert.doesNotMatch(tex, /\\includegraphics/, "a web picture is not included, so the paper compiles");
  const back = importLatex(tex);
  assert.equal(find(back.content, "figure")[0].attrs.src, "https://example.org/a.png");
  assert.equal(find(back.content, "figure")[0].attrs.width, 60);
});

test("ruled tables keep their column spec and rules, also after rows are added", () => {
  const { content, body } = cycle(page(FIXED_POINT["ruled table"]));
  assert.match(body, /\\begin\{tabular\}\{\|r\|c\|p\{3cm\}\|\}\n\s+\\hline\n\s+A & B & C \\\\\n\s+\\hline\n\s+1 & 2 & 3 \\\\\n\s+\\hline/);
  const table = find(content, "table")[0];
  assert.deepEqual(table.content[1].content.map((cell) => cell.content[0].attrs.textAlign), ["right", "center", null]);
  table.content.push(structuredClone(table.content[1]));
  const grown = bodyOf(documentToLatex(content, createFromTemplate("blank", 0).settings, "").tex);
  assert.equal((grown.match(/\\hline/g) ?? []).length, 4, "the added row gets the same rule");
  const booktabs = cycle(page(FIXED_POINT["booktabs table"]));
  assert.equal(find(booktabs.content, "tableHeader").length, 3, "a rule under the first row makes it a header");
  const plain = cycle(page(String.raw`\begin{tabular}{ll}a&b\\c&d\\\end{tabular}`));
  assert.equal(find(plain.content, "tableHeader").length, 0, "without a rule there is no header row");
});

test("definitions written in the body move to the preamble and stay defined", () => {
  const { tex, body } = cycle(page(FIXED_POINT["body definitions"]));
  const preamble = tex.slice(0, tex.indexOf("\\begin{document}"));
  assert.match(preamble, /\\newcommand\{\\later\}\{L\}/);
  assert.match(preamble, /\\definecolor\{mine\}\{HTML\}\{112233\}/);
  assert.doesNotMatch(body, /\\newcommand|\\definecolor/);
  assert.match(body, /\\later\{\} and/);
});

test("text macros stay calls, structural macros are expanded", () => {
  const { content, body } = cycle(page(String.raw`\sect{Methods} We use \method{} and \method.`, "\\newcommand{\\method}{\\textsc{FooNet}}\n\\newcommand{\\sect}[1]{\\section{#1}}\n"));
  assert.equal(find(content, "heading")[0].content[0].text, "Methods");
  assert.deepEqual(find(content, "rawInline").map((node) => node.attrs.source), ["\\method{}", "\\method"]);
  assert.match(body, /We use \\method\{\} and \\method\./);
});

test("the parser ends a control word with the macro body it is written in", () => {
  const words = (source) => parseLatex(source).nodes.map((node) => (node.type === "text" ? node.value : node.type === "command" ? `\\${node.name}` : node.type));
  assert.deepEqual(words("\\newcommand{\\eg}{e.g.\\xspace}\\eg again"), ["e.g.", "\\xspace", "again"]);
  assert.deepEqual(words("\\newcommand{\\foo}[1]{#1\\relax}\\foo{x} bar"), ["x", "\\relax", "space", "bar"]);
});

test("opening a converted paper in the editor never rewrites its source", async () => {
  for (const tex of Object.values(FIXED_POINT)) {
    const latex = latexDoc(page(tex));
    const visual = await switchToVisual(latex, { validBlock });
    const opened = loaded(visual.document.content);
    opened.content.push({ type: "paragraph" });
    const back = await switchToLatex({ ...visual.document, content: opened });
    assert.equal(back.document.source, latex.source, `rewritten: ${tex}`);
  }
});

test("papers stored by the previous converter switch back without a rewrite", async () => {
  const stored = JSON.parse(readFileSync(new URL("./fixtures/stored-before-raw-inline.json", import.meta.url), "utf8"));
  for (const doc of stored.fromLatex) {
    // As stored, and as the editor saves it after loading (with its trailing paragraph).
    const reloaded = loaded(doc.content);
    reloaded.content.push({ type: "paragraph" });
    for (const content of [doc.content, reloaded]) {
      const back = await switchToLatex({ ...doc, content });
      assert.equal(back.document.source, doc.source, `${doc.template}: the original source must be kept`);
    }
  }
  for (const doc of stored.fromVisual) {
    const back = await switchToVisual(doc, { validBlock });
    assert.deepEqual(back.document.content, doc.content, `${doc.template}: the visual paper must be reused`);
  }
});

test("a references-only edit in the visual editor reaches the LaTeX project", async () => {
  const entry = (key, year) => `@article{${key}, author={Alpha, Ann}, title={T}, journal={J}, year={${year}}}`;
  const latex = { ...latexDoc(page("See \\cite{a2020}.\n\n\\bibliography{references}")), bib: entry("a2020", 2020) };
  const visual = (await switchToVisual(latex, { validBlock })).document;
  const edited = { ...visual, bib: `${visual.bib}\n${entry("b2021", 2021)}` };
  const back = await switchToLatex(edited);
  assert.match(back.document.files.find((file) => file.name === "references.bib")?.content ?? "", /b2021/);
});

test("a block the editor cannot load is kept as LaTeX instead of emptying the paper", async () => {
  const settings = createFromTemplate("blank", 0).settings;
  const broken = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Fine." }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "mathBlock", attrs: { latex: "x^2", numbered: false } }] }] },
      { type: "mystery", content: [{ type: "text", text: "Kept?" }] },
    ],
  };
  assert.equal(validBlock(broken.content[0]), true);
  assert.equal(validBlock(broken.content[1]), false);
  const { content, changed } = loadableContent(broken, validBlock, settings, "");
  assert.equal(changed, true);
  assert.equal(content.content[0], broken.content[0]);
  assert.equal(content.content[1].type, "rawLatex");
  assert.match(content.content[1].attrs.source, /\\begin\{itemize\}[\s\S]*x\^2/);
  assert.equal(content.content.length, 2, "a block that exports nothing is left out");
  loaded(content);
  const valid = loadableContent({ type: "doc", content: [broken.content[0]] }, validBlock, settings, "");
  assert.equal(valid.changed, false);
});

test("footnotes with markup keep their LaTeX, plain ones their text", () => {
  const { content, body } = cycle(page(String.raw`A\footnote{50\% off, x\^{}2} B\footnote{With $x^2$ and \cite{k}.}`));
  const notes = find(content, "footnote");
  assert.deepEqual(notes.map((note) => [note.attrs.text, note.attrs.latex]), [
    ["50% off, x^2", ""],
    ["With $x^2$ and [k].", "With $x^2$ and \\cite{k}."],
  ]);
  assert.match(body, /A\\footnote\{50\\% off, x\\textasciicircum\{\}2\} B\\footnote\{With \$x\^2\$ and \\cite\{k\}\.\}/);
});

test("the exporter's mark order is the schema's", () => {
  assert.deepEqual(Object.keys(schema.marks), MARK_ORDER);
});
