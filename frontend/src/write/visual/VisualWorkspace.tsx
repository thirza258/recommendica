import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import WorkspaceHeader from "../WorkspaceHeader";
import { Icon } from "../icons";
import { Dialog, MenuBar, MenuButton, ToolButton, ToolSeparator } from "../ui";
import { useOutsideClose } from "../useOutsideClose.ts";
import type { MenuEntry } from "../ui";
import { BIB_FILE, DEFAULT_SETTINGS, fileBaseName, plainText } from "../documents.ts";
import type { DocumentKind, PaperDocument, PaperSettings } from "../documents.ts";
import type { DocumentStore } from "../storage.ts";
import { useAutosave } from "../useAutosave.ts";
import { lookFromSettings, paperClassName, paperStyle } from "../paperStyle.ts";
import { readImageFile, toLatexImage } from "../images.ts";
import { shortcut } from "../keys.ts";
import { editorExtensions, EDITABLE_ATOMS } from "./editorExtensions.ts";
import type { EditorHooks } from "./editorExtensions.ts";
import { getAnalysis, updatePaperContext } from "./paperPlugin.ts";
import { getFindState, replaceAll, replaceCurrent, setFind, stepFind } from "./findReplace.ts";
import { documentToLatex } from "./toLatex.ts";
import { bibEntries } from "./analysis.ts";
import ReferencesPanel from "./ReferencesPanel";
import { CitationDialog, CrossRefDialog, MathDialog, PageSetupDialog, RawLatexDialog, TextDialog } from "./dialogs";

interface VisualWorkspaceProps {
  initial: PaperDocument;
  store: DocumentStore;
  onSwitchMode: (current: PaperDocument, kind: DocumentKind) => Promise<void>;
  initialNotice?: string;
}

type DialogState =
  | { kind: "math"; display: boolean; pos: number | null; latex: string; numbered: boolean; range?: { from: number; to: number } }
  | { kind: "citation"; pos: number | null; keys: string[] }
  | { kind: "crossRef"; pos: number | null; target: string }
  | { kind: "footnote"; pos: number | null; text: string }
  | { kind: "link"; url: string }
  | { kind: "rawLatex"; pos: number | null; source: string }
  | { kind: "alt"; pos: number; alt: string }
  | { kind: "pageSetup" }
  | { kind: "latexSource"; tex: string }
  | { kind: "wordCount" }
  | { kind: "shortcuts" };

const TEXT_COLORS: [string, string][] = [
  ["Black", "#111827"],
  ["Dark gray", "#4b5563"],
  ["Red", "#b91c1c"],
  ["Orange", "#c2410c"],
  ["Green", "#15803d"],
  ["Blue", "#1d4ed8"],
  ["Purple", "#7e22ce"],
];

const HIGHLIGHTS: [string, string][] = [
  ["Yellow", "#fff59d"],
  ["Green", "#c8f7c5"],
  ["Blue", "#cfe8ff"],
  ["Pink", "#fbd3e9"],
  ["Orange", "#ffe0b2"],
];

const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];
const SHEET_WIDTH_PX = { a4: 793.7, letter: 816 };

function tableJson(rows: number, columns: number): JSONContent {
  return {
    type: "tableFigure",
    attrs: { id: "" },
    content: [
      { type: "figcaption" },
      {
        type: "table",
        content: Array.from({ length: rows }, (_, row) => ({
          type: "tableRow",
          content: Array.from({ length: columns }, () => ({
            type: row === 0 ? "tableHeader" : "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph" }],
          })),
        })),
      },
    ],
  };
}

/** The innermost ancestor of the selection with this node type, if any. */
function ancestor(editor: Editor, name: string): { pos: number; depth: number } | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === name) return { pos: selection.from, depth: selection.$from.depth + 1 };
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === name) return { pos: $from.before(depth), depth };
  }
  return null;
}

