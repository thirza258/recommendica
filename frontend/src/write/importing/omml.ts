/**
 * Word equations (Office Math Markup, `m:oMath`) as LaTeX.
 *
 * Word stores equations as a tree of math objects — fractions, scripts,
 * radicals, n-ary operators, delimiters, matrices — with the symbols as
 * Unicode text. Each object maps to its LaTeX construct, and the text maps
 * to LaTeX commands where it has to (Greek letters, operators, arrows), so
 * the result reads like LaTeX written by hand.
 */

import { attr, child, elements, textOf } from "./xml.ts";
import type { XmlElement } from "./xml.ts";

const SYMBOLS: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta",
  ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho", σ: "\\sigma",
  ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon", φ: "\\varphi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "≅": "\\cong", "∼": "\\sim", "≃": "\\simeq", "∝": "\\propto", "≪": "\\ll", "≫": "\\gg",
  "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot", "∘": "\\circ", "∗": "\\ast", "⋆": "\\star", "•": "\\bullet",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists", "¬": "\\neg",
  "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "⊇": "\\supseteq", "⊄": "\\not\\subset",
  "∪": "\\cup", "∩": "\\cap", "∖": "\\setminus", "∧": "\\land", "∨": "\\lor", "⊕": "\\oplus", "⊗": "\\otimes", "⊙": "\\odot", "⊥": "\\perp",
  "∥": "\\parallel", "∠": "\\angle", "△": "\\triangle", "□": "\\square", "◻": "\\square", "†": "\\dagger", "‡": "\\ddagger",
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto",
  "⟶": "\\longrightarrow", "⟵": "\\longleftarrow", "⟹": "\\Longrightarrow", "⟸": "\\Longleftarrow", "⟺": "\\Longleftrightarrow", "↑": "\\uparrow", "↓": "\\downarrow",
  "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots", "′": "'", "″": "''", "‴": "'''",
  "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "ℙ": "\\mathbb{P}", "ℓ": "\\ell", "ℏ": "\\hbar",
  "ℜ": "\\Re", "ℑ": "\\Im", "ℵ": "\\aleph", "℘": "\\wp", "√": "\\surd", "⟨": "\\langle", "⟩": "\\rangle", "〈": "\\langle", "〉": "\\rangle",
  "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "‖": "\\|", "∣": "\\mid", "∤": "\\nmid", "°": "^{\\circ}", "∑": "\\sum", "∏": "\\prod",
  "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "⊢": "\\vdash", "⊨": "\\models", "∴": "\\therefore", "∵": "\\because",
  "\u2212": "-", "\u2236": ":", "\u2061": "", "\u200b": "", "\u2062": "", "\u2063": "", "\u2009": "\\,", "\u200a": "\\,", "\u205f": "\\;",
};

/** Characters TeX's math mode reads as commands or that it must not see bare. */
const MATH_SPECIALS: Record<string, string> = { "{": "\\{", "}": "\\}", "#": "\\#", "%": "\\%", $: "\\$", _: "\\_", "&": "\\&", "~": "\\sim", "\\": "\\backslash", "^": "\\hat{}" };

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "log", "ln", "lg", "exp",
  "lim", "liminf", "limsup", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "hom", "Pr",
]);

const NARY: Record<string, string> = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "∯": "\\oiint", "⋃": "\\bigcup",
  "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge", "⨁": "\\bigoplus", "⨂": "\\bigotimes", "⨀": "\\bigodot", "⨄": "\\biguplus",
};

const DELIMITERS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⟨": "\\langle", "⟩": "\\rangle", "〈": "\\langle",
  "〉": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "/": "/", "\\": "\\backslash", "⟦": "[\\![", "⟧": "]\\!]",
};

const ACCENTS: Record<string, string> = {
  "\u0302": "\\hat", "\u0303": "\\tilde", "\u0304": "\\bar", "\u0305": "\\bar", "\u0307": "\\dot", "\u0308": "\\ddot", "\u20db": "\\dddot", "\u20d7": "\\vec",
  "\u0301": "\\acute", "\u0300": "\\grave", "\u0306": "\\breve", "\u030c": "\\check", "\u20d6": "\\overleftarrow", "\u20e1": "\\overleftrightarrow",
  "^": "\\hat", "~": "\\tilde", "\u00af": "\\bar", "\u2192": "\\vec",
};

const WIDE_ACCENTS: Record<string, string> = { "\\hat": "\\widehat", "\\tilde": "\\widetilde", "\\bar": "\\overline", "\\vec": "\\overrightarrow" };

