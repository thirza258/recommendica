import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { baseExtensions } from "../src/write/visual/extensions.ts";
import { convertDocx } from "../src/write/importing/docx.ts";
import { ommlParagraph, ommlToLatex } from "../src/write/importing/omml.ts";
import { parseXml } from "../src/write/importing/xml.ts";
import { buildLatexProject, decodeSource, normalizePath, unzipProject } from "../src/write/importing/latexProject.ts";
import { createFromTemplate } from "../src/write/templates.ts";
import { DEFAULT_SETTINGS } from "../src/write/documents.ts";
import { switchToLatex, switchToVisual } from "../src/write/modeSwitch.ts";
import { validBlock } from "../src/write/visual/contentCheck.ts";

const schema = getSchema(baseExtensions());

// ── Building .docx files ──────────────────────────────────────────────────

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(" ");

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));

const p = (inner, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const r = (text, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const styled = (id) => `<w:pStyle w:val="${id}"/>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Judul1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ChapterHead"><w:name w:val="Chapter Head"/><w:basedOn w:val="Judul1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering ${NS}>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>
</w:numbering>`;

function docx({ body, rels = "", footnotes = "", media = {}, sources = "", sectPr = "" }) {
  const files = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sectPr}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    "word/styles.xml": strToU8(STYLES),
    "word/numbering.xml": strToU8(NUMBERING),
    "word/footnotes.xml": strToU8(`<?xml version="1.0"?><w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${footnotes}</w:footnotes>`),
  };
  for (const [name, bytes] of Object.entries(media)) files[`word/media/${name}`] = bytes;
  if (sources) files["customXml/item1.xml"] = strToU8(`<?xml version="1.0"?><b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography">${sources}</b:Sources>`);
  return zipSync(files);
}

const drawing = (rid, cx, alt = "") =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="${alt}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const field = (instruction, result) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const blocks = (result) => result.content.content;
const ofType = (result, type) => {
  const found = [];
  const visit = (node) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(visit);
  };
  visit(result.content);
  return found;
};
const text = (node) => (node.content ?? []).map((child) => child.text ?? "").join("");

function valid(content) {
  const node = Node.fromJSON(schema, content);
  node.check();
  return node;
}

// ── Word documents ────────────────────────────────────────────────────────

test("a Word paper keeps its title, authors, abstract, keywords and headings", () => {
  const result = convertDocx(
    docx({
      body: [
        p(r("Deep Learning for Rice"), styled("Title")),
        p(r("Ann Alpha, Bob Beta")),
        p(r("Universitas Contoh")),
        p(r("Abstract"), styled("Judul1")),
        p(r("We study rice.")),
        p(r("Keywords:", "<w:b/>") + r(" rice, learning")),
        p(r("1. Introduction"), styled("Judul1")),
        p(r("Rice is ") + r("important", '<w:rStyle w:val="Strong"/>') + r(".")),
        p(r("1.1 Background"), styled("Heading2")),
        p(r("Chapter style"), styled("ChapterHead")),
      ].join(""),
    }),
  );
  const [title, authors, abstract, keywords, h1, para, h2, chapter] = blocks(result);
  assert.equal(title.type, "paperTitle");
  assert.equal(text(title), "Deep Learning for Rice");
  assert.equal(result.title, "Deep Learning for Rice");
  assert.equal(authors.type, "paperAuthors");
  assert.deepEqual(authors.content.map((node) => node.text ?? node.type), ["Ann Alpha, Bob Beta", "hardBreak", "Universitas Contoh"]);
  assert.equal(abstract.type, "paperAbstract");
  assert.equal(text(abstract.content[0]), "We study rice.");
  assert.equal(keywords.type, "paperKeywords");
  assert.equal(text(keywords), "rice, learning");
  assert.deepEqual([h1.type, h1.attrs.level, h1.attrs.numbered, text(h1)], ["heading", 1, true, "Introduction"], "manual numbers are dropped and the headings numbered");
  assert.deepEqual(para.content.find((node) => node.text === "important").marks, [{ type: "bold" }], "a character style's bold is kept");
  assert.equal(h1.content[0].marks, undefined, "a heading style's bold is not emphasis");
  assert.deepEqual([h2.attrs.level, text(h2)], [2, "Background"]);
  assert.deepEqual([chapter.type, chapter.attrs.level], ["heading", 1], "a style based on a heading is that heading");
  valid(result.content);
});

