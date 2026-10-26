/**
 * Source-editor language support: LaTeX and BibTeX highlighting, and
 * completion that knows the project — citation keys from the .bib files,
 * labels from the last preview, and uploaded file names.
 */

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StreamParser } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { snippetCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";

export const latexLanguage = StreamLanguage.define(stex);

const bibtexParser: StreamParser<{ inEntry: boolean }> = {
  name: "bibtex",
  startState: () => ({ inEntry: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^%.*/)) return "comment";
    if (stream.match(/^@[A-Za-z]+/)) {
      state.inEntry = true;
      return "keyword";
    }
    if (state.inEntry && stream.match(/^[A-Za-z][\w-]*(?=\s*=)/)) return "propertyName";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^\\[A-Za-z]+|^\\./)) return "tag";
    if (stream.match(/^[{}()]/)) return "bracket";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%" } },
};

export const bibtexLanguage = StreamLanguage.define(bibtexParser);

export const latexHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.tagName, tags.macroName], color: "#1d4ed8" },
    { tag: tags.keyword, color: "#7c3aed", fontWeight: "600" },
    { tag: [tags.atom, tags.bool], color: "#0f766e" },
    { tag: [tags.string, tags.special(tags.string)], color: "#b45309" },
    { tag: tags.number, color: "#0f766e" },
    { tag: tags.comment, color: "#64748b", fontStyle: "italic" },
    { tag: tags.bracket, color: "#475569" },
    { tag: [tags.propertyName, tags.attributeName], color: "#0369a1" },
    { tag: [tags.variableName, tags.typeName], color: "#be185d" },
    { tag: tags.invalid, color: "#b91c1c" },
  ]),
);

function cmd(label: string, template: string, detail?: string, boost = 0): Completion {
  return snippetCompletion(template, { label, detail, type: "keyword", boost });
}

const COMMANDS: Completion[] = [
  cmd("\\section", "\\section{${title}}", "heading", 5),
  cmd("\\subsection", "\\subsection{${title}}", "heading", 4),
  cmd("\\subsubsection", "\\subsubsection{${title}}", "heading", 3),
  cmd("\\paragraph", "\\paragraph{${title}}", "run-in heading"),
  cmd("\\textbf", "\\textbf{${}}", "bold", 4),
  cmd("\\textit", "\\textit{${}}", "italic", 4),
  cmd("\\emph", "\\emph{${}}", "emphasis", 4),
  cmd("\\underline", "\\underline{${}}", "underline"),
  cmd("\\texttt", "\\texttt{${}}", "monospace"),
  cmd("\\textsc", "\\textsc{${}}", "small caps"),
  cmd("\\cite", "\\cite{${}}", "citation", 5),
  cmd("\\citep", "\\citep{${}}", "natbib (Author, year)"),
  cmd("\\citet", "\\citet{${}}", "natbib Author (year)"),
  cmd("\\ref", "\\ref{${}}", "reference", 5),
  cmd("\\eqref", "\\eqref{${}}", "equation reference", 4),
  cmd("\\autoref", "\\autoref{${}}", "named reference"),
  cmd("\\label", "\\label{${}}", "label", 5),
  cmd("\\footnote", "\\footnote{${}}", "footnote", 3),
  cmd("\\url", "\\url{${}}", "link"),
  cmd("\\href", "\\href{${url}}{${text}}", "link"),
  cmd("\\includegraphics", "\\includegraphics[width=0.8\\linewidth]{${file}}", "image", 3),
  cmd("\\caption", "\\caption{${}}", "caption", 3),
  cmd("\\item", "\\item ${}", "list item", 4),
  cmd("\\begin", "\\begin{${env}}\n\t${}\n\\end{${env}}", "environment", 6),
  cmd("\\frac", "\\frac{${num}}{${den}}", "fraction", 4),
  cmd("\\sqrt", "\\sqrt{${}}", "square root"),
  cmd("\\mathbb", "\\mathbb{${}}", "blackboard bold"),
  cmd("\\mathbf", "\\mathbf{${}}", "bold math"),
  cmd("\\mathcal", "\\mathcal{${}}", "calligraphic"),
  cmd("\\mathrm", "\\mathrm{${}}", "upright math"),
  cmd("\\operatorname", "\\operatorname{${}}", "operator"),
  cmd("\\text", "\\text{${}}", "text in math"),
  cmd("\\left(", "\\left( ${} \\right)", "scaled parentheses"),
  cmd("\\usepackage", "\\usepackage{${}}", "package"),
  cmd("\\newcommand", "\\newcommand{\\${name}}[${n}]{${body}}", "macro"),
  cmd("\\multicolumn", "\\multicolumn{${n}}{c}{${}}", "table"),
  cmd("\\vspace", "\\vspace{${1em}}", "vertical space"),
  cmd("\\hspace", "\\hspace{${1em}}", "horizontal space"),
  cmd("\\bibliography", "\\bibliography{${references}}", "BibTeX file"),
  cmd("\\bibliographystyle", "\\bibliographystyle{${plain}}", "plain, unsrt, IEEEtran, apalike"),
  ...[
    "maketitle",
    "tableofcontents",
    "centering",
    "noindent",
    "newpage",
    "clearpage",
    "hline",
    "toprule",
    "midrule",
    "bottomrule",
    "today",
    "LaTeX",
    "ldots",
    "cdots",
    "quad",
    "qquad",
    "appendix",
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "varepsilon",
    "theta",
    "lambda",
    "mu",
    "pi",
    "sigma",
    "tau",
    "phi",
    "omega",
    "Gamma",
    "Delta",
    "Theta",
    "Lambda",
    "Sigma",
    "Phi",
    "Omega",
    "sum",
    "prod",
    "int",
    "oint",
    "partial",
    "nabla",
    "infty",
    "cdot",
    "times",
    "leq",
    "geq",
    "neq",
    "approx",
    "equiv",
    "sim",
    "propto",
    "in",
    "notin",
    "subset",
    "subseteq",
    "cup",
    "cap",
    "forall",
    "exists",
    "rightarrow",
    "leftarrow",
    "Rightarrow",
    "Leftrightarrow",
    "mapsto",
    "to",
    "log",
    "exp",
    "sin",
    "cos",
    "max",
    "min",
    "arg",
    "lim",
  ].map((name) => ({ label: `\\${name}`, type: "constant" }) satisfies Completion),
];

