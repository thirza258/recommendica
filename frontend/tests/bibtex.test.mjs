import assert from "node:assert/strict";
import test from "node:test";
import {
  bibToText,
  buildBibliography,
  escapeHtml,
  formatCitation,
  makeCiteKey,
  parseBibtex,
  parseNames,
  serializeBibEntry,
  serializeBibtex,
} from "../src/write/latex/bibtex.ts";

const FORMATS = String.raw`
@article{art,
  author = {John Smith and Lee, Ana Maria},
  title = {Deep {L}earning for {X}},
  journal = {Journal of Testing},
  volume = 3, number = {2}, pages = {1--10},
  month = jan, year = 2020,
  doi = {https://doi.org/10.1000/xyz},
}
@inproceedings{conf,
  author = {Kim, Dae-Jung and Jean-Paul Sartre and others},
  title = {Why Not?},
  booktitle = {Proc. Testing Conf.},
  year = {2019}, pages = {7},
  publisher = {TestPress},
}
@book{book,
  author = {Donald E. Knuth},
  title = {The {\TeX}book},
  publisher = {Addison-Wesley}, address = {Reading, MA},
  year = 1984, edition = {Second},
}
@phdthesis{thesis,
  author = {M{\"u}ller, J{\"o}rg},
  title = {On Things},
  school = {TU Berlin}, address = {Berlin}, year = 2018,
}
@techreport{report,
  author = {{World Health Organization}},
  title = {Global Report},
  institution = {WHO}, number = {12}, year = {2020},
  url = {https://who.int/report},
}
@misc{web,
  title = {A Page Without Author},
  howpublished = {\url{https://example.com/a\_b}},
}
@misc{arxiv,
  author = {Ada Lovelace},
  title = {Notes},
  eprint = {2101.00001}, archiveprefix = {arXiv},
  year = {2021},
}
@article{many,
  author = {A One and B Two and C Three and D Four and E Five and F Six and G Seven},
  title = {Big Team}, journal = {J}, year = 2022,
}
`;

const formatEntries = () => {
  const { entries, diagnostics } = parseBibtex(FORMATS);
  assert.deepEqual(diagnostics, []);
  return entries;
};

const htmlByKey = (bibliography) =>
  Object.fromEntries(bibliography.items.map((item) => [item.key, item.html]));

test("fields resolve braces, quotes, numbers, # concatenation, @string and month macros", () => {
  const { entries, diagnostics } = parseBibtex(`
@string{acm = "ACM Press"}
@STRING(venue = {Proc. } # acm)
@Article{smith2020,
  Author = {John Smith},
  title = {Deep {L}earning   for
           {X}},
  journal = "Journal of " # acm,
  booktitle = venue,
  year = 2020,
  month = jan,
  note = {A} # " and " # {B},
}`);
  assert.deepEqual(diagnostics, []);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.type, "article");
  assert.equal(entry.key, "smith2020");
  assert.equal(entry.line, 4);
  assert.deepEqual(entry.fields, {
    author: "John Smith",
    title: "Deep {L}earning for {X}",
    journal: "Journal of ACM Press",
    booktitle: "Proc. ACM Press",
    year: "2020",
    month: "January",
    note: "A and B",
  });
});

test("nested braces, quotes inside braces and parenthesized entries are kept intact", () => {
  const { entries, diagnostics } = parseBibtex(String.raw`
@misc{nested, title = {A {B {C}} D}, note = "He said {"}hi{"}", author = {M{\"u}ller}}
@book(paren, title = {P (x)}, year = 1999)
`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    entries.map((entry) => [entry.key, entry.fields]),
    [
      ["nested", { title: "A {B {C}} D", note: 'He said {"}hi{"}', author: String.raw`M{\"u}ller` }],
      ["paren", { title: "P (x)", year: "1999" }],
    ],
  );
});

