/**
 * Text-mode symbol tables for the LaTeX renderer.
 *
 * Only text mode lives here: everything between math delimiters is handed to
 * KaTeX untouched. Values are plain Unicode and are HTML-escaped by the caller.
 */

/** Control words that print a fixed character or string in text mode. */
export const TEXT_SYMBOLS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  textendash: "–",
  textemdash: "—",
  textbullet: "•",
  textperiodcentered: "·",
  textasteriskcentered: "∗",
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "<",
  textgreater: ">",
  textunderscore: "_",
  textbraceleft: "{",
  textbraceright: "}",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  textquotedbl: "\"",
  textexclamdown: "¡",
  textquestiondown: "¿",
  textsection: "§",
  textparagraph: "¶",
  textdagger: "†",
  textdaggerdbl: "‡",
  textcopyright: "©",
  textregistered: "®",
  texttrademark: "™",
  textdegree: "°",
  textcelsius: "℃",
  textmu: "µ",
  textpm: "±",
  texttimes: "×",
  textdiv: "÷",
  textonehalf: "½",
  textonequarter: "¼",
  textthreequarters: "¾",
  texteuro: "€",
  textsterling: "£",
  textyen: "¥",
  textcent: "¢",
  textdollar: "$",
  textperthousand: "‰",
  textnumero: "№",
  textleftarrow: "←",
  textrightarrow: "→",
  textuparrow: "↑",
  textdownarrow: "↓",
  textvisiblespace: "␣",
  checkmark: "✓",
  euro: "€",
  pounds: "£",
  copyright: "©",
  S: "§",
  P: "¶",
  dag: "†",
  ddag: "‡",
  ss: "ß",
  SS: "SS",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  o: "ø",
  O: "Ø",
  aa: "å",
  AA: "Å",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
  dh: "ð",
  DH: "Ð",
  th: "þ",
  TH: "Þ",
  ng: "ŋ",
  NG: "Ŋ",
  guillemotleft: "«",
  guillemotright: "»",
  guilsinglleft: "‹",
  guilsinglright: "›",
  quotedblbase: "„",
  quotesinglbase: "‚",
  slash: "/",
  textslash: "/",
};

/** Single-character control symbols such as `\%` or `\&`. */
export const CONTROL_SYMBOLS: Record<string, string> = {
  "%": "%",
  "&": "&",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  " ": " ",
  ",": "\u2009",
  ";": "\u2005",
  ":": "\u2005",
  "!": "",
  "-": "", // discretionary hyphen
  "/": "", // italic correction
  "@": "",
  "|": "‖",
};

/** Accent commands mapped to Unicode combining characters. */
export const ACCENTS: Record<string, string> = {
  "'": "́",
  "`": "̀",
  "^": "̂",
  '"': "̈",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  d: "̣",
  b: "̱",
  r: "̊",
  k: "̨",
  t: "͡",
};

/** Combines a base string with an accent and normalizes to a precomposed form. */
export function applyAccent(accent: string, base: string): string {
  const mark = ACCENTS[accent];
  if (!mark) return base;
  // The dotless i and j take accents in LaTeX; Unicode wants the dotted base.
  const letter = base === "ı" ? "i" : base === "ȷ" ? "j" : base;
  if (!letter) return mark.normalize("NFC");
  const [first, ...rest] = Array.from(letter);
  return `${first}${mark}${rest.join("")}`.normalize("NFC");
}

/** Font-size declarations in em relative to the paper's base size. */
export const FONT_SIZES: Record<string, number> = {
  tiny: 0.5,
  scriptsize: 0.7,
  footnotesize: 0.8,
  small: 0.9,
  normalsize: 1,
  large: 1.2,
  Large: 1.44,
  LARGE: 1.728,
  huge: 2.074,
  Huge: 2.488,
};

