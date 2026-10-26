import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { baseExtensions } from "../src/write/visual/extensions.ts";
import { analyzeDoc } from "../src/write/visual/analysis.ts";
import { documentToLatex, escapeLatex, wrapMultiline } from "../src/write/visual/toLatex.ts";
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
