import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { baseExtensions } from "../src/write/visual/extensions.ts";
import { analyzeDoc } from "../src/write/visual/analysis.ts";
import { documentToLatex, escapeLatex, wrapMultiline } from "../src/write/visual/toLatex.ts";
import { importLatex } from "../src/write/visual/fromLatex.ts";
import { switchToLatex, switchToVisual } from "../src/write/modeSwitch.ts";
import { INLINE_MATH_PATTERN } from "../src/write/visual/schema.ts";
import { createFromTemplate, TEMPLATES } from "../src/write/templates.ts";
import { DEFAULT_SETTINGS } from "../src/write/documents.ts";
import { htmlToText, renderLatex } from "../src/write/latex/render.ts";

const schema = getSchema(baseExtensions());
const context = (settings, bib = "") => ({
  theme: settings.theme,
  numberedHeadings: settings.numberedHeadings,
  citationStyle: settings.citationStyle,
  bib,
});

const BIB = `@article{a2020, author={Alpha, Ann}, title={First}, journal={J}, year={2020}}
@article{b2019, author={Beta, Bob}, title={Second}, journal={J}, year={2019}}`;

const text = (value, marks) => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const p = (...content) => ({ type: "paragraph", content: content.map((c) => (typeof c === "string" ? text(c) : c)) });
const h = (level, value, id, numbered = true) => ({ type: "heading", attrs: { level, id, numbered }, content: [text(value)] });
const doc = (...content) => ({ type: "doc", content });

test("every template is valid, exports LaTeX the renderer accepts, and resolves its own references", () => {
  for (const template of TEMPLATES) {
    const created = createFromTemplate(template.id, 0);
    assert.equal(created.kind, template.kind, template.id);
    if (created.kind === "latex") {
      const files = Object.fromEntries(created.files.map((file) => [file.name, file.content]));
      const result = renderLatex(created.source, { files });
      assert.deepEqual(result.diagnostics, [], template.id);
      continue;
    }
    const node = Node.fromJSON(schema, created.content);
    node.check();
    const analysis = analyzeDoc(node, context(created.settings, created.bib));
    assert.deepEqual(analysis.missingKeys, [], template.id);
    assert.ok(!analysis.labels.some((label) => label.spec.missing), `${template.id} has a dangling cross-reference`);
    const exported = documentToLatex(created.content, created.settings, created.bib, { embedBibliography: true });
    const rendered = renderLatex(exported.tex, { files: { "references.bib": exported.bib } });
    assert.deepEqual(rendered.diagnostics, [], template.id);
    assert.doesNotMatch(htmlToText(rendered.html), /\?\?/, template.id);
  }
});

test("numbering follows document order and is recomputed after a move", () => {
  const json = doc(
    h(1, "Intro", "sec-a"),
    { type: "mathBlock", attrs: { latex: "a", numbered: true, id: "eq-1" } },
    h(2, "Detail", "sec-b"),
    { type: "mathBlock", attrs: { latex: "b", numbered: false, id: "eq-2" } },
    { type: "mathBlock", attrs: { latex: "c", numbered: true, id: "eq-3" } },
    h(1, "Next", "sec-c", false),
    h(1, "Last", "sec-d"),
    p("See ", { type: "crossRef", attrs: { target: "eq-3" } }, " and ", { type: "crossRef", attrs: { target: "sec-b" } }, " and ", { type: "crossRef", attrs: { target: "gone" } }),
  );
  const analysis = analyzeDoc(Node.fromJSON(schema, json), context(DEFAULT_SETTINGS));
  assert.deepEqual(analysis.outline.map((item) => item.number), ["1", "1.1", "", "2"]);
  const refs = analysis.labels.filter((label) => label.attrs["data-label"] !== undefined).map((label) => label.spec.paperLabel);
  assert.deepEqual(refs, ["Eq. (2)", "Section 1.1", "[missing reference]"]);

  const moved = { ...json, content: [json.content[4], ...json.content.filter((_, index) => index !== 4)] };
  const after = analyzeDoc(Node.fromJSON(schema, moved), context(DEFAULT_SETTINGS));
  assert.equal(after.targets.find((target) => target.id === "eq-3")?.label, "Eq. (1)");
});

