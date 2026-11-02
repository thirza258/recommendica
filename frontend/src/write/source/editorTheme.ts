/**
 * Colours for the LaTeX source editor, written entirely as CSS custom
 * properties (the --code-* and core tokens in index.css). Switching
 * `data-theme` on <html> therefore restyles every open editor in place: no
 * EditorState needs reconfiguring, which matters because CodeEditor keeps one
 * state per project file.
 *
 * The editor never declares itself dark, so CodeMirror keeps applying its
 * `&light` base styles; every colour those set is overridden here, at the
 * same or higher specificity (a theme's rules are mounted after the base
 * theme's, so equal specificity is enough).
 */

import { EditorView } from "@codemirror/view";

export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "var(--code-bg)",
  },
  ".cm-content": {
    caretColor: "var(--ink)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ink)",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--border)",
    backgroundColor: "var(--code-gutter-bg)",
    color: "var(--code-gutter-ink)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--code-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--code-active-gutter)",
    color: "var(--ink-muted)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--code-selection-blur)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--code-selection)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--code-selection-match)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--code-search-match)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--code-search-current)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--code-bracket)",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--code-bracket-bad)",
  },
  ".cm-specialChar": {
    color: "var(--code-special-char)",
  },
  ".cm-snippetField": {
    backgroundColor: "var(--code-snippet-field)",
  },

  // Search panel (Mod-F).
  ".cm-panels": {
    backgroundColor: "var(--surface-sunken)",
    color: "var(--ink)",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-textfield": {
    border: "1px solid var(--field-border)",
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  },
  ".cm-button": {
    border: "1px solid var(--border-strong)",
    backgroundColor: "var(--surface)",
    backgroundImage: "none",
    color: "var(--ink)",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--surface-hover)",
  },
  ".cm-button:active": {
    backgroundImage: "none",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    accentColor: "var(--accent)",
  },

  // Autocomplete and other tooltips.
  ".cm-tooltip": {
    border: "1px solid var(--border-strong)",
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
    boxShadow: "var(--shadow-md)",
  },
  ".cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    background: "var(--accent)",
    color: "var(--accent-contrast)",
  },
  ".cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
    background: "var(--ink-subtle)",
  },
});
