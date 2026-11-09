/**
 * Text marks in a fixed order.
 *
 * ProseMirror stores the marks of a text node sorted by the schema's mark
 * order, while JSON built elsewhere (the LaTeX importer, older documents) may
 * list them in any order. The exporter wraps marks in this order, so the same
 * text always produces the same LaTeX; otherwise loading a converted paper in
 * the editor would count as an edit and rewrite its LaTeX source.
 *
 * Schema-free (no TipTap import), so the mode switch can use it without
 * loading the editor.
 */

/** The visual schema's mark order (see the test that checks it against the schema). */
export const MARK_ORDER = ["link", "textStyle", "bold", "code", "italic", "strike", "underline", "highlight", "subscript", "superscript"];

interface MarkLike {
  type: string;
  attrs?: Record<string, unknown>;
}

function rank(type: string): number {
  const index = MARK_ORDER.indexOf(type);
  return index === -1 ? MARK_ORDER.length : index;
}

/** The marks in the schema's order; marks the schema does not know keep their order, last. */
export function sortMarks<T extends MarkLike>(marks: readonly T[] | null | undefined): T[] {
  return [...(marks ?? [])].sort((left, right) => rank(left.type) - rank(right.type));
}

/** Attributes that are unset or null say the same thing. */
function canonicalAttrs(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return "";
  const entries = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? JSON.stringify(entries) : "";
}

/** A key that is equal for equal mark sets, whatever order they are listed in. */
export function marksKey(marks: readonly MarkLike[] | null | undefined): string {
  if (!marks?.length) return "";
  return sortMarks(marks)
    .map((mark) => `${mark.type}${canonicalAttrs(mark.attrs)}`)
    .join("|");
}