test("IEEE numbering uses Roman sections and APA leaves headings unnumbered", () => {
  const json = doc(h(1, "One", "s1"), h(2, "Sub", "s2"), h(3, "Deep", "s3"), h(1, "Two", "s4"));
  const ieee = analyzeDoc(Node.fromJSON(schema, json), context({ ...DEFAULT_SETTINGS, theme: "ieee" }));
  assert.deepEqual(ieee.outline.map((item) => item.number), ["I", "A", "1", "II"]);
  assert.equal(ieee.targets.find((target) => target.id === "s3")?.label, "Section I-A1");
  const apa = analyzeDoc(Node.fromJSON(schema, json), context({ ...DEFAULT_SETTINGS, theme: "apa", numberedHeadings: false }));
  assert.deepEqual(apa.outline.map((item) => item.number), ["", "", "", ""]);
  assert.equal(apa.targets[0].label, "“One”");
});

test("citations number by first use in IEEE style, sort by author in APA, and flag unknown keys", () => {
  const json = doc(p({ type: "citation", attrs: { keys: ["b2019"] } }, " ", { type: "citation", attrs: { keys: ["a2020", "b2019"] } }, " ", { type: "citation", attrs: { keys: ["nobody"] } }), { type: "bibliography" });
  const node = Node.fromJSON(schema, json);
  const ieee = analyzeDoc(node, context(DEFAULT_SETTINGS, BIB));
  const labels = ieee.labels.filter((label) => label.attrs["data-label"]).map((label) => label.spec.paperLabel);
  assert.deepEqual(labels, ["[1]", "[1], [2]", "[?]"]);
  assert.deepEqual(ieee.missingKeys, ["nobody"]);
  const list = ieee.labels.find((label) => label.spec.html);
  assert.match(list.spec.html, /\[1\][\s\S]*B\. Beta[\s\S]*\[2\][\s\S]*A\. Alpha/);

  const apa = analyzeDoc(node, context({ ...DEFAULT_SETTINGS, citationStyle: "apa" }, BIB));
  assert.equal(apa.labels.find((label) => label.attrs["data-label"])?.spec.paperLabel, "(Beta, 2019)");
});