test("runs keep their formatting, links and accepted changes", () => {
  const result = convertDocx(
    docx({
      rels: '<Relationship Id="rIdL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/a" TargetMode="External"/>',
      body: p(
        [
          r("bold", "<w:b/>"),
          r(" "),
          r("not bold", '<w:b w:val="0"/>'),
          r(" "),
          r("it", "<w:i/>"),
          r("sup", '<w:vertAlign w:val="superscript"/>'),
          r("red", '<w:color w:val="FF0000"/>'),
          r("marked", '<w:highlight w:val="yellow"/>'),
          r("code()", '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'),
          '<w:hyperlink r:id="rIdL">' + r("link") + "</w:hyperlink>",
          field(' HYPERLINK "https://example.org/b" ', r("field link")),
          '<w:ins w:id="1" w:author="A">' + r(" added") + "</w:ins>",
          '<w:del w:id="2" w:author="A"><w:r><w:delText>removed</w:delText></w:r></w:del>',
          '<w:r><w:tab/><w:t>tab</w:t></w:r>',
        ].join(""),
      ),
    }),
  );
  const nodes = blocks(result)[0].content;
  const marksOf = (value) => nodes.find((node) => node.text === value)?.marks ?? [];
  assert.deepEqual(marksOf("bold"), [{ type: "bold" }]);
  assert.deepEqual(marksOf("not bold"), []);
  assert.deepEqual(marksOf("sup"), [{ type: "superscript" }]);
  assert.deepEqual(marksOf("red"), [{ type: "textStyle", attrs: { color: "#FF0000" } }]);
  assert.deepEqual(marksOf("marked"), [{ type: "highlight", attrs: { color: "#FFFF00" } }]);
  assert.deepEqual(marksOf("code()"), [{ type: "code" }]);
  assert.deepEqual(marksOf("link"), [{ type: "link", attrs: { href: "https://example.org/a" } }]);
  assert.deepEqual(marksOf("field link"), [{ type: "link", attrs: { href: "https://example.org/b" } }]);
  const all = nodes.map((node) => node.text ?? "").join("");
  assert.match(all, / added tab$/);
  assert.doesNotMatch(all, /removed|HYPERLINK/);
  assert.match(result.warnings.join(" "), /Tracked changes were applied/);
});

test("lists nest, keep their numbering and come from list styles too", () => {
  const item = (value, numId, ilvl) => p(r(value), `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
  const result = convertDocx(docx({ body: [item("one", 1, 0), item("one a", 1, 1), item("two", 1, 0), p(r("between")), p(r("third"), styled("ListNumber"))].join("") }));
  const [bullets, between, numbered] = blocks(result);
  assert.equal(bullets.type, "bulletList");
  assert.equal(bullets.content.length, 2);
  const nested = bullets.content[0].content[1];
  assert.equal(nested.type, "orderedList");
  assert.equal(text(nested.content[0].content[0]), "one a");
  assert.equal(between.type, "paragraph");
  assert.deepEqual([numbered.type, numbered.attrs?.start], ["orderedList", 3], "numbering from the paragraph style, with its start");
  valid(result.content);
});

test("tables keep spans, header rows and captions; uncaptioned tables are not numbered", () => {
  const cell = (value, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${p(r(value))}</w:tc>`;
  const table = (rows) => `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>${rows}</w:tbl>`;
  const result = convertDocx(
    docx({
      body: [
        p(r("Table ") + field(" SEQ Table \\* ARABIC ", r("1")) + r(": Results of the study"), styled("Caption")),
        table(
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("A")}${cell("B")}${cell("C")}</w:tr>` +
            `<w:tr>${cell("span", '<w:gridSpan w:val="2"/>')}${cell("x", '<w:vMerge w:val="restart"/>')}</w:tr>` +
            `<w:tr>${cell("1")}${cell("2")}${cell("", "<w:vMerge/>")}</w:tr>`,
        ),
        table(`<w:tr>${cell("plain")}${cell("table")}</w:tr>`),
      ].join(""),
    }),
  );
  const [figure, plain] = blocks(result);
  assert.equal(figure.type, "tableFigure");
  assert.equal(text(figure.content[0]), "Results of the study", "the caption without its label");
  const rows = figure.content[1].content;
  assert.deepEqual(rows[0].content.map((cell) => cell.type), ["tableHeader", "tableHeader", "tableHeader"]);
  assert.deepEqual([rows[1].content[0].attrs.colspan, rows[1].content[1].attrs.rowspan], [2, 2]);
  assert.equal(rows[2].content.length, 2, "the merged cell is not repeated");
  assert.equal(plain.type, "table");
  valid(result.content);
});

test("pictures become figures with their captions; formats browsers cannot show are reported", () => {
  const result = convertDocx(
    docx({
      rels: [
        '<Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
        '<Relationship Id="rIdE" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.emf"/>',
      ].join(""),
      media: { "image1.png": PNG, "image2.emf": new Uint8Array([1, 2, 3]) },
      sectPr: '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr>',
      body: [
        p(drawing("rIdI", 914400 * 3, "A plot")),
        p(r("Figure 1. Overview of the method")),
        // Word writes a drawing twice: as DrawingML (Choice) and as VML (Fallback).
        p(`<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing("rIdI", 914400).replace(/^<w:r>|<\/w:r>$/g, "")}</mc:Choice><mc:Fallback><w:pict><v:shape><v:imagedata r:id="rIdI"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`),
        p(drawing("rIdE", 914400)),
      ].join(""),
    }),
  );
  const figures = ofType(result, "figure");
  assert.equal(figures.length, 3, "one figure per picture, the alternative content once");
  assert.match(figures[0].attrs.src, /^data:image\/png;base64,/);
  assert.equal(figures[0].attrs.alt, "A plot");
  assert.equal(figures[0].attrs.width, 48, "3 in of the 6.27 in text width");
  assert.equal(text(figures[0].content[0]), "Overview of the method");
  assert.equal(figures[2].attrs.src, "");
  assert.match(result.warnings.join(" "), /EMF\/WMF/);
  valid(result.content);
});

test("Word equations become LaTeX, display and inline, numbered when Word numbers them", () => {
  const math = (inner) => `<m:oMath>${inner}</m:oMath>`;
  const mr = (value, rPr = "") => `<m:r>${rPr ? `<m:rPr>${rPr}</m:rPr>` : ""}<m:t>${value}</m:t></m:r>`;
  const result = convertDocx(
    docx({
      body: [
        p(`<m:oMathPara>${math(`${mr("E")}${mr("=")}${mr("m")}<m:sSup><m:e>${mr("c")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup>`)}</m:oMathPara>`),
        p(`<m:oMathPara>${math(`<m:f><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>`)}</m:oMathPara><w:r><w:tab/><w:t>(1)</w:t></w:r>`),
        p(r("Inline ") + math(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr("x")}</m:e></m:rad>`) + r(" here.")),
      ].join(""),
    }),
  );
  const equations = ofType(result, "mathBlock");
  assert.deepEqual(equations.map((node) => [node.attrs.latex, node.attrs.numbered]), [
    ["E=mc^2", false],
    ["\\frac{a}{b}", true],
  ]);
  assert.deepEqual(ofType(result, "mathInline").map((node) => node.attrs.latex), ["\\sqrt{x}"]);
  valid(result.content);
});

