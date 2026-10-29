import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { Ref } from "react";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippet, startCompletion } from "@codemirror/autocomplete";
import { bibtexLanguage, latexCompletions, latexHighlight, latexLanguage } from "./latexLanguage";
import type { ProjectCompletions } from "./latexLanguage";

export interface CodeEditorHandle {
  /** Current text of a file, whether or not it has been opened. */
  getText: (name: string) => string;
  insertSnippet: (template: string) => void;
  goToLine: (line: number, name?: string) => void;
  openSearch: () => void;
  toggleComment: () => void;
  complete: () => void;
  focus: () => void;
  forget: (name: string) => void;
}

interface CodeEditorProps {
  file: string;
  initialText: (name: string) => string;
  onChange: (name: string) => void;
  onCursorLine?: (line: number) => void;
  onSave?: () => void;
  completions: ProjectCompletions;
  handleRef: Ref<CodeEditorHandle>;
  label: string;
  /** Prevent edits while the project is being converted to another editor. */
  readOnly?: boolean;
}

/**
 * CodeMirror 6 with one EditorState per project file, so each file keeps its
 * own undo history and selection when you switch between them. The editor
 * reports *that* a file changed, not its text: the text is read only when
 * the preview or a save needs it, which keeps keystrokes cheap.
 */
export default function CodeEditor({ file, initialText, onChange, onCursorLine, onSave, completions, handleRef, label, readOnly = false }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const activeFile = useRef(file);
  const callbacks = useRef({ onChange, onCursorLine, onSave, completions, initialText, readOnly });
  const editable = useMemo(() => new Compartment(), []);

  useEffect(() => {
    callbacks.current = { onChange, onCursorLine, onSave, completions, initialText, readOnly };
  });

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [editable, readOnly]);

  const createState = (name: string, text: string): EditorState => {
    const language: Extension = name.toLowerCase().endsWith(".bib") ? bibtexLanguage : latexLanguage;
    const project: ProjectCompletions = {
      citationKeys: () => callbacks.current.completions.citationKeys(),
      labels: () => callbacks.current.completions.labels(),
      files: () => callbacks.current.completions.files(),
    };
    return EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        editable.of(EditorView.editable.of(!callbacks.current.readOnly)),
        language,
        latexHighlight,
        autocompletion({ override: name.toLowerCase().endsWith(".bib") ? [] : [latexCompletions(project)], icons: false }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              callbacks.current.onSave?.();
              return true;
            },
          },
          { key: "Mod-Enter", run: () => (callbacks.current.onSave?.(), true) },
          { key: "Mod-/", run: toggleComment },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ "aria-label": `${label}: ${name}`, spellcheck: "true" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(activeFile.current);
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            callbacks.current.onCursorLine?.(line);
          }
        }),
      ],
    });
  };

  const stateFor = (name: string): EditorState => {
    const view = viewRef.current;
    if (view && activeFile.current === name) return view.state;
    let state = states.current.get(name);
    if (!state) {
      state = createState(name, callbacks.current.initialText(name));
      states.current.set(name, state);
    }
    return state;
  };

  // Create the view once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const saved = states.current;
    const view = new EditorView({ state: stateFor(activeFile.current), parent: host });
    viewRef.current = view;
    return () => {
      saved.set(activeFile.current, view.state);
      view.destroy();
      viewRef.current = null;
    };
    // stateFor reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch files by swapping states.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || activeFile.current === file) return;
    states.current.set(activeFile.current, view.state);
    activeFile.current = file;
    view.setState(stateFor(file));
    // Saved states keep the editability they had when they were left, so a
    // file opened during a conversion must be locked again explicitly.
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!callbacks.current.readOnly)) });
    view.focus();
    // stateFor reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useImperativeHandle(
    handleRef,
    () => ({
      getText: (name: string) => {
        const view = viewRef.current;
        if (view && activeFile.current === name) return view.state.doc.toString();
        const state = states.current.get(name);
        return state ? state.doc.toString() : callbacks.current.initialText(name);
      },
      insertSnippet: (template: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const raw = view.state.sliceDoc(from, to);
        // A one-line selection becomes the first field; a multi-line one is kept as text.
        const escaped = raw.replace(/[{}]/g, (brace) => `\\${brace}`);
        const filler = !raw ? "${}" : raw.includes("\n") ? escaped : `\${${escaped}}`;
        snippet(template.replace("${selection}", () => filler))(view, null, from, to);
        view.focus();
      },
      goToLine: (line: number, name?: string) => {
        const view = viewRef.current;
        if (!view || (name && name !== activeFile.current)) return;
        const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({
          selection: EditorSelection.cursor(target.from),
          effects: EditorView.scrollIntoView(target.from, { y: "center" }),
        });
        view.focus();
      },
      openSearch: () => {
        if (viewRef.current) openSearchPanel(viewRef.current);
      },
      toggleComment: () => {
        if (viewRef.current) toggleComment(viewRef.current);
      },
      complete: () => {
        if (viewRef.current) startCompletion(viewRef.current);
      },
      focus: () => viewRef.current?.focus(),
      forget: (name: string) => {
        states.current.delete(name);
      },
    }),
    [],
  );

  return <div ref={hostRef} className="write-source-editor" />;
}
