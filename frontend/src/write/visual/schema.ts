/**
 * Paper-specific document nodes for the visual editor.
 *
 * Schema only: no DOM work and no React, so the serializer tests can build
 * documents in Node. Interactive node views are attached in nodeViews.ts.
 *
 * Numbers (sections, figures, tables, equations, footnotes) and citation and
 * cross-reference labels are not stored; the analysis plugin computes them
 * from document order, so moving or deleting anything renumbers everything.
 */

import { Extension, InputRule, Node, mergeAttributes } from "@tiptap/core";
import { isImageSource } from "../assetSource.ts";

/** Node types that can be the target of a cross-reference. */
export const LABELED_TYPES = ["heading", "figure", "tableFigure", "mathBlock"] as const;

const idAttribute = {
  default: "",
  parseHTML: (element: HTMLElement) => element.getAttribute("data-id") ?? "",
  renderHTML: (attributes: Record<string, unknown>) => (attributes.id ? { "data-id": String(attributes.id) } : {}),
};

/**
 * The LaTeX label a node was imported with, written back exactly while the
 * node keeps the id it got for it. Never copied: a pasted copy is a new node.
 */
const labelAttribute = {
  default: "",
  parseHTML: () => "",
  renderHTML: () => ({}),
};

/** A string attribute carried through copy and paste as `data-<name>`. */
function dataAttribute(name: string) {
  return {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? "",
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())];
      return value ? { [`data-${name}`]: String(value) } : {};
    },
  };
}

/** A true/false attribute carried as `data-<name>="true"`. */
function flagAttribute(name: string) {
  return {
    default: false,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) === "true",
    renderHTML: (attributes: Record<string, unknown>) => (attributes[name] ? { [`data-${name}`]: "true" } : {}),
  };
}

/** Images may come from an upload (data: or the asset API) or a pasted https URL. */
export function safeImageSource(value: unknown): string {
  const source = typeof value === "string" ? value.trim() : "";
  return isImageSource(source) ? source : "";
}

export const PaperHeadingAttributes = Extension.create({
  name: "paperHeadingAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          numbered: {
            default: true,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-numbered") !== "false",
            renderHTML: (attributes: Record<string, unknown>) => ({
              "data-numbered": attributes.numbered === false ? "false" : "true",
              class: `paper-heading paper-h${String(attributes.level ?? 1)}`,
            }),
          },
          id: idAttribute,
          label: labelAttribute,
        },
      },
    ];
  },
});

/**
 * What a table or list had in LaTeX beyond what the visual editor shows: a
 * tabular's column spec and rules, a description list, enumitem options.
 * The exporter writes them back while they still fit the table or list.
 */
export const LatexAttributes = Extension.create({
  name: "latexAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          latexSpec: dataAttribute("latex-spec"),
          latexRules: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              try {
                const value: unknown = JSON.parse(element.getAttribute("data-latex-rules") ?? "null");
                return Array.isArray(value) && value.every((rule) => typeof rule === "string") ? value : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attributes: Record<string, unknown>) => (Array.isArray(attributes.latexRules) ? { "data-latex-rules": JSON.stringify(attributes.latexRules) } : {}),
          },
        },
      },
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          latexEnv: dataAttribute("latex-env"),
          latexOptions: dataAttribute("latex-options"),
        },
      },
    ];
  },
});

export const PaperTitle = Node.create({
  name: "paperTitle",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "h1.paper-title", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["h1", mergeAttributes(HTMLAttributes, { class: "paper-title" }), 0];
  },
});

export const PaperAuthors = Node.create({
  name: "paperAuthors",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p.paper-authors", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, { class: "paper-authors" }), 0];
  },
});

export const PaperAbstract = Node.create({
  name: "paperAbstract",
  group: "block",
  content: "paragraph+",
  defining: true,
  parseHTML() {
    return [{ tag: "section.paper-abstract", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes, { class: "paper-abstract", "data-label": "Abstract" }), 0];
  },
});

export const PaperKeywords = Node.create({
  name: "paperKeywords",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p.paper-keywords", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, { class: "paper-keywords" }), 0];
  },
});

/** `$x^2$` typed in text becomes inline math. Prices such as "$5 and $10" do not. */
export const INLINE_MATH_PATTERN = /(?:^|[^\\$\w])\$([^$\s](?:[^$]*?[^$\s\\])?)\$$/;

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-latex": String(attributes.latex ?? "") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "math-inline", class: "paper-math-inline" }), `$${node.attrs.latex}$`];
  },
  renderText({ node }) {
    return `$${node.attrs.latex}$`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: INLINE_MATH_PATTERN,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const start = range.from + match[0].indexOf("$");
          state.tr.replaceWith(start, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-latex": String(attributes.latex ?? "") }),
      },
      numbered: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-numbered") !== "false",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-numbered": attributes.numbered === false ? "false" : "true" }),
      },
      id: idAttribute,
      label: labelAttribute,
      // A multi-line environment (align, gather, …) kept from LaTeX; `latex`
      // is then its body, rows and labels included.
      env: dataAttribute("env"),
      envArg: dataAttribute("env-arg"),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "math-block", class: "paper-equation" }), `$$${node.attrs.latex}$$`];
  },
  renderText({ node }) {
    return `$$${node.attrs.latex}$$`;
  },
  addInputRules() {
    // "$$" followed by a space at the start of an empty paragraph.
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph" || $from.parent.textContent.trim() !== "$$") return null;
          const start = $from.before();
          const end = $from.after();
          state.tr.replaceWith(start, end, this.type.create({ latex: "" }));
        },
      }),
    ];
  },
});

