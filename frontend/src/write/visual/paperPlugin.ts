/**
 * Keeps the visual document's numbering live.
 *
 * On every document change (or a settings/bibliography change sent as plugin
 * meta) the analysis runs once and its labels become node decorations: CSS
 * shows section, caption and equation numbers from `data-*` attributes, and
 * the inline node views print citation, cross-reference and footnote labels.
 *
 * A second plugin gives every referenceable node a unique id, including
 * copies made by paste, so cross-references always have a stable target.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { analyzeDoc } from "./analysis.ts";
import type { AnalysisContext, DocAnalysis } from "./analysis.ts";
import { LABELED_TYPES } from "./schema.ts";

export interface PaperPluginState {
  context: AnalysisContext;
  analysis: DocAnalysis;
  decorations: DecorationSet;
}

export const paperPluginKey = new PluginKey<PaperPluginState>("paperAnalysis");

const ID_PREFIX: Record<string, string> = { heading: "sec", figure: "fig", tableFigure: "tab", mathBlock: "eq" };

export function newNodeId(type: string): string {
  return `${ID_PREFIX[type] ?? "node"}-${Math.random().toString(36).slice(2, 8)}`;
}

function build(doc: ProseMirrorNode, context: AnalysisContext): PaperPluginState {
  const analysis = analyzeDoc(doc, context);
  const decorations = DecorationSet.create(
    doc,
    analysis.labels.map((label) => Decoration.node(label.pos, label.pos + label.size, label.attrs, label.spec)),
  );
  return { context, analysis, decorations };
}

export function getAnalysis(state: EditorState): DocAnalysis | null {
  return paperPluginKey.getState(state)?.analysis ?? null;
}

/** Sends new settings or BibTeX to the plugin; the numbering refreshes at once. */
export function updatePaperContext(tr: Transaction, context: Partial<AnalysisContext>): Transaction {
  return tr.setMeta(paperPluginKey, context).setMeta("addToHistory", false);
}

const LABELED = new Set<string>(LABELED_TYPES);

export const PaperAnalysis = Extension.create<{ context: AnalysisContext }>({
  name: "paperAnalysis",

  addOptions() {
    return { context: { theme: "article", numberedHeadings: true, citationStyle: "ieee", bib: "" } };
  },

  addProseMirrorPlugins() {
    const initial = this.options.context;
    return [
      new Plugin<PaperPluginState>({
        key: paperPluginKey,
        state: {
          init: (_config, state) => build(state.doc, initial),
          apply: (tr, value, _oldState, newState) => {
            const meta = tr.getMeta(paperPluginKey) as Partial<AnalysisContext> | undefined;
            if (meta) return build(newState.doc, { ...value.context, ...meta });
            return tr.docChanged ? build(newState.doc, value.context) : value;
          },
        },
        props: {
          decorations: (state) => paperPluginKey.getState(state)?.decorations ?? null,
        },
      }),
      new Plugin({
        key: new PluginKey("paperIds"),
        appendTransaction: (transactions, _oldState, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (!LABELED.has(node.type.name)) return !node.isTextblock;
            const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
            if (id && !seen.has(id)) {
              seen.add(id);
            } else {
              const fresh = newNodeId(node.type.name);
              seen.add(fresh);
              tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
            }
            return node.type.name !== "heading";
          });
          return tr;
        },
      }),
    ];
  },
});
