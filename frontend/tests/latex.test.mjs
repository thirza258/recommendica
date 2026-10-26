import assert from "node:assert/strict";
import test from "node:test";
import { parseLatex } from "../src/write/latex/parser.ts";
import { htmlToText, parseColumnSpec, renderLatex } from "../src/write/latex/render.ts";

const BIB = `@article{vaswani2017, author={Ashish Vaswani and Noam Shazeer}, title={Attention Is All You Need}, journal={NeurIPS}, year={2017}}
@inproceedings{he2016, author={He, Kaiming and Sun, Jian}, title={Deep Residual Learning}, booktitle={CVPR}, year={2016}}`;

const render = (source, options = {}) => renderLatex(source, { today: new Date(2026, 9, 26), ...options });
const text = (source, options) => htmlToText(render(source, options).html);
const messages = (result) => result.diagnostics.map((d) => d.message).join("\n");

function doc(body, preamble = "") {
  return `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}`;
}

test("paragraphs follow TeX: blank lines split, comments join lines, ligatures apply", () => {
  const result = render("First line\nsame paragraph% comment\ncontinues.\n\nSecond ``quoted''---dash -- range.");
  const paragraphs = result.html.match(/<p[^>]*>/g) ?? [];
  assert.equal(paragraphs.length, 2);
  assert.match(htmlToText(result.html), /First line same paragraphcontinues\. Second “quoted”—dash – range\./);
});

test("sections number, label and resolve forward references", () => {
  const result = render(doc("See Section~\\ref{sec:b}.\n\\section{Alpha}\\label{sec:a}\n\\subsection{Inner}\\label{sec:a1}\n\\section*{Unnumbered}\n\\section{Beta}\\label{sec:b}"));
  assert.match(htmlToText(result.html), /See Section 2\./);
  assert.deepEqual(
    result.outline.map((entry) => [entry.level, entry.number, entry.title]),
    [[1, "1", "Alpha"], [2, "1.1", "Inner"], [1, "", "Unnumbered"], [1, "2", "Beta"]],
  );
  assert.equal(result.labels["sec:a1"], "1.1");
  assert.equal(result.diagnostics.length, 0, messages(result));
});

test("equations number by environment and respect \\nonumber, \\tag and \\label", () => {
  const result = render(doc([
    "\\begin{equation}a=b\\label{eq:one}\\end{equation}",
    "\\begin{equation*}c=d\\end{equation*}",
    "\\begin{align}x&=1\\label{eq:x}\\\\y&=2\\nonumber\\\\z&=3\\end{align}",
    "\\[ e=f \\]",
    "\\begin{equation}g\\tag{$\\star$}\\label{eq:star}\\end{equation}",
    "Refs \\eqref{eq:one}, \\ref{eq:x} and \\eqref{eq:star}.",
  ].join("\n")));
  assert.deepEqual(result.labels, { "eq:one": "1", "eq:x": "2", "eq:star": "$\\star$" });
  assert.match(htmlToText(result.html), /Refs \(1\), 2 and/);
  assert.equal(result.diagnostics.filter((d) => d.severity === "error").length, 0, messages(result));
  const tags = result.html.match(/\\tag\{\d+\}/g);
  assert.deepEqual(tags, ["\\tag{1}", "\\tag{2}", "\\tag{3}"]);
});

test("citations resolve against .bib files in IEEE and author-year styles", () => {
  const ieee = render(doc("As shown~\\cite{he2016,vaswani2017}.\n\\bibliographystyle{IEEEtran}\n\\bibliography{refs}"), { files: { "refs.bib": BIB } });
  assert.match(htmlToText(ieee.html), /As shown \[1\], \[2\]\./);
  assert.match(ieee.html, /paper-reflist--ieee/);
  assert.match(htmlToText(ieee.html), /\[1\]\s*K\. He and J\. Sun/);

  const apa = render(doc("Per \\citet{vaswani2017} and \\citep[p.~4]{he2016}.\n\\bibliographystyle{apalike}\n\\bibliography{refs}", "\\usepackage{natbib}"), { files: { "refs.bib": BIB } });
  assert.match(htmlToText(apa.html), /Per Vaswani and Shazeer \(2017\) and \(He & Sun, 2016, p\. 4\)\./);

  const missing = render(doc("\\cite{nobody}\n\\bibliography{refs}"), { files: { "refs.bib": BIB } });
  assert.match(messages(missing), /Citation "nobody" is not in the bibliography/);
});