function blockLabel(editor: Editor): string {
  if (editor.isActive("paperTitle")) return "Title";
  if (editor.isActive("paperAuthors")) return "Authors";
  if (editor.isActive("paperKeywords")) return "Keywords";
  for (const level of [1, 2, 3, 4]) if (editor.isActive("heading", { level })) return `Heading ${level}`;
  if (editor.isActive("codeBlock")) return "Code";
  if (editor.isActive("blockquote")) return "Quote";
  if (editor.isActive("figcaption")) return "Caption";
  return "Normal text";
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarProps {
  editor: Editor;
  run: Record<string, () => void>;
  onInsert: (json: JSONContent) => void;
  zoomLabel: string;
  zoomItems: MenuEntry[];
  showOutline: boolean;
  onToggleOutline: () => void;
}

function TableGridPicker({ onPick }: { onPick: (rows: number, columns: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<[number, number]>([2, 3]);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, close, ref);
  return (
    <div ref={ref} className="write-menubutton">
      <button
        type="button"
        className="write-tool"
        aria-label="Insert table"
        title="Insert table"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        <Icon name="table" />
      </button>
      {open && (
        <div className="write-popover" role="dialog" aria-label="Table size" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
          <div className="write-grid-picker">
            {Array.from({ length: 6 }, (_, row) =>
              Array.from({ length: 8 }, (_, column) => (
                <button
                  key={`${row}-${column}`}
                  type="button"
                  aria-label={`${row + 1} by ${column + 1} table`}
                  className={row <= hover[0] && column <= hover[1] ? "is-active" : ""}
                  onMouseEnter={() => setHover([row, column])}
                  onFocus={() => setHover([row, column])}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    onPick(row + 1, column + 1);
                  }}
                />
              )),
            )}
          </div>
          <div className="write-grid-label">
            {hover[0] + 1} × {hover[1] + 1} table with a header row
          </div>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, run, onInsert, zoomLabel, zoomItems, showOutline, onToggleOutline }: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      block: blockLabel(current),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      superscript: current.isActive("superscript"),
      subscript: current.isActive("subscript"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      align: (["center", "right", "left"] as const).find((align) => current.isActive({ textAlign: align })) ?? "justify",
      color: (current.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: current.isActive("highlight"),
    }),
  });

  const chain = () => editor.chain().focus();
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled), :scope > .write-menubutton > button"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  const alignIcon = state.align === "center" ? "alignCenter" : state.align === "right" ? "alignRight" : state.align === "left" ? "alignLeft" : "alignJustify";

  return (
    <div className="write-toolbar" role="toolbar" aria-label="Formatting" onKeyDown={onKeyDown}>
      <ToolButton icon="panelLeft" label="Outline" active={showOutline} onClick={onToggleOutline} />
      <ToolButton icon="undo" label="Undo" shortcut={shortcut("Mod+Z")} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <ToolButton icon="redo" label="Redo" shortcut={shortcut("Mod+Shift+Z")} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      <ToolButton icon="print" label="Print or save as PDF" shortcut={shortcut("Mod+P")} onClick={run.print} />
      <MenuButton label={`Zoom ${zoomLabel}`} items={zoomItems}>
        <span>{zoomLabel}</span>
      </MenuButton>
      <ToolSeparator />
      <MenuButton
        label={`Paragraph style: ${state.block}`}
        className="write-tool--text"
        items={[
          { label: "Normal text", checked: state.block === "Normal text", onSelect: () => chain().setParagraph().run(), shortcut: shortcut("Mod+Alt+0") },
          { label: "Title", checked: state.block === "Title", onSelect: () => chain().setNode("paperTitle").run() },
          { label: "Authors", checked: state.block === "Authors", onSelect: () => chain().setNode("paperAuthors").run() },
          ...[1, 2, 3, 4].map((level) => ({
            label: `Heading ${level}`,
            checked: state.block === `Heading ${level}`,
            shortcut: shortcut(`Mod+Alt+${level}`),
            onSelect: () => chain().setHeading({ level: level as 1 | 2 | 3 | 4 }).run(),
          })),
          { label: "Keywords", checked: state.block === "Keywords", onSelect: () => chain().setNode("paperKeywords").run() },
          "separator",
          { label: "Quote", checked: state.block === "Quote", onSelect: () => chain().toggleBlockquote().run() },
          { label: "Code", checked: state.block === "Code", onSelect: () => chain().toggleCodeBlock().run() },
        ]}
      >
        <span>{state.block}</span>
      </MenuButton>
      <ToolSeparator />
      <ToolButton icon="bold" label="Bold" shortcut={shortcut("Mod+B")} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton icon="italic" label="Italic" shortcut={shortcut("Mod+I")} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton icon="underline" label="Underline" shortcut={shortcut("Mod+U")} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <ToolButton icon="strike" label="Strikethrough" shortcut={shortcut("Mod+Shift+S")} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <MenuButton
        label="Text colour"
        items={[
          ...TEXT_COLORS.map(([name, value]) => ({ label: name, swatch: value, checked: state.color === value, onSelect: () => chain().setColor(value).run() })),
          "separator" as const,
          { label: "Default colour", onSelect: () => chain().unsetColor().run() },
        ]}
      >
        <span className="write-tool-stack">
          <Icon name="textColor" />
          <span className="write-color-dot" style={{ background: state.color ?? "#111827" }} />
        </span>
      </MenuButton>
      <MenuButton
        label="Highlight"
        items={[
          ...HIGHLIGHTS.map(([name, value]) => ({ label: name, swatch: value, onSelect: () => chain().setHighlight({ color: value }).run() })),
          "separator" as const,
          { label: "No highlight", onSelect: () => chain().unsetHighlight().run() },
        ]}
      >
        <Icon name="highlight" />
      </MenuButton>
      <ToolButton icon="link" label="Link" shortcut={shortcut("Mod+K")} active={state.link} onClick={run.link} />
      <ToolButton icon="superscript" label="Superscript" shortcut={shortcut("Mod+.")} active={state.superscript} onClick={() => chain().toggleSuperscript().run()} />
      <ToolButton icon="subscript" label="Subscript" shortcut={shortcut("Mod+,")} active={state.subscript} onClick={() => chain().toggleSubscript().run()} />
      <ToolSeparator />
      <ToolButton icon="sigma" label="Inline math" shortcut={shortcut("Mod+Shift+M")} onClick={run.math} />
      <ToolButton icon="displayMath" label="Equation" shortcut={shortcut("Mod+Alt+M")} onClick={run.equation} />
      <ToolButton icon="citation" label="Cite" shortcut={shortcut("Mod+Alt+C")} onClick={run.citation} />
      <ToolButton icon="crossRef" label="Cross-reference" onClick={run.crossRef} />
      <ToolButton icon="footnote" label="Footnote" shortcut={shortcut("Mod+Alt+F")} onClick={run.footnote} />
      <ToolButton icon="image" label="Figure" onClick={run.figure} />
      <TableGridPicker onPick={(rows, columns) => onInsert(tableJson(rows, columns))} />
      <ToolSeparator />
      <MenuButton
        label="Align"
        items={[
          { label: "Left", icon: "alignLeft", checked: state.align === "left", onSelect: () => chain().setTextAlign("left").run(), shortcut: shortcut("Mod+Shift+L") },
          { label: "Center", icon: "alignCenter", checked: state.align === "center", onSelect: () => chain().setTextAlign("center").run(), shortcut: shortcut("Mod+Shift+E") },
          { label: "Right", icon: "alignRight", checked: state.align === "right", onSelect: () => chain().setTextAlign("right").run(), shortcut: shortcut("Mod+Shift+R") },
          { label: "Justify (paper default)", icon: "alignJustify", checked: state.align === "justify", onSelect: () => chain().unsetTextAlign().run(), shortcut: shortcut("Mod+Shift+J") },
        ]}
      >
        <Icon name={alignIcon} />
      </MenuButton>
      <ToolButton icon="bulletList" label="Bulleted list" shortcut={shortcut("Mod+Shift+8")} active={state.bulletList} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton icon="orderedList" label="Numbered list" shortcut={shortcut("Mod+Shift+7")} active={state.orderedList} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton icon="outdent" label="Decrease indent" onClick={() => chain().liftListItem("listItem").run()} />
      <ToolButton icon="indent" label="Increase indent" onClick={() => chain().sinkListItem("listItem").run()} />
      <ToolButton icon="clearFormat" label="Clear formatting" shortcut={shortcut("Mod+\\")} onClick={() => chain().unsetAllMarks().unsetTextAlign().run()} />
    </div>
  );
}

// ── Context bar (tables, figures, equations, …) ─────────────────────────────

