/**
 * Keeping the reader's place across a mode switch: the section heading at the
 * top of the view in one editor is found again, by its text, in the other.
 */

export interface ModeAnchor {
  /** The heading's text, reduced by `headingKey`. */
  heading: string;
  /** Which of the headings with that text (0-based), for repeated titles. */
  occurrence: number;
}

/** Letters and digits only, so a visual heading matches its \section{…} title. */
export function headingKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADING_COMMAND = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\]\s*)?\{/g;

/** Section headings in LaTeX source, with their 1-based line numbers. */
export function latexHeadings(source: string): { key: string; line: number }[] {
  const headings: { key: string; line: number }[] = [];
  let line = 1;
  let counted = 0;
  for (const match of source.matchAll(HEADING_COMMAND)) {
    const at = match.index ?? 0;
    for (let index = counted; index < at; index++) if (source.charCodeAt(index) === 10) line++;
    counted = at;
    const lineStart = source.lastIndexOf("\n", at - 1) + 1;
    if (/(?:^|[^\\])%/.test(source.slice(lineStart, at))) continue;
    let depth = 1;
    let index = at + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const ch = source[index];
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      index++;
    }
    const title = source.slice(start, Math.max(start, index - 1)).replace(/\$[^$]*\$/g, " ").replace(/\\[a-zA-Z]+\*?/g, " ");
    headings.push({ key: headingKey(title), line });
  }
  return headings;
}

/** The anchor for `headings[index]`, or null when there is none. */
export function anchorAt(headings: { key: string }[], index: number): ModeAnchor | null {
  const key = headings[index]?.key;
  if (!key) return null;
  let occurrence = 0;
  for (let before = 0; before < index; before++) if (headings[before].key === key) occurrence++;
  return { heading: key, occurrence };
}

/** Where the anchor's heading is in `headings`, or -1. */
export function findAnchor(headings: { key: string }[], anchor: ModeAnchor): number {
  let seen = 0;
  for (let index = 0; index < headings.length; index++) {
    if (headings[index].key !== anchor.heading) continue;
    if (seen === anchor.occurrence) return index;
    seen++;
  }
  return headings.findIndex((heading) => heading.key === anchor.heading);
}