/** Mathematical alphanumeric symbols (𝑥, 𝐱, ℝ-like 𝔸): base letter and LaTeX font. */
function mathAlphanumeric(code: number): { char: string; font: string } | null {
  if (code < 0x1d400 || code > 0x1d7ff) return null;
  if (code >= 0x1d7ce) {
    const digit = (code - 0x1d7ce) % 10;
    const font = ["\\mathbf", "\\mathbb", "\\mathsf", "\\mathbf", "\\mathtt"][Math.floor((code - 0x1d7ce) / 10)] ?? "";
    return { char: String(digit), font };
  }
  const index = code - 0x1d400;
  const style = Math.floor(index / 52);
  const offset = index % 52;
  const char = offset < 26 ? String.fromCharCode(65 + offset) : String.fromCharCode(97 + offset - 26);
  // bold, italic, bold italic, script, bold script, fraktur, double-struck,
  // bold fraktur, sans, sans bold, sans italic, sans bold italic, monospace
  const fonts = ["\\mathbf", "", "\\boldsymbol", "\\mathcal", "\\mathcal", "\\mathfrak", "\\mathbb", "\\mathfrak", "\\mathsf", "\\mathsf", "\\mathsf", "\\mathsf", "\\mathtt"];
  if (style >= fonts.length) return null;
  return { char, font: fonts[style] };
}