test("user macros expand TeX-style, including half-environment shorthands", () => {
  const source = doc(
    "\\be E=mc^2 \\ee \\greet{World} \\greet[Hi]{you} $\\R$ \\B{bold}",
    "\\newcommand{\\be}{\\begin{equation}}\\newcommand{\\ee}{\\end{equation}}\n\\newcommand{\\greet}[2][Hello]{#1, #2!}\n\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\B}{\\textbf}",
  );
  const result = render(source);
  assert.match(htmlToText(result.html), /Hello, World! Hi, you!/);
  assert.match(result.html, /paper-equation/);
  assert.match(result.html, /<span class="ltx-bf">bold<\/span>/);
  assert.equal(result.diagnostics.length, 0, messages(result));
});

test("runaway macros stop with a diagnostic instead of hanging", () => {
  const started = Date.now();
  const result = render("\\def\\a{\\a\\a}\\a text");
  assert.ok(Date.now() - started < 2000);
  assert.match(messages(result), /Macro expansion limit/);
});

test("tables honour column specs, booktabs rules, multicolumn and multirow", () => {
  const result = render(doc([
    "\\begin{table}\\caption{Scores}\\label{tab:s}",
    "\\begin{tabular}{|l|c|r|}\\toprule",
    "\\multirow{2}{*}{Model} & \\multicolumn{2}{c|}{Metrics} \\\\",
    " & A & B \\\\ \\midrule",
    "Ours & 1 & 2 \\\\ \\bottomrule",
    "\\end{tabular}\\end{table}",
    "Table~\\ref{tab:s}",
  ].join("\n")));
  assert.match(result.html, /rowspan="2"/);
  assert.match(result.html, /colspan="2"/);
  assert.match(result.html, /ltx-rule-above-thick/);
  assert.match(result.html, /ltx-rule-below-thick/);
  assert.equal((result.html.match(/<tr/g) ?? []).length, 3);
  assert.match(htmlToText(result.html), /Table 1: Scores/);
  assert.match(htmlToText(result.html), /Table 1$/);
  const spec = parseColumnSpec("|l|*{2}{c}|p{3cm}@{}");
  assert.deepEqual(spec.columns.map((column) => column.align), ["l", "c", "c", "j"]);
  assert.deepEqual(spec.borders, [1, 1, 0, 1, 0]);
});

