/**
 * The full extension list of the visual editor: the shared schema plus
 * node views, live numbering, find/replace, placeholders, image paste/drop
 * and the paper-specific keyboard shortcuts.
 */

import { Extension } from "@tiptap/core";
import type { AnyExtension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { baseExtensions } from "./extensions.ts";
import { Bibliography, Citation, CrossRef, Figure, Footnote, MathBlock, MathInline, RawLatex } from "./schema.ts";
import { PaperAnalysis } from "./paperPlugin.ts";
import type { AnalysisContext } from "./analysis.ts";
import { FindReplace } from "./findReplace.ts";
import { BibliographyView, FigureView, LabelView, MathBlockView, MathInlineView, RawLatexView } from "./nodeViews.ts";
import type { PaperViewHooks } from "./nodeViews.ts";

export interface EditorHooks extends PaperViewHooks {
  /** Paper shortcuts that open UI the editor itself does not own. */
  command: (name: "math" | "equation" | "footnote" | "citation" | "link" | "find" | "print" | "save") => void;
  imageFiles: (files: File[], pos: number | null) => void;
}

const VIEWED = new Set(["mathInline", "mathBlock", "citation", "crossRef", "footnote", "figure", "rawLatex", "bibliography"]);

/** Atom nodes that open an editor dialog on double-click or Enter. */
export const EDITABLE_ATOMS = new Set(["mathInline", "mathBlock", "citation", "crossRef", "footnote", "rawLatex"]);

function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith("image/"));
}

export function editorExtensions(context: AnalysisContext, hooks: EditorHooks): AnyExtension[] {
  // The schema nodes again, this time with their interactive views.
  const withViews: AnyExtension[] = [
    ...baseExtensions().filter((extension) => !VIEWED.has(extension.name)),
    MathInline.extend({ addNodeView: () => ({ node }) => new MathInlineView(node) }),
    MathBlock.extend({ addNodeView: () => ({ node }) => new MathBlockView(node) }),
    Citation.extend({ addNodeView: () => ({ node, decorations }) => new LabelView(node, decorations, "span", "paper-cite") }),
    CrossRef.extend({ addNodeView: () => ({ node, decorations }) => new LabelView(node, decorations, "span", "paper-xref") }),
    Footnote.extend({ addNodeView: () => ({ node, decorations }) => new LabelView(node, decorations, "sup", "paper-footnote-ref") }),
    Figure.extend({ addNodeView: () => ({ node, getPos }) => new FigureView(node, getPos, hooks) }),
    RawLatex.extend({ addNodeView: () => ({ node }) => new RawLatexView(node, hooks) }),
    Bibliography.extend({ addNodeView: () => ({ decorations }) => new BibliographyView(decorations) }),
  ];

  const PaperBehaviour = Extension.create({
    name: "paperBehaviour",
    addKeyboardShortcuts() {
      const run = (name: Parameters<EditorHooks["command"]>[0]) => () => {
        hooks.command(name);
        return true;
      };
      return {
        "Mod-Shift-m": run("math"),
        "Mod-Alt-m": run("equation"),
        "Mod-Alt-f": run("footnote"),
        "Mod-Alt-c": run("citation"),
        "Mod-k": run("link"),
        "Mod-f": run("find"),
        "Mod-h": run("find"),
        "Mod-p": run("print"),
        "Mod-s": run("save"),
        Enter: ({ editor }) => {
          const { selection } = editor.state;
          if (selection instanceof NodeSelection && EDITABLE_ATOMS.has(selection.node.type.name)) {
            hooks.edit(selection.from);
            return true;
          }
          return false;
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDoubleClickOn: (_view, _pos, node, nodePos) => {
              if (!EDITABLE_ATOMS.has(node.type.name)) return false;
              hooks.edit(nodePos);
              return true;
            },
            handlePaste: (_view, event) => {
              const files = imageFiles(event.clipboardData);
              if (!files.length) return false;
              // Word, Excel and PowerPoint add a picture of the selection to
              // the clipboard; when there is text, paste the text.
              const data = event.clipboardData;
              if (data && (data.getData("text/html").trim() || data.getData("text/plain").trim())) return false;
              hooks.imageFiles(files, null);
              return true;
            },
            handleDrop: (view, event) => {
              const files = imageFiles(event.dataTransfer);
              if (!files.length) return false;
              event.preventDefault();
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
              hooks.imageFiles(files, pos);
              return true;
            },
          },
        }),
      ];
    },
  });

  return [
    ...withViews,
    PaperAnalysis.configure({ context }),
    FindReplace,
    PaperBehaviour,
    Placeholder.configure({
      includeChildren: true,
      showOnlyCurrent: false,
      placeholder: ({ node, hasAnchor }) => {
        switch (node.type.name) {
          case "paperTitle":
            return "Paper title";
          case "paperAuthors":
            return "Authors and affiliations";
          case "paperKeywords":
            return "keyword, keyword, keyword";
          case "figcaption":
            return "Write a caption";
          case "heading":
            return "Heading";
          case "paragraph":
            return hasAnchor ? "Write, or type $…$ for math and $$ for an equation" : "";
          default:
            return "";
        }
      },
    }),
  ];
}