test("footnotes keep their text, and their LaTeX when they hold more", () => {
  const result = convertDocx(
    docx({
      footnotes: [
        `<w:footnote w:id="1">${p(r("Plain note 50%."))}</w:footnote>`,
        `<w:footnote w:id="2">${p(r("See ") + r("this", "<w:b/>") + "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>")}</w:footnote>`,
      ].join(""),
      body: p(r("Text") + '<w:r><w:footnoteReference w:id="1"/></w:r>' + r(" more") + '<w:r><w:footnoteReference w:id="2"/></w:r>'),
    }),
  );
  const notes = ofType(result, "footnote");
  assert.deepEqual(notes.map((note) => note.attrs.text), ["Plain note 50%.", "See this$x$"]);
  assert.equal(notes[0].attrs.latex, undefined);
  assert.equal(notes[1].attrs.latex, "See \\textbf{this}$x$");
  valid(result.content);
});

test("reference-manager citations become \\cite with BibTeX; the table of contents becomes \\tableofcontents", () => {
  const csl = JSON.stringify({
    citationItems: [{ id: 1, uris: ["http://zotero.org/users/1/items/AAA"], locator: "5", label: "page", itemData: { type: "article-journal", title: "Rice Genomics", "container-title": "Nature", author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2020]] }, volume: "5", page: "1-10", DOI: "10.1/x" } }],
    properties: { formattedCitation: "(Smith, 2020, p. 5)" },
  });
  const result = convertDocx(
    docx({
      sources: '<b:Source><b:Tag>Doe21</b:Tag><b:SourceType>Book</b:SourceType><b:Author><b:Author><b:NameList><b:Person><b:Last>Doe</b:Last><b:First>John</b:First></b:Person></b:NameList></b:Author></b:Author><b:Title>A Book</b:Title><b:Year>2021</b:Year></b:Source>',
      body: [
        // A table of contents is one field across many paragraphs.
        p('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + r("Introduction 1")),
        p(r("Methods 2") + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'),
        p(r("As shown ") + field(` ADDIN ZOTERO_ITEM CSL_CITATION ${csl.replace(/&/g, "&amp;").replace(/</g, "&lt;")}`, r("(Smith, 2020, p. 5)")) + r(" and ") + field(" CITATION Doe21 \\l 1033 ", r("(Doe, 2021)")) + r(".")),
        p(field(" ADDIN ZOTERO_BIBL {} CSL_BIBLIOGRAPHY ", r("Smith, J. (2020). Rice Genomics."))),
      ].join(""),
    }),
  );
  const [toc, paragraph, bibliography] = blocks(result);
  assert.deepEqual([toc.type, toc.attrs.source], ["rawLatex", "\\tableofcontents"], "the table of contents, once, without its entries");
  const citations = ofType(result, "citation");
  assert.deepEqual(citations.map((node) => node.attrs), [{ keys: ["smith2020"], post: "p.~5" }, { keys: ["Doe21"] }]);
  assert.equal(text(paragraph).trim(), "As shown  and .");
  assert.equal(bibliography.type, "bibliography");
  assert.match(result.bib, /@article\{smith2020,[\s\S]*author = \{Smith, Jane\}[\s\S]*journal = \{Nature\}[\s\S]*pages = \{1--10\}/);
  assert.match(result.bib, /@book\{Doe21,[\s\S]*author = \{Doe, John\}/);
  assert.equal(result.settings.citationStyle, "apa");
  valid(result.content);
});

test("page setup, fonts and spacing carry over", () => {
  const result = convertDocx(docx({ body: p(r("x")), sectPr: '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="2268" w:right="1701"/><w:cols w:num="2"/></w:sectPr>' }));
  assert.deepEqual(result.settings, { paper: "a4", margins: "wide", columns: 2, font: "times", fontSize: 12, lineSpacing: 2 });
});

test("a Word paper becomes a LaTeX paper that opens in the visual editor unchanged", async () => {
  const bytes = docx({
    rels: '<Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
    media: { "image1.png": PNG },
    body: [
      p(r("A Title"), styled("Title")),
      p(r("Introduction"), styled("Judul1")),
      p(r("Text with ") + r("bold", "<w:b/>") + r(" and 50% & $5.")),
      p(drawing("rIdI", 914400 * 2)),
      p(r("Figure 1: A picture")),
      p(r("Some code();"), styled("Code")),
      p(r("A quote."), styled("Quote")),
    ].join(""),
  });
  const result = convertDocx(bytes);
  const visual = { ...createFromTemplate("blank", 0), title: result.title, template: "import", settings: { ...DEFAULT_SETTINGS, ...result.settings }, content: result.content, bib: result.bib };
  const latex = (await switchToLatex(visual)).document;
  assert.equal(latex.kind, "latex");
  assert.match(latex.source, /\\title\{A Title\}/);
  assert.match(latex.source, /\\section\*?\{Introduction\}/);
  assert.match(latex.source, /Text with \\textbf\{bold\} and 50\\% \\& \\\$5\./);
  assert.match(latex.source, /\\includegraphics\[width=0\.31\\linewidth\]\{figures\/figure-1\.png\}\n  \\caption\{A picture\}/);
  assert.match(latex.source, /\\begin\{verbatim\}\nSome code\(\);\n\\end\{verbatim\}/);
  assert.match(latex.source, /\\begin\{quote\}\nA quote\.\n\\end\{quote\}/);
  assert.ok(latex.assets.some((asset) => asset.name === "figures/figure-1.png"));
  // Opening it in the visual editor reuses the Word content, and nothing is rewritten.
  const reopened = await switchToVisual(latex, { validBlock });
  assert.deepEqual(reopened.document.content, result.content);
  const loaded = valid(reopened.document.content).toJSON();
  loaded.content.push({ type: "paragraph" });
  const back = await switchToLatex({ ...reopened.document, content: loaded });
  assert.equal(back.document.source, latex.source);
});

test("files that are not Word documents are refused clearly", () => {
  assert.throws(() => convertDocx(new Uint8Array([1, 2, 3])), /not a Word document/);
  assert.throws(() => convertDocx(zipSync({ "a.txt": strToU8("x") })), /not a Word document/);
});

// ── Word math ─────────────────────────────────────────────────────────────

const omml = (inner) => parseXml(`<m:oMath xmlns:m="m">${inner}</m:oMath>`);
const t = (value, sty = "") => `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ""}<m:t>${value}</m:t></m:r>`;

test("Word math objects map to LaTeX constructs", () => {
  const cases = [
    [`<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${t("i=1")}</m:sub><m:sup>${t("n")}</m:sup><m:e><m:sSub><m:e>${t("x")}</m:e><m:sub>${t("i")}</m:sub></m:sSub></m:e></m:nary>`, "\\sum_{i=1}^n x_i"],
    [`<m:nary><m:sub>${t("0")}</m:sub><m:sup>${t("∞")}</m:sup><m:e>${t("f")}</m:e></m:nary>`, "\\int_0^\\infty f"],
    [`<m:d><m:e><m:m><m:mr><m:e>${t("a")}</m:e><m:e>${t("b")}</m:e></m:mr><m:mr><m:e>${t("c")}</m:e><m:e>${t("d")}</m:e></m:mr></m:m></m:e></m:d>`, "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}"],
    [`<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e><m:eqArr><m:e>${t("1&amp;x&gt;0")}</m:e><m:e>${t("0&amp;x≤0")}</m:e></m:eqArr></m:e></m:d>`, "\\begin{cases}1&x>0 \\\\ 0&x\\le 0\\end{cases}"],
    [`<m:func><m:fName>${t("sin", "p")}</m:fName><m:e>${t("θ")}</m:e></m:func>`, "\\sin\\theta"],
    [`<m:func><m:fName><m:limLow><m:e>${t("lim", "p")}</m:e><m:lim>${t("n→∞")}</m:lim></m:limLow></m:fName><m:e>${t("a")}</m:e></m:func>`, "\\lim_{n\\to \\infty} a"],
    [`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${t("v")}</m:e></m:acc>`, "\\vec{v}"],
    [`<m:acc><m:e>${t("xy")}</m:e></m:acc>`, "\\widehat{xy}"],
    [`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${t("z")}</m:e></m:bar>`, "\\overline{z}"],
    [`<m:rad><m:deg>${t("3")}</m:deg><m:e>${t("8")}</m:e></m:rad>`, "\\sqrt[3]{8}"],
    [`<m:sSubSup><m:e>${t("x")}</m:e><m:sub>${t("i")}</m:sub><m:sup>${t("2")}</m:sup></m:sSubSup>`, "x_i^2"],
    [`<m:sSup><m:e>${t("e")}</m:e><m:sup>${t("-iπ")}</m:sup></m:sSup>`, "e^{-i\\pi}"],
    [t("α+β≠γ"), "\\alpha +\\beta \\ne \\gamma"],
    [t("R", "p"), "\\mathrm{R}"],
    [`<m:r><m:rPr><m:scr m:val="double-struck"/></m:rPr><m:t>R</m:t></m:r>`, "\\mathbb{R}"],
    [`<m:r><m:rPr><m:nor/></m:rPr><m:t>if x &gt; 0</m:t></m:r>`, "\\text{if x > 0}"],
    [`<m:groupChr><m:e>${t("a+b")}</m:e></m:groupChr>`, "\\underbrace{a+b}"],
    [t("{a}%"), "\\{a\\}\\%"],
  ];
  for (const [xml, expected] of cases) assert.equal(ommlToLatex(omml(xml)), expected, xml);
});

test("an equation paragraph with Word's #(n) number reports the number", () => {
  const para = parseXml(`<m:oMathPara xmlns:m="m"><m:oMath>${t("a=b")}${t("#")}<m:d><m:e>${t("2")}</m:e></m:d></m:oMath></m:oMathPara>`);
  assert.deepEqual(ommlParagraph(para), { latex: "a=b", number: "2" });
});

test("the XML reader handles entities and CDATA but not DTD tricks", () => {
  const root = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><a b="1 &amp; 2"><c>&lt;&#x41;&#66;&e;</c><![CDATA[<raw>]]></a>');
  assert.equal(root.attrs.b, "1 & 2");
  assert.deepEqual(root.children, [{ name: "c", local: "c", attrs: {}, children: ["<AB&e;"] }, "<raw>"]);
});

// ── LaTeX projects ────────────────────────────────────────────────────────

const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, typeof content === "string" ? strToU8(content) : content])));