export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      keys: {
        default: [] as string[],
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute("data-keys") ?? "")
            .split(",")
            .map((key) => key.trim())
            .filter(Boolean),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-keys": Array.isArray(attributes.keys) ? attributes.keys.join(",") : "",
        }),
      },
      // natbib's command (citet, citeauthor, …) and the notes of a citation
      // written in LaTeX; empty for the paper's own citation style.
      command: dataAttribute("command"),
      pre: dataAttribute("pre"),
      post: dataAttribute("post"),
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="citation"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "citation", class: "paper-cite" })];
  },
  renderText({ node }) {
    return `[${(node.attrs.keys as string[]).join(", ")}]`;
  },
});

export const CrossRef = Node.create({
  name: "crossRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-target") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-target": String(attributes.target ?? "") }),
      },
      // The command a reference was written with in LaTeX (\eqref, \cref,
      // \nameref, …); empty for the visual editor's "Section 2" form.
      command: dataAttribute("command"),
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="cross-ref"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "cross-ref", class: "paper-xref" })];
  },
});

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-text") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-text": String(attributes.text ?? "") }),
      },
      // The footnote's LaTeX when it holds more than plain text (math,
      // citations, formatting); `text` is then what the editor shows.
      latex: dataAttribute("latex"),
    };
  },
  parseHTML() {
    return [{ tag: 'sup[data-type="footnote"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { "data-type": "footnote", class: "paper-footnote-ref" })];
  },
});

export const Figcaption = Node.create({
  name: "figcaption",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "figcaption" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figcaption", mergeAttributes(HTMLAttributes, { class: "paper-caption" }), 0];
  },
});

export const Figure = Node.create({
  name: "figure",
  group: "block",
  content: "figcaption",
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => safeImageSource((element.tagName === "IMG" ? element : element.querySelector("img"))?.getAttribute("src")),
        renderHTML: () => ({}),
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) => (element.tagName === "IMG" ? element : element.querySelector("img"))?.getAttribute("alt") ?? "",
        renderHTML: () => ({}),
      },
      width: {
        default: 80,
        parseHTML: (element: HTMLElement) => {
          const value = Number.parseInt(element.getAttribute("data-width") ?? "", 10);
          return Number.isFinite(value) ? Math.min(Math.max(value, 10), 100) : 80;
        },
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-width": String(attributes.width ?? 80) }),
      },
      id: idAttribute,
      label: labelAttribute,
      // The file a LaTeX source includes when the project has no such image yet.
      path: dataAttribute("path"),
      // figure* (across both columns).
      wide: flagAttribute("wide"),
    };
  },
  parseHTML() {
    return [{ tag: "figure.paper-figure" }, { tag: "img[src]", priority: 40 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const src = safeImageSource(node.attrs.src);
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { class: "paper-figure" }),
      ["img", { src, alt: node.attrs.alt, style: `width:${node.attrs.width}%` }],
      ["div", { class: "paper-figure-caption" }, 0],
    ];
  },
});

export const TableFigure = Node.create({
  name: "tableFigure",
  group: "block",
  content: "figcaption table",
  isolating: true,
  addAttributes() {
    return { id: idAttribute, label: labelAttribute, wide: flagAttribute("wide") };
  },
  parseHTML() {
    return [{ tag: "figure.paper-table-figure" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { class: "paper-table-figure" }), 0];
  },
});

/** LaTeX the visual model has no node for, kept verbatim and previewed. */
export const RawLatex = Node.create({
  name: "rawLatex",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-source") ?? element.textContent ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-source": String(attributes.source ?? "") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="raw-latex"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "raw-latex", class: "paper-raw-latex" }), ["pre", {}, node.attrs.source]];
  },
});

/**
 * LaTeX inside a paragraph that the visual model has no node for (a user
 * macro, \SI{5}{\meter}, a \label), kept verbatim and previewed.
 */
export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-source") ?? element.textContent ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-source": String(attributes.source ?? "") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="raw-inline"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "raw-inline", class: "paper-raw-inline" }), String(node.attrs.source ?? "")];
  },
  renderText({ node }) {
    return String(node.attrs.source ?? "");
  },
});

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "page-break", class: "paper-pagebreak" })];
  },
});

/** The reference list: generated from the cited entries of the document's BibTeX. */
export const Bibliography = Node.create({
  name: "bibliography",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'section[data-type="bibliography"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes, { "data-type": "bibliography", class: "paper-references" })];
  },
});

export const PAPER_NODES = [
  PaperHeadingAttributes,
  PaperTitle,
  PaperAuthors,
  PaperAbstract,
  PaperKeywords,
  MathInline,
  MathBlock,
  Citation,
  CrossRef,
  Footnote,
  Figcaption,
  Figure,
  TableFigure,
  RawLatex,
  RawInline,
  PageBreak,
  Bibliography,
  LatexAttributes,
];