const ENVIRONMENTS = [
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "itemize",
  "enumerate",
  "description",
  "figure",
  "figure*",
  "table",
  "table*",
  "tabular",
  "abstract",
  "theorem",
  "lemma",
  "corollary",
  "definition",
  "proof",
  "center",
  "quote",
  "verbatim",
  "lstlisting",
  "algorithm",
  "algorithmic",
  "minipage",
  "subfigure",
  "cases",
  "matrix",
  "pmatrix",
  "bmatrix",
  "thebibliography",
];

const ENV_BODIES: Record<string, string> = {
  figure: "[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}\n",
  table: "[htbp]\n\t\\centering\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\t\\begin{tabular}{lcc}\n\t\t\\toprule\n\t\t${A} & B & C \\\\\n\t\t\\midrule\n\t\t1 & 2 & 3 \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n",
  tabular: "{${lcc}}\n\t${}\n",
  itemize: "\n\t\\item ${}\n",
  enumerate: "\n\t\\item ${}\n",
  equation: "\n\t${}\n\t\\label{eq:${label}}\n",
  minipage: "{${0.45\\linewidth}}\n\t${}\n",
  subfigure: "{${0.45\\linewidth}}\n\t\\centering\n\t${}\n",
};

export interface ProjectCompletions {
  citationKeys: () => string[];
  labels: () => string[];
  files: () => string[];
}

export function latexCompletions(project: ProjectCompletions) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);

    const cite = /\\(?:cite[pt]?|citealp|citealt|citeauthor|citeyear|nocite|parencite|textcite|autocite)\*?(?:\[[^\]]*\])*\{([^}]*)$/.exec(before);
    if (cite) {
      const typed = cite[1].split(",").pop() ?? "";
      return {
        from: context.pos - typed.trimStart().length,
        options: project.citationKeys().map((key) => ({ label: key, type: "variable", detail: "citation" })),
        validFor: /^[^,}\s]*$/,
      };
    }
    const ref = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\*?\{([^}]*)$/.exec(before);
    if (ref) {
      return {
        from: context.pos - ref[1].length,
        options: project.labels().map((label) => ({ label, type: "variable", detail: "label" })),
        validFor: /^[^}\s]*$/,
      };
    }
    const file = /\\(?:includegraphics(?:\[[^\]]*\])?|input|include|bibliography|addbibresource)\{([^}]*)$/.exec(before);
    if (file) {
      return {
        from: context.pos - file[1].length,
        options: project.files().map((name) => ({ label: name, type: "text", detail: "file" })),
        validFor: /^[^}]*$/,
      };
    }
    const env = /\\begin\{([^}]*)$/.exec(before);
    if (env) {
      return {
        from: context.pos - env[1].length,
        options: ENVIRONMENTS.map((name) =>
          snippetCompletion(`${name}}${ENV_BODIES[name.replace(/\*$/, "")] ?? "\n\t${}\n"}\\end{${name}`, { label: name, type: "type" }),
        ),
        validFor: /^[\w*]*$/,
      };
    }
    const command = context.matchBefore(/\\[A-Za-z]*/);
    if (command && (command.from < command.to || context.explicit)) {
      return { from: command.from, options: COMMANDS, validFor: /^\\[A-Za-z(]*$/ };
    }
    return null;
  };
}