test("comments, preambles, %-lines and text outside entries are skipped", () => {
  const { entries, diagnostics } = parseBibtex(String.raw`
% @article{commented, title = {no}}
Notes outside entries, mail me@example.com.
@comment{ @article{fake, title = {nope}} }
@preamble{ "\newcommand{\noopsort}[1]{}" }
@misc{real, title = {Yes}}
`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(entries.map((entry) => entry.key), ["real"]);
});

test("malformed entries become diagnostics with line numbers and parsing continues", () => {
  const { entries, diagnostics } = parseBibtex(`@article{broken,
  title = {Missing close},
@book{good, title = {Fine}, title = {Dup}}
@book{good, title = {Second}}
@article{bad, title = {Unclosed
@misc{next, title = {Next}, publisher = undefinedmacro}
@article{, title = {no key}}
@misc{after, title = {Still parsed}}
`);
  assert.deepEqual(
    entries.map((entry) => [entry.line, entry.key, entry.fields]),
    [
      [1, "broken", { title: "Missing close" }],
      [3, "good", { title: "Fine" }],
      [5, "bad", {}],
      [6, "next", { title: "Next", publisher: "undefinedmacro" }],
      [8, "after", { title: "Still parsed" }],
    ],
  );
  assert.deepEqual(diagnostics, [
    { line: 1, message: 'Unterminated entry "broken"' },
    { line: 3, message: 'Duplicate field "title" in "good" (the first value is kept)' },
    { line: 4, message: 'Duplicate key "good" (the first entry is kept)' },
    { line: 5, message: 'Unbalanced braces or quotes in the field "title"' },
    { line: 6, message: 'Undefined string "undefinedmacro"' },
    { line: 7, message: "@article entry has no citation key" },
  ]);
});

test("truncated and garbage input never throws", () => {
  for (const input of [
    "", "@", "@{", "@article", "@article{", "@article{x", "@article{x,",
    "@article{x, title", "@article{x, title =", "@article{x, title = {",
    '@article{x, title = "abc', "@article{x, = {y}}", "}}}}@@@", "@string{",
    "@string{x = }", "@comment{", "@preamble(", "@article{x title = {y}}",
    "@article{x, title = {a} junk {b}, year = 1}", "@article{x, title = {a}} trailing }",
    null, undefined, 42,
  ]) {
    const result = parseBibtex(input);
    assert.ok(Array.isArray(result.entries));
    assert.ok(Array.isArray(result.diagnostics));
    for (const diagnostic of result.diagnostics) {
      assert.ok(Number.isInteger(diagnostic.line) && diagnostic.line >= 1);
      assert.ok(diagnostic.message);
    }
  }
  assert.deepEqual(parseBibtex("@article{x title = {y}}").entries[0].fields, { title: "y" });
});

test("names split in all three BibTeX forms", () => {
  const name = (first, von, last, jr = "") => ({ first, von, last, jr });
  assert.deepEqual(parseNames("John Smith"), { names: [name("John", "", "Smith")], others: false });
  assert.deepEqual(parseNames("Smith, John").names, [name("John", "", "Smith")]);
  assert.deepEqual(parseNames("Ludwig van Beethoven").names, [name("Ludwig", "van", "Beethoven")]);
  assert.deepEqual(parseNames("van Beethoven, Ludwig").names, [name("Ludwig", "van", "Beethoven")]);
  assert.deepEqual(parseNames("Jean de la Fontaine").names, [name("Jean", "de la", "Fontaine")]);
  assert.deepEqual(parseNames("Ford, Jr., Henry").names, [name("Henry", "", "Ford", "Jr.")]);
  assert.deepEqual(
    parseNames(String.raw`Charles Louis Xavier Joseph de la Vall{\'e}e Poussin`).names,
    [name("Charles Louis Xavier Joseph", "de la", String.raw`Vall{\'e}e Poussin`)],
  );
  assert.deepEqual(parseNames(String.raw`{\'E}mile Zola`).names, [name(String.raw`{\'E}mile`, "", "Zola")]);
  // Braced text is caseless, so it never becomes a von part.
  assert.deepEqual(parseNames("Maria {de la} Cruz").names, [name("Maria {de la}", "", "Cruz")]);
  assert.deepEqual(parseNames("{World Health Organization}").names, [
    name("", "", "{World Health Organization}"),
  ]);
  assert.deepEqual(parseNames("{Barnes and Noble} AND Ann Lee and others"), {
    names: [name("", "", "{Barnes and Noble}"), name("Ann", "", "Lee")],
    others: true,
  });
  assert.deepEqual(parseNames(""), { names: [], others: false });
});

test("LaTeX field text converts to plain Unicode", () => {
  const cases = [
    ["{\\\"o}\\\"{o}\\'e\\`a\\^o\\~n", "ööéàôñ"],
    [String.raw`\c{c}\v{s}\u{g}\={a}\.{z}\H{o}\k{a}\r{a}\'{\i}`, "çšğāżőąåí"],
    [String.raw`Fran\c{c}ois M\"{u}ller`, "François Müller"],
    [String.raw`{\ss}{\ae}{\AE}{\oe}{\OE}{\o}{\O}{\aa}{\AA}{\l}{\L}`, "ßæÆœŒøØåÅłŁ"],
    [String.raw`{\o}stergaard \ss{} \& \% \$ \# \_ \{ \}`, "østergaard ß & % $ # _ { }"],
    ["1--2 and 3---4", "1–2 and 3—4"],
    ["``Hi'' there", "“Hi” there"],
    ["a~b", "a b"],
    [String.raw`\textbf{B} \emph{E} \textit{I} \textsc{S} \texttt{T} \url{U} {\em x} {\bf y}`, "B E I S T U x y"],
    ["{D}eep {L}earning", "Deep Learning"],
    [String.raw`$\alpha$-stable $O(n^{2})$ $x \leq y$`, "α-stable O(n^2) x ≤ y"],
    ["  a \n\t  b  ", "a b"],
    [String.raw`\href{https://x.org}{the link} {\noopsort{a}}B`, "the link B"],
  ];
  for (const [input, expected] of cases) assert.equal(bibToText(input), expected, input);
});

test("IEEE numbers by first citation, compresses ranges and marks missing keys", () => {
  const { entries } = parseBibtex(
    "@misc{a, title={A}} @misc{b, title={B}} @misc{c, title={C}} @misc{d, title={D}} @misc{e, title={E}}",
  );
  const bib = buildBibliography(entries, { style: "ieee", citedKeys: ["c", "a", "zz", "c", " e "] });
  assert.deepEqual(bib.items.map((item) => [item.label, item.key]), [["[1]", "c"], ["[2]", "a"], ["[3]", "e"]]);
  assert.deepEqual(bib.missing, ["zz"]);
  assert.equal(bib.labels.a.number, 2);
  assert.equal(formatCitation(["a", "c", "e"], bib), "[1]–[3]");
  assert.equal(formatCitation(["a", "c"], bib), "[1], [2]");
  assert.equal(formatCitation(["e", "c"], bib, "text"), "[1], [3]");
  assert.equal(formatCitation(["a", "zz", "a"], bib), "[2], [?]");
  assert.equal(formatCitation(["b"], bib), "[?]");
  assert.equal(formatCitation([], bib), "");
  assert.equal(formatCitation(["constructor"], bib), "[?]");

  const all = buildBibliography(entries, { style: "ieee", citedKeys: ["c", "a"], includeAll: true });
  assert.deepEqual(all.items.map((item) => item.key), ["c", "a", "b", "d", "e"]);
  assert.equal(formatCitation(["a", "b", "c", "d", "e"], all), "[1]–[5]");
  assert.equal(formatCitation(["c", "d", "e"], all), "[1], [4], [5]");
  assert.equal(formatCitation(["c", "b", "d"], all), "[1], [3], [4]");
});

test("IEEE reference formats", () => {
  const entries = formatEntries();
  const bib = buildBibliography(entries, { style: "ieee", citedKeys: entries.map((entry) => entry.key) });
  assert.deepEqual(htmlByKey(bib), {
    art: 'J. Smith and A. M. Lee, “Deep Learning for X,” <i>Journal of Testing</i>, vol. 3, no. 2, pp. 1–10, Jan. 2020, doi: <a href="https://doi.org/10.1000/xyz">10.1000/xyz</a>.',
    conf: "D.-J. Kim, J.-P. Sartre, et al., “Why Not?” in <i>Proc. Testing Conf.</i>, 2019, p. 7.",
    book: "D. E. Knuth, <i>The TeXbook</i>, 2nd ed. Reading, MA: Addison-Wesley, 1984.",
    thesis: "J. Müller, “On Things,” Ph.D. dissertation, TU Berlin, Berlin, 2018.",
    report: 'World Health Organization, “Global Report,” WHO, Tech. Rep. 12, 2020. [Online]. Available: <a href="https://who.int/report">https://who.int/report</a>',
    web: '<i>A Page Without Author</i>. [Online]. Available: <a href="https://example.com/a_b">https://example.com/a_b</a>',
    arxiv: "A. Lovelace, “Notes,” arXiv:2101.00001, 2021.",
    many: "A. One et al., “Big Team,” <i>J</i>, 2022.",
  });
  assert.deepEqual(bib.labels.art, { number: 1, authors: "Smith & Lee", textAuthors: "Smith and Lee", year: "2020" });
  assert.equal(bib.labels.web.year, "n.d.");
});

test("APA sorts by author, year and title and disambiguates same-author years", () => {
  const { entries } = parseBibtex(String.raw`
@misc{s2, author = {Smith, John}, title = {Zebra Patterns}, year = 2020}
@misc{s1, author = {Smith, John}, title = {Alpha Waves}, year = 2020}
@misc{s0, author = {Smith, John}, title = {Undated Work}}
@misc{mu, author = {M{\"u}ller, Anna}, title = {Accents}, year = 2019}
@misc{lee, author = {Lee, Ana and Kim, Dae}, title = {Pairs}, year = 2021}
@misc{ab, author = {Abbott, Zed}, title = {First}, year = 2021}
@misc{team, author = {Ng, A. and Ho, B. and Wu, C.}, title = {Team}, year = 2018}
`);
  const keys = entries.map((entry) => entry.key);
  const bib = buildBibliography(entries, { style: "apa", citedKeys: keys });
  assert.deepEqual(bib.items.map((item) => item.key), ["ab", "lee", "mu", "team", "s0", "s1", "s2"]);
  assert.ok(bib.items.every((item) => item.label === ""));
  assert.deepEqual(
    Object.fromEntries(keys.map((key) => [key, bib.labels[key].year])),
    { s2: "2020b", s1: "2020a", s0: "n.d.", mu: "2019", lee: "2021", ab: "2021", team: "2018" },
  );
  assert.equal(formatCitation(["s2", "s1"], bib), "(Smith, 2020a, 2020b)");
  assert.equal(formatCitation(["s1", "s0"], bib, "text"), "Smith (n.d., 2020a)");
  assert.equal(formatCitation(["mu", "lee", "nope"], bib), "(Lee & Kim, 2021; Müller, 2019; nope?)");
  assert.equal(formatCitation(["mu", "lee", "nope"], bib, "text"), "Lee and Kim (2021); Müller (2019); nope?");
  assert.equal(formatCitation(["team"], bib), "(Ng et al., 2018)");
  assert.equal(formatCitation(["nope"], bib), "(nope?)");
  assert.equal(formatCitation([], bib), "");
  assert.match(bib.items.find((item) => item.key === "s1").html, /\(2020a\)\./);

  const undated = parseBibtex(
    "@misc{u1, author={Roe, R.}, title={B}} @misc{u2, author={Roe, R.}, title={A}}",
  ).entries;
  const undatedBib = buildBibliography(undated, { style: "apa", citedKeys: ["u1", "u2"] });
  assert.deepEqual([undatedBib.labels.u2.year, undatedBib.labels.u1.year], ["n.d.-a", "n.d.-b"]);

  const all = buildBibliography(entries, { style: "apa", citedKeys: ["s2"], includeAll: true });
  assert.deepEqual(all.items.map((item) => item.key), ["ab", "lee", "mu", "team", "s0", "s1", "s2"]);
});

test("APA reference formats", () => {
  const entries = formatEntries();
  const bib = buildBibliography(entries, { style: "apa", citedKeys: entries.map((entry) => entry.key) });
  assert.deepEqual(htmlByKey(bib), {
    art: 'Smith, J., &amp; Lee, A. M. (2020). Deep Learning for X. <i>Journal of Testing</i>, <i>3</i>(2), 1–10. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>',
    conf: "Kim, D.-J., Sartre, J.-P., et al. (2019). Why Not? In <i>Proc. Testing Conf.</i> (p. 7). TestPress.",
    book: "Knuth, D. E. (1984). <i>The TeXbook</i> (2nd ed.). Addison-Wesley.",
    thesis: "Müller, J. (2018). <i>On Things</i> [Doctoral dissertation, TU Berlin].",
    report: 'World Health Organization. (2020). <i>Global Report</i> (Report No. 12). WHO. <a href="https://who.int/report">https://who.int/report</a>',
    web: '<i>A Page Without Author</i>. (n.d.). <a href="https://example.com/a_b">https://example.com/a_b</a>',
    arxiv: "Lovelace, A. (2021). <i>Notes</i>. arXiv:2101.00001.",
    many: "One, A., Two, B., Three, C., Four, D., Five, E., Six, F., &amp; Seven, G. (2022). Big Team. <i>J</i>.",
  });
  assert.deepEqual(bib.labels.conf, { number: 2, authors: "Kim et al.", textAuthors: "Kim et al.", year: "2019" });
  assert.equal(bib.labels.web.authors, "“A Page Without Author”");
});

test("output is escaped and only http(s) URLs and DOIs become links", () => {
  const { entries } = parseBibtex(String.raw`
@misc{xss, author = {{Barnes \& Noble}}, title = {<script>alert(1)</script> "quoted" 'single'},
  url = {javascript:alert(1)}, year = 2020}
@misc{ftp, title = {FTP}, url = {ftp://example.com/file}}
@misc{d1, title = {D1}, doi = {10.1/x}}
@misc{d2, title = {D2}, doi = {doi:10.1/x}}
@misc{d3, title = {D3}, doi = {https://dx.doi.org/10.1/x}}
@misc{d4, title = {D4}, doi = {DOI: 10.1/x}}
@misc{d5, title = {D5}, doi = {not a doi}, url = {https://example.com/?a=1&b=2}}
@misc{quote, title = {Q}, url = {https://example.com/"onmouseover="x}}
`);
  for (const style of ["ieee", "apa"]) {
    const bib = buildBibliography(entries, { style, citedKeys: entries.map((entry) => entry.key) });
    const html = htmlByKey(bib);
    assert.ok(!html.xss.includes("<script>"), html.xss);
    assert.ok(html.xss.includes("&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &#39;single&#39;"));
    assert.ok(html.xss.includes("Barnes &amp; Noble"));
    assert.ok(!/javascript/i.test(html.xss) && !html.xss.includes("<a"));
    assert.ok(!html.ftp.includes("<a"));
    for (const key of ["d1", "d2", "d3", "d4"]) {
      assert.ok(html[key].includes('href="https://doi.org/10.1/x"'), `${style} ${key}: ${html[key]}`);
    }
    assert.ok(html.d5.includes('href="https://example.com/?a=1&amp;b=2"'), html.d5);
    assert.ok(!html.quote.includes("<a") && !html.quote.includes("onmouseover"), html.quote);
    assert.ok(!html.d5.includes("doi.org"));
  }
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");

  const custom = buildBibliography(entries.slice(2, 3), {
    style: "ieee",
    citedKeys: ["d1"],
    renderText: (latex) => `[${latex}]`,
  });
  assert.equal(custom.items[0].html, '<i>[D1]</i>, doi: <a href="https://doi.org/10.1/x">10.1/x</a>.');
});

test("serialization is canonical and round-trips through the parser", () => {
  const { entries } = parseBibtex(FORMATS);
  const again = parseBibtex(serializeBibtex(entries));
  assert.deepEqual(again.diagnostics, []);
  assert.deepEqual(
    again.entries.map(({ type, key, fields }) => ({ type, key, fields })),
    entries.map(({ type, key, fields }) => ({ type, key, fields })),
  );
  assert.equal(
    serializeBibEntry({ type: "Article", key: "k", fields: { year: "2020", title: "T", author: "A" }, line: 1 }),
    "@article{k,\n  author = {A},\n  title = {T},\n  year = {2020},\n}",
  );
  const unbalanced = serializeBibEntry({ type: "misc", key: "u", fields: { title: "a}b{c" }, line: 1 });
  assert.equal(unbalanced, "@misc{u,\n  title = {ab{c}},\n}");
  assert.deepEqual(parseBibtex(unbalanced).entries[0].fields, { title: "ab{c}" });
  assert.equal(serializeBibEntry({ type: "misc", key: "empty", fields: {}, line: 1 }), "@misc{empty,\n}");
  assert.equal(serializeBibtex([]), "");
  assert.ok(serializeBibtex(entries).endsWith("}\n"));
});

test("citation keys are surname + year + first significant title word, made unique", () => {
  const entry = { fields: { author: "Smith, John", year: "2020", title: "The Deep Learning Revolution" } };
  assert.equal(makeCiteKey(entry, new Set()), "smith2020deep");
  assert.equal(makeCiteKey(entry, new Set(["smith2020deep"])), "smith2020deepb");
  assert.equal(makeCiteKey(entry, new Set(["smith2020deep", "smith2020deepb"])), "smith2020deepc");
  assert.equal(
    makeCiteKey({ fields: { author: String.raw`M{\"u}ller, J.`, year: "2001", title: "On the 3D World" } }, new Set()),
    "muller20013d",
  );
  assert.equal(
    makeCiteKey({ fields: { editor: "van Dam, A.", date: "2015-04-01", title: "Towards a Theory" } }, new Set()),
    "dam2015theory",
  );
  assert.equal(
    makeCiteKey({ fields: { author: "{World Health Organization}", year: "2020" } }, new Set()),
    "worldhealthorganization2020",
  );
  assert.equal(makeCiteKey({ fields: {} }, new Set()), "ref");
  assert.equal(makeCiteKey({ fields: {} }, new Set(["ref"])), "refb");
});
