/**
 * Small readings of LaTeX shapes that the importer, the exporter and the
 * visual analysis must agree on: the rows of a multi-line equation and the
 * columns of a tabular. Schema-free and DOM-free.
 */

/** Equation environments with one row per `\\` (and, unstarred, a number per row). */
export const MULTILINE_MATH = new Set(["align", "flalign", "gather", "multline", "alignat", "eqnarray"]);

export interface MathRow {
  /** `\label{…}` names in the row. */
  labels: string[];
  /** Whether the row gets an equation number of its own. */
  numbered: boolean;
}

/** The body split at top-level `\\`, outside braces and nested environments. */
export function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let nested = 0;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const ch = body[index];
    if (ch === "\\") {
      const rest = body.slice(index, index + 7);
      if (rest.startsWith("\\begin{")) nested++;
      else if (rest.startsWith("\\end{")) nested = Math.max(0, nested - 1);
      else if (body[index + 1] === "\\" && depth === 0 && nested === 0) {
        rows.push(body.slice(start, index));
        start = index + 2;
      }
      index++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  rows.push(body.slice(start));
  return rows;
}

/**
 * The rows of a multi-line equation environment (`env` without its star) and
 * which of them LaTeX numbers: every non-empty row of align, gather, … unless
 * it says `\nonumber`/`\notag` or has its own `\tag`; multline numbers its
 * last row only.
 */
export function mathRows(env: string, body: string, starred: boolean): MathRow[] {
  const rows = splitRows(body);
  const lastFilled = rows.reduce((last, row, index) => (row.trim() ? index : last), -1);
  return rows.map((row, index) => {
    const labels = [...row.matchAll(/\\label\s*\{([^}]*)\}/g)].map((match) => match[1].trim()).filter(Boolean);
    const blank = !row.replace(/\\(?:label|tag)\*?\s*\{[^}]*\}|\\(?:nonumber|notag)\b/g, "").trim();
    const suppressed = /\\(?:nonumber|notag|tag\*?)\b/.test(row);
    const numbered = !starred && !blank && !suppressed && (env !== "multline" || index === lastFilled);
    return { labels, numbered };
  });
}

/** Reads one balanced `{…}` group starting at `index` (which must be `{`). */
function group(spec: string, index: number): { body: string; next: number } {
  let depth = 0;
  for (let at = index; at < spec.length; at++) {
    if (spec[at] === "{") depth++;
    else if (spec[at] === "}") {
      depth--;
      if (depth === 0) return { body: spec.slice(index + 1, at), next: at + 1 };
    }
  }
  return { body: spec.slice(index + 1), next: spec.length };
}

/**
 * The alignment of each column a tabular column spec defines: `l`, `c` and
 * `r` as written; paragraph columns (`p{}`, `m{}`, `b{}`, `X`) and unknown
 * column types read as `l`. Rules (`|`) and inter-column material (`@{}`,
 * `!{}`, `>{}`, `<{}`) define no column; `*{n}{…}` repeats.
 */
export function columnAligns(spec: string, depth = 0): ("l" | "c" | "r")[] {
  const aligns: ("l" | "c" | "r")[] = [];
  let index = 0;
  while (index < spec.length) {
    const ch = spec[index];
    if (/\s|\|/.test(ch)) {
      index++;
      continue;
    }
    if (ch === "@" || ch === "!" || ch === ">" || ch === "<") {
      index++;
      while (/\s/.test(spec[index] ?? "")) index++;
      if (spec[index] === "{") index = group(spec, index).next;
      continue;
    }
    if (ch === "*" && depth < 4) {
      index++;
      const count = spec[index] === "{" ? group(spec, index) : { body: "1", next: index };
      index = count.next;
      const body = spec[index] === "{" ? group(spec, index) : { body: "", next: index };
      index = body.next;
      const repeated = columnAligns(body.body, depth + 1);
      const times = Math.min(50, Math.max(0, Number.parseInt(count.body, 10) || 0));
      for (let time = 0; time < times; time++) aligns.push(...repeated);
      continue;
    }
    index++;
    if (ch === "p" || ch === "m" || ch === "b" || ch === "w" || ch === "W") {
      // p{width}; w{align}{width} and W{align}{width} (array) take two.
      const takes = ch === "w" || ch === "W" ? 2 : 1;
      for (let taken = 0; taken < takes; taken++) {
        while (/\s/.test(spec[index] ?? "")) index++;
        if (spec[index] === "{") index = group(spec, index).next;
      }
      aligns.push("l");
      continue;
    }
    if (ch === "{") {
      // The arguments of a column type (D{.}{.}{2}) define no column.
      index = group(spec, index - 1).next;
      continue;
    }
    if (ch === "[") {
      // Options of a column type (S[table-format=2.1]).
      const close = spec.indexOf("]", index);
      index = close === -1 ? spec.length : close + 1;
      continue;
    }
    aligns.push(ch === "c" ? "c" : ch === "r" ? "r" : "l");
  }
  return aligns;
}

/**
 * A multi-line environment kept from LaTeX (align, gather, …), as KaTeX can
 * show it: labels and number switches are LaTeX's business, and the visual
 * editor prints the numbers itself.
 */
export function environmentMath(env: string, envArg: string, latex: string): string {
  const base = env.replace(/\*$/, "");
  let body = latex.replace(/\\label\s*\{[^}]*\}/g, "").replace(/\\(?:nonumber|notag)\b/g, "").replace(/\\tag\*?\s*\{[^}]*\}/g, "");
  // eqnarray's three columns (a & = & b) read as two.
  if (base === "eqnarray") body = body.replace(/&([^&\\]*)&/g, "&$1");
  if (base === "gather" || base === "multline") return `\\begin{gathered}${body}\\end{gathered}`;
  if (base === "alignat") return `\\begin{alignedat}{${/^\d+$/.test(envArg) ? envArg : "1"}}${body}\\end{alignedat}`;
  return `\\begin{aligned}${body}\\end{aligned}`;
}
