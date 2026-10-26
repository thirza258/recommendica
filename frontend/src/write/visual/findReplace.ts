/**
 * Find and replace for the visual editor: highlights every match, steps
 * through them, and replaces one or all in a single undoable step.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: { from: number; to: number }[];
  current: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>("findReplace");

const MAX_MATCHES = 2000;

function findMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    // Atoms count as one placeholder character, so offsets map to positions.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    const haystack = caseSensitive ? text : text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1 && matches.length < MAX_MATCHES) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length });
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return false;
  });
  return matches;
}

function build(doc: ProseMirrorNode, query: string, caseSensitive: boolean, current: number): FindState {
  const matches = findMatches(doc, query, caseSensitive);
  const index = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, i) => Decoration.inline(match.from, match.to, { class: i === index ? "find-match find-match--current" : "find-match" })),
  );
  return { query, caseSensitive, matches, current: index, decorations };
}

const EMPTY: FindState = { query: "", caseSensitive: false, matches: [], current: -1, decorations: DecorationSet.empty };

export function getFindState(state: EditorState): FindState {
  return findKey.getState(state) ?? EMPTY;
}

export function setFind(view: EditorView, query: string, caseSensitive: boolean): void {
  view.dispatch(view.state.tr.setMeta(findKey, { query, caseSensitive, current: 0 }));
}

export function stepFind(view: EditorView, delta: number): void {
  const state = getFindState(view.state);
  if (!state.matches.length) return;
  const current = (state.current + delta + state.matches.length) % state.matches.length;
  const match = state.matches[current];
  const tr = view.state.tr.setMeta(findKey, { current }).setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView();
  view.dispatch(tr);
}

export function replaceCurrent(view: EditorView, replacement: string): void {
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  if (!match) return;
  const tr = view.state.tr;
  if (replacement) tr.insertText(replacement, match.from, match.to);
  else tr.delete(match.from, match.to);
  tr.setMeta(findKey, { current: state.current });
  view.dispatch(tr);
}

export function replaceAll(view: EditorView, replacement: string): number {
  const state = getFindState(view.state);
  if (!state.matches.length) return 0;
  const tr: Transaction = view.state.tr;
  for (const match of [...state.matches].reverse()) {
    if (replacement) tr.insertText(replacement, match.from, match.to);
    else tr.delete(match.from, match.to);
  }
  view.dispatch(tr);
  return state.matches.length;
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value, _old, newState) => {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (meta) {
              return build(newState.doc, meta.query ?? value.query, meta.caseSensitive ?? value.caseSensitive, meta.current ?? value.current);
            }
            if (tr.docChanged && value.query) return build(newState.doc, value.query, value.caseSensitive, value.current);
            return value;
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