/** Text of a math run as LaTeX math. */
function mathText(text: string, alignment: boolean): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "&" && alignment) {
      out += "&";
      continue;
    }
    const styled = mathAlphanumeric(code);
    if (styled) {
      out += styled.font ? `${styled.font}{${styled.char}}` : styled.char;
      continue;
    }
    const symbol = SYMBOLS[char] ?? MATH_SPECIALS[char];
    if (symbol !== undefined) {
      // A command followed by a letter needs a space to end its name.
      out += symbol && /^\\[A-Za-z]+$/.test(symbol) ? `${symbol} ` : symbol;
      continue;
    }
    if (char === " " || char === "\t") {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

/** Text for \text{…}: text-mode escapes. */
function textModeText(text: string): string {
  return text.replace(/[\\{}$&#%_~^]/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : ch === "~" ? "\\textasciitilde{}" : ch === "^" ? "\\textasciicircum{}" : `\\${ch}`));
}

/** One token or group does not need braces after ^ or _ (x^2 vs x^{10}). */
function group(latex: string): string {
  const trimmed = latex.trim();
  if (/^[A-Za-z0-9]$/.test(trimmed) || /^\\[A-Za-z]+$/.test(trimmed)) return trimmed;
  return `{${trimmed}}`;
}

/** A base before ^ or _: braced unless it is one token, so x^2 does not become {x}^2. */
function base(latex: string): string {
  const trimmed = latex.trim();
  if (!trimmed) return "{}";
  if (/^[A-Za-z0-9]$/.test(trimmed) || /^\\[A-Za-z]+$/.test(trimmed) || /\\right\S*$/.test(trimmed) || /^\{.*\}$/.test(trimmed)) return trimmed;
  return `{${trimmed}}`;
}

function delimiter(char: string | null, fallback: string): string {
  const value = char === null ? fallback : char;
  if (value === "") return ".";
  return DELIMITERS[value] ?? mathText(value, false).trim();
}

/** A property's `m:val`; `fallback` when the property is absent. */
function prop(element: XmlElement | null, properties: string, name: string, fallback: string | null = null): string | null {
  const holder = child(element, properties);
  const found = child(holder, name);
  if (!found) return fallback;
  return attr(found, "val") ?? "";
}

/** On/off properties: present means on unless m:val says 0/off/false. */
function flag(element: XmlElement | null, properties: string, name: string): boolean {
  const holder = child(element, properties);
  const found = child(holder, name);
  if (!found) return false;
  const value = attr(found, "val");
  return value === null || !/^(0|off|false)$/i.test(value);
}

interface Context {
  /** Inside an equation array or matrix row, where & aligns. */
  alignment: boolean;
}

function convertChildren(element: XmlElement | null, context: Context): string {
  if (!element) return "";
  let out = "";
  for (const node of elements(element)) {
    if (/Pr$/.test(node.local)) continue;
    const piece = convert(node, context);
    // Two commands, or a command and a letter, must not run together.
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(piece)) out += " ";
    out += piece;
  }
  return out;
}

function run(element: XmlElement, context: Context): string {
  const properties = child(element, "rPr");
  const text = elements(element, "t").map((node) => textOf(node)).join("");
  if (!text) return "";
  // Ordinary text inside an equation.
  if (child(properties, "nor")) return `\\text{${textModeText(text)}}`;
  const style = attr(child(properties, "sty"), "val");
  const script = attr(child(properties, "scr"), "val");
  if (/^[A-Za-z]{2,}$/.test(text) && FUNCTIONS.has(text)) return `\\${text} `;
  let latex = mathText(text, context.alignment);
  const font =
    script === "double-struck" ? "\\mathbb" : script === "script" ? "\\mathcal" : script === "fraktur" ? "\\mathfrak" : script === "sans-serif" ? "\\mathsf" : script === "monospace" ? "\\mathtt"
      : style === "b" ? "\\mathbf" : style === "bi" ? "\\boldsymbol" : style === "p" && /[A-Za-z]/.test(text) ? "\\mathrm" : "";
  if (font && latex.trim()) latex = `${font}{${latex.trim()}}`;
  return latex;
}

function fraction(element: XmlElement, context: Context): string {
  const numerator = convertChildren(child(element, "num"), context);
  const denominator = convertChildren(child(element, "den"), context);
  switch (prop(element, "fPr", "type")) {
    case "lin":
    case "skw":
      return `${base(numerator)}/${base(denominator)}`;
    case "noBar":
      return `\\genfrac{}{}{0pt}{}{${numerator}}{${denominator}}`;
    default:
      return `\\frac{${numerator}}{${denominator}}`;
  }
}

function nary(element: XmlElement, context: Context): string {
  const char = prop(element, "naryPr", "chr", "∫") || "∫";
  const operator = NARY[char] ?? `\\mathop{${mathText(char, false).trim()}}`;
  const limits = prop(element, "naryPr", "limLoc") === "undOvr" && /^\\(?:i+nt|oint)/.test(operator) ? "\\limits" : "";
  const sub = flag(element, "naryPr", "subHide") ? "" : convertChildren(child(element, "sub"), context).trim();
  const sup = flag(element, "naryPr", "supHide") ? "" : convertChildren(child(element, "sup"), context).trim();
  const body = convertChildren(child(element, "e"), context).trim();
  return `${operator}${limits}${sub ? `_${group(sub)}` : ""}${sup ? `^${group(sup)}` : ""}${body ? ` ${body}` : ""}`;
}

function matrixRows(element: XmlElement, context: Context): string {
  const inner = { ...context, alignment: true };
  return elements(element, "mr")
    .map((row) => elements(row, "e").map((cell) => convertChildren(cell, inner).trim()).join(" & "))
    .join(" \\\\ ");
}

function delimited(element: XmlElement, context: Context): string {
  const open = prop(element, "dPr", "begChr");
  const close = prop(element, "dPr", "endChr");
  const separator = prop(element, "dPr", "sepChr", "|") ?? "|";
  const parts = elements(element, "e");
  // A bracketed matrix is a pmatrix, bmatrix, … and braces around rows are cases.
  if (parts.length === 1) {
    const inner = elements(parts[0]).filter((node) => !/Pr$/.test(node.local));
    if (inner.length === 1 && inner[0].local === "m") {
      const kind: Record<string, string> = { "()": "pmatrix", "[]": "bmatrix", "{}": "Bmatrix", "||": "vmatrix", "‖‖": "Vmatrix" };
      const name = kind[`${open ?? "("}${close ?? ")"}`];
      if (name) return `\\begin{${name}}${matrixRows(inner[0], context)}\\end{${name}}`;
    }
    if (inner.length === 1 && inner[0].local === "eqArr" && (open ?? "(") === "{" && (close ?? ")") === "") {
      const rows = elements(inner[0], "e").map((row) => convertChildren(row, { ...context, alignment: true }).trim());
      return `\\begin{cases}${rows.join(" \\\\ ")}\\end{cases}`;
    }
  }
  const middle = separator === "|" ? " \\middle| " : ` ${mathText(separator, false).trim()} `;
  const body = parts.map((part) => convertChildren(part, context).trim()).join(middle);
  return `\\left${delimiter(open, "(")}${body}\\right${delimiter(close, ")")}`;
}

function func(element: XmlElement, context: Context): string {
  const nameElement = child(element, "fName");
  const body = convertChildren(child(element, "e"), context).trim();
  const plain = textOf(nameElement).trim();
  let name: string;
  if (/^[A-Za-z]+$/.test(plain) && elements(nameElement).every((node) => node.local === "r" || /Pr$/.test(node.local))) {
    name = FUNCTIONS.has(plain) ? `\\${plain}` : `\\operatorname{${plain}}`;
  } else {
    name = convertChildren(nameElement, context).trim();
  }
  return `${name}${/^[\\([{|]/.test(body) || !body ? "" : " "}${body}`;
}

function limit(element: XmlElement, context: Context, upper: boolean): string {
  const baseElement = child(element, "e");
  const plain = textOf(baseElement).trim();
  const below = convertChildren(child(element, "lim"), context).trim();
  if (!upper && /^(lim|max|min|sup|inf|liminf|limsup)$/.test(plain)) return `\\${plain}_${group(below)}`;
  const body = convertChildren(baseElement, context).trim();
  return upper ? `\\overset{${below}}{${body}}` : `\\underset{${below}}{${body}}`;
}

function accent(element: XmlElement, context: Context): string {
  const char = prop(element, "accPr", "chr", "\u0302") || "\u0302";
  const body = convertChildren(child(element, "e"), context).trim();
  const command = ACCENTS[char] ?? "\\hat";
  const wide = body.replace(/\\[A-Za-z]+\s*/g, "x").replace(/[{}\s]/g, "").length > 1;
  return `${wide ? (WIDE_ACCENTS[command] ?? command) : command}{${body}}`;
}

function groupCharacter(element: XmlElement, context: Context): string {
  const char = prop(element, "groupChrPr", "chr", "\u23df") || "\u23df";
  const position = prop(element, "groupChrPr", "pos", "bot");
  const body = convertChildren(child(element, "e"), context).trim();
  if (char === "\u23df" || char === "\ufe38") return `\\underbrace{${body}}`;
  if (char === "\u23de" || char === "\ufe37") return `\\overbrace{${body}}`;
  const symbol = mathText(char, false).trim();
  return position === "top" ? `\\overset{${symbol}}{${body}}` : `\\underset{${symbol}}{${body}}`;
}

function convert(element: XmlElement, context: Context): string {
  switch (element.local) {
    case "r":
      return run(element, context);
    case "f":
      return fraction(element, context);
    case "sSup":
      return `${base(convertChildren(child(element, "e"), context))}^${group(convertChildren(child(element, "sup"), context))}`;
    case "sSub":
      return `${base(convertChildren(child(element, "e"), context))}_${group(convertChildren(child(element, "sub"), context))}`;
    case "sSubSup":
      return `${base(convertChildren(child(element, "e"), context))}_${group(convertChildren(child(element, "sub"), context))}^${group(convertChildren(child(element, "sup"), context))}`;
    case "sPre":
      return `{}_${group(convertChildren(child(element, "sub"), context))}^${group(convertChildren(child(element, "sup"), context))}${base(convertChildren(child(element, "e"), context))}`;
    case "rad": {
      const degree = flag(element, "radPr", "degHide") ? "" : convertChildren(child(element, "deg"), context).trim();
      return `\\sqrt${degree ? `[${degree}]` : ""}{${convertChildren(child(element, "e"), context).trim()}}`;
    }
    case "nary":
      return nary(element, context);
    case "d":
      return delimited(element, context);
    case "func":
      return func(element, context);
    case "limLow":
      return limit(element, context, false);
    case "limUpp":
      return limit(element, context, true);
    case "acc":
      return accent(element, context);
    case "bar":
      return `${prop(element, "barPr", "pos", "bot") === "top" ? "\\overline" : "\\underline"}{${convertChildren(child(element, "e"), context).trim()}}`;
    case "groupChr":
      return groupCharacter(element, context);
    case "borderBox":
      return `\\boxed{${convertChildren(child(element, "e"), context).trim()}}`;
    case "phant":
      return `\\phantom{${convertChildren(child(element, "e"), context).trim()}}`;
    case "m":
      return `\\begin{matrix}${matrixRows(element, context)}\\end{matrix}`;
    case "eqArr": {
      const rows = elements(element, "e").map((row) => convertChildren(row, { ...context, alignment: true }).trim());
      const env = rows.some((row) => row.includes("&")) ? "aligned" : "gathered";
      return `\\begin{${env}}${rows.join(" \\\\ ")}\\end{${env}}`;
    }
    case "t":
      return mathText(textOf(element), context.alignment);
    default:
      // Arguments (e, num, sub, …), boxes and anything newer: their content.
      return convertChildren(element, context);
  }
}

/** LaTeX for one `m:oMath` element (without $ … $). */
export function ommlToLatex(element: XmlElement): string {
  return convertChildren(element, { alignment: false })
    .replace(/\s+/g, " ")
    .replace(/\s+([_^}])/g, "$1")
    .replace(/([{(]) /g, "$1")
    .trim();
}

/**
 * LaTeX for an `m:oMathPara`: its equations, one per line. A trailing
 * `#(n)` or `(n)` that Word uses for an equation number is returned apart.
 */
export function ommlParagraph(element: XmlElement): { latex: string; number: string | null } {
  const equations = elements(element, "oMath").map((math) => ommlToLatex(math)).filter(Boolean);
  let latex = equations.join(" \\\\ ");
  let number: string | null = null;
  // "#" reaches here escaped (\#), as any literal # in math would.
  const numbered = /\\#\s*\\left\(\s*([0-9]+(?:\.[0-9]+)*)\s*\\right\)\s*$/.exec(latex) ?? /\\#\s*\(\s*([0-9]+(?:\.[0-9]+)*)\s*\)\s*$/.exec(latex);
  if (numbered) {
    number = numbered[1];
    latex = latex.slice(0, numbered.index).trim();
  }
  return { latex, number };
}
