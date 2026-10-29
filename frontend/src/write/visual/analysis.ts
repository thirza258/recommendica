/**
 * One pass over a visual document that numbers everything a paper numbers.
 *
 * Sections, figures, tables, equations and footnotes are numbered in document
 * order; citations get labels from the reference list; cross-references get
 * the current number of their target. The editor shows the results through
 * decorations, so the stored document never contains a stale number.
 *
 * Pure and DOM-free: it runs on every document change (one linear walk) and
 * in the tests.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { buildBibliography, formatCitation, parseBibtex } from "../latex/bibtex.ts";
import type { BibEntry, Bibliography, CitationStyle } from "../latex/bibtex.ts";
import { referenceListHtml } from "../latex/render.ts";
import { toRoman } from "../latex/symbols.ts";
import { conventions, headingNumber } from "../themes.ts";
import type { VisualTheme } from "../themes.ts";

export interface AnalysisContext {
  theme: VisualTheme;
  numberedHeadings: boolean;
  citationStyle: CitationStyle;
  /** The document's references as BibTeX. */
  bib: string;
}

export interface OutlineItem {
  id: string;
  pos: number;
  level: number;
  number: string;
  text: string;
}

export type TargetKind = "section" | "figure" | "table" | "equation";

export interface RefTarget {
  id: string;
  kind: TargetKind;
  pos: number;
  /** The bare number ("2.1", "3", "IV") or "" when the target is unnumbered. */
  number: string;
  /** What a cross-reference displays: "Figure 2", "Eq. (3)", "Section 2.1". */
  label: string;
  /** Heading text or caption, for the cross-reference picker. */
  text: string;
}

export interface NodeLabel {
  pos: number;
  size: number;
  attrs: Record<string, string>;
  /** `raw` marks a reference to a label that only exists inside a LaTeX block. */
  spec: { paperLabel: string; missing?: boolean; raw?: boolean; html?: string };
}

export interface DocAnalysis {
  outline: OutlineItem[];
  targets: RefTarget[];
  citedKeys: string[];
  missingKeys: string[];
  footnotes: { pos: number; number: number; text: string }[];
  bibliography: Bibliography | null;
  entries: BibEntry[];
  labels: NodeLabel[];
  wordCount: number;
}

// Parsing and formatting the bibliography is the costly part of a pass, and
// it only changes when the BibTeX, the style or the cited set changes.
let entriesCache: { bib: string; entries: BibEntry[] } | null = null;
let bibliographyCache: { entries: BibEntry[]; style: CitationStyle; cited: string; result: Bibliography } | null = null;

export function bibEntries(bib: string): BibEntry[] {
  if (entriesCache?.bib !== bib) entriesCache = { bib, entries: parseBibtex(bib).entries };
  return entriesCache.entries;
}

