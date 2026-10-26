/**
 * Node views for the visual editor, in plain DOM rather than React: a paper
 * can hold hundreds of equations and citations, and a React portal per node
 * would make every keystroke heavier. Each view re-renders only when its own
 * node, or the label decoration from the analysis plugin, changes.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Decoration, NodeView } from "@tiptap/pm/view";
import { renderLatex, renderMath } from "../latex/render.ts";
import { safeImageSource } from "./schema.ts";
import { wrapMultiline } from "./toLatex.ts";

export interface PaperViewHooks {
  /** Opens the editor dialog for the atom node at `pos`. */
  edit: (pos: number) => void;
  /** Lets the user choose an image for the figure at `pos`. */
  pickImage: (pos: number) => void;
  /** The document's BibTeX, for citations inside raw LaTeX blocks. */
  getBib: () => string;
}

interface LabelSpec {
  paperLabel?: string;
  missing?: boolean;
  html?: string;
}

function labelFrom(decorations: readonly Decoration[]): LabelSpec | null {
  for (const decoration of decorations) {
    const spec = decoration.spec as LabelSpec | undefined;
    if (spec && typeof spec.paperLabel === "string") return spec;
  }
  return null;
}

function mathHtml(latex: string, display: boolean): { html: string; error: string | null } {
  return renderMath(display ? wrapMultiline(latex) : latex, display);
}

export class MathInlineView implements NodeView {
  dom: HTMLElement;
  private latex: string | null = null;

  constructor(node: ProseMirrorNode) {
    this.dom = document.createElement("span");
    this.dom.className = "paper-math-inline";
    this.dom.dataset.type = "math-inline";
    this.render(node);
  }

