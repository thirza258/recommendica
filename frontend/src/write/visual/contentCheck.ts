/**
 * Checks content against the visual editor's schema before the editor sees
 * it. TipTap replaces a document it cannot load with an empty one, so a
 * conversion must never produce such a document. Loaded on demand with the
 * editor, so the documents list stays free of TipTap.
 */

import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { baseExtensions } from "./extensions.ts";

let schema: Schema | null = null;

/** Whether one top-level block loads in the visual editor as it is. */
export function validBlock(block: JSONContent): boolean {
  schema ??= getSchema(baseExtensions());
  try {
    const node = schema.nodeFromJSON(block);
    node.check();
    return schema.topNodeType.contentMatch.matchType(node.type) !== null;
  } catch {
    return false;
  }
}
