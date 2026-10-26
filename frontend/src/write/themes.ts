/**
 * Paper designs and their typographic conventions.
 *
 * One table drives section numbers, caption labels and the words used in
 * cross-references, both in the visual editor and in the exported LaTeX, so
 * "Fig. 2" on screen is "Fig.~\ref{…}" in the .tex. The arXiv-style designs
 * are look-alikes of common preprint layouts, not the official venue files.
 */

import { toAlpha, toRoman } from "./latex/symbols.ts";

export type VisualTheme = "article" | "ieee" | "apa" | "arxiv" | "mlconf" | "revtex" | "amsart";

export const VISUAL_THEMES: readonly VisualTheme[] = ["article", "ieee", "apa", "arxiv", "mlconf", "revtex", "amsart"];

export interface ThemeConventions {
  label: string;
  /** Whether headings are numbered at all (APA never numbers them). */
  numbered: boolean;
  /** Tables numbered I, II, III (IEEE, APS) rather than 1, 2, 3. */
  romanTables: boolean;
  figureLabel: (number: string) => string;
  tableLabel: (number: string) => string;
  /** The word a cross-reference prints before the number. */
  figureRef: string;
  tableRef: string;
  sectionRef: string;
  equationRef: string;
}

export const THEMES: Record<VisualTheme, ThemeConventions> = {
  article: {
    label: "Article",
    numbered: true,
    romanTables: false,
    figureLabel: (n) => `Figure ${n}:`,
    tableLabel: (n) => `Table ${n}:`,
    figureRef: "Figure",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Eq.",
  },
  ieee: {
    label: "IEEE",
    numbered: true,
    romanTables: true,
    figureLabel: (n) => `Fig. ${n}.`,
    tableLabel: (n) => `TABLE ${n}`,
    figureRef: "Fig.",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Eq.",
  },
  apa: {
    label: "APA 7",
    numbered: false,
    romanTables: false,
    figureLabel: (n) => `Figure ${n}`,
    tableLabel: (n) => `Table ${n}`,
    figureRef: "Figure",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Equation",
  },
  arxiv: {
    label: "arXiv preprint",
    numbered: true,
    romanTables: false,
    figureLabel: (n) => `Figure ${n}:`,
    tableLabel: (n) => `Table ${n}:`,
    figureRef: "Figure",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Eq.",
  },
  mlconf: {
    label: "ML conference preprint",
    numbered: true,
    romanTables: false,
    figureLabel: (n) => `Figure ${n}.`,
    tableLabel: (n) => `Table ${n}.`,
    figureRef: "Figure",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Eq.",
  },
  revtex: {
    label: "APS/REVTeX-style",
    numbered: true,
    romanTables: true,
    figureLabel: (n) => `FIG. ${n}.`,
    tableLabel: (n) => `TABLE ${n}.`,
    figureRef: "Fig.",
    tableRef: "Table",
    sectionRef: "Sec.",
    equationRef: "Eq.",
  },
  amsart: {
    label: "AMS article",
    numbered: true,
    romanTables: false,
    figureLabel: (n) => `Figure ${n}.`,
    tableLabel: (n) => `Table ${n}.`,
    figureRef: "Figure",
    tableRef: "Table",
    sectionRef: "Section",
    equationRef: "Eq.",
  },
};

export function conventions(theme: VisualTheme): ThemeConventions {
  return THEMES[theme] ?? THEMES.article;
}

/**
 * Heading number as printed (`display`) and as referenced (`ref`).
 * IEEE prints "I." / "A." / "1)" and refers to "I-A1"; APS prints "I." /
 * "A." / "1." and refers to "I A 1"; amsart prints "1." / "1.1.".
 */
export function headingNumber(counters: number[], level: number, theme: VisualTheme): { display: string; ref: string } {
  if (theme === "ieee" || theme === "revtex") {
    const section = toRoman(counters[0], true);
    const sub = toAlpha(counters[1], true);
    const join = theme === "ieee" ? "-" : " ";
    if (level === 1) return { display: `${section}.`, ref: section };
    if (level === 2) return { display: `${sub}.`, ref: `${section}${join}${sub}` };
    return {
      display: theme === "ieee" ? `${counters[2]})` : `${counters[2]}.`,
      ref: theme === "ieee" ? `${section}-${sub}${counters[2]}` : `${section} ${sub} ${counters[2]}`,
    };
  }
  const value = counters.slice(0, level).join(".");
  return { display: theme === "amsart" ? `${value}.` : value, ref: value };
}