/** Font declarations (`\bfseries`, `{\it ...}`) mapped to renderer style classes. */
export const FONT_DECLARATIONS: Record<string, string> = {
  bfseries: "bf",
  bf: "bf",
  mdseries: "md",
  itshape: "it",
  it: "it",
  em: "em",
  slshape: "sl",
  sl: "sl",
  scshape: "sc",
  sc: "sc",
  upshape: "up",
  ttfamily: "tt",
  tt: "tt",
  sffamily: "sf",
  sf: "sf",
  rmfamily: "rm",
  rm: "rm",
  normalfont: "normal",
};

/** Font commands that take one argument (`\textbf{...}`) mapped to style classes. */
export const FONT_COMMANDS: Record<string, string> = {
  textbf: "bf",
  textmd: "md",
  textit: "it",
  emph: "em",
  textsl: "sl",
  textsc: "sc",
  textup: "up",
  texttt: "tt",
  textsf: "sf",
  textrm: "rm",
  textnormal: "normal",
  underline: "underline",
  uline: "underline",
  sout: "strike",
  st: "strike",
  hl: "highlight",
  textsuperscript: "sup",
  textsubscript: "sub",
};

/** The named colours of xcolor's base set (and a few dvipsnames favourites). */
export const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  darkgray: "#404040",
  lightgray: "#bfbfbf",
  brown: "#bf8040",
  lime: "#bfff00",
  olive: "#808000",
  orange: "#ff8000",
  pink: "#ffbfbf",
  purple: "#bf0040",
  teal: "#008080",
  violet: "#800080",
  navyblue: "#000080",
  forestgreen: "#228b22",
  maroon: "#800000",
  royalblue: "#4169e1",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `\today` in LaTeX's default US format. */
export function formatToday(date: Date = new Date()): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Counter value formatters shared by sections, lists and theorems. */
export function toAlpha(value: number, upper = false): string {
  if (value <= 0) return String(value);
  let out = "";
  let n = value;
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return upper ? out.toUpperCase() : out;
}

export function toRoman(value: number, upper = false): string {
  if (value <= 0 || value >= 4000) return String(value);
  const numerals: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let n = value;
  let out = "";
  for (const [amount, numeral] of numerals) {
    while (n >= amount) {
      out += numeral;
      n -= amount;
    }
  }
  return upper ? out.toUpperCase() : out;
}

/** Placeholder text for `\lipsum` and `\blindtext`, which templates use often. */
export const LIPSUM = [
  "Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Ut purus elit, vestibulum ut, placerat ac, adipiscing vitae, felis. Curabitur dictum gravida mauris. Nam arcu libero, nonummy eget, consectetuer id, vulputate a, magna. Donec vehicula augue eu neque. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Mauris ut leo.",
  "Nam dui ligula, fringilla a, euismod sodales, sollicitudin vel, wisi. Morbi auctor lorem non justo. Nam lacus libero, pretium at, lobortis vitae, ultricies et, tellus. Donec aliquet, tortor sed accumsan bibendum, erat ligula aliquet magna, vitae ornare odio metus a mi. Morbi ac orci et nisl hendrerit mollis. Suspendisse ut massa.",
  "Nulla malesuada porttitor diam. Donec felis erat, congue non, volutpat at, tincidunt tristique, libero. Vivamus viverra fermentum felis. Donec nonummy pellentesque ante. Phasellus adipiscing semper elit. Proin fermentum massa ac quam. Sed diam turpis, molestie vitae, placerat a, molestie nec, leo. Maecenas lacinia.",
  "Quisque ullamcorper placerat ipsum. Cras nibh. Morbi vel justo vitae lacus tincidunt ultrices. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. In hac habitasse platea dictumst. Integer tempus convallis augue. Etiam facilisis. Nunc elementum fermentum wisi. Aenean placerat. Ut imperdiet, enim sed gravida sollicitudin.",
  "Etiam euismod. Fusce facilisis lacinia dui. Suspendisse potenti. In mi erat, cursus id, nonummy sed, ullamcorper eget, sapien. Praesent pretium, magna in eleifend egestas, pede pede pretium lorem, quis consectetuer tortor sapien facilisis magna. Mauris quis magna varius nulla scelerisque imperdiet. Aliquam non quam.",
];