test("LaTeX export escapes text, maps marks and only labels what is referenced", () => {
  const json = doc(
    { type: "paperTitle", content: [text("Costs & 50% of $5 #1_a")] },
    p(text("bold", [{ type: "bold" }]), " ", text("link", [{ type: "link", attrs: { href: "https://x.org/a%20b#c" } }]), " ", text("bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]), " ", text("hl", [{ type: "highlight", attrs: { color: "#ff0" } }])),
    h(1, "Kept", "sec-kept"),
    h(1, "Unlabelled", "sec-free"),
    h(1, "Plain", "sec-plain", false),
    p({ type: "crossRef", attrs: { target: "sec-kept" } }, " ", { type: "crossRef", attrs: { target: "sec-plain" } }),
    { type: "rawLatex", attrs: { source: "\\begin{custom}x\\end{custom}" } },
    { type: "codeBlock", content: [text("a & b \\end{verbatim}")] },
  );
  const { tex } = documentToLatex(json, DEFAULT_SETTINGS, "");
  assert.match(tex, /\\title\{Costs \\& 50\\% of \\\$5 \\#1\\_a\}/);
  assert.match(tex, /\\textbf\{bold\}/);
  assert.match(tex, /\\href\{https:\/\/x\.org\/a\\%20b\\#c\}\{link\}/);
  assert.doesNotMatch(tex, /javascript/);
  assert.match(tex, /\\usepackage\{soul\}/);
  assert.match(tex, /\\definecolor\{paperhlFFFF00\}\{HTML\}\{FFFF00\}/);
  assert.match(tex, /\{\\sethlcolor\{paperhlFFFF00\}\\hl\{hl\}\}/);
  const nested = documentToLatex(doc(p(text("x", [{ type: "bold" }, { type: "highlight", attrs: { color: "#fff59d" } }]))), DEFAULT_SETTINGS, "").tex;
  assert.match(nested, /\\textbf\{\{\\sethlcolor\{paperhlFFF59D\}\\hl\{x\}\}\}/, "\\hl must be innermost");
  assert.match(tex, /\\section\{Kept\}\\label\{sec:kept\}/);
  assert.match(tex, /\\section\{Unlabelled\}\n/);
  assert.match(tex, /\\section\*\{Plain\}/);
  assert.match(tex, /Section~\\ref\{sec:kept\} ``\\nameref\{sec:plain\}''/);
  assert.match(tex, /\\begin\{custom\}x\\end\{custom\}/);
  assert.match(tex, /\\end \{verbatim\}\n\\end\{verbatim\}/);
  assert.equal(escapeLatex("~^\\"), "\\textasciitilde{}\\textasciicircum{}\\textbackslash{}");
});

test("figures and tables export as floats with files, multicolumn and multirow", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const cell = (value, attrs = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [p(value)] });
  const json = doc(
    { type: "figure", attrs: { src: png, alt: "", width: 50, id: "fig-a" }, content: [{ type: "figcaption", content: [text("Cap")] }] },
    {
      type: "tableFigure",
      attrs: { id: "tab-a" },
      content: [
        { type: "figcaption", content: [text("T")] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("A", { rowspan: 2 }), cell("B", { colspan: 2 })] },
            { type: "tableRow", content: [cell("c"), cell("d")] },
          ],
        },
      ],
    },
    p({ type: "crossRef", attrs: { target: "fig-a" } }, { type: "crossRef", attrs: { target: "tab-a" } }),
  );
  const result = documentToLatex(json, DEFAULT_SETTINGS, "");
  assert.deepEqual(result.images.map((image) => image.path), ["figures/figure-1.png"]);
  assert.match(result.tex, /\\includegraphics\[width=0\.5\\linewidth\]\{figures\/figure-1\.png\}/);
  assert.match(result.tex, /\\label\{fig:a\}/);
  assert.match(result.tex, /\\multirow\{2\}\{\*\}\{A\} & \\multicolumn\{2\}\{c\}\{B\} \\\\/);
  assert.match(result.tex, / & c & d \\\\/);
  assert.match(result.tex, /\\usepackage\{multirow\}/);
  const rendered = renderLatex(result.tex, { assets: { "figures/figure-1.png": png } });
  assert.deepEqual(rendered.diagnostics, []);
});

test("bibliography export embeds or separates the .bib and picks a style per theme", () => {
  const json = doc(p({ type: "citation", attrs: { keys: ["a2020"] } }));
  const embedded = documentToLatex(json, { ...DEFAULT_SETTINGS, citationStyle: "apa" }, BIB, { embedBibliography: true });
  assert.match(embedded.tex, /^\\begin\{filecontents\*\}\[overwrite\]\{references\.bib\}/);
  assert.match(embedded.tex, /\\citep\{a2020\}/);
  assert.match(embedded.tex, /\\bibliographystyle\{apalike\}/);
  const separate = documentToLatex(json, { ...DEFAULT_SETTINGS, theme: "ieee", columns: 2 }, BIB);
  assert.doesNotMatch(separate.tex, /filecontents/);
  assert.doesNotMatch(separate.tex, /setspace/, "IEEE layouts keep the class's own spacing");
  assert.match(separate.tex, /\\documentclass\[conference,a4paper\]\{IEEEtran\}/);
  assert.match(separate.tex, /\\bibliographystyle\{IEEEtran\}/);
  assert.match(separate.bib, /@article\{a2020/);
});

test("inline math input rule ignores prices and escaped dollars", () => {
  const match = (value) => INLINE_MATH_PATTERN.exec(value)?.[1] ?? null;
  assert.equal(match("energy $E=mc^2$"), "E=mc^2");
  assert.equal(match("$x$"), "x");
  assert.equal(match("costs $5 and $"), null);
  assert.equal(match("price \\$5$"), null);
  assert.equal(match("a$b$"), null);
  assert.equal(wrapMultiline("a &= b \\\\ c &= d"), "\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}");
  assert.equal(wrapMultiline("\\frac{a}{b}"), "\\frac{a}{b}");
});

test("LaTeX import maps structure, metadata, settings, labels and raw constructs", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const source = `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=0.5in]{geometry}
\\usepackage[round]{natbib}
\\title{A \\textbf{Bold} Title}
\\author{Ada Lovelace \\\\ University}
\\begin{document}
\\maketitle
\\begin{abstract}
An abstract with $x$ and \\cite{a2020}.
\\end{abstract}
\\section{Introduction}\\label{sec:intro}
See Section~\\ref{sec:method}, Figure~\\ref{fig:one} and Theorem~\\ref{thm:one}.
\\begin{equation}\\label{eq:main}
E = mc^2
\\end{equation}
\\begin{figure}[htbp]
\\centering
\\includegraphics[width=0.5\\linewidth]{figs/one.png}
\\caption{A figure}\\label{fig:one}
\\end{figure}
\\begin{table}[htbp]
\\caption{A table}\\label{tab:one}
\\begin{tabular}{lc}
A & B \\\\
1 & 2 \\\\
\\end{tabular}
\\end{table}
\\begin{itemize}
\\item First
\\item Second
\\end{itemize}
\\begin{theorem}\\label{thm:one}
A theorem the visual editor keeps verbatim.
\\end{theorem}
\\section{Method}\\label{sec:method}
Method text.
\\bibliographystyle{apalike}
\\bibliography{references}
\\end{document}`;
  const result = importLatex(source, { files: { "references.bib": BIB }, assets: { "figs/one.png": png } });
  assert.equal(result.title, "A Bold Title");
  assert.equal(result.settings.margins, "narrow");
  assert.equal(result.settings.citationStyle, "apa");
  assert.equal(result.bib, BIB);
  assert.deepEqual(result.warnings, []);

  const node = Node.fromJSON(schema, result.content);
  node.check();
  const blocks = result.content.content;
  const types = blocks.map((block) => block.type);
  for (const type of ["paperTitle", "paperAuthors", "paperAbstract", "heading", "mathBlock", "figure", "tableFigure", "bulletList", "rawLatex", "bibliography"]) {
    assert.ok(types.includes(type), `missing ${type}`);
  }
  const headings = blocks.filter((block) => block.type === "heading");
  assert.deepEqual(headings.map((heading) => heading.attrs.id), ["sec:intro", "sec:method"]);
  const figure = blocks.find((block) => block.type === "figure");
  assert.equal(figure.attrs.src, png);
  assert.equal(figure.attrs.id, "fig:one");
  assert.equal(figure.attrs.width, 50);
  const table = blocks.find((block) => block.type === "tableFigure");
  assert.equal(table.attrs.id, "tab:one");
  assert.equal(table.content[1].content.length, 2);
  const math = blocks.find((block) => block.type === "mathBlock");
  assert.equal(math.attrs.id, "eq:main");
  assert.equal(math.attrs.latex, "E = mc^2");

  // A reference to a label that lives inside a preserved raw block still
  // exports as a real \ref rather than "??".
  const exported = documentToLatex(result.content, { ...DEFAULT_SETTINGS, ...result.settings }, result.bib);
  assert.match(exported.tex, /\\ref\{thm:one\}/);
  assert.match(exported.tex, /\\label\{sec:intro\}/);
  assert.match(exported.tex, /\\label\{fig:one\}/);
  assert.match(exported.tex, /\\label\{tab:one\}/);
  assert.match(exported.tex, /\\label\{eq:main\}/);
  assert.match(exported.tex, /\\begin\{theorem\}/);
});

test("mode switching keeps one document and reuses an unchanged representation", async () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const visual = createFromTemplate("blank", 0);
  visual.title = "Switching";
  visual.bib = BIB;
  visual.content = doc(
    { type: "paperTitle", content: [text("Switching")] },
    h(1, "Introduction", "sec-intro"),
    p("See ", { type: "crossRef", attrs: { target: "sec-intro" } }, " and ", { type: "crossRef", attrs: { target: "fig-one" } }, ", and cite ", { type: "citation", attrs: { keys: ["a2020"] } }, "."),
    { type: "figure", attrs: { src: png, alt: "one", width: 50, id: "fig-one" }, content: [{ type: "figcaption", content: [text("A figure")] }] },
    { type: "bibliography" },
  );

  const first = await switchToLatex(visual);
  assert.equal(first.document.id, visual.id);
  assert.equal(first.document.kind, "latex");
  assert.equal(first.document.title, visual.title);
  assert.equal(first.document.content, visual.content, "the visual representation is kept");
  assert.match(first.document.source, /\\label\{sec:intro\}/);
  assert.match(first.document.source, /\\label\{fig:one\}/);
  assert.ok(first.document.assets.some((asset) => asset.name === "figures/figure-1.png" && asset.dataUrl === png));
  assert.ok(first.document.files.some((file) => file.name === "references.bib" && file.content.includes("a2020")));

  const back = await switchToVisual(first.document);
  assert.equal(back.document.id, visual.id);
  assert.equal(back.document.kind, "visual");
  assert.equal(back.document.source, first.document.source, "source is kept");
  assert.deepEqual(back.document.content, visual.content, "unchanged source reuses the visual representation");
  Node.fromJSON(schema, back.document.content).check();
  assert.match(JSON.stringify(back.document.content), /fig-one/);
  assert.match(JSON.stringify(back.document.content), /a2020/);

  const again = await switchToLatex(back.document);
  assert.equal(again.document.source, first.document.source, "peeking at the visual editor must not rewrite the source");
  assert.deepEqual(again.document.assets, first.document.assets);
});

