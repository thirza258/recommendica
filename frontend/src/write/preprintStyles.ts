/**
 * Small LaTeX style files for the arXiv-like preprint designs.
 *
 * They ship inside each project (and inside exports), so the papers compile
 * with a standard TeX installation: they only combine fancyhdr and titling.
 * The preview recognises the designs by these package names. Fonts, margins
 * and citations stay in main.tex, where the page setup puts them.
 */

const NOTICE = `% Written for Recommendica Write. Free to use, change and share (MIT licence).
% A look-alike of a common preprint layout, not the official style of any
% venue: to submit to a conference or journal, use its own style files.`;

export const PREPRINT_STYLES = {
  "arxiv-preprint": `% arxiv-preprint.sty: a single-column preprint layout like those common on arXiv.
${NOTICE}
\\NeedsTeXFormat{LaTeX2e}
\\ProvidesPackage{arxiv-preprint}[2026/10/26 arXiv-style preprint layout]
\\RequirePackage{fancyhdr}
\\RequirePackage{titling}

\\newcommand{\\preprintlabel}{A Preprint}

% Running head on every page, including the title page.
\\fancypagestyle{preprint}{%
  \\fancyhf{}%
  \\fancyhead[L]{\\small\\scshape\\thetitle}%
  \\fancyhead[R]{\\small\\scshape\\preprintlabel}%
  \\fancyfoot[C]{\\thepage}%
  \\renewcommand{\\headrulewidth}{0.4pt}}
\\fancypagestyle{plain}{%
  \\fancyhf{}%
  \\fancyhead[R]{\\small\\scshape\\preprintlabel}%
  \\fancyfoot[C]{\\thepage}%
  \\renewcommand{\\headrulewidth}{0.4pt}}
\\pagestyle{preprint}

% Title between two rules, authors in a centred row.
\\pretitle{\\begin{center}\\rule{\\linewidth}{2pt}\\par\\vspace{0.8em}\\LARGE\\bfseries}
\\posttitle{\\par\\vspace{0.6em}\\rule{\\linewidth}{0.8pt}\\end{center}\\vspace{0.5em}}
\\preauthor{\\begin{center}\\large\\lineskip 0.5em\\begin{tabular}[t]{c}}
\\postauthor{\\end{tabular}\\par\\end{center}}
\\predate{\\begin{center}\\small}
\\postdate{\\par\\end{center}}

\\renewenvironment{abstract}{%
  \\begin{center}\\bfseries Abstract\\end{center}\\vspace{-0.6em}%
  \\begin{quote}\\small}{\\end{quote}}
\\newcommand{\\keywords}[1]{%
  \\begin{quote}\\small\\textbf{Keywords}\\enspace #1\\end{quote}\\vspace{0.4em}}
\\endinput
`,
  "ml-preprint": `% ml-preprint.sty: a two-column machine-learning conference preprint look.
${NOTICE}
\\NeedsTeXFormat{LaTeX2e}
\\ProvidesPackage{ml-preprint}[2026/10/26 ML conference preprint layout]
\\RequirePackage{fancyhdr}
\\RequirePackage{titling}

\\newcommand{\\preprintnote}{Preprint. Under review.}

\\fancypagestyle{preprint}{%
  \\fancyhf{}%
  \\fancyhead[C]{\\small\\itshape\\thetitle}%
  \\fancyfoot[C]{\\thepage}%
  \\renewcommand{\\headrulewidth}{0.4pt}}
\\fancypagestyle{plain}{%
  \\fancyhf{}%
  \\fancyfoot[L]{\\small\\itshape\\preprintnote}%
  \\fancyfoot[C]{\\thepage}%
  \\renewcommand{\\headrulewidth}{0pt}}
\\pagestyle{preprint}

\\pretitle{\\begin{center}\\rule{\\linewidth}{1pt}\\par\\vspace{0.7em}\\Large\\bfseries}
\\posttitle{\\par\\vspace{0.6em}\\rule{\\linewidth}{1pt}\\end{center}\\vspace{0.3em}}
\\preauthor{\\begin{center}\\normalsize\\lineskip 0.5em\\begin{tabular}[t]{c}}
\\postauthor{\\end{tabular}\\par\\end{center}}
\\predate{\\begin{center}\\small}
\\postdate{\\par\\end{center}}

% The abstract sits in the first column, as in most ML proceedings.
\\renewenvironment{abstract}{%
  \\begin{center}\\large\\bfseries Abstract\\end{center}\\vspace{-0.5em}%
  \\begin{quote}\\small}{\\end{quote}}
\\newcommand{\\keywords}[1]{%
  \\begin{quote}\\small\\textbf{Keywords:} #1\\end{quote}}
\\endinput
`,
} as const;

export type PreprintStyle = keyof typeof PREPRINT_STYLES;