test("a project zip is cleaned, re-rooted at its main file and keeps every path", () => {
  const warnings = [];
  const entries = unzipProject(
    zip({
      "paper-main/__MACOSX/._paper.tex": "junk",
      "paper-main/.DS_Store": "junk",
      "paper-main/paper.aux": "junk",
      "paper-main/paper.pdf": "compiled output",
      "paper-main/paper.tex": "\\documentclass{article}\n\\title{Rice \\& Wheat\\thanks{x}}\n\\begin{document}\n\\input{sections/intro}\n\\includegraphics{figures/my plot.png}\n\\bibliography{refs}\n\\end{document}\n",
      "paper-main/sections/intro.tex": "\\section{Intro}",
      "paper-main/figures/my plot.png": PNG,
      "paper-main/figures/old.pdf": "%PDF-1.4",
      "paper-main/refs.bib": "@misc{a, title={A}}",
      "paper-main/style.sty": "\\ProvidesPackage{style}",
      "paper-main/font.ttf": "binary",
    }),
    warnings,
  );
  const project = buildLatexProject(entries, warnings);
  assert.equal(project.mainPath, "paper.tex");
  assert.match(project.source, /\\input\{sections\/intro\}/);
  assert.deepEqual(project.files.map((file) => file.name).sort(), ["refs.bib", "sections/intro.tex", "style.sty"]);
  assert.deepEqual(project.binaries.map((file) => [file.name, file.type]).sort(), [
    ["figures/my plot.png", "image/png"],
    ["figures/old.pdf", "application/pdf"],
  ]);
  assert.equal(project.title, "Rice & Wheat");
  assert.match(warnings.join(" "), /“paper\.tex” is the main file/);
});