test("lists nest with LaTeX labels and enumerate items can be referenced", () => {
  const result = render(doc("\\begin{enumerate}\\item One\\label{it:one}\\begin{enumerate}\\item Inner\\label{it:inner}\\end{enumerate}\\item[*] Star\\item Two\\end{enumerate}\\begin{description}\\item[Term] Meaning\\end{description}See \\ref{it:inner}."));
  const labels = [...result.html.matchAll(/ltx-item-label">([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(labels, ["1.", "(a)", "*", "2."]);
  assert.match(htmlToText(result.html), /See 1a\./);
  assert.match(result.html, /ltx-desc-label">Term/);
});

test("theorems number within sections and proofs end with a QED mark", () => {
  const result = render(doc("\\section{S}\\begin{theorem}[Main]\\label{thm:m}True.\\end{theorem}\\begin{lemma}Also.\\end{lemma}\\begin{proof}Done.\\end{proof}\\ref{thm:m}", "\\newtheorem{theorem}{Theorem}[section]\\newtheorem{lemma}[theorem]{Lemma}"));
  const plain = htmlToText(result.html);
  assert.match(plain, /Theorem 1\.1 \(Main\)\. True\./);
  assert.match(plain, /Lemma 1\.2\. Also\./);
  assert.match(plain, /Proof\. Done\.\s*∎/);
  assert.match(plain, /1\.1$/);
});

test("IEEE class switches to two columns, Roman sections and IEEE captions", () => {
  const result = render("\\documentclass[conference]{IEEEtran}\\begin{document}\\section{Intro}\\subsection{Sub}\\label{s}\\begin{figure}\\caption{F}\\end{figure}\\begin{table}\\caption{T}\\end{table}\\ref{s}\\end{document}");
  assert.equal(result.layout.columns, 2);
  assert.equal(result.layout.theme, "ieee");
  const plain = htmlToText(result.html);
  assert.match(plain, /I\.Intro/);
  assert.match(plain, /Fig\. 1\. F/);
  assert.match(plain, /TABLE I T/);
  assert.match(plain, /I-A$/);
});

test("output is escaped and links, images and colours are validated", () => {
  const result = render(doc([
    "<script>alert(1)</script> \\& \\href{javascript:alert(1)}{click}",
    "\\url{https://example.com/a_b} \\href{mailto:a@b.c}{mail}",
    "\\includegraphics{https://evil.example/x.png}",
    "\\textcolor{red;background:url(x)}{c} \\textcolor[HTML]{FF0000}{red}",
  ].join("\n")));
  assert.doesNotMatch(result.html, /<script/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /javascript:/);
  assert.match(result.html, /href="https:\/\/example\.com\/a_b"/);
  assert.match(result.html, /href="mailto:a@b\.c"/);
  assert.doesNotMatch(result.html, /evil\.example\/x\.png"/);
  assert.doesNotMatch(result.html, /url\(x\)/);
  assert.match(result.html, /color:#ff0000/);
});

test("uploaded images resolve by name, stem or folder", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const result = render("\\includegraphics[width=0.5\\linewidth]{figures/plot}\\includegraphics{chart.pdf}", {
    assets: { "plot.png": png, "chart.png": png },
  });
  assert.equal((result.html.match(/<img /g) ?? []).length, 2);
  assert.match(result.html, /style="width:50%"/);
  assert.equal(result.diagnostics.length, 0, messages(result));
});

test("structural problems are reported with line numbers and rendering continues", () => {
  const result = render("Line one\n\\begin{itemize}\n\\item a\n\\unknown{x}\n$\\frac{1}{$\n\\end{enumerate}\n{open");
  const found = result.diagnostics.map((d) => `${d.line}:${d.message}`).join("\n");
  assert.match(found, /4:Unknown command \\unknown/);
  assert.match(found, /5:Math error/);
  assert.match(found, /\\end\{enumerate\} has no matching/);
  assert.match(found, /Missing \\end\{itemize\}/);
  assert.match(found, /Missing \}/);
  assert.match(htmlToText(result.html), /Line one/);
});

test("fragments render without a document environment and \\input pulls project files", () => {
  const result = render("\\input{intro}\n\nMain text.", { files: { "intro.tex": "\\section{From file}Included." } });
  assert.match(htmlToText(result.html), /1\s*From file Included\. Main text\./);
});

test("footnotes, thanks and the title block render once, in order", () => {
  const result = render(doc("\\maketitle Text\\footnote{Note one.} more\\footnote{Note two.}", "\\title{T}\\author{A\\thanks{Funded.} \\and B}"));
  const notes = [...result.html.matchAll(/paper-footnote-mark">([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(notes, ["*", "1", "2"]);
  assert.equal((result.html.match(/paper-author"/g) ?? []).length, 2);
  assert.equal(result.title, "T");
  assert.match(result.html, /October 26, 2026/);
});

test("thebibliography, algorithmic and verbatim render without a .bib", () => {
  const result = render(doc([
    "See \\cite{k1}.",
    "\\begin{algorithmic}[1]\\Require $n$\\State $s \\gets 0$\\For{$i<n$}\\State $s \\gets s+i$\\EndFor\\Return $s$\\end{algorithmic}",
    "\\begin{verbatim}\n<b>raw</b> & \\textbf{x}\n\\end{verbatim}",
    "\\begin{thebibliography}{9}\\bibitem{k1} A. Author. Title.\\end{thebibliography}",
  ].join("\n")));
  const plain = htmlToText(result.html);
  assert.match(plain, /See \[1\]\./);
  assert.match(plain, /Require:/);
  assert.match(plain, /for .* do/);
  assert.match(plain, /end for/);
  assert.match(result.html, /&lt;b&gt;raw&lt;\/b&gt; &amp; \\textbf\{x\}/);
  // algorithmicx numbers every statement line, including "end for", but not Require.
  assert.equal((result.html.match(/ltx-alg-num/g) ?? []).length, 5);
});

test("the parser keeps positions and never throws on hostile input", () => {
  for (const source of ["}", "\\end{x}", "$", "\\begin{", "\\verb", "{".repeat(500), "\\newcommand", "\\def\\x#1{#1#1}\\x{\\x{\\x{y}}}", "\u0000\u0007"]) {
    const result = parseLatex(source);
    assert.ok(Array.isArray(result.nodes));
    render(source);
  }
  const { nodes } = parseLatex("ab \\textbf{cd}");
  assert.deepEqual([nodes[0].start, nodes[2].start], [0, 3]);
});