function ContextBar({ editor, onEdit, onAlt, onReplaceImage }: { editor: Editor; onEdit: (pos: number) => void; onAlt: (pos: number) => void; onReplaceImage: (pos: number) => void }) {
  const context = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { selection } = current.state;
      if (selection instanceof NodeSelection && EDITABLE_ATOMS.has(selection.node.type.name)) {
        return { kind: selection.node.type.name, pos: selection.from, numbered: selection.node.attrs.numbered !== false, width: 0 };
      }
      const figure = ancestor(current, "figure");
      if (figure) {
        const node = current.state.doc.nodeAt(figure.pos);
        return { kind: "figure", pos: figure.pos, numbered: true, width: Number(node?.attrs.width) || 80 };
      }
      if (current.isActive("table")) return { kind: "table", pos: -1, numbered: true, width: 0 };
      if (current.isActive("heading")) {
        return { kind: "heading", pos: -1, numbered: current.getAttributes("heading").numbered !== false, width: 0 };
      }
      return null;
    },
  });
  if (!context) return null;
  const chain = () => editor.chain().focus();
  const removeAt = (pos: number) => {
    const node = editor.state.doc.nodeAt(pos);
    if (node) chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  switch (context.kind) {
    case "table": {
      const wrapper = ancestor(editor, "tableFigure");
      return (
        <div className="write-contextbar" role="toolbar" aria-label="Table">
          <span className="write-contextbar-label">Table</span>
          <ToolButton icon="rowAbove" label="Insert row above" onClick={() => chain().addRowBefore().run()} />
          <ToolButton icon="rowBelow" label="Insert row below" onClick={() => chain().addRowAfter().run()} />
          <ToolButton icon="colLeft" label="Insert column left" onClick={() => chain().addColumnBefore().run()} />
          <ToolButton icon="colRight" label="Insert column right" onClick={() => chain().addColumnAfter().run()} />
          <ToolSeparator />
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().deleteRow().run()}>
            Delete row
          </button>
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().deleteColumn().run()}>
            Delete column
          </button>
          <ToolButton icon="merge" label="Merge cells" onClick={() => chain().mergeCells().run()} />
          <ToolButton icon="split" label="Split cell" onClick={() => chain().splitCell().run()} />
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().toggleHeaderRow().run()}>
            Header row
          </button>
          <ToolSeparator />
          <button
            type="button"
            className="write-tool"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (wrapper ? removeAt(wrapper.pos) : chain().deleteTable().run())}
          >
            <Icon name="trash" size={16} /> Delete table
          </button>
        </div>
      );
    }
    case "figure":
      return (
        <div className="write-contextbar" role="toolbar" aria-label="Figure">
          <span className="write-contextbar-label">Figure</span>
          {[25, 50, 75, 100].map((width) => (
            <button
              key={width}
              type="button"
              className="write-tool"
              aria-pressed={context.width === width}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().command(({ tr }) => {
                const node = tr.doc.nodeAt(context.pos);
                if (node) tr.setNodeMarkup(context.pos, undefined, { ...node.attrs, width });
                return true;
              }).run()}
            >
              {width}%
            </button>
          ))}
          <ToolSeparator />
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => onReplaceImage(context.pos)}>
            <Icon name="upload" size={16} /> Replace image
          </button>
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => onAlt(context.pos)}>
            Alt text
          </button>
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => removeAt(context.pos)}>
            <Icon name="trash" size={16} /> Delete figure
          </button>
        </div>
      );
    case "heading":
      return (
        <div className="write-contextbar" role="toolbar" aria-label="Heading">
          <span className="write-contextbar-label">Heading</span>
          <label className="write-check">
            <input
              type="checkbox"
              checked={context.numbered}
              onChange={(event) => editor.chain().focus().updateAttributes("heading", { numbered: event.target.checked }).run()}
            />{" "}
            Numbered
          </label>
        </div>
      );
    default: {
      const names: Record<string, string> = {
        mathInline: "Inline math",
        mathBlock: "Equation",
        citation: "Citation",
        crossRef: "Cross-reference",
        footnote: "Footnote",
        rawLatex: "LaTeX block",
      };
      return (
        <div className="write-contextbar" role="toolbar" aria-label={names[context.kind]}>
          <span className="write-contextbar-label">{names[context.kind]}</span>
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => onEdit(context.pos)}>
            <Icon name="pencil" size={16} /> Edit
          </button>
          {context.kind === "mathBlock" && (
            <label className="write-check">
              <input
                type="checkbox"
                checked={context.numbered}
                onChange={(event) => editor.chain().focus().command(({ tr }) => {
                  const node = tr.doc.nodeAt(context.pos);
                  if (node) tr.setNodeMarkup(context.pos, undefined, { ...node.attrs, numbered: event.target.checked });
                  return true;
                }).run()}
              />{" "}
              Numbered
            </label>
          )}
          <button type="button" className="write-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => removeAt(context.pos)}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      );
    }
  }
}

// ── Find and replace ────────────────────────────────────────────────────────

function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    return from !== to ? editor.state.doc.textBetween(from, to, " ").slice(0, 100) : "";
  });
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const counts = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = getFindState(current.state);
      return { total: state.matches.length, current: state.current };
    },
  });

  useEffect(() => {
    setFind(editor.view, query, caseSensitive);
  }, [editor, query, caseSensitive]);

  useEffect(() => () => setFind(editor.view, "", false), [editor]);

  return (
    <div className="write-find" role="search" aria-label="Find and replace">
      <input
        type="text"
        aria-label="Find"
        placeholder="Find in paper"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            stepFind(editor.view, event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") onClose();
        }}
      />
      <span className="write-find-count" aria-live="polite">
        {query ? (counts.total ? `${counts.current + 1} of ${counts.total}` : "No matches") : ""}
      </span>
      <ToolButton icon="chevronDown" label="Next match" onClick={() => stepFind(editor.view, 1)} disabled={!counts.total} />
      <input
        type="text"
        aria-label="Replace with"
        placeholder="Replace with"
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      />
      <button type="button" className="ghost-button" disabled={!counts.total} onClick={() => replaceCurrent(editor.view, replacement)}>
        Replace
      </button>
      <button type="button" className="ghost-button" disabled={!counts.total} onClick={() => replaceAll(editor.view, replacement)}>
        Replace all
      </button>
      <label className="write-check">
        <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Match case
      </label>
      <ToolButton icon="close" label="Close find and replace" onClick={onClose} />
    </div>
  );
}

// ── Panels that follow the document ─────────────────────────────────────────