test("in a subfiles project the main file is the one the chapters belong to", () => {
  const project = buildLatexProject([
    { path: "chapters/one.tex", bytes: strToU8("\\documentclass[../main.tex]{subfiles}\n\\begin{document}\nOne\n\\end{document}") },
    { path: "thesis.tex", bytes: strToU8("\\documentclass{report}\n\\usepackage{subfiles}\n\\begin{document}\n\\subfile{chapters/one}\n\\end{document}") },
    { path: "figure.tex", bytes: strToU8("\\documentclass{standalone}\n\\begin{document}x\\end{document}") },
  ]);
  assert.equal(project.mainPath, "thesis.tex");
});

test("a main file in a folder is the root; other text decodes from Windows-1252", () => {
  const warnings = [];
  const project = buildLatexProject(
    [
      { path: "paper/main.tex", bytes: Uint8Array.from([...strToU8("\\documentclass{article}\\begin{document}Caf"), 0xe9, ...strToU8("\\end{document}")]) },
      { path: "paper/fig/a.png", bytes: PNG },
      { path: "README.md", bytes: strToU8("# readme") },
    ],
    warnings,
  );
  assert.match(project.source, /Café/);
  assert.deepEqual(project.binaries.map((file) => file.name), ["fig/a.png"]);
  assert.ok(project.files.some((file) => file.name === "README.md"));
  assert.match(warnings.join(" "), /outside the main file's folder/);
  assert.equal(decodeSource(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), "A");
});

test("upload paths cannot leave the project, and an upload without .tex is refused", () => {
  assert.equal(normalizePath("../../etc/./x\\y.tex"), "etc/x/y.tex");
  assert.equal(normalizePath("/abs/path.tex"), "abs/path.tex");
  assert.throws(() => buildLatexProject([{ path: "refs.bib", bytes: strToU8("") }]), /no \.tex file/);
  assert.throws(() => unzipProject(new Uint8Array([1, 2, 3])), /could not be read/);
});

// ── Markdown and text ─────────────────────────────────────────────────────

import { convertMarkdown, convertPlainText } from "../src/write/importing/markdown.ts";
import { addToProject, classifyUploads, importUploads, newEntries } from "../src/write/importing/index.ts";
import { documentToLatex } from "../src/write/visual/toLatex.ts";

const MARKDOWN = `---
title: "Notes on Rice"
author:
  - Ann Alpha
  - Bob Beta
abstract: A short study.
---

# Introduction

Rice is **important**, *very* \`code\` ~~old~~ and [a link](https://example.org).
Prices are $5 and $10; math is $a_1 * b_1 = c\\_2$ and \\(x\\).

$$
\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}
$$

## Methods

1. first
2. second
   - nested

- [x] done
- [ ] todo

| Name | Score |
|:-----|------:|
| A    | 1     |

\`\`\`python
print("$not math$")
\`\`\`

As shown [@smith2020, p. 5] and in a note[^1]. H<sub>2</sub>O.

![A chart](https://example.org/chart.png)

![Local](figures/plot.png)

[^1]: The note text.
`;

test("Markdown keeps its structure, math, citations, footnotes and pictures", () => {
  const result = convertMarkdown(MARKDOWN);
  const [title, authors, abstract, heading] = blocks(result);
  assert.equal(title.type, "paperTitle");
  assert.equal(result.title, "Notes on Rice");
  assert.deepEqual(authors.content.map((node) => node.text ?? node.type), ["Ann Alpha", "hardBreak", "Bob Beta"]);
  assert.equal(abstract.type, "paperAbstract");
  assert.deepEqual([heading.type, heading.attrs.level, text(heading)], ["heading", 1, "Introduction"]);
  const paragraph = blocks(result)[4];
  const marksOf = (value) => paragraph.content.find((node) => node.text === value)?.marks?.map((mark) => mark.type) ?? [];
  assert.deepEqual(marksOf("important"), ["bold"]);
  assert.deepEqual(marksOf("old"), ["strike"]);
  assert.deepEqual(marksOf("code"), ["code"]);
  assert.match(paragraph.content.map((node) => node.text ?? "").join(""), /Prices are \$5 and \$10; math is/, "prices are not math");
  assert.deepEqual(ofType(result, "mathInline").map((node) => node.attrs.latex), ["a_1 * b_1 = c\\_2", "x"]);
  assert.deepEqual(ofType(result, "mathBlock").map((node) => node.attrs.latex), ["\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}"], "\\\\ keeps both backslashes");
  const [ordered, tasks] = ofType(result, "orderedList").concat(ofType(result, "bulletList").filter((list) => text(list.content[0].content[0]).startsWith("☑")));
  assert.equal(ordered.content[1].content[1].type, "bulletList");
  assert.match(text(tasks.content[0].content[0]), /^☑ done/);
  const table = ofType(result, "table")[0];
  assert.deepEqual(table.content[0].content.map((cell) => cell.type), ["tableHeader", "tableHeader"]);
  assert.equal(table.content[1].content[1].content[0].attrs.textAlign, "right");
  const code = ofType(result, "codeBlock")[0];
  assert.deepEqual([code.attrs.language, code.content[0].text], ["python", 'print("$not math$")']);
  assert.deepEqual(ofType(result, "citation").map((node) => node.attrs), [{ keys: ["smith2020"], post: "p.~5" }]);
  assert.deepEqual(ofType(result, "footnote").map((node) => node.attrs.text), ["The note text."]);
  assert.ok(ofType(result, "text").some((node) => node.text === "2" && node.marks?.[0].type === "subscript"));
  const figures = ofType(result, "figure");
  assert.deepEqual(figures.map((figure) => [figure.attrs.src, figure.attrs.path ?? "", text(figure.content[0])]), [
    ["https://example.org/chart.png", "", "A chart"],
    ["", "figures/plot.png", "Local"],
  ]);
  assert.match(result.warnings.join(" "), /not uploaded/);
  valid(result.content);
  const tex = documentToLatex(result.content, { ...DEFAULT_SETTINGS }, "").tex;
  assert.match(tex, /\\includegraphics\[width=0\.8\\linewidth\]\{figures\/plot\.png\}/, "a local picture keeps its path");
});

test("plain text becomes paragraphs at blank lines", () => {
  const result = convertPlainText("First line\nwrapped.\n\n  Second.  \n\n\n");
  assert.deepEqual(blocks(result).map((block) => text(block)), ["First line wrapped.", "Second."]);
});

// ── Uploads ───────────────────────────────────────────────────────────────

const upload = (path, content) => ({ path, file: new File([typeof content === "string" ? strToU8(content) : content], path.split("/").pop()) });

test("uploads are recognised as a document or a project, and old formats are refused", () => {
  assert.deepEqual(classifyUploads([upload("thesis.docx", "x")]), { kind: "document" });
  assert.deepEqual(classifyUploads([upload("notes.md", "x")]), { kind: "document" });
  assert.deepEqual(classifyUploads([upload("paper.zip", "x")]), { kind: "project" });
  assert.deepEqual(classifyUploads([upload("main.tex", "x"), upload("refs.bib", "x"), upload("fig.png", "x")]), { kind: "project" });
  assert.match(classifyUploads([upload("old.doc", "x")]).error, /save it as \.docx/);
  assert.match(classifyUploads([upload("paper.pdf", "x")]).error, /PDF cannot be turned back/);
  assert.match(classifyUploads([upload("a.docx", "x"), upload("b.md", "x")]).error, /one document at a time/);
});

test("an imported Markdown document is a LaTeX paper", async () => {
  const outcome = await importUploads([upload("notes.md", MARKDOWN)]);
  assert.equal(outcome.doc.kind, "latex");
  assert.equal(outcome.doc.title, "Notes on Rice");
  assert.match(outcome.doc.source, /\\section\{Introduction\}/);
  assert.match(outcome.doc.source, /\\begin\{aligned\} a &= b \\\\ c &= d \\end\{aligned\}/);
  assert.match(outcome.notice, /not uploaded/);
  valid(outcome.doc.content);
});

test("an imported project zip is a LaTeX paper with its files", async () => {
  const outcome = await importUploads([
    upload("paper.zip", zip({ "p/main.tex": "\\documentclass{article}\\title{Zip Paper}\\begin{document}\\input{a}\\end{document}", "p/a.tex": "Hello", "p/refs.bib": "" })),
  ]);
  assert.equal(outcome.doc.kind, "latex");
  assert.equal(outcome.doc.title, "Zip Paper");
  assert.deepEqual(outcome.doc.files.map((file) => file.name).sort(), ["a.tex", "refs.bib"]);
});

test("files added to an open project never overwrite, and documents become a .tex to \\input", async () => {
  const bytes = docx({ body: [p(r("Results"), styled("Title")), p(r("Some ") + r("findings", "<w:b/>") + r(".")), p(r("(old style) — 50% & more"))].join("") });
  const added = await addToProject(
    [upload("refs.bib", "@misc{b, title={B}}"), upload("bundle.zip", zip({ "x/section.tex": "S", "x/refs.bib": "@misc{c}" })), upload("Chapter Two.docx", bytes), upload("old.doc", "x")],
    ["main.tex", "refs.bib", "section.tex"],
    "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\\end{document}",
  );
  assert.deepEqual(added.files.map((file) => file.name), ["chapter-two.tex", "section-2.tex", "refs-2.bib", "refs-3.bib"]);
  const chapter = added.files[0].content;
  assert.match(chapter, /^\\section\{Results\}/);
  assert.match(chapter, /Some \\textbf\{findings\}\./);
  assert.doesNotMatch(chapter, /\\begin\{document\}|\\documentclass|\\maketitle/);
  assert.match(added.notice, /\\input\{chapter-two\}/);
  assert.match(added.notice, /old Word document/);
  assert.match(added.notice, /refs\.bib → refs-2\.bib/);
});

test("only BibTeX entries with new keys are merged", () => {
  assert.equal(newEntries("@misc{a, title={A}}", "@misc{a, title={A}}\n@article{b, title={B}}"), "@article{b, title={B}}");
});

import { normalizeDocument } from "../src/write/documents.ts";

test("PDF and EPS figures of a project survive being read back from storage", () => {
  const doc = { ...createFromTemplate("latex-blank", 0), assets: [
    { name: "figures/a.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0=", size: 5 },
    { name: "figures/b.eps", type: "application/postscript", dataUrl: "data:application/postscript;base64,JSFQUw==", size: 5 },
    { name: "evil.html", type: "text/html", dataUrl: "data:text/html;base64,PGI+", size: 3 },
  ] };
  assert.deepEqual(normalizeDocument(doc).assets.map((asset) => asset.name), ["figures/a.pdf", "figures/b.eps"]);
});

test("folders and huge files are skipped by path and size before anything is read", async () => {
  const unreadable = (path, size) => ({ path, file: { name: path.split("/").pop(), size, arrayBuffer: () => { throw new Error(`read ${path}`); } } });
  const outcome = await importUploads([
    upload("paper/main.tex", "\\documentclass{article}\\begin{document}Hi\\end{document}"),
    unreadable("paper/.git/objects/pack/x.pack", 1e9),
    unreadable("paper/node_modules/lib/index.js", 10),
    unreadable("paper/figures/huge.png", 1e9),
    unreadable("paper/video.mp4", 5e8),
  ]);
  assert.equal(outcome.doc.source, "\\documentclass{article}\\begin{document}Hi\\end{document}");
  assert.match(outcome.notice, /too large and left out/);
});

test("captions: the Caption-style paragraph wins, body text stays text, and years are not heading numbers", () => {
  const result = convertDocx(
    docx({
      rels: '<Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      media: { "image1.png": PNG },
      body: [
        p(r("2020 Census Data"), styled("Judul1")),
        p(r("Figure 2: Map of the region"), styled("Caption")),
        p(drawing("rIdI", 914400)),
        p(r("Figure 3 shows the trend over time.")),
        p(r("Table 1 summarizes the results.")),
      ].join(""),
    }),
  );
  const [heading, figure, after, table] = blocks(result);
  assert.deepEqual([heading.type, text(heading), heading.attrs.numbered], ["heading", "2020 Census Data", false]);
  assert.equal(text(figure.content[0]), "Map of the region");
  assert.equal(text(after), "Figure 3 shows the trend over time.");
  assert.equal(text(table), "Table 1 summarizes the results.");
});

test("a document added to a project cites with plain \\cite unless the project loads natbib", async () => {
  const csl = JSON.stringify({ citationItems: [{ id: 1, uris: ["u:1"], prefix: "see", locator: "5", itemData: { type: "book", title: "T", author: [{ family: "Lee", given: "A" }], issued: { "date-parts": [[2019]] } } }], properties: { formattedCitation: "(see Lee, 2019, p. 5)" } }).replace(/&/g, "&amp;");
  const bytes = docx({ body: p(r("Shown ") + field(` ADDIN ZOTERO_ITEM CSL_CITATION ${csl}`, r("(Lee, 2019)")) + r(" at ") + '<w:hyperlink r:id="rIdL">' + r("the site") + "</w:hyperlink>" + r(".")), rels: '<Relationship Id="rIdL" Type="x" Target="https://example.org" TargetMode="External"/>' });
  const plainProject = await addToProject([upload("part.docx", bytes)], ["main.tex"], "\\documentclass{article}\\begin{document}\\end{document}");
  assert.match(plainProject.files[0].content, /Shown \\cite\[p\.~5\]\{lee2019\} at \\href\{https:\/\/example\.org\}\{the site\}\./);
  assert.match(plainProject.notice, /\\usepackage\{hyperref\}/);
  assert.doesNotMatch(plainProject.notice, /amsmath|natbib|graphicx|booktabs/);
  assert.match(plainProject.bib, /@book\{lee2019,/);
  const natbibProject = await addToProject([upload("part.docx", bytes)], ["main.tex"], "\\documentclass{article}\\usepackage{natbib}\\usepackage{hyperref}\\begin{document}\\end{document}");
  assert.match(natbibProject.files[0].content, /\\citep\[see\]\[p\.~5\]\{lee2019\}/);
  assert.doesNotMatch(natbibProject.notice, /usepackage/);
});

test("a document that cites without BibTeX gets an empty references.bib and still reopens unchanged", async () => {
  const outcome = await importUploads([upload("cites.md", "# T\n\nAs [@doe2020] said.")]);
  assert.ok(outcome.doc.files.some((file) => file.name === "references.bib"));
  assert.match(outcome.notice, /add their BibTeX entries to references\.bib/);
  const reopened = await switchToVisual(outcome.doc, { validBlock });
  assert.deepEqual(reopened.document.content, outcome.doc.content, "the visual content is reused, not re-imported");
});

test("Markdown links keep only web and mail addresses", () => {
  const result = convertMarkdown("[bad](javascript:alert(1)) [data](data:text/html,x) [ref][r] [ok](https://example.org) [mail](mailto:a@b.c)\n\n[r]: javascript:alert(2)\n");
  const links = ofType(result, "text").filter((node) => node.marks?.some((mark) => mark.type === "link")).map((node) => [node.text, node.marks[0].attrs.href]);
  assert.deepEqual(links, [["ok", "https://example.org"], ["mail", "mailto:a@b.c"]]);
  assert.match(ofType(result, "paragraph").map(text).join(" "), /bad data ref ok mail/, "the link text stays as text");
});
