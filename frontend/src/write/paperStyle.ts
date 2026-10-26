/**
 * Maps page settings (visual documents) or a rendered layout (LaTeX
 * documents) to the `.paper` modifier classes and custom properties in
 * paper.css, so both editors, print and export share one look.
 */

import type { CSSProperties } from "react";
import type { PaperSettings } from "./documents.ts";
import type { PaperFont, PaperLayout } from "./latex/render.ts";

export interface PaperLook {
  theme: string;
  paper: "a4" | "letter";
  margins: "narrow" | "normal" | "wide";
  columns: 1 | 2;
  font: PaperFont;
  fontSize: number;
  lineSpacing: number;
  paragraphStyle: "indent" | "spaced";
}

export function lookFromSettings(settings: PaperSettings): PaperLook {
  return {
    theme: settings.theme,
    paper: settings.paper,
    margins: settings.margins,
    columns: settings.columns,
    font: settings.font,
    fontSize: settings.fontSize,
    lineSpacing: settings.theme === "apa" ? Math.max(settings.lineSpacing, 2) : settings.lineSpacing,
    paragraphStyle: settings.paragraphStyle,
  };
}

export function lookFromLayout(layout: PaperLayout): PaperLook {
  return {
    theme: layout.theme,
    paper: layout.paper,
    margins: "normal",
    columns: layout.columns,
    font: layout.font,
    fontSize: Math.min(Math.max(layout.fontSize, 9), 12),
    lineSpacing: layout.lineSpacing,
    paragraphStyle: "indent",
  };
}

export function paperClassName(look: PaperLook): string {
  return [
    "paper",
    `paper--theme-${look.theme}`,
    look.paper === "letter" ? "paper--letter" : "",
    look.margins !== "normal" ? `paper--margin-${look.margins}` : "",
    look.columns === 2 ? "paper--cols-2" : "",
    look.font !== "cm" ? `paper--font-${look.font}` : "",
    `paper--size-${look.fontSize}`,
    look.paragraphStyle === "spaced" ? "paper--spaced" : "paper--indent",
  ]
    .filter(Boolean)
    .join(" ");
}

export function paperStyle(look: PaperLook): CSSProperties {
  return { "--paper-spacing": String(look.lineSpacing) } as CSSProperties;
}

const MARGIN_SIZES = { narrow: "12.7mm", normal: "25.4mm", wide: "38.1mm" };

/** The CSS `@page` rule for printing a paper with this look. */
export function pageRule(look: PaperLook): string {
  return `@page { size: ${look.paper === "letter" ? "letter" : "A4"}; margin: ${MARGIN_SIZES[look.margins]}; }`;
}