test("editing LaTeX then switching back and forth preserves the edited source", async () => {
  const visual = createFromTemplate("research-article", 0);
  const first = await switchToLatex(visual);
  const edited = first.document.source.replace("\\section{Introduction}", "\\section{Opening}");
  assert.notEqual(edited, first.document.source);

  const imported = await switchToVisual({ ...first.document, source: edited });
  assert.equal(imported.document.kind, "visual");
  assert.match(JSON.stringify(imported.document.content), /Opening/);

  const returned = await switchToLatex(imported.document);
  assert.equal(returned.document.source, edited, "unchanged visual content must reuse the edited LaTeX");

  const changedContent = {
    ...imported.document.content,
    content: [...imported.document.content.content, p("A paragraph added in the visual editor.")],
  };
  const converted = await switchToLatex({ ...imported.document, content: changedContent });
  assert.notEqual(converted.document.source, edited);
  assert.match(converted.document.source, /A paragraph added in the visual editor\./);
});

test("an empty paper does not gain a title when it round-trips", async () => {
  const visual = createFromTemplate("blank", 0);
  const first = await switchToLatex(visual);
  assert.doesNotMatch(first.document.source, /\\title\{/);

  const back = await switchToVisual({ ...first.document, source: `${first.document.source}\n% edited\n` });
  assert.ok(!JSON.stringify(back.document.content).includes("Untitled paper"), "the exporter's fallback title must not become content");
});

test("visual settings survive edits to converted LaTeX", async () => {
  const visual = createFromTemplate("apa-paper", 0);
  const first = await switchToLatex(visual);
  assert.match(first.document.source, /^% recommendica-write-settings: \{.*"theme":"apa"/m);

  const edited = first.document.source.replace("\\begin{document}", "\\begin{document}\n\nAn added paragraph.\n");
  assert.notEqual(edited, first.document.source);
  const back = await switchToVisual({ ...first.document, source: edited });
  assert.equal(back.document.settings.theme, "apa", "APA shares the article class, so its theme must be restored from the marker");
  assert.equal(back.document.settings.lineSpacing, 2);
  assert.equal(back.document.settings.numberedHeadings, false);
});

test("mode switching reconverts when visual settings or references change", async () => {
  const visual = createFromTemplate("blank", 0);
  visual.bib = BIB;
  visual.content = doc(p("See ", { type: "citation", attrs: { keys: ["a2020"] } }, "."), { type: "bibliography" });
  const first = await switchToLatex(visual);
  assert.match(first.document.source, /\\documentclass\[11pt,a4paper\]\{article\}/);
  assert.ok(first.document.files.find((file) => file.name === "references.bib").content.includes("a2020"));

  const themed = await switchToLatex({ ...first.document, kind: "visual", settings: { ...first.document.settings, theme: "ieee" } });
  assert.notEqual(themed.document.source, first.document.source, "changing page settings must regenerate the source");
  assert.match(themed.document.source, /\{IEEEtran\}/);

  const added = `${BIB}\n@article{c2021, author={Gamma, Greta}, title={Third}, journal={J}, year={2021}}`;
  const reffed = await switchToLatex({ ...themed.document, kind: "visual", bib: added });
  assert.ok(reffed.document.files.find((file) => file.name === "references.bib").content.includes("c2021"), "a changed bibliography must be written to the project");
});

test("mode switching reimports when project files or images change", async () => {
  const visual = createFromTemplate("blank", 0);
  visual.content = doc(p("Before"));
  const first = await switchToLatex(visual);
  const withInput = {
    ...first.document,
    source: first.document.source.replace("Before", "\\input{body}"),
    files: [...first.document.files, { name: "body.tex", content: "Before" }],
  };
  const imported = await switchToVisual(withInput);
  assert.match(JSON.stringify(imported.document.content), /Before/);

  const reused = await switchToLatex(imported.document);
  const edited = {
    ...reused.document,
    files: reused.document.files.map((file) => (file.name === "body.tex" ? { ...file, content: "After" } : file)),
  };
  const reimported = await switchToVisual(edited);
  assert.match(JSON.stringify(reimported.document.content), /After/, "editing an included file must refresh the visual content");

  const source = first.document.source.replace("Before", "\\begin{figure}\n\\includegraphics[width=0.5\\linewidth]{figs/one.png}\n\\caption{One}\n\\label{fig:one}\n\\end{figure}");
  const missing = await switchToVisual({ ...first.document, source });
  const missingFigure = missing.document.content.content.find((block) => block.type === "figure");
  assert.equal(missingFigure.attrs.src, "");
  assert.match(missing.notice, /not found/);

  const png = "data:image/png;base64,iVBORw0KGgo=";
  const added = await switchToVisual({
    ...missing.document,
    assets: [{ name: "figs/one.png", type: "image/png", dataUrl: png, size: 10 }],
  });
  const figure = added.document.content.content.find((block) => block.type === "figure");
  assert.equal(figure.attrs.src, png, "adding the image must refresh the visual content");
});

test("every template survives a round trip through the other editor", async () => {
  for (const template of TEMPLATES) {
    const created = createFromTemplate(template.id, 0);
    if (created.kind === "visual") {
      const latex = await switchToLatex(created);
      const back = await switchToVisual(latex.document);
      Node.fromJSON(schema, back.document.content).check();
      assert.deepEqual(back.document.content, created.content, `${template.id}: visual content changed`);
      const again = await switchToLatex(back.document);
      assert.equal(again.document.source, latex.document.source, `${template.id}: LaTeX source changed`);
    } else {
      const visual = await switchToVisual(created);
      Node.fromJSON(schema, visual.document.content).check();
      const back = await switchToLatex(visual.document);
      assert.equal(back.document.source, created.source, `${template.id}: LaTeX source changed`);
    }
  }
});

test("LaTeX generated by a mode switch renders and resolves its references", async () => {
  for (const template of TEMPLATES.filter((entry) => entry.kind === "visual")) {
    const converted = await switchToLatex(createFromTemplate(template.id, 0));
    const files = Object.fromEntries(converted.document.files.map((file) => [file.name, file.content]));
    const assets = Object.fromEntries(converted.document.assets.map((asset) => [asset.name, asset.dataUrl]));
    const rendered = renderLatex(converted.document.source, { files, assets });
    assert.deepEqual(rendered.diagnostics, [], template.id);
    assert.doesNotMatch(htmlToText(rendered.html), /\?\?/, template.id);
  }
});

test("references into preserved LaTeX blocks are not reported as missing", async () => {
  const source = `\\documentclass{article}
\\begin{document}
\\section{Introduction}\\label{sec:intro}
See \\ref{thm:one} and \\ref{sec:intro}.
\\begin{theorem}\\label{thm:one}
Holds.
\\end{theorem}
\\end{document}`;
  const latex = createFromTemplate("latex-blank", 0);
  const imported = await switchToVisual({ ...latex, source });
  const node = Node.fromJSON(schema, imported.document.content);
  node.check();
  const analysis = analyzeDoc(node, context(imported.document.settings, imported.document.bib));
  assert.ok(!analysis.labels.some((label) => label.spec.missing), "a label inside a LaTeX block is a real target");
  const raw = analysis.labels.find((label) => label.spec.raw);
  assert.equal(raw?.spec.paperLabel, "thm:one", "the reference shows the label LaTeX will resolve");
});

test("marks, nested blocks and structured tables survive a round trip", async () => {
  const visual = createFromTemplate("blank", 0);
  visual.title = "Rich";
  visual.bib = BIB;
  visual.content = doc(
    { type: "paperTitle", content: [text("Rich title")] },
    h(1, "Introduction", "sec-intro"),
    p(
      "Plain, ",
      text("bold", [{ type: "bold" }]),
      ", ",
      text("italic", [{ type: "italic" }]),
      ", ",
      text("underlined", [{ type: "underline" }]),
      ", ",
      text("struck", [{ type: "strike" }]),
      ", ",
      text("code", [{ type: "code" }]),
      ", ",
      text("red", [{ type: "textStyle", attrs: { color: "#b91c1c" } }]),
      ", ",
      text("highlighted", [{ type: "highlight", attrs: { color: "#fff3a3" } }]),
      ", ",
      text("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ", ref ", { type: "crossRef", attrs: { target: "sec-method" } },
      ", cite ", { type: "citation", attrs: { keys: ["a2020"] } },
      ", note", { type: "footnote", attrs: { text: "A footnote." } },
      ".",
    ),
    p("Inline ", { type: "mathInline", attrs: { latex: "y" } }, " and display math."),
    { type: "mathBlock", attrs: { latex: "E = mc^2", numbered: true, id: "eq-one" } },
    {
      type: "tableFigure",
      attrs: { id: "tab-one" },
      content: [
        { type: "figcaption", content: [text("A table")] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p("Head")] }] },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("A")] },
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("B")] },
              ],
            },
          ],
        },
      ],
    },
    { type: "bulletList", content: [{ type: "listItem", content: [p("First")] }, { type: "listItem", content: [p("Second")] }] },
    { type: "blockquote", content: [p("Quoted")] },
    { type: "codeBlock", attrs: { language: "python" }, content: [text("print(1)")] },
    { type: "horizontalRule" },
    { type: "pageBreak" },
    h(1, "Method", "sec-method"),
    p("After."),
    { type: "bibliography" },
  );

  const latex = await switchToLatex(visual);
  const back = await switchToVisual(latex.document);
  Node.fromJSON(schema, back.document.content).check();
  assert.deepEqual(back.document.content, visual.content);
  const again = await switchToLatex(back.document);
  assert.equal(again.document.source, latex.document.source);
});
