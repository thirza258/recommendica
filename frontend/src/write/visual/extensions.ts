/**
 * The visual editor's schema-level extensions, shared by the editor and the
 * tests. Interactive behaviour (node views, paste handling) is added on top
 * in editorExtensions.ts.
 */

import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { PAPER_NODES } from "./schema.ts";

export function baseExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      undoRedo: { depth: 300, newGroupDelay: 600 },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph", "paperTitle", "paperAuthors"] }),
    Subscript,
    Superscript,
    TableKit.configure({ table: { resizable: false } }),
    ...PAPER_NODES,
  ];
}