  private render(node: ProseMirrorNode) {
    const latex = String(node.attrs.latex ?? "");
    if (latex === this.latex) return;
    this.latex = latex;
    this.dom.dataset.latex = latex;
    if (!latex.trim()) {
      this.dom.innerHTML = '<span class="paper-math-empty">math</span>';
      return;
    }
    const { html, error } = mathHtml(latex, false);
    this.dom.classList.toggle("ltx-math-error", Boolean(error));
    this.dom.title = error ?? latex;
    if (error) this.dom.textContent = latex;
    else this.dom.innerHTML = html;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "mathInline") return false;
    this.render(node);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export class MathBlockView implements NodeView {
  dom: HTMLElement;
  private readonly body: HTMLElement;
  private latex: string | null = null;

  constructor(node: ProseMirrorNode) {
    this.dom = document.createElement("div");
    this.dom.className = "paper-equation";
    this.dom.dataset.type = "math-block";
    this.body = document.createElement("div");
    this.body.className = "paper-equation-body";
    this.dom.append(this.body);
    this.render(node);
  }

  private render(node: ProseMirrorNode) {
    this.dom.dataset.numbered = node.attrs.numbered === false ? "false" : "true";
    const latex = String(node.attrs.latex ?? "");
    if (latex === this.latex) return;
    this.latex = latex;
    if (!latex.trim()) {
      this.body.innerHTML = '<span class="paper-equation-empty">Empty equation — double-click to write it</span>';
      return;
    }
    const { html, error } = mathHtml(latex, true);
    this.dom.title = error ?? "";
    if (error) {
      this.body.className = "paper-equation-body ltx-math-error";
      this.body.textContent = latex;
    } else {
      this.body.className = "paper-equation-body";
      this.body.innerHTML = html;
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "mathBlock") return false;
    this.render(node);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** Citations, cross-references and footnote marks: text comes from the analysis. */
export class LabelView implements NodeView {
  dom: HTMLElement;
  private readonly typeName: string;

  constructor(node: ProseMirrorNode, decorations: readonly Decoration[], tag: string, className: string) {
    this.typeName = node.type.name;
    this.dom = document.createElement(tag);
    this.dom.className = className;
    this.apply(node, decorations);
  }

  private apply(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    const spec = labelFrom(decorations);
    const label = spec?.paperLabel ?? (this.typeName === "footnote" ? "*" : "[?]");
    if (this.dom.textContent !== label) this.dom.textContent = label;
    if (this.typeName === "citation") {
      this.dom.title = `Citation: ${(Array.isArray(node.attrs.keys) ? node.attrs.keys : []).join(", ")}`;
    } else if (this.typeName === "footnote") {
      this.dom.title = String(node.attrs.text ?? "");
    } else {
      this.dom.title = spec?.missing ? "This reference points to something that was deleted" : "Cross-reference";
    }
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]): boolean {
    if (node.type.name !== this.typeName) return false;
    this.apply(node, decorations);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export class FigureView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private readonly media: HTMLElement;
  private image: HTMLImageElement | null = null;
  private upload: HTMLButtonElement | null = null;

  constructor(node: ProseMirrorNode, getPos: () => number | undefined, hooks: PaperViewHooks) {
    this.dom = document.createElement("figure");
    this.dom.className = "paper-figure";
    this.media = document.createElement("div");
    this.media.className = "paper-figure-media";
    this.media.contentEditable = "false";
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "paper-figure-caption";
    this.dom.append(this.media, this.contentDOM);
    this.render(node, () => {
      const pos = getPos();
      if (typeof pos === "number") hooks.pickImage(pos);
    });
  }

  private pick: (() => void) | null = null;

  private render(node: ProseMirrorNode, pick?: () => void) {
    if (pick) this.pick = pick;
    const src = safeImageSource(node.attrs.src);
    const width = Math.min(Math.max(Number(node.attrs.width) || 80, 10), 100);
    if (src) {
      this.upload?.remove();
      this.upload = null;
      if (!this.image) {
        this.image = document.createElement("img");
        this.image.draggable = false;
        this.media.append(this.image);
      }
      if (this.image.getAttribute("src") !== src) this.image.src = src;
      this.image.alt = String(node.attrs.alt ?? "");
      this.image.style.width = `${width}%`;
    } else {
      this.image?.remove();
      this.image = null;
      if (!this.upload) {
        this.upload = document.createElement("button");
        this.upload.type = "button";
        this.upload.className = "paper-figure-upload";
        this.upload.textContent = "Add an image — click, drop or paste a PNG, JPEG or SVG";
        this.upload.addEventListener("click", () => this.pick?.());
        this.media.append(this.upload);
      }
      this.upload.style.width = `${width}%`;
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "figure") return false;
    this.render(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return Boolean(this.upload && event.target instanceof Node && this.upload.contains(event.target));
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

export class RawLatexView implements NodeView {
  dom: HTMLElement;
  private source: string | null = null;
  private readonly hooks: PaperViewHooks;

  constructor(node: ProseMirrorNode, hooks: PaperViewHooks) {
    this.hooks = hooks;
    this.dom = document.createElement("div");
    this.dom.className = "paper-raw-latex";
    this.dom.dataset.type = "raw-latex";
    this.render(node);
  }

  private render(node: ProseMirrorNode) {
    const source = String(node.attrs.source ?? "");
    if (source === this.source) return;
    this.source = source;
    if (!source.trim()) {
      this.dom.innerHTML = '<p class="paper-equation-empty">Empty LaTeX block — double-click to edit</p>';
      return;
    }
    const result = renderLatex(source, { bibliography: this.hooks.getBib(), idPrefix: "raw-" });
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    this.dom.title = errors ? `${errors} LaTeX ${errors === 1 ? "error" : "errors"}; double-click to edit` : "LaTeX block; double-click to edit";
    this.dom.innerHTML = result.html;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "rawLatex") return false;
    this.render(node);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(event: Event): boolean {
    // Links inside the rendered block must not navigate the app.
    if (event.type === "click" && event.target instanceof Element && event.target.closest("a")) {
      event.preventDefault();
    }
    return false;
  }
}

const EMPTY_REFERENCES =
  '<h2 class="paper-heading paper-references-title">References</h2><p class="paper-references-empty">Cite a source and it will be listed here.</p>';

export class BibliographyView implements NodeView {
  dom: HTMLElement;
  private html = "";

  constructor(decorations: readonly Decoration[]) {
    this.dom = document.createElement("section");
    this.dom.className = "paper-references";
    this.dom.dataset.type = "bibliography";
    this.apply(decorations);
  }

  private apply(decorations: readonly Decoration[]) {
    const html = labelFrom(decorations)?.html ?? EMPTY_REFERENCES;
    if (html !== this.html) {
      this.html = html;
      this.dom.innerHTML = html;
    }
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]): boolean {
    if (node.type.name !== "bibliography") return false;
    this.apply(decorations);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(event: Event): boolean {
    if (event.type === "click" && event.target instanceof Element && event.target.closest("a")) event.preventDefault();
    return false;
  }
}
