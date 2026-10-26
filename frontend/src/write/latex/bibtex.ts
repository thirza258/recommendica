/**
 * BibTeX for Paper Studio.
 *
 * A tolerant parser (problems become diagnostics; it never throws), a
 * canonical serializer, BibTeX name splitting, LaTeX-to-Unicode text
 * conversion, and IEEE / APA 7 reference lists with in-text citation labels.
 *
 * Pure and DOM-free so the node test runner can import it directly. Every
 * string that reaches HTML goes through escapeHtml (or the caller's
 * renderText), and links are only emitted for http(s) URLs and
 * https://doi.org DOIs.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
  line: number;
}

export interface BibDiagnostic {
  line: number;
  message: string;
}

export interface BibDatabase {
  entries: BibEntry[];
  diagnostics: BibDiagnostic[];
}

export interface PersonName {
  first: string;
  von: string;
  last: string;
  jr: string;
}

export type CitationStyle = "ieee" | "apa";

export interface CitationLabel {
  number: number;
  authors: string;
  textAuthors: string;
  year: string;
}

export interface BibliographyItem {
  key: string;
  label: string;
  html: string;
}

export interface Bibliography {
  style: CitationStyle;
  items: BibliographyItem[];
  labels: Record<string, CitationLabel>;
  missing: string[];
}

export interface BibliographyOptions {
  style: CitationStyle;
  citedKeys: string[];
  includeAll?: boolean;
  renderText?: (latex: string) => string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBREVIATIONS = [
  "Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.",
  "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.",
];

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

/** Assigns without ever touching a prototype, even for a key like "__proto__". */
function setOwn<T>(object: Record<string, T>, key: string, value: T) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// ── Parsing ────────────────────────────────────────────────────────────────

const SPACE = /\s/;