function bibliographyFor(entries: BibEntry[], style: CitationStyle, citedKeys: string[]): Bibliography {
  const cited = citedKeys.join("\u0000");
  if (bibliographyCache && bibliographyCache.entries === entries && bibliographyCache.style === style && bibliographyCache.cited === cited) {
    return bibliographyCache.result;
  }
  const result = buildBibliography(entries, { style, citedKeys });
  bibliographyCache = { entries, style, cited, result };
  return result;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function analyzeDoc(doc: ProseMirrorNode, context: AnalysisContext): DocAnalysis {
  const { theme } = context;
  const style = conventions(theme);
  const numberHeadings = context.numberedHeadings && style.numbered;
  const counters = [0, 0, 0];
  let figures = 0;
  let tables = 0;
  let equations = 0;
  let footnoteCount = 0;
  let wordCount = 0;

  const outline: OutlineItem[] = [];
  const targets: RefTarget[] = [];
  const citedKeys: string[] = [];
  const footnotes: DocAnalysis["footnotes"] = [];
  const labels: NodeLabel[] = [];
  const citations: { pos: number; size: number; keys: string[] }[] = [];
  const crossRefs: { pos: number; size: number; target: string }[] = [];
  // Labels inside preserved LaTeX cannot be numbered here, but they do exist
  // (and export correctly), so references to them are not broken links.
  const rawLabels = new Set<string>();
  let bibliographyNode: { pos: number; size: number } | null = null;

  doc.descendants((node, pos) => {
    const type = node.type.name;
    switch (type) {
      case "text":
        wordCount += (node.text?.match(WORD) ?? []).length;
        return false;
      case "heading": {
        const level = Number(node.attrs.level) || 1;
        const id = String(node.attrs.id ?? "");
        const text = node.textContent.trim();
        let display = "";
        let ref = "";
        if (numberHeadings && node.attrs.numbered !== false && level <= 3) {
          counters[level - 1] += 1;
          for (let i = level; i < counters.length; i++) counters[i] = 0;
          ({ display, ref } = headingNumber(counters, level, theme));
          labels.push({ pos, size: node.nodeSize, attrs: { "data-number": display }, spec: { paperLabel: display } });
        }
        outline.push({ id, pos, level, number: display.replace(/[.)]$/, ""), text });
        if (id) {
          targets.push({
            id,
            kind: "section",
            pos,
            number: ref,
            label: ref ? `${style.sectionRef} ${ref}` : `“${text || "Untitled section"}”`,
            text,
          });
        }
        return true;
      }
      case "figure":
      case "tableFigure": {
        const isTable = type === "tableFigure";
        const number = isTable ? (style.romanTables ? toRoman(++tables, true) : String(++tables)) : String(++figures);
        const caption = node.firstChild;
        const captionText = caption?.type.name === "figcaption" ? caption.textContent.trim() : "";
        const label = isTable ? style.tableLabel(number) : style.figureLabel(number);
        if (caption?.type.name === "figcaption") {
          labels.push({ pos: pos + 1, size: caption.nodeSize, attrs: { "data-label": label }, spec: { paperLabel: label } });
        }
        const id = String(node.attrs.id ?? "");
        if (id) {
          targets.push({
            id,
            kind: isTable ? "table" : "figure",
            pos,
            number,
            label: `${isTable ? style.tableRef : style.figureRef} ${number}`,
            text: captionText,
          });
        }
        return true;
      }
      case "mathBlock": {
        const id = String(node.attrs.id ?? "");
        let number = "";
        if (node.attrs.numbered !== false) {
          number = String(++equations);
          labels.push({ pos, size: node.nodeSize, attrs: { "data-number": number }, spec: { paperLabel: number } });
        }
        if (id) {
          targets.push({
            id,
            kind: "equation",
            pos,
            number,
            label: number ? `${style.equationRef} (${number})` : "an unnumbered equation",
            text: String(node.attrs.latex ?? ""),
          });
        }
        return false;
      }
      case "citation": {
        const keys = (Array.isArray(node.attrs.keys) ? node.attrs.keys : []).map(String);
        for (const key of keys) if (!citedKeys.includes(key)) citedKeys.push(key);
        citations.push({ pos, size: node.nodeSize, keys });
        return false;
      }
      case "crossRef":
        crossRefs.push({ pos, size: node.nodeSize, target: String(node.attrs.target ?? "") });
        return false;
      case "footnote": {
        footnoteCount += 1;
        const label = String(footnoteCount);
        footnotes.push({ pos, number: footnoteCount, text: String(node.attrs.text ?? "") });
        labels.push({ pos, size: node.nodeSize, attrs: { "data-label": label }, spec: { paperLabel: label } });
        return false;
      }
      case "bibliography":
        bibliographyNode = { pos, size: node.nodeSize };
        return false;
      case "rawLatex": {
        const source = String(node.attrs.source ?? "");
        for (const match of source.matchAll(/\\label\{([^}]*)\}/g)) {
          const label = match[1].trim();
          if (label) rawLabels.add(label);
        }
        return false;
      }
      case "mathInline":
        return false;
      default:
        return true;
    }
  });

  const entries = bibEntries(context.bib);
  const bibliography = entries.length || citedKeys.length ? bibliographyFor(entries, context.citationStyle, citedKeys) : null;
  const missingKeys = bibliography ? bibliography.missing : citedKeys;

  for (const citation of citations) {
    const missing = citation.keys.length === 0 || citation.keys.some((key) => missingKeys.includes(key));
    const label = citation.keys.length === 0
      ? "[?]"
      : bibliography
        ? formatCitation(citation.keys, bibliography, "paren")
        : citation.keys.map(() => "[?]").join(", ");
    labels.push({
      pos: citation.pos,
      size: citation.size,
      attrs: { "data-label": label, ...(missing ? { "data-missing": "true" } : {}) },
      spec: { paperLabel: label, missing },
    });
  }

  const byId = new Map(targets.map((target) => [target.id, target]));
  for (const ref of crossRefs) {
    const target = byId.get(ref.target);
    const raw = !target && rawLabels.has(ref.target);
    // The number is computed by LaTeX, so the visual editor can only show the
    // label itself; `raw` keeps it from looking like a deleted target.
    const label = target ? target.label : raw ? ref.target : "[missing reference]";
    labels.push({
      pos: ref.pos,
      size: ref.size,
      attrs: {
        "data-label": label,
        ...(target ? {} : raw ? { "data-raw-ref": "true" } : { "data-missing": "true" }),
      },
      spec: { paperLabel: label, ...(target ? {} : raw ? { raw: true } : { missing: true }) },
    });
  }

  const listNode = bibliographyNode as { pos: number; size: number } | null;
  if (listNode) {
    const html = referenceListHtml(bibliography, "References", "paper-");
    labels.push({ pos: listNode.pos, size: listNode.size, attrs: { "data-version": hash(html) }, spec: { paperLabel: "References", html } });
  }

  return { outline, targets, citedKeys, missingKeys, footnotes, bibliography, entries, labels, wordCount };
}