function Outline({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const outline = useEditorState({
    editor,
    selector: ({ editor: current }) => (getAnalysis(current.state)?.outline ?? []).map((item) => ({ level: item.level, number: item.number, text: item.text })),
  });
  const go = (index: number) => {
    let seen = -1;
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (target !== -1) return false;
      if (node.type.name === "heading") {
        seen += 1;
        if (seen === index) target = pos;
        return false;
      }
      return true;
    });
    if (target === -1) return;
    editor.chain().focus().setTextSelection(target + 1).run();
    editor.view.domAtPos(target + 1).node.parentElement?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <aside className="write-panel write-panel--left" aria-label="Document outline">
      <div className="write-panel-head">
        <h2>Outline</h2>
        <ToolButton icon="close" label="Close outline" onClick={onClose} />
      </div>
      <div className="write-panel-body">
        {outline.length ? (
          <ul className="write-outline">
            {outline.map((item, index) => (
              <li key={index} className={`level-${item.level}`}>
                <button type="button" onClick={() => go(index)}>
                  {item.number && <span className="write-outline-num">{item.number}</span>}
                  <span>{item.text || "Untitled heading"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="write-hint">Headings you add appear here.</p>
        )}
      </div>
    </aside>
  );
}

function Footnotes({ editor, onEdit, sectionRef }: { editor: Editor; onEdit: (pos: number) => void; sectionRef: RefObject<HTMLElement | null> }) {
  const notes = useEditorState({
    editor,
    selector: ({ editor: current }) => (getAnalysis(current.state)?.footnotes ?? []).map((note) => ({ number: note.number, text: note.text })),
  });
  if (!notes.length) return null;
  const edit = (index: number) => {
    const note = getAnalysis(editor.state)?.footnotes[index];
    if (note) onEdit(note.pos);
  };
  return (
    <section ref={sectionRef} className="paper-footnotes write-footnotes" aria-label="Footnotes">
      <ol>
        {notes.map((note, index) => (
          <li key={note.number} onDoubleClick={() => edit(index)} title="Double-click to edit">
            <span className="paper-footnote-mark">{note.number}</span> {note.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatusBar({ editor, settings, onPageSetup, onWordCount }: { editor: Editor; settings: PaperSettings; onPageSetup: () => void; onWordCount: () => void }) {
  const words = useEditorState({ editor, selector: ({ editor: current }) => getAnalysis(current.state)?.wordCount ?? 0 });
  const look = lookFromSettings(settings);
  return (
    <footer className="write-statusbar">
      <button type="button" onClick={onWordCount}>
        {words.toLocaleString()} {words === 1 ? "word" : "words"}
      </button>
      <button type="button" onClick={onPageSetup}>
        {settings.theme === "ieee" ? "IEEE" : settings.theme === "apa" ? "APA 7" : "Article"} · {look.paper === "letter" ? "US Letter" : "A4"} · {look.columns === 2 ? "two columns" : "one column"} · {settings.fontSize} pt
      </button>
      <span>{settings.citationStyle === "apa" ? "Author–year citations" : "Numbered citations"}</span>
      <span className="write-statusbar-spacer" />
      <span>Spelling is checked by your browser</span>
    </footer>
  );
}

// ── Workspace ───────────────────────────────────────────────────────────────

export default function VisualWorkspace({ initial, store, onSwitchMode, initialNotice = "" }: VisualWorkspaceProps) {
  const [title, setTitle] = useState(initial.title);
  const [settings, setSettings] = useState<PaperSettings>(initial.settings ?? DEFAULT_SETTINGS);
  const [bib, setBib] = useState(initial.bib);
  const [showOutline, setShowOutline] = useState(() => typeof window === "undefined" || window.innerWidth > 1180);
  const [showReferences, setShowReferences] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [zoomMode, setZoomMode] = useState<number | "fit">(() => (typeof window !== "undefined" && window.innerWidth < 900 ? "fit" : 1));
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [switching, setSwitching] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const footnotesRef = useRef<HTMLElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<number | null | "new">("new");
  const bibRef = useRef(bib);
  const switchingRef = useRef(false);
  const handlers = useRef<Omit<EditorHooks, "getBib">>({ edit: () => undefined, pickImage: () => undefined, command: () => undefined, imageFiles: () => undefined });

  useEffect(() => {
    bibRef.current = bib;
  }, [bib]);

  // Stable hooks for the editor's extensions; they forward to the latest handlers.
  const hooks = useMemo<EditorHooks>(
    () => ({
      edit: (pos) => handlers.current.edit(pos),
      pickImage: (pos) => handlers.current.pickImage(pos),
      command: (name) => handlers.current.command(name),
      imageFiles: (files, pos) => handlers.current.imageFiles(files, pos),
      getBib: () => bibRef.current,
    }),
    [],
  );

  const extensions = useMemo(
    () =>
      editorExtensions(
        { theme: initial.settings.theme, numberedHeadings: initial.settings.numberedHeadings, citationStyle: initial.settings.citationStyle, bib: initial.bib },
        hooks,
      ),
    [hooks, initial.settings, initial.bib],
  );

  const scheduleRef = useRef<() => void>(() => undefined);
  const editor = useEditor({
    extensions,
    content: initial.content ?? { type: "doc", content: [{ type: "paperTitle" }, { type: "paragraph" }] },
    editorProps: {
      attributes: { class: "paper-body", spellcheck: "true", "aria-label": "Paper", "aria-multiline": "true", role: "textbox" },
    },
    onUpdate: () => scheduleRef.current(),
  });

  const buildDoc = useCallback(
    (): PaperDocument => ({
      ...initial,
      title: title.trim() || "Untitled paper",
      settings,
      bib,
      content: editor ? editor.getJSON() : initial.content,
    }),
    [initial, title, settings, bib, editor],
  );
  const { saveState, schedule, flush, discard } = useAutosave(store, buildDoc);

  // Changes made while a conversion is running belong to neither
  // representation, so they must not schedule a save over the converted file.
  const scheduleEdit = useCallback(() => {
    if (!switchingRef.current) schedule();
  }, [schedule]);

  useEffect(() => {
    scheduleRef.current = scheduleEdit;
  }, [scheduleEdit]);

  // Settings and references live outside the document; numbering needs both.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      updatePaperContext(editor.state.tr, {
        theme: settings.theme,
        numberedHeadings: settings.numberedHeadings,
        citationStyle: settings.citationStyle,
        bib,
      }),
    );
  }, [editor, settings, bib]);

  useEffect(() => {
    document.title = `${title || "Untitled paper"} — Recommendica Write`;
  }, [title]);

  useEffect(
    () =>
      store.subscribe((id) => {
        if (id === initial.id) setChangedElsewhere(true);
      }),
    [store, initial.id],
  );

  // The canvas only exists once the editor does, so observe it from then on.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [editor]);

  const look = lookFromSettings(settings);
  const fitZoom = Math.min(1.25, Math.max(0.35, (canvasWidth - 8) / SHEET_WIDTH_PX[look.paper]));
  const zoom = zoomMode === "fit" ? fitZoom : zoomMode;
  const zoomLabel = zoomMode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;

  const updateSettings = (next: PaperSettings) => {
    setSettings(next);
    scheduleEdit();
  };
  const updateBib = (next: string) => {
    setBib(next);
    scheduleEdit();
  };

  // ── Commands ─────────────────────────────────────────────────────────────

  const insertImages = async (files: File[], pos: number | null) => {
    if (!editor) return;
    try {
      for (const file of files) {
        const image = await readImageFile(file);
        const figure: JSONContent = {
          type: "figure",
          attrs: { src: image.dataUrl, alt: file.name.replace(/\.[a-z0-9]+$/i, ""), width: 80, id: "" },
          content: [{ type: "figcaption" }],
        };
        if (pos === null) insertNode(figure);
        else editor.chain().focus().insertContentAt(pos, figure).run();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The image could not be added.");
    }
  };

  const openMath = (display: boolean) => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ");
    setDialog({ kind: "math", display, pos: null, latex: selected, numbered: true, range: empty ? undefined : { from, to } });
  };

  const openLink = () => {
    if (!editor) return;
    const href = (editor.getAttributes("link").href as string | undefined) ?? "";
    setDialog({ kind: "link", url: href });
  };

  const exportAs = async (format: "pdf" | "html" | "tex" | "zip" | "bib") => {
    if (!editor) return;
    await flush();
    const exporting = await import("../exporting.ts");
    const base = fileBaseName(title);
    try {
      if (format === "pdf" || format === "html") {
        const body = exporting.cleanForExport(editor.view.dom as HTMLElement) + (footnotesRef.current ? exporting.cleanForExport(footnotesRef.current) : "");
        if (format === "pdf") await exporting.printPaper(body, look, title);
        else exporting.downloadText(exporting.standaloneHtml(body, look, title), `${base}.html`, "text/html");
        return;
      }
      if (format === "bib") {
        exporting.downloadText(bib, `${base}.bib`, "application/x-bibtex");
        return;
      }
      const result = documentToLatex(editor.getJSON(), settings, bib, { embedBibliography: format === "tex" });
      if (format === "tex") {
        exporting.downloadText(result.tex, `${base}.tex`, "application/x-tex");
        if (result.images.length) setNotice("The .tex file refers to figures in a figures/ folder. Download the LaTeX project (.zip) to get the images too.");
        return;
      }
      const files: Record<string, string | Uint8Array> = { "main.tex": result.tex };
      if (result.bib) files[BIB_FILE] = result.bib;
      for (const image of result.images) files[image.path] = exporting.dataUrlToBytes(await toLatexImage(image.dataUrl));
      exporting.downloadBlob(await exporting.zipFiles(files), `${base}-latex.zip`);
      if (result.warnings.length) setNotice(result.warnings.join(" "));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    }
  };

  const switchMode = async (kind: DocumentKind) => {
    if (!editor || switchingRef.current || kind === "visual") return;
    switchingRef.current = true;
    setSwitching(true);
    setDialog(null);
    editor.setEditable(false);
    try {
      await flush();
      // The converted document is about to replace this one; its unmount flush
      // must not write the old representation back over it.
      discard();
      await onSwitchMode(buildDoc(), kind);
    } catch (error) {
      switchingRef.current = false;
      setSwitching(false);
      editor.setEditable(true);
      schedule();
      setNotice(error instanceof Error ? error.message : "The editor could not be switched.");
    }
  };

  handlers.current = {
    edit: (pos) => {
      const node = editor?.state.doc.nodeAt(pos);
      if (!node) return;
      switch (node.type.name) {
        case "mathInline":
        case "mathBlock":
          setDialog({ kind: "math", display: node.type.name === "mathBlock", pos, latex: String(node.attrs.latex ?? ""), numbered: node.attrs.numbered !== false });
          break;
        case "citation":
          setDialog({ kind: "citation", pos, keys: Array.isArray(node.attrs.keys) ? node.attrs.keys.map(String) : [] });
          break;
        case "crossRef":
          setDialog({ kind: "crossRef", pos, target: String(node.attrs.target ?? "") });
          break;
        case "footnote":
          setDialog({ kind: "footnote", pos, text: String(node.attrs.text ?? "") });
          break;
        case "rawLatex":
          setDialog({ kind: "rawLatex", pos, source: String(node.attrs.source ?? "") });
          break;
        default:
          break;
      }
    },
    pickImage: (pos) => {
      imageTarget.current = pos;
      imageInput.current?.click();
    },
    imageFiles: (files, pos) => void insertImages(files, pos),
    command: (name) => {
      switch (name) {
        case "math":
          openMath(false);
          break;
        case "equation":
          openMath(true);
          break;
        case "footnote":
          setDialog({ kind: "footnote", pos: null, text: "" });
          break;
        case "citation":
          setDialog({ kind: "citation", pos: null, keys: [] });
          break;
        case "link":
          openLink();
          break;
        case "find":
          setShowFind(true);
          break;
        case "print":
          void exportAs("pdf");
          break;
        case "save":
          void flush();
          break;
        default:
          break;
      }
    },
  };

  // Empty equations created with "$$ " open their editor straight away.
  useEffect(() => {
    if (!editor) return;
    const onSelection = () => {
      const { selection } = editor.state;
      if (selection instanceof NodeSelection && selection.node.type.name === "mathBlock" && !String(selection.node.attrs.latex ?? "").trim()) {
        setDialog((current) => current ?? { kind: "math", display: true, pos: selection.from, latex: "", numbered: true });
      }
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor]);

  const setNodeAttrs = (pos: number, attrs: Record<string, unknown>) => {
    editor?.chain().focus().command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      return true;
    }).run();
  };

  const deleteNodeAt = (pos: number) => {
    const node = editor?.state.doc.nodeAt(pos);
    if (editor && node) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    setDialog(null);
  };

  // Blocks (equations, figures, tables) inserted at the end of a paragraph or
  // into an empty one get a fresh paragraph after them, so typing continues
  // below the block instead of jumping into whatever follows it.
  const insertNode = (json: JSONContent) => {
    if (!editor) return;
    const inline = ["text", "mathInline", "citation", "crossRef", "footnote"].includes(json.type ?? "");
    const { $from, empty } = editor.state.selection;
    const atEnd = empty && $from.parent.isTextblock && $from.parentOffset === $from.parent.content.size;
    editor.chain().focus().insertContent(!inline && atEnd ? [json, { type: "paragraph" }] : json).run();
  };

  const insertFrontMatter = (type: "paperAbstract" | "paperKeywords" | "bibliography") => {
    if (!editor) return;
    let existing = -1;
    editor.state.doc.forEach((node, offset) => {
      if (existing === -1 && node.type.name === type) existing = offset;
    });
    if (existing !== -1) {
      editor.chain().focus().setTextSelection(existing + 1).scrollIntoView().run();
      return;
    }
    if (type === "bibliography") {
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, { type: "bibliography" }).run();
      return;
    }
    // Abstract and keywords belong right after the title block.
    let after = 0;
    editor.state.doc.forEach((node, offset) => {
      if (["paperTitle", "paperAuthors", "paperAbstract"].includes(node.type.name)) after = offset + node.nodeSize;
    });
    const json: JSONContent = type === "paperAbstract" ? { type, content: [{ type: "paragraph" }] } : { type };
    editor.chain().focus().insertContentAt(after, json).setTextSelection(after + 2).run();
  };

  const run: Record<string, () => void> = {
    print: () => void exportAs("pdf"),
    link: openLink,
    math: () => openMath(false),
    equation: () => openMath(true),
    citation: () => setDialog({ kind: "citation", pos: null, keys: [] }),
    crossRef: () => setDialog({ kind: "crossRef", pos: null, target: "" }),
    footnote: () => setDialog({ kind: "footnote", pos: null, text: "" }),
    figure: () => {
      imageTarget.current = "new";
      imageInput.current?.click();
    },
  };

  const zoomItems: MenuEntry[] = [
    { label: "Fit width", checked: zoomMode === "fit", onSelect: () => setZoomMode("fit") },
    "separator",
    ...ZOOMS.map((value) => ({ label: `${Math.round(value * 100)}%`, checked: zoomMode === value, onSelect: () => setZoomMode(value) })),
  ];

  const downloadItems: MenuEntry[] = [
    { label: "PDF (print)", icon: "print", shortcut: shortcut("Mod+P"), onSelect: () => void exportAs("pdf") },
    { label: "LaTeX project (.zip)", icon: "archive", onSelect: () => void exportAs("zip") },
    { label: "LaTeX file (.tex)", icon: "fileCode", onSelect: () => void exportAs("tex") },
    { label: "Web page (.html)", icon: "externalLink", onSelect: () => void exportAs("html") },
    { label: "References (.bib)", icon: "citation", onSelect: () => void exportAs("bib") },
  ];

  const chain = () => editor!.chain().focus();
  const menus: { label: string; items: MenuEntry[] }[] = editor
    ? [
        {
          label: "File",
          items: [
            { label: "New paper", icon: "filePlus", onSelect: () => (window.location.hash = "write") },
            { label: "All papers", icon: "folderOpen", onSelect: () => (window.location.hash = "write") },
            "separator",
            { label: "Page setup…", icon: "settings", onSelect: () => setDialog({ kind: "pageSetup" }) },
            { label: "Download", icon: "download", submenu: downloadItems },
            { label: "Switch to LaTeX editor", icon: "fileCode", onSelect: () => void switchMode("latex") },
            "separator",
            { label: "Print", icon: "print", shortcut: shortcut("Mod+P"), onSelect: () => void exportAs("pdf") },
          ],
        },
        {
          label: "Edit",
          items: [
            { label: "Undo", icon: "undo", shortcut: shortcut("Mod+Z"), onSelect: () => chain().undo().run() },
            { label: "Redo", icon: "redo", shortcut: shortcut("Mod+Shift+Z"), onSelect: () => chain().redo().run() },
            "separator",
            { label: "Select all", shortcut: shortcut("Mod+A"), onSelect: () => chain().selectAll().run() },
            { label: "Find and replace", icon: "replace", shortcut: shortcut("Mod+F"), onSelect: () => setShowFind(true) },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Outline", checked: showOutline, onSelect: () => setShowOutline(!showOutline) },
            { label: "References", checked: showReferences, onSelect: () => setShowReferences(!showReferences) },
            { label: "Zoom", submenu: zoomItems },
            "separator",
            {
              label: "LaTeX source",
              icon: "braces",
              onSelect: () => setDialog({ kind: "latexSource", tex: documentToLatex(editor.getJSON(), settings, bib).tex }),
            },
          ],
        },
        {
          label: "Insert",
          items: [
            { label: "Figure (image)…", icon: "image", onSelect: run.figure },
            { label: "Table", icon: "table", onSelect: () => insertNode(tableJson(3, 3)) },
            { label: "Inline math", icon: "sigma", shortcut: shortcut("Mod+Shift+M"), onSelect: run.math },
            { label: "Equation", icon: "displayMath", shortcut: shortcut("Mod+Alt+M"), onSelect: run.equation },
            "separator",
            { label: "Citation…", icon: "citation", shortcut: shortcut("Mod+Alt+C"), onSelect: run.citation },
            { label: "Cross-reference…", icon: "crossRef", onSelect: run.crossRef },
            { label: "Footnote", icon: "footnote", shortcut: shortcut("Mod+Alt+F"), onSelect: run.footnote },
            { label: "Link…", icon: "link", shortcut: shortcut("Mod+K"), onSelect: openLink },
            "separator",
            { label: "Abstract", onSelect: () => insertFrontMatter("paperAbstract") },
            { label: "Keywords", onSelect: () => insertFrontMatter("paperKeywords") },
            { label: "References list", icon: "library", onSelect: () => insertFrontMatter("bibliography") },
            { label: "LaTeX block…", icon: "braces", onSelect: () => setDialog({ kind: "rawLatex", pos: null, source: "" }) },
            "separator",
            { label: "Page break", icon: "pageBreak", onSelect: () => insertNode({ type: "pageBreak" }) },
            { label: "Horizontal line", icon: "minus", onSelect: () => chain().setHorizontalRule().run() },
          ],
        },
        {
          label: "Format",
          items: [
            {
              label: "Text",
              submenu: [
                { label: "Bold", icon: "bold", shortcut: shortcut("Mod+B"), onSelect: () => chain().toggleBold().run() },
                { label: "Italic", icon: "italic", shortcut: shortcut("Mod+I"), onSelect: () => chain().toggleItalic().run() },
                { label: "Underline", icon: "underline", shortcut: shortcut("Mod+U"), onSelect: () => chain().toggleUnderline().run() },
                { label: "Strikethrough", icon: "strike", onSelect: () => chain().toggleStrike().run() },
                { label: "Superscript", icon: "superscript", onSelect: () => chain().toggleSuperscript().run() },
                { label: "Subscript", icon: "subscript", onSelect: () => chain().toggleSubscript().run() },
                { label: "Code", icon: "code", onSelect: () => chain().toggleCode().run() },
              ],
            },
            {
              label: "Line spacing",
              submenu: [1, 1.15, 1.5, 2].map((value) => ({
                label: value === 1 ? "Single" : value === 2 ? "Double" : String(value),
                checked: settings.lineSpacing === value,
                onSelect: () => updateSettings({ ...settings, lineSpacing: value }),
              })),
            },
            {
              label: "Columns",
              submenu: [1, 2].map((value) => ({
                label: value === 1 ? "One column" : "Two columns",
                checked: settings.columns === value,
                onSelect: () => updateSettings({ ...settings, columns: value as 1 | 2 }),
              })),
            },
            { label: "Number sections", checked: settings.numberedHeadings, onSelect: () => updateSettings({ ...settings, numberedHeadings: !settings.numberedHeadings }) },
            "separator",
            { label: "Bulleted list", icon: "bulletList", onSelect: () => chain().toggleBulletList().run() },
            { label: "Numbered list", icon: "orderedList", onSelect: () => chain().toggleOrderedList().run() },
            { label: "Clear formatting", icon: "clearFormat", onSelect: () => chain().unsetAllMarks().unsetTextAlign().run() },
          ],
        },
        {
          label: "Tools",
          items: [
            { label: "Word count", onSelect: () => setDialog({ kind: "wordCount" }) },
            { label: "References…", icon: "bookOpen", onSelect: () => setShowReferences(true) },
            {
              label: "Citation style",
              submenu: (["ieee", "apa"] as const).map((style) => ({
                label: style === "ieee" ? "Numbered [1] (IEEE)" : "Author–year (APA)",
                checked: settings.citationStyle === style,
                onSelect: () => updateSettings({ ...settings, citationStyle: style }),
              })),
            },
            "separator",
            { label: "Find papers on Recommendica", icon: "search", onSelect: () => window.open(`/?q=${encodeURIComponent(title)}#search`, "_blank", "noopener") },
          ],
        },
        {
          label: "Help",
          items: [{ label: "Keyboard shortcuts", icon: "keyboard", onSelect: () => setDialog({ kind: "shortcuts" }) }],
        },
      ]
    : [];

  if (!editor) return null;

  const analysis = getAnalysis(editor.state);
  const sheetStyle = { ...paperStyle(look) } as CSSProperties;

  return (
    <div className="write-workspace">
      <WorkspaceHeader
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          scheduleEdit();
        }}
        kind="visual"
        onSwitchKind={(kind) => void switchMode(kind)}
        switchBusy={switching}
        saveState={saveState}
        persistent={store.persistent}
        menubar={<MenuBar label="Editor menu" menus={menus} />}
        actions={
          <>
            <button type="button" className="ghost-button write-hide-small" onClick={() => setShowReferences(!showReferences)} aria-pressed={showReferences}>
              <Icon name="bookOpen" size={16} /> References
            </button>
            <MenuButton label="Download" items={downloadItems} align="end" className="write-tool--text">
              <Icon name="download" size={16} /> <span className="write-hide-small">Download</span>
            </MenuButton>
          </>
        }
      />

      <div>
        <Toolbar
          editor={editor}
          run={run}
          onInsert={insertNode}
          zoomLabel={zoomLabel}
          zoomItems={zoomItems}
          showOutline={showOutline}
          onToggleOutline={() => setShowOutline(!showOutline)}
        />
        {showFind && <FindBar editor={editor} onClose={() => setShowFind(false)} />}
        <ContextBar
          editor={editor}
          onEdit={(pos) => handlers.current.edit(pos)}
          onAlt={(pos) => setDialog({ kind: "alt", pos, alt: String(editor.state.doc.nodeAt(pos)?.attrs.alt ?? "") })}
          onReplaceImage={(pos) => handlers.current.pickImage(pos)}
        />
        {changedElsewhere && (
          <div className="write-banner" role="status">
            <Icon name="alertTriangle" size={16} /> This paper was changed in another tab. Saving here will overwrite those changes.
            <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
        {notice && (
          <div className="write-banner" role="status">
            <Icon name="alertCircle" size={16} /> {notice}
            <button type="button" className="ghost-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="write-body">
        {showOutline ? <Outline editor={editor} onClose={() => setShowOutline(false)} /> : <div />}
        <div ref={canvasRef} className="write-canvas" onClick={(event) => {
          // A click on the grey canvas below the text puts the caret at the end.
          if (event.target === event.currentTarget) editor.chain().focus("end").run();
        }}>
          <div className="write-page" style={{ "--write-zoom": zoom } as CSSProperties}>
            <article className={`${paperClassName(look)} paper-sheet`} style={sheetStyle}>
              <EditorContent editor={editor} />
              <Footnotes editor={editor} sectionRef={footnotesRef} onEdit={(pos) => handlers.current.edit(pos)} />
            </article>
          </div>
        </div>
        {showReferences ? (
          <ReferencesPanel
            bib={bib}
            onBibChange={updateBib}
            style={settings.citationStyle}
            onStyleChange={(style) => updateSettings({ ...settings, citationStyle: style })}
            citedKeys={analysis?.citedKeys ?? []}
            missingKeys={analysis?.missingKeys ?? []}
            onCite={(key) => insertNode({ type: "citation", attrs: { keys: [key] } })}
            onClose={() => setShowReferences(false)}
          />
        ) : (
          <div />
        )}
      </div>

      <StatusBar editor={editor} settings={settings} onPageSetup={() => setDialog({ kind: "pageSetup" })} onWordCount={() => setDialog({ kind: "wordCount" })} />

      <input
        ref={imageInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const target = imageTarget.current;
          if (target === "new" || target === null) {
            await insertImages([file], null);
            return;
          }
          try {
            const image = await readImageFile(file);
            setNodeAttrs(target, { src: image.dataUrl, alt: file.name.replace(/\.[a-z0-9]+$/i, "") });
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "The image could not be added.");
          }
        }}
      />

      {dialog?.kind === "math" && (
        <MathDialog
          display={dialog.display}
          initialLatex={dialog.latex}
          initialNumbered={dialog.numbered}
          isNew={dialog.pos === null || !String(editor.state.doc.nodeAt(dialog.pos)?.attrs.latex ?? "").trim()}
          onClose={() => setDialog(null)}
          onDelete={dialog.pos === null ? undefined : () => deleteNodeAt(dialog.pos as number)}
          onSubmit={(latex, numbered) => {
            if (dialog.pos !== null) setNodeAttrs(dialog.pos, dialog.display ? { latex, numbered } : { latex });
            else {
              const json: JSONContent = dialog.display ? { type: "mathBlock", attrs: { latex, numbered, id: "" } } : { type: "mathInline", attrs: { latex } };
              if (dialog.range) editor.chain().focus().insertContentAt(dialog.range, json).run();
              else insertNode(json);
            }
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "citation" && (
        <CitationDialog
          entries={bibEntries(bib)}
          initialKeys={dialog.keys}
          onClose={() => setDialog(null)}
          onManage={() => {
            setDialog(null);
            setShowReferences(true);
          }}
          onDelete={dialog.pos === null ? undefined : () => deleteNodeAt(dialog.pos as number)}
          onSubmit={(keys) => {
            if (dialog.pos !== null) setNodeAttrs(dialog.pos, { keys });
            else insertNode({ type: "citation", attrs: { keys } });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "crossRef" && (
        <CrossRefDialog
          targets={getAnalysis(editor.state)?.targets ?? []}
          current={dialog.target}
          onClose={() => setDialog(null)}
          onDelete={dialog.pos === null ? undefined : () => deleteNodeAt(dialog.pos as number)}
          onSubmit={(id) => {
            if (dialog.pos !== null) setNodeAttrs(dialog.pos, { target: id });
            else insertNode({ type: "crossRef", attrs: { target: id } });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "footnote" && (
        <TextDialog
          title={dialog.pos === null ? "Insert footnote" : "Edit footnote"}
          label="Footnote text"
          initial={dialog.text}
          multiline
          submitLabel={dialog.pos === null ? "Insert" : "Update"}
          validate={(value) => (value.trim() ? null : "Write the footnote text.")}
          onClose={() => setDialog(null)}
          onDelete={dialog.pos === null ? undefined : () => deleteNodeAt(dialog.pos as number)}
          onSubmit={(text) => {
            if (dialog.pos !== null) setNodeAttrs(dialog.pos, { text });
            else insertNode({ type: "footnote", attrs: { text } });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "link" && (
        <TextDialog
          title="Link"
          label="Web address"
          initial={dialog.url}
          placeholder="https://example.org"
          submitLabel="Apply"
          validate={(value) => (/^(https?:\/\/|mailto:)\S+$/i.test(value.trim()) || /^www\.\S+$/i.test(value.trim()) ? null : "Enter an address starting with https://, http:// or mailto:.")}
          onClose={() => setDialog(null)}
          deleteLabel="Remove link"
          onDelete={dialog.url ? () => {
            chain().extendMarkRange("link").unsetLink().run();
            setDialog(null);
          } : undefined}
          onSubmit={(value) => {
            const href = /^www\./i.test(value) ? `https://${value}` : value;
            if (editor.state.selection.empty && !editor.isActive("link")) {
              insertNode({ type: "text", text: value, marks: [{ type: "link", attrs: { href } }] });
            } else {
              chain().extendMarkRange("link").setLink({ href }).run();
            }
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "alt" && (
        <TextDialog
          title="Alternative text"
          label="Describe the figure for people who cannot see it"
          initial={dialog.alt}
          multiline
          submitLabel="Save"
          hint="Used by screen readers and in the exported web page."
          onClose={() => setDialog(null)}
          onSubmit={(alt) => {
            setNodeAttrs(dialog.pos, { alt });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "rawLatex" && (
        <RawLatexDialog
          initial={dialog.source}
          bib={bib}
          isNew={dialog.pos === null}
          onClose={() => setDialog(null)}
          onDelete={dialog.pos === null ? undefined : () => deleteNodeAt(dialog.pos as number)}
          onSubmit={(source) => {
            if (dialog.pos !== null) setNodeAttrs(dialog.pos, { source });
            else insertNode({ type: "rawLatex", attrs: { source } });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "pageSetup" && (
        <PageSetupDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSubmit={(next) => {
            updateSettings(next);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "latexSource" && (
        <Dialog
          title="LaTeX source"
          size="lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(dialog.tex)}>
                <Icon name="copy" size={16} /> Copy
              </button>
              <button type="button" className="primary-button" onClick={() => void exportAs("zip")}>
                Download project
              </button>
            </>
          }
        >
          <p>This is the LaTeX your paper exports to. It updates every time you open this view.</p>
          <textarea className="write-source-view" readOnly value={dialog.tex} aria-label="LaTeX source" spellCheck={false} />
        </Dialog>
      )}

      {dialog?.kind === "wordCount" && (
        <Dialog title="Word count" size="sm" onClose={() => setDialog(null)}>
          <dl className="write-stats">
            <dt>Words</dt>
            <dd>{(analysis?.wordCount ?? 0).toLocaleString()}</dd>
            <dt>Characters</dt>
            <dd>{plainText(editor.getJSON()).length.toLocaleString()}</dd>
            <dt>Sections</dt>
            <dd>{analysis?.outline.length ?? 0}</dd>
            <dt>Figures and tables</dt>
            <dd>{analysis?.targets.filter((target) => target.kind === "figure" || target.kind === "table").length ?? 0}</dd>
            <dt>Numbered equations</dt>
            <dd>{analysis?.targets.filter((target) => target.kind === "equation" && target.number).length ?? 0}</dd>
            <dt>Cited references</dt>
            <dd>{analysis?.citedKeys.length ?? 0}</dd>
            <dt>Footnotes</dt>
            <dd>{analysis?.footnotes.length ?? 0}</dd>
          </dl>
        </Dialog>
      )}

      {dialog?.kind === "shortcuts" && (
        <Dialog title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <dl className="write-shortcuts">
            {[
              ["Bold / italic / underline", "Mod+B · Mod+I · Mod+U"],
              ["Heading 1–4 / normal text", "Mod+Alt+1–4 · Mod+Alt+0"],
              ["Inline math (or type $…$)", "Mod+Shift+M"],
              ["Equation (or type $$ and space)", "Mod+Alt+M"],
              ["Cite", "Mod+Alt+C"],
              ["Footnote", "Mod+Alt+F"],
              ["Link", "Mod+K"],
              ["Edit the selected equation, citation…", "Enter"],
              ["Find and replace", "Mod+F"],
              ["Bulleted / numbered list", "Mod+Shift+8 · Mod+Shift+7"],
              ["Align left / center / right / justify", "Mod+Shift+L · E · R · J"],
              ["Print or save as PDF", "Mod+P"],
              ["Undo / redo", "Mod+Z · Mod+Shift+Z"],
            ].map(([label, keys]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{shortcut(keys)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </div>
  );
}