function lineLookup(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

const collapseSpace = (value: string) => value.replace(/\s+/g, " ").trim();

export function parseBibtex(source: string): BibDatabase {
  const src = typeof source === "string" ? source : "";
  const length = src.length;
  const entries: BibEntry[] = [];
  const diagnostics: BibDiagnostic[] = [];
  // Null prototype: a macro named "constructor" must not resolve to a function.
  const macros: Record<string, string> = Object.create(null);
  MONTH_NAMES.forEach((name) => {
    macros[name.slice(0, 3).toLowerCase()] = name;
  });
  const keys = new Set<string>();
  const lineOf = lineLookup(src);
  let pos = 0;

  const report = (offset: number, message: string) => {
    diagnostics.push({ line: lineOf(offset), message });
  };

  const skipSpace = () => {
    while (pos < length && SPACE.test(src[pos])) pos++;
  };

  /** Only whitespace separates `offset` from the start of its line. */
  const startsLine = (offset: number) => {
    for (let i = offset - 1; i >= 0 && src[i] !== "\n"; i--) {
      if (!SPACE.test(src[i])) return false;
    }
    return true;
  };

  /** The next line-initial "@" after `offset`: where parsing resumes after an error. */
  const recoveryPoint = (offset: number) => {
    let at = src.indexOf("@", offset);
    while (at >= 0 && !startsLine(at)) at = src.indexOf("@", at + 1);
    return at < 0 ? length : at;
  };

  // BibTeX counts every brace, escaped or not, so these do too.
  const matchBrace = (open: number) => {
    let depth = 0;
    for (let i = open; i < length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return i;
    }
    return -1;
  };

  const matchQuote = (open: number) => {
    let depth = 0;
    for (let i = open + 1; i < length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
      else if (ch === '"' && depth === 0) return i;
    }
    return -1;
  };

  /** Moves past the delimiter closing the current body (`pos` is inside it). */
  const skipPast = (close: string, start: number, what: string) => {
    let depth = 0;
    for (let i = pos; i < length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}" && depth > 0) depth--;
      else if (ch === close && depth === 0) {
        pos = i + 1;
        return;
      }
    }
    report(start, `Unterminated ${what}`);
    pos = recoveryPoint(start + 1);
  };

  /** The next "," or closing delimiter at depth 0; always moves forward. */
  const separatorAfter = (close: string) => {
    let depth = 0;
    let i = pos;
    for (; i < length; i++) {
      const ch = src[i];
      if (ch === "@" && depth === 0 && i > pos && startsLine(i)) return i;
      if (ch === "{") depth++;
      else if (ch === "}" && depth > 0) depth--;
      else if (depth === 0 && (ch === "," || ch === close)) return i;
    }
    return i;
  };

  /** `part # part # …`; null when a brace or quote never closes. */
  const readValue = (fieldStart: number): string | null => {
    let value = "";
    for (;;) {
      skipSpace();
      const ch = pos < length ? src[pos] : "";
      if (ch === "{") {
        const end = matchBrace(pos);
        if (end < 0) return null;
        value += src.slice(pos + 1, end);
        pos = end + 1;
      } else if (ch === '"') {
        const end = matchQuote(pos);
        if (end < 0) return null;
        value += src.slice(pos + 1, end);
        pos = end + 1;
      } else if (/[0-9]/.test(ch)) {
        const start = pos;
        while (pos < length && /[0-9]/.test(src[pos])) pos++;
        value += src.slice(start, pos);
      } else if (/[A-Za-z_]/.test(ch)) {
        const start = pos;
        while (pos < length && /[^\s,#{}()"=]/.test(src[pos])) pos++;
        const name = src.slice(start, pos);
        const expansion = macros[name.toLowerCase()];
        if (expansion === undefined) {
          report(start, `Undefined string "${name}"`);
          value += name;
        } else {
          value += expansion;
        }
      } else {
        report(fieldStart, "Missing field value");
        return collapseSpace(value);
      }
      skipSpace();
      if (src[pos] !== "#") return collapseSpace(value);
      pos++;
    }
  };

  const readString = (close: string, start: number) => {
    skipSpace();
    const nameStart = pos;
    while (pos < length && /[^\s=,{}()"#]/.test(src[pos])) pos++;
    const name = src.slice(nameStart, pos);
    skipSpace();
    if (!name || src[pos] !== "=") {
      report(start, "Malformed @string definition");
      skipPast(close, start, "@string definition");
      return;
    }
    pos++;
    const value = readValue(nameStart);
    if (value === null) {
      report(start, `Unbalanced braces or quotes in @string "${name}"`);
      pos = recoveryPoint(start + 1);
      return;
    }
    macros[name.toLowerCase()] = value;
    skipSpace();
    if (src[pos] === close) {
      pos++;
    } else {
      report(pos, `Expected "${close}" after @string "${name}"`);
      skipPast(close, start, "@string definition");
    }
  };

  const readEntry = (type: string, close: string, start: number) => {
    skipSpace();
    const keyStart = pos;
    while (
      pos < length &&
      !SPACE.test(src[pos]) &&
      src[pos] !== "," &&
      src[pos] !== "{" &&
      src[pos] !== "}" &&
      src[pos] !== close
    ) {
      pos++;
    }
    const key = src.slice(keyStart, pos);
    const fields: Record<string, string> = {};

    skipSpace();
    if (src[pos] === ",") {
      pos++;
    } else if (src[pos] !== close && pos < length) {
      report(pos, `Expected "," after the key "${key}"`);
    }

    for (;;) {
      skipSpace();
      if (pos >= length || (src[pos] === "@" && startsLine(pos))) {
        report(start, `Unterminated entry "${key || type}"`);
        break;
      }
      const ch = src[pos];
      if (ch === close) {
        pos++;
        break;
      }
      if (ch === ",") {
        pos++;
        continue;
      }
      const nameStart = pos;
      while (pos < length && /[^\s=,{}()"#@]/.test(src[pos])) pos++;
      const name = src.slice(nameStart, pos).toLowerCase();
      if (!name) {
        report(pos, `Unexpected "${ch}" in entry "${key}"`);
        pos = separatorAfter(close);
        continue;
      }
      skipSpace();
      if (src[pos] !== "=") {
        report(nameStart, `Expected "=" after the field "${name}"`);
        pos = separatorAfter(close);
        continue;
      }
      pos++;
      const value = readValue(nameStart);
      if (value === null) {
        report(nameStart, `Unbalanced braces or quotes in the field "${name}"`);
        pos = recoveryPoint(nameStart);
        break;
      }
      if (hasOwn(fields, name)) {
        report(nameStart, `Duplicate field "${name}" in "${key}" (the first value is kept)`);
      } else {
        setOwn(fields, name, value);
      }
      skipSpace();
      if (
        pos < length &&
        src[pos] !== "," &&
        src[pos] !== close &&
        !(src[pos] === "@" && startsLine(pos))
      ) {
        report(pos, `Expected "," or the end of the entry "${key}"`);
        pos = separatorAfter(close);
      }
    }

    if (!key) {
      report(start, `@${type} entry has no citation key`);
    } else if (keys.has(key)) {
      report(start, `Duplicate key "${key}" (the first entry is kept)`);
    } else {
      keys.add(key);
      entries.push({ type, key, fields, line: lineOf(start) });
    }
  };

  while (pos < length) {
    const at = src.indexOf("@", pos);
    if (at < 0) break;
    pos = at + 1;
    // Outside entries a "%" line is a comment (as in biber), so a commented-out
    // entry stays out.
    const lineStart = src.lastIndexOf("\n", at) + 1;
    if (src.slice(lineStart, at).includes("%")) {
      const lineEnd = src.indexOf("\n", at);
      pos = lineEnd < 0 ? length : lineEnd + 1;
      continue;
    }
    skipSpace();
    const typeStart = pos;
    while (pos < length && /[A-Za-z]/.test(src[pos])) pos++;
    const type = src.slice(typeStart, pos).toLowerCase();
    if (!type) continue;
    skipSpace();
    const open = src[pos];
    if (open !== "{" && open !== "(") continue;
    const close = open === "{" ? "}" : ")";
    pos++;
    if (type === "comment" || type === "preamble") skipPast(close, at, `@${type}`);
    else if (type === "string") readString(close, at);
    else readEntry(type, close, at);
  }

  return { entries, diagnostics };
}

// ── Serializing ────────────────────────────────────────────────────────────

/** Drops braces that would close the field early and closes any left open. */
function balanceBraces(value: string): string {
  let depth = 0;
  let out = "";
  for (const ch of value) {
    if (ch === "{") depth++;
    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
    }
    out += ch;
  }
  return out + "}".repeat(depth);
}

export function serializeBibEntry(entry: BibEntry): string {
  const names = Object.keys(entry.fields);
  const ordered = [
    ...["author", "title"].filter((name) => names.includes(name)),
    ...names.filter((name) => name !== "author" && name !== "title"),
  ];
  const body = ordered
    .map((name) => `  ${name.toLowerCase()} = {${balanceBraces(entry.fields[name])}},`)
    .join("\n");
  return `@${entry.type.toLowerCase()}{${entry.key},${body ? `\n${body}` : ""}\n}`;
}

export function serializeBibtex(entries: BibEntry[]): string {
  return entries.length ? `${entries.map(serializeBibEntry).join("\n\n")}\n` : "";
}

// ── LaTeX to text ──────────────────────────────────────────────────────────

/** Accent commands → combining marks; NFC composes them with their base. */
const ACCENTS: Record<string, string> = {
  '"': "̈",
  "'": "́",
  "`": "̀",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  k: "̨",
  r: "̊",
  d: "̣",
  b: "̱",
  t: "͡",
};

/** Commands that stand for a letter; spaces after them are swallowed, as in TeX. */
const LETTERS: Record<string, string> = {
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", aa: "å", AA: "Å",
  l: "ł", L: "Ł", i: "ı", j: "ȷ", dh: "ð", DH: "Ð", th: "þ", TH: "Þ", ng: "ŋ", NG: "Ŋ",
};

const SYMBOLS: Record<string, string> = {
  LaTeX: "LaTeX", TeX: "TeX", ldots: "…", dots: "…", textellipsis: "…",
  textendash: "–", textemdash: "—", S: "§", P: "¶", copyright: "©",
  textcopyright: "©", textregistered: "®", texttrademark: "™", euro: "€",
  pounds: "£", textbackslash: "\\", textasciitilde: "~", textasciicircum: "^",
  textbar: "|", textless: "<", textgreater: ">", textquoteleft: "‘",
  textquoteright: "’", textquotedblleft: "“", textquotedblright: "”",
  textdegree: "°", dag: "†", ddag: "‡", textbullet: "•", today: "",
  // Math symbols; the most common ones in titles.
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ",
  rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
  phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ",
  Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ", Nu: "Ν",
  Xi: "Ξ", Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ",
  Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "·", leq: "≤", le: "≤",
  geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", equiv: "≡",
  infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫",
  in: "∈", ell: "ℓ", circ: "∘", star: "⋆", ast: "∗",
};

/** Font switches like {\em x}: they produce nothing and swallow following spaces. */
const SWITCHES = new Set([
  "em", "bf", "it", "sc", "rm", "sf", "tt", "sl", "up", "md", "bfseries",
  "itshape", "scshape", "rmfamily", "sffamily", "ttfamily", "upshape",
  "slshape", "mdseries", "normalfont", "tiny", "scriptsize", "footnotesize",
  "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "relax",
  "protect", "displaystyle", "textstyle", "scriptstyle",
]);

function convertLatex(src: string): string {
  const n = src.length;
  let i = 0;
  let math = false;

  const skipSpaces = () => {
    while (i < n && /[ \t\r\n]/.test(src[i])) i++;
  };

  /** Content of the group opening at `i`, honouring \{ and \}; moves past it. */
  const readGroup = (): string => {
    let depth = 0;
    const start = i + 1;
    for (let j = i; j < n; j++) {
      const ch = src[j];
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        i = j + 1;
        return src.slice(start, j);
      }
    }
    i = n;
    return src.slice(start);
  };

  /** One argument as raw source: a group, a control sequence or a character. */
  const readArgument = (): string => {
    skipSpaces();
    if (i >= n) return "";
    if (src[i] === "{") return readGroup();
    if (src[i] === "\\") {
      const start = i;
      i++;
      if (/[A-Za-z]/.test(src[i] ?? "")) {
        while (i < n && /[A-Za-z]/.test(src[i])) i++;
      } else {
        i++;
      }
      return src.slice(start, i);
    }
    const ch = String.fromCodePoint(src.codePointAt(i) ?? 0);
    i += ch.length;
    return ch;
  };

  const accent = (mark: string): string => {
    const raw = readArgument().trim();
    // The accent replaces the dot: \'{\i} is í, not ı́.
    const base = raw === "\\i" ? "i" : raw === "\\j" ? "j" : convertLatex(raw);
    if (!base) return "";
    const first = String.fromCodePoint(base.codePointAt(0) ?? 0);
    return first + mark + base.slice(first.length);
  };

  const command = (): string => {
    i++;
    if (i >= n) return "";
    const ch = src[i];
    if (!/[A-Za-z]/.test(ch)) {
      i++;
      if (hasOwn(ACCENTS, ch)) return accent(ACCENTS[ch]);
      if ("&%$#_{}".includes(ch)) return ch;
      if (ch === "\\" || ch === " " || ch === "," || ch === ";" || ch === ":") return " ";
      if (ch === "!" || ch === "-" || ch === "/" || ch === "@") return "";
      return ch;
    }
    const start = i;
    while (i < n && /[A-Za-z]/.test(src[i])) i++;
    const name = src.slice(start, i);
    if (name.length === 1 && hasOwn(ACCENTS, name)) return accent(ACCENTS[name]);
    if (hasOwn(LETTERS, name)) {
      if (src.startsWith("{}", i)) i += 2;
      else skipSpaces();
      return LETTERS[name];
    }
    if (hasOwn(SYMBOLS, name)) {
      if (src.startsWith("{}", i)) i += 2;
      return SYMBOLS[name];
    }
    if (SWITCHES.has(name)) {
      skipSpaces();
      return "";
    }
    switch (name) {
      case "url":
        return readArgument();
      case "href":
      case "noopsort":
        readArgument();
        return "";
      case "MakeUppercase":
      case "uppercase":
        return convertLatex(readArgument()).toUpperCase();
      case "MakeLowercase":
      case "lowercase":
        return convertLatex(readArgument()).toLowerCase();
      default:
        // \textbf{x}, \emph{x}, \mathcal{X}, unknown commands: the command
        // disappears and the group that follows is read as plain content.
        return "";
    }
  };

  let out = "";
  while (i < n) {
    const ch = src[i];
    if (ch === "\\") {
      out += command();
    } else if (ch === "{" || ch === "}") {
      i++;
    } else if (ch === "$") {
      math = !math;
      i += src[i + 1] === "$" ? 2 : 1;
    } else if (ch === "~") {
      out += "\u00a0";
      i++;
    } else if (!math && src.startsWith("---", i)) {
      out += "—";
      i += 3;
    } else if (!math && src.startsWith("--", i)) {
      out += "–";
      i += 2;
    } else if (!math && src.startsWith("``", i)) {
      out += "“";
      i += 2;
    } else if (!math && src.startsWith("''", i)) {
      out += "”";
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * LaTeX field text → plain Unicode: accents, special letters, escapes,
 * dashes and quotes converted; formatting commands, case-protection braces
 * and math delimiters removed (math content stays, with common symbols
 * converted and ^ / _ kept).
 */
export function bibToText(value: string): string {
  return convertLatex(typeof value === "string" ? value : "")
    .normalize("NFC")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .replace(/^ | $/g, "");
}

export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

// ── Names ──────────────────────────────────────────────────────────────────

/** Splits at brace depth 0: on whitespace and ~ ("space"), or on commas. */
function splitTopLevel(value: string, at: "space" | "comma"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      current += ch + value[i + 1];
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    const splits =
      depth === 0 && (at === "comma" ? ch === "," : SPACE.test(ch) || ch === "~");
    if (splits) {
      if (at === "comma") parts.push(current.trim());
      else if (current) parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (at === "comma") parts.push(current.trim());
  else if (current) parts.push(current);
  return parts;
}

const isLowerLetter = (ch: string) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();

function startsLowercase(text: string): boolean {
  const letter = text.match(/\p{L}/u);
  return letter ? isLowerLetter(letter[0]) : false;
}

/**
 * BibTeX's von test: the first letter at brace depth 0 decides. A special
 * character such as {\"o} counts by its letter; other braced text is caseless.
 */
function isLowercaseWord(word: string): boolean {
  let depth = 0;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === "{") {
      if (depth === 0 && word[i + 1] === "\\") {
        let inner = 0;
        let end = i;
        for (; end < word.length; end++) {
          if (word[end] === "{") inner++;
          else if (word[end] === "}" && --inner === 0) break;
        }
        return startsLowercase(bibToText(word.slice(i, end + 1)));
      }
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      if (ch === "\\") return startsLowercase(bibToText(word.slice(i)));
      if (/\p{L}/u.test(ch)) return isLowerLetter(ch);
    }
  }
  return false;
}

function parseName(text: string): PersonName {
  const parts = splitTopLevel(text, "comma");
  if (parts.length === 1) {
    const words = splitTopLevel(parts[0], "space");
    const lastIndex = words.length - 1;
    let vonStart = -1;
    let vonEnd = -1;
    for (let i = 0; i < lastIndex; i++) {
      if (isLowercaseWord(words[i])) {
        if (vonStart < 0) vonStart = i;
        vonEnd = i;
      }
    }
    if (vonStart < 0) {
      return {
        first: words.slice(0, lastIndex).join(" "),
        von: "",
        last: words[lastIndex] ?? "",
        jr: "",
      };
    }
    return {
      first: words.slice(0, vonStart).join(" "),
      von: words.slice(vonStart, vonEnd + 1).join(" "),
      last: words.slice(vonEnd + 1).join(" "),
      jr: "",
    };
  }
  // "von Last, First" or "von Last, Jr, First": von runs from the first word
  // to the last lowercase word, always leaving one word for Last.
  const words = splitTopLevel(parts[0], "space");
  let vonEnd = -1;
  for (let i = 0; i < words.length - 1; i++) {
    if (isLowercaseWord(words[i])) vonEnd = i;
  }
  return {
    first: parts.length === 2 ? parts[1] : parts.slice(2).join(", "),
    von: words.slice(0, vonEnd + 1).join(" "),
    last: words.slice(vonEnd + 1).join(" "),
    jr: parts.length >= 3 ? parts[1] : "",
  };
}

/**
 * Splits a BibTeX name list. Parts keep their LaTeX (braces, accents); pass
 * them through bibToText for display.
 */
export function parseNames(value: string): { names: PersonName[]; others: boolean } {
  const groups: string[][] = [[]];
  for (const word of splitTopLevel(typeof value === "string" ? value : "", "space")) {
    if (word.toLowerCase() === "and") groups.push([]);
    else groups[groups.length - 1].push(word);
  }
  const names: PersonName[] = [];
  let others = false;
  for (const group of groups) {
    if (!group.length) continue;
    const text = group.join(" ");
    if (text.toLowerCase() === "others") others = true;
    else names.push(parseName(text));
  }
  return { names, others };
}

function initials(first: string): string {
  return bibToText(first)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((piece) =>
          // "J.R.R." is three initials.
          piece
            .split(/(?<=\.)(?=\p{L})/u)
            .map((part) => {
              const letter = part.match(/\p{L}/u);
              return letter ? `${letter[0].toUpperCase()}.` : "";
            })
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean)
        .join("-"),
    )
    .filter(Boolean)
    .join(" ");
}

const surname = (name: PersonName) =>
  bibToText([name.von, name.last].filter(Boolean).join(" "));

function ieeeName(name: PersonName): string {
  const full = [initials(name.first), surname(name)].filter(Boolean).join(" ");
  return name.jr ? `${full}, ${bibToText(name.jr)}` : full;
}

function apaName(name: PersonName): string {
  const given = initials(name.first);
  const jr = name.jr ? `, ${bibToText(name.jr)}` : "";
  return given ? `${surname(name)}, ${given}${jr}` : `${surname(name)}${jr}`;
}

function ieeeAuthorList(names: PersonName[], others: boolean): string {
  const list = names.map(ieeeName);
  if (!list.length) return "";
  if (list.length > 6) return `${list[0]} et al.`;
  if (others) return list.length === 1 ? `${list[0]} et al.` : `${list.join(", ")}, et al.`;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function apaAuthorList(names: PersonName[], others: boolean): string {
  const list = names.map(apaName);
  if (!list.length) return "";
  if (others) return `${list.join(", ")}, et al.`;
  if (list.length === 1) return list[0];
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(", ")}, . . . ${list[list.length - 1]}`;
}

// ── Entry fields ───────────────────────────────────────────────────────────

const raw = (entry: BibEntry, name: string) =>
  hasOwn(entry.fields, name) ? entry.fields[name].trim() : "";

const plain = (entry: BibEntry, name: string) => bibToText(raw(entry, name));

interface Contributors {
  names: PersonName[];
  others: boolean;
  editors: boolean;
}

function contributors(entry: BibEntry): Contributors | null {
  for (const field of ["author", "editor"]) {
    const value = raw(entry, field);
    if (!value) continue;
    const { names, others } = parseNames(value);
    if (names.length) return { names, others, editors: field === "editor" };
  }
  return null;
}

function yearOf(entry: BibEntry): string {
  const year = plain(entry, "year");
  if (year) return year;
  return plain(entry, "date").match(/\d{4}/)?.[0] ?? "";
}

function monthIndex(value: string): number {
  const text = bibToText(value).toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? month - 1 : -1;
  }
  if (text.length < 3) return -1;
  return MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(text));
}

function pagesOf(entry: BibEntry): string {
  return plain(entry, "pages").replace(/\s*(?:-+|–|—)\s*/g, "–");
}

const ORDINAL_WORDS = [
  "first", "second", "third", "fourth", "fifth",
  "sixth", "seventh", "eighth", "ninth", "tenth",
];

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

function editionOf(entry: BibEntry): string {
  const text = plain(entry, "edition").replace(/\s*(?:ed\.?|edition)$/i, "");
  if (!text) return "";
  if (/^\d+$/.test(text)) return ordinal(Number(text));
  const word = ORDINAL_WORDS.indexOf(text.toLowerCase());
  return word >= 0 ? ordinal(word + 1) : text;
}

/** A URL field's text with \url{}, escapes and braces removed. */
function cleanUrl(value: string): string {
  return value
    .trim()
    .replace(/^\\url\{([\s\S]*)\}$/, "$1")
    .replace(/\\([_%#&$~])/g, "$1")
    .replace(/[{}]/g, "")
    .trim();
}

function doiOf(entry: BibEntry): { href: string; label: string } | null {
  const match = cleanUrl(raw(entry, "doi")).match(/10\.\d+(?:\.\d+)*\/\S+/);
  if (!match) return null;
  const doi = match[0];
  return {
    href: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    label: doi,
  };
}

/** The entry's http(s) URL, from `url` or a \url{} in howpublished. */
function urlOf(entry: BibEntry): string | null {
  const candidates = [
    raw(entry, "url"),
    raw(entry, "howpublished").match(/\\url\{([^}]*)\}/)?.[1] ?? "",
  ];
  for (const candidate of candidates) {
    const url = cleanUrl(candidate);
    if (/^https?:\/\/[^\s"<>]+$/i.test(url)) return url;
  }
  return null;
}

const link = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

/** Appends a period unless the visible text already ends a sentence. */
function endSentence(html: string): string {
  if (!html) return html;
  const visible = html.replace(/(?:<[^>]+>|\s)+$/, "");
  return /[.?!]$/.test(visible) ? html : `${html}.`;
}

const THESIS_TYPES: Record<string, string> = {
  phdthesis: "Ph.D. dissertation",
  mastersthesis: "M.S. thesis",
  mathesis: "M.S. thesis",
};

// ── IEEE ───────────────────────────────────────────────────────────────────

/** Joins segments with commas, moving each comma inside a closing quote. */
function finishIeee(segments: string[], tail: string): string {
  let out = segments
    .filter(Boolean)
    .join(", ")
    .replace(/([.?!])”, /g, "$1” ")
    .replace(/”, /g, ",” ");
  if (out.endsWith("”")) {
    if (!/[.?!]”$/.test(out)) out = `${out.slice(0, -1)}.”`;
  } else {
    out = endSentence(out);
  }
  return tail ? `${out} ${tail}` : out;
}

function formatIeee(entry: BibEntry, render: (latex: string) => string): string {
  const html = (name: string) => (raw(entry, name) ? render(raw(entry, name)) : "");
  const people = contributors(entry);
  let authors = people ? escapeHtml(ieeeAuthorList(people.names, people.others)) : "";
  if (people?.editors) {
    authors += people.names.length > 1 || people.others ? ", Eds." : ", Ed.";
  }
  const title = html("title");
  const quoted = title ? `“${title}”` : "";
  const month = raw(entry, "month");
  const monthAt = month ? monthIndex(month) : -1;
  const date = escapeHtml(
    [monthAt >= 0 ? MONTH_ABBREVIATIONS[monthAt] : bibToText(month), yearOf(entry)]
      .filter(Boolean)
      .join(" "),
  );
  const pageText = pagesOf(entry);
  const pages = pageText
    ? `${/[–,+]/.test(pageText) ? "pp." : "p."} ${escapeHtml(pageText)}`
    : "";
  const doi = doiOf(entry);
  const doiPart = doi ? `doi: ${link(doi.href, doi.label)}` : "";
  const url = doi ? null : urlOf(entry);
  const online = url ? `[Online]. Available: ${link(url, url)}` : "";
  const publisher = [html("address"), html("publisher")].filter(Boolean).join(": ");
  const prefixed = (prefix: string, value: string) => (value ? `${prefix}${value}` : "");

  switch (entry.type) {
    case "article":
      return finishIeee(
        [
          authors,
          quoted,
          html("journal") && `<i>${html("journal")}</i>`,
          prefixed("vol. ", html("volume")),
          prefixed("no. ", html("number")),
          pages,
          date,
          doiPart,
        ],
        online,
      );
    case "inproceedings":
    case "conference":
      return finishIeee(
        [
          authors,
          quoted,
          prefixed("in ", html("booktitle") && `<i>${html("booktitle")}</i>`),
          html("address"),
          date,
          pages,
          doiPart,
        ],
        online,
      );
    case "incollection":
      return finishIeee(
        [
          authors,
          quoted,
          prefixed("in ", html("booktitle") && `<i>${html("booktitle")}</i>`),
          publisher,
          date,
          pages,
          doiPart,
        ],
        online,
      );
    case "book":
    case "inbook": {
      let head = [authors, title && `<i>${title}</i>`].filter(Boolean).join(", ");
      const edition = editionOf(entry);
      if (edition) head = [head, `${escapeHtml(edition)} ed.`].filter(Boolean).join(", ");
      const rest = [publisher, date, entry.type === "inbook" ? pages : "", doiPart]
        .filter(Boolean)
        .join(", ");
      const out = endSentence(head && rest ? `${endSentence(head)} ${rest}` : head || rest);
      return online ? `${out} ${online}` : out;
    }
    case "phdthesis":
    case "mastersthesis":
    case "thesis": {
      const type = plain(entry, "type");
      const kind = hasOwn(THESIS_TYPES, type.toLowerCase())
        ? THESIS_TYPES[type.toLowerCase()]
        : type
          ? escapeHtml(type)
          : entry.type === "mastersthesis"
            ? "M.S. thesis"
            : "Ph.D. dissertation";
      return finishIeee(
        [authors, quoted, kind, html("school") || html("institution"), html("address"), date, doiPart],
        online,
      );
    }
    case "techreport":
    case "report":
      return finishIeee(
        [
          authors,
          quoted,
          html("institution"),
          html("address"),
          [html("type") || "Tech. Rep.", html("number")].filter(Boolean).join(" "),
          date,
          doiPart,
        ],
        online,
      );
    default: {
      const venue = venueOf(entry, render);
      return finishIeee(
        venue
          ? [authors, quoted, venue, date, html("note"), doiPart]
          : [authors, title && `<i>${title}</i>`, date, html("note"), doiPart],
        online,
      );
    }
  }
}

/** Where a misc / online / unpublished work appeared, if anywhere. */
function venueOf(entry: BibEntry, render: (latex: string) => string): string {
  const howpublished = raw(entry, "howpublished");
  if (howpublished && !/\\url\b/.test(howpublished)) return render(howpublished);
  const eprint = plain(entry, "eprint");
  const archive = (plain(entry, "archiveprefix") || plain(entry, "eprinttype")).toLowerCase();
  if (eprint && archive === "arxiv") return escapeHtml(`arXiv:${eprint}`);
  const journal = raw(entry, "journal");
  if (!journal) return "";
  return /arxiv/i.test(journal) ? render(journal) : `<i>${render(journal)}</i>`;
}

// ── APA 7 ──────────────────────────────────────────────────────────────────

const PART_OF_LARGER = new Set(["article", "inproceedings", "conference", "incollection"]);

function apaEditorsInline(entry: BibEntry): string {
  const value = raw(entry, "editor");
  if (!value) return "";
  const { names, others } = parseNames(value);
  if (!names.length) return "";
  const list = names.map((name) => [initials(name.first), surname(name)].filter(Boolean).join(" "));
  const joined = others
    ? `${list.join(", ")}, et al.`
    : list.length === 1
      ? list[0]
      : list.length === 2
        ? `${list[0]} & ${list[1]}`
        : `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${escapeHtml(joined)} (${list.length > 1 || others ? "Eds." : "Ed."}), `;
}

function formatApa(
  entry: BibEntry,
  render: (latex: string) => string,
  year: string,
): string {
  const html = (name: string) => (raw(entry, name) ? render(raw(entry, name)) : "");
  const type = entry.type;
  const people = contributors(entry);
  const title = html("title");
  const thesis = type === "phdthesis" || type === "mastersthesis" || type === "thesis";

  let descriptor = "";
  const edition = editionOf(entry);
  if ((type === "book" || type === "inbook") && edition) {
    descriptor = ` (${escapeHtml(edition)} ed.)`;
  } else if (thesis) {
    const masters =
      type === "mastersthesis" || /^ma|master/i.test(plain(entry, "type"));
    const school = html("school") || html("institution");
    descriptor = ` [${masters ? "Master’s thesis" : "Doctoral dissertation"}${school ? `, ${school}` : ""}]`;
  } else if ((type === "techreport" || type === "report") && raw(entry, "number")) {
    descriptor = ` (${html("type") || "Report"} No. ${html("number")})`;
  }
  const titleBlock = title
    ? `${PART_OF_LARGER.has(type) ? title : `<i>${title}</i>`}${descriptor}`
    : "";

  let author = "";
  let titleInAuthorPosition = false;
  if (people) {
    author = escapeHtml(apaAuthorList(people.names, people.others));
    if (people.editors) author += people.names.length > 1 || people.others ? " (Eds.)" : " (Ed.)";
  } else if (titleBlock) {
    author = titleBlock;
    titleInAuthorPosition = true;
  }

  const date = `(${escapeHtml(year)})`;
  const sentences = [author ? `${endSentence(author)} ${date}` : date];
  if (!titleInAuthorPosition) sentences.push(titleBlock);

  const pageText = pagesOf(entry);
  const pages = escapeHtml(pageText);
  switch (type) {
    case "article": {
      const issue = html("number") ? `(${html("number")})` : "";
      const volume = html("volume") ? `<i>${html("volume")}</i>${issue}` : issue;
      sentences.push(
        [html("journal") && `<i>${html("journal")}</i>`, volume, pages].filter(Boolean).join(", "),
      );
      break;
    }
    case "inproceedings":
    case "conference":
    case "incollection": {
      const book = html("booktitle");
      if (book) {
        const range = pageText ? ` (${/[–,+]/.test(pageText) ? "pp." : "p."} ${pages})` : "";
        sentences.push(`In ${people?.editors ? "" : apaEditorsInline(entry)}<i>${book}</i>${range}`);
      }
      sentences.push(html("publisher") || html("organization"));
      break;
    }
    case "book":
    case "inbook":
      sentences.push(html("publisher"));
      break;
    case "techreport":
    case "report":
      sentences.push(html("institution"));
      break;
    default:
      if (!thesis) sentences.push(venueOf(entry, render));
  }

  const doi = doiOf(entry);
  const url = doi ? doi.href : urlOf(entry);
  const body = sentences.filter(Boolean).map(endSentence).join(" ");
  return url ? `${body} ${link(url, url)}` : body;
}

// ── Bibliography and citations ─────────────────────────────────────────────

/** APA in-text author form; a missing author falls back to a short title. */
function citeAuthors(entry: BibEntry, mode: "paren" | "text"): string {
  const people = contributors(entry);
  if (people) {
    const names = people.names.map(surname);
    if (names.length >= 3 || people.others) return `${names[0]} et al.`;
    if (names.length === 2) {
      return mode === "paren" ? `${names[0]} & ${names[1]}` : `${names[0]} and ${names[1]}`;
    }
    return names[0];
  }
  const head = plain(entry, "title").split(/:\s/)[0].trim();
  if (!head) return entry.key;
  const words = head.split(/\s+/);
  return `“${words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : head}”`;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

interface SortKey {
  names: string[];
  year: string;
  title: string;
}

function sortKeyOf(entry: BibEntry): SortKey {
  const people = contributors(entry);
  return {
    names: people
      ? people.names.map((name) => `${surname(name)} ${initials(name.first)}`.trim())
      : [plain(entry, "title")],
    year: yearOf(entry),
    title: plain(entry, "title"),
  };
}

function compareKeys(a: SortKey, b: SortKey): number {
  const shared = Math.min(a.names.length, b.names.length);
  for (let i = 0; i < shared; i++) {
    const order = collator.compare(a.names[i], b.names[i]);
    if (order) return order;
  }
  if (a.names.length !== b.names.length) return a.names.length - b.names.length;
  // An undated work ("" here) precedes dated works by the same authors.
  return collator.compare(a.year, b.year) || collator.compare(a.title, b.title);
}

function letterSuffix(index: number): string {
  return String.fromCharCode(97 + (index % 26)).repeat(Math.floor(index / 26) + 1);
}

const defaultRender = (latex: string) => escapeHtml(bibToText(latex));

export function buildBibliography(
  entries: BibEntry[],
  options: BibliographyOptions,
): Bibliography {
  const style: CitationStyle = options.style === "apa" ? "apa" : "ieee";
  const render = options.renderText ?? defaultRender;
  const byKey = new Map<string, BibEntry>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  }

  const seen = new Set<string>();
  const missing: string[] = [];
  let listed: BibEntry[] = [];
  for (const candidate of options.citedKeys) {
    const key = candidate.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = byKey.get(key);
    if (entry) listed.push(entry);
    else missing.push(key);
  }
  if (options.includeAll) {
    for (const entry of byKey.values()) {
      if (!seen.has(entry.key)) listed.push(entry);
    }
  }

  const years = new Map<string, string>();
  if (style === "apa") {
    const keys = new Map(listed.map((entry) => [entry, sortKeyOf(entry)] as const));
    const keyOf = (entry: BibEntry) => keys.get(entry) ?? sortKeyOf(entry);
    listed = [...listed].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    // Same authors and year: 2020a, 2020b … in title order (the sort's last key).
    let start = 0;
    while (start < listed.length) {
      const group = `${keyOf(listed[start]).names.join("|")}\u0000${keyOf(listed[start]).year}`;
      let end = start + 1;
      while (
        end < listed.length &&
        `${keyOf(listed[end]).names.join("|")}\u0000${keyOf(listed[end]).year}` === group
      ) {
        end++;
      }
      if (end - start > 1) {
        for (let i = start; i < end; i++) {
          const year = yearOf(listed[i]);
          years.set(listed[i].key, year ? `${year}${letterSuffix(i - start)}` : `n.d.-${letterSuffix(i - start)}`);
        }
      }
      start = end;
    }
  }

  const labels: Record<string, CitationLabel> = {};
  const items = listed.map((entry, index): BibliographyItem => {
    const year = years.get(entry.key) ?? (yearOf(entry) || "n.d.");
    setOwn(labels, entry.key, {
      number: index + 1,
      authors: citeAuthors(entry, "paren"),
      textAuthors: citeAuthors(entry, "text"),
      year,
    });
    return {
      key: entry.key,
      label: style === "ieee" ? `[${index + 1}]` : "",
      html: style === "ieee" ? formatIeee(entry, render) : formatApa(entry, render, year),
    };
  });

  return { style, items, labels, missing };
}

/** In-text citation as plain text (not HTML). */
export function formatCitation(
  keys: string[],
  bibliography: Bibliography,
  mode: "paren" | "text" = "paren",
): string {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (!unique.length) return "";
  const { labels } = bibliography;
  const known = unique.filter((key) => hasOwn(labels, key));
  const missing = unique.filter((key) => !hasOwn(labels, key));

  if (bibliography.style === "ieee") {
    const numbers = [...new Set(known.map((key) => labels[key].number))].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < numbers.length; ) {
      let j = i;
      while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
      if (j - i >= 2) parts.push(`[${numbers[i]}]–[${numbers[j]}]`);
      else for (let k = i; k <= j; k++) parts.push(`[${numbers[k]}]`);
      i = j + 1;
    }
    parts.push(...missing.map(() => "[?]"));
    return parts.join(", ");
  }

  // APA: bibliography order, one author group per run ("Smith, 2019, 2020a").
  const groups: { authors: string; textAuthors: string; years: string[] }[] = [];
  for (const key of known.sort((a, b) => labels[a].number - labels[b].number)) {
    const label = labels[key];
    const previous = groups[groups.length - 1];
    if (previous && previous.authors === label.authors) previous.years.push(label.year);
    else groups.push({ authors: label.authors, textAuthors: label.textAuthors, years: [label.year] });
  }
  if (mode === "text") {
    return [
      ...groups.map((group) => `${group.textAuthors} (${group.years.join(", ")})`),
      ...missing.map((key) => `${key}?`),
    ].join("; ");
  }
  return `(${[
    ...groups.map((group) => `${group.authors}, ${group.years.join(", ")}`),
    ...missing.map((key) => `${key}?`),
  ].join("; ")})`;
}

// ── Citation keys ──────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "on", "of", "for", "and", "in", "to", "with", "towards", "toward",
]);

function asciiFold(text: string): string {
  return text
    .replace(/ß/g, "ss")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[øØ]/g, "o")
    .replace(/[łŁ]/g, "l")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const KEY_SUFFIXES = "bcdefghijklmnopqrstuvwxyz";

/** "smith2020deep": surname + year + first significant title word, made unique. */
export function makeCiteKey(
  entry: { fields: Record<string, string> },
  existing: Set<string>,
): string {
  const field = (name: string) =>
    hasOwn(entry.fields, name) ? String(entry.fields[name]).trim() : "";
  const people = parseNames(field("author") || field("editor")).names;
  const name = people.length ? asciiFold(bibToText(people[0].last)).replace(/[^a-z]/g, "") : "";
  const year = (bibToText(field("year")) || bibToText(field("date"))).match(/\d{4}/)?.[0] ?? "";
  const word =
    asciiFold(bibToText(field("title")))
      .split(/[^a-z0-9]+/)
      .find((candidate) => candidate && !STOP_WORDS.has(candidate)) ?? "";
  const base = `${name}${year}${word}` || "ref";
  if (!existing.has(base)) return base;
  for (const letter of KEY_SUFFIXES) {
    if (!existing.has(base + letter)) return base + letter;
  }
  for (let n = 2; ; n++) {
    if (!existing.has(`${base}${n}`)) return `${base}${n}`;
  }
}
