import type { Course } from "./types.ts";

export const latexEssentials: Course = {
  id: "latex-essentials",
  title: "Write papers in LaTeX",
  category: "Writing tools",
  description:
    "Learn the LaTeX you need for a paper: structure, equations, figures and tables, BibTeX citations, importing existing work into Write, and fixing common errors.",
  outcome:
    "A LaTeX paper in Write with numbered equations, a figure, a table, and a working bibliography.",
  resources: [
    {
      title: "The LaTeX Project: official documentation",
      url: "https://www.latex-project.org/help/documentation/",
    },
    {
      title: "The Not So Short Introduction to LaTeX (CTAN)",
      url: "https://ctan.org/pkg/lshort-english",
    },
    {
      title: "Overleaf: Learn LaTeX in 30 minutes",
      url: "https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes",
    },
    {
      title: "Wikibooks: LaTeX",
      url: "https://en.wikibooks.org/wiki/LaTeX",
    },
  ],
  lessons: [
    {
      id: "latex-anatomy",
      title: "Read the anatomy of a LaTeX paper",
      minutes: 6,
      objective:
        "Identify the preamble and body of a LaTeX file, structure it with sections and labels, and escape special characters.",
      sections: [
        {
          title: "Preamble and body",
          text: "A LaTeX file starts with \\documentclass, which sets the overall layout, followed by the preamble: \\usepackage lines that add features, and the title and author. The paper itself sits between \\begin{document} and \\end{document}, where \\maketitle prints the title block. In Write, start a paper from a template such as Research article, then select LaTeX in the editor mode switch to see main.tex.",
          points: [
            "\\documentclass{article} chooses the class; templates use venue classes such as IEEEtran.",
            "\\usepackage{amsmath} adds features; load only what you use.",
            "Everything printed goes between \\begin{document} and \\end{document}.",
          ],
        },
        {
          title: "Structure, labels, and references",
          text: "Divide the paper with \\section{...} and \\subsection{...}; LaTeX numbers them for you. Put \\label{sec:method} right after a heading, then write Section~\\ref{sec:method} anywhere else: the number stays correct when sections move. The tilde is a non-breaking space that keeps 'Section' and its number on the same line. A blank line starts a new paragraph, and a % starts a comment.",
        },
        {
          title: "Characters with special meaning",
          text: "Ten characters have special meaning in LaTeX: # $ % & _ { } ~ ^ and the backslash. To print most of them, put a backslash in front: \\%, \\$, \\&, \\#, \\_, \\{ and \\}. The tilde, caret, and backslash need commands such as \\textasciitilde{}. An unescaped % silently hides the rest of the line, and an unescaped & or _ in text usually stops the build with an error.",
          points: [
            "Write 50\\% and R\\&D in running text.",
            "Use quotes as `` and '' in plain LaTeX source.",
            "Let LaTeX handle spacing; extra spaces in the source are ignored.",
          ],
        },
      ],
      example: {
        title: "A minimal paper",
        text: "\\documentclass{article} · \\usepackage{amsmath} · \\title{Quizzes and Exam Scores} · \\author{A. Researcher} · \\begin{document} · \\maketitle · \\section{Introduction}\\label{sec:intro} · Retrieval practice improves recall (Section~\\ref{sec:method}). · \\section{Method}\\label{sec:method} · ... · \\end{document}. Each piece has one job, and the reference to the Method section updates itself.",
      },
      exercise:
        "Create a paper in Write from a template and switch to the LaTeX editor. Find the document class, three packages, and the first \\section. Add a label to one section, reference it from another with ~\\ref, and recompile to see the number appear.",
      quiz: {
        question:
          "In running text you type 'a 20% increase', and the rest of the line disappears from the output. Why?",
        options: [
          "The % sign starts a comment; write 20\\% instead.",
          "LaTeX cannot print numbers in running text.",
          "The line was too long for the page.",
        ],
        answer: 0,
        explanation:
          "In LaTeX, % comments out everything after it on that line. Escaping it as \\% prints the percent sign.",
      },
    },
    {
      id: "latex-math",
      title: "Typeset equations that read well",
      minutes: 7,
      objective:
        "Write inline and numbered equations, align multi-line derivations, and reference equations by label.",
      sections: [
        {
          title: "Inline and display math",
          text: "Put short math inside a sentence between dollar signs: $a^2 + b^2 = c^2$. For a numbered equation on its own line, use \\begin{equation} ... \\end{equation}, and for an unnumbered one, \\[ ... \\]. In the visual editor, Insert offers Inline math and Equation, rendered as you type. Avoid $$ ... $$; it is plain TeX syntax that LaTeX does not handle well.",
          points: [
            "Superscripts and subscripts: x^{2}, x_{i}, x_{ij}^{2}.",
            "Fractions and roots: \\frac{a}{b}, \\sqrt{n}.",
            "Sums and Greek letters: \\sum_{i=1}^{n} x_i, \\alpha, \\beta, \\mu.",
          ],
        },
        {
          title: "Multi-line equations and references",
          text: "With the amsmath package, the align environment lines up several equations at the & sign and breaks lines with \\\\. Label an equation with \\label{eq:model} inside it and cite it with \\eqref{eq:model}, which prints the number in parentheses. Words inside math go in \\text{...}, so they are set upright with normal spacing.",
        },
        {
          title: "Equations are part of sentences",
          text: "Treat each equation as part of the surrounding sentence, with punctuation at its end when the sentence ends there. Define every symbol at its first use, right after the equation: 'where y_i is the score of student i'. Use the same symbol for the same quantity throughout the paper, and prefer readable names over a new letter for each variable.",
          points: [
            "Introduce the equation in words before it appears.",
            "Define every symbol immediately after first use.",
            "Number only the equations you refer to, if your venue allows it.",
          ],
        },
      ],
      example: {
        title: "A model, written and referenced",
        text: "\\begin{equation} y_i = \\beta_0 + \\beta_1 q_i + \\varepsilon_i, \\label{eq:model} \\end{equation} where y_i is the exam score and q_i the number of quizzes completed by student i. Later: 'Estimating \\eqref{eq:model} with prior grades added ...' prints (1) and stays correct if equations are added before it.",
      },
      exercise:
        "Write one inline expression and one numbered equation from your own work. Label the equation, refer to it with \\eqref in a later sentence, and define every symbol right after the equation.",
      quiz: {
        question:
          "Which command refers to a labeled equation and prints its number in parentheses?",
        options: [
          "\\ref{eq:model} inside dollar signs",
          "\\eqref{eq:model}",
          "\\label{eq:model}",
        ],
        answer: 1,
        explanation:
          "\\eqref, from amsmath, prints the equation number in parentheses. \\label defines the target; it prints nothing.",
      },
    },
    {
      id: "latex-figures-tables",
      title: "Add figures and tables that float",
      minutes: 7,
      objective:
        "Insert figures and tables with captions and labels, let LaTeX place them, and format tables cleanly.",
      sections: [
        {
          title: "Figures as floats",
          text: "A figure is a float: LaTeX places it where it fits best, often at the top of a page, rather than exactly where it appears in the source. Inside \\begin{figure}, use \\includegraphics[width=\\linewidth]{figures/scores.pdf} from the graphicx package, then \\caption{...} and \\label{fig:scores}. Refer to it as Figure~\\ref{fig:scores}, never as 'the figure below', because it may move.",
          points: [
            "Put \\label after \\caption, or the reference picks up the wrong number.",
            "Prefer vector formats such as PDF for charts; use PNG or JPEG for photos.",
            "Write captions that say what the figure shows, not just its topic.",
          ],
        },
        {
          title: "Tables that are easy to read",
          text: "A table environment holds a tabular, whose column specification such as {lrr} aligns one left and two right-aligned columns. Rows end with \\\\ and cells are separated with &. The booktabs package adds \\toprule, \\midrule, and \\bottomrule for clean horizontal rules; most style guides advise against vertical lines. Put units in the column headers and align numbers so that digits line up.",
        },
        {
          title: "Figures and tables in Write",
          text: "In the LaTeX editor, add image files with Upload images in the project files panel, then reference them by path in \\includegraphics. In the visual editor, Insert offers Figure (image) and Table, numbered automatically, and Cross-reference to point at them from the text. Both editors keep the numbering, so switching between them does not break your references.",
          points: [
            "Upload images before referring to them in the source.",
            "Check every figure after switching editors or importing a project.",
            "Give every figure alternative text describing what it shows.",
          ],
        },
      ],
      example: {
        title: "A small results table",
        text: "\\begin{table}[t] \\caption{Final-exam scores by quiz completion.} \\label{tab:scores} \\begin{tabular}{lrr} \\toprule Group & n & Mean score \\\\ \\midrule Fewer than 8 quizzes & 201 & 68.2 \\\\ 8 or more & 211 & 74.5 \\\\ \\bottomrule \\end{tabular} \\end{table}. Many venues place table captions above the table and figure captions below the figure.",
      },
      exercise:
        "Add one figure and one table to a Write paper with captions and labels. Refer to both from the text with ~\\ref, recompile, and check that the numbers and placement make sense.",
      quiz: {
        question:
          "Your figure appears on the next page, and the text says 'the figure below'. What is the best fix?",
        options: [
          "Force the figure to stay in place with a blank line before it.",
          "Move the figure code until it happens to land in the right spot.",
          "Refer to it by number with Figure~\\ref{fig:scores} and let LaTeX place it.",
        ],
        answer: 2,
        explanation:
          "Floats move to where they fit. A numbered reference is always correct, wherever the figure ends up.",
      },
    },
    {
      id: "latex-citations",
      title: "Cite sources with BibTeX",
      minutes: 7,
      objective:
        "Store references in a .bib file, cite them by key, choose a bibliography style, and check entries for errors.",
      sections: [
        {
          title: "Entries and keys",
          text: "BibTeX keeps references in a .bib file. Each entry has a type, a key, and fields: @article{smith2020quizzes, author = {Smith, Jane and Lee, Kim}, title = {...}, journal = {...}, year = {2020}, doi = {...}}. You cite it with \\cite{smith2020quizzes}, and the bibliography lists only what you cite. Separate authors with 'and', not commas, and wrap words whose capitals must survive, such as {DNA}, in braces.",
          points: [
            "Use readable keys such as author-year-word: smith2020quizzes.",
            "Include the DOI when one exists.",
            "Keep one .bib file per paper, usually references.bib.",
          ],
        },
        {
          title: "Styles and citation commands",
          text: "\\bibliographystyle chooses the format, such as plain or IEEEtran for numbered citations and apalike for author-year, and \\bibliography{references} prints the list from references.bib. With the natbib package, \\citet{key} gives a textual citation like 'Smith and Lee (2020)' and \\citep{key} a parenthetical one like '(Smith and Lee, 2020)'. Venue templates usually set the style for you; do not change it.",
        },
        {
          title: "References in Write",
          text: "In the visual editor, open View, References to manage the bibliography: choose the citation style, add a reference by hand, or paste BibTeX copied from a publisher page, arXiv's export citation link, or a reference manager such as Zotero. Insert, Citation adds a citation at the cursor. In the LaTeX editor, add entries to references.bib directly. Check pasted entries: exported metadata often has wrong capitalization, missing pages, or garbled accents.",
          points: [
            "Paste BibTeX from the source rather than retyping it.",
            "Open each cited paper once to confirm it says what you cite it for.",
            "Search the output for '?' or bold keys, the signs of a missing entry.",
          ],
        },
      ],
      example: {
        title: "From DOI to citation",
        text: "Copy the BibTeX export from a paper's page, paste it into the References panel, and protect the title's capitals with braces: {Retrieval Practice in {STEM} Courses}. Cite it with \\citep{lee2021retrieval}. In an author-year style, the text shows (Lee et al., 2021) and the full entry appears in the reference list.",
      },
      exercise:
        "Add three references to a Write paper: one pasted as BibTeX, one added by hand, and one from arXiv. Cite each once, switch the citation style, and check that every citation resolves.",
      quiz: {
        question: "In a .bib entry, how should multiple authors be separated?",
        options: [
          "With commas between full names",
          "With the word 'and' between names",
          "With semicolons",
        ],
        answer: 1,
        explanation:
          "BibTeX splits authors on 'and'. Commas separate surname from given names within one author, so commas between authors scramble the names.",
      },
    },
    {
      id: "latex-import",
      title: "Bring existing work into Write",
      minutes: 6,
      objective:
        "Import Word, Markdown, and LaTeX projects into Write, and check the result before relying on it.",
      sections: [
        {
          title: "Convert a document",
          text: "On the Write home page, Import a document converts a Word (.docx), Markdown, or plain-text file into a LaTeX paper. Word documents keep their headings, lists, tables, equations, pictures, footnotes, and Zotero or Mendeley citations, which become BibTeX entries. You can also drop files anywhere on the page. The converted paper opens in the editor, ready to edit in either mode.",
        },
        {
          title: "Upload a LaTeX project",
          text: "Upload a LaTeX project accepts a .zip, such as a project downloaded from Overleaf, or the project's .tex, .bib, and figure files; 'or a project folder' uploads a whole folder. arXiv source downloads usually arrive as .tar.gz archives: extract one and upload the folder. Write finds the main file, the one with both \\documentclass and \\begin{document}, makes it main.tex, and tells you what it renamed. Inside an open LaTeX project, Upload files in the project files panel adds more sources, figures, or another document to convert.",
          points: [
            "Upload the whole project so included files and figures resolve.",
            "Read the notice after import; it lists renamed or skipped files.",
            "Keep the original files; the import is a copy.",
          ],
        },
        {
          title: "Check before you trust it",
          text: "Conversion is good but not perfect. Compare the imported paper with the original: equations, tables, figure positions, footnotes, and citations. Embedded charts and some legacy objects may arrive as empty figure placeholders, and fonts are approximated. In the LaTeX editor, the Problems panel lists packages the preview does not know; the downloaded project still compiles with pdfLaTeX and BibTeX on Overleaf or a local TeX installation.",
          points: [
            "Check every equation and table against the original.",
            "Replace placeholder figures with exported images.",
            "Remember that papers live in this browser; export a copy you can keep.",
          ],
        },
      ],
      example: {
        title: "From a Word draft to a venue template",
        text: "A student imports a Word thesis chapter with Zotero citations. Write converts headings, equations, and citations, and the references appear in the References panel. One chart arrives as an empty figure, so the student exports it from the spreadsheet as a PDF, uploads it with Upload images, and points the figure at the new file.",
      },
      exercise:
        "Import a short Word or Markdown document of your own into Write. List three things that converted well and one that needed fixing, then export the result as a LaTeX project (.zip).",
      quiz: {
        question:
          "You upload a LaTeX project as a .zip. Which file does Write treat as the main file?",
        options: [
          "The largest file in the archive",
          "The file that contains both \\documentclass and \\begin{document}",
          "The first file in alphabetical order",
        ],
        answer: 1,
        explanation:
          "The main file is the one that defines the document class and contains the document body. Write makes it main.tex and reports any renaming.",
      },
    },
    {
      id: "latex-troubleshooting",
      title: "Fix the LaTeX errors you will meet",
      minutes: 7,
      objective:
        "Read error messages from the first one down and fix the most common causes quickly.",
      sections: [
        {
          title: "Start with the first error",
          text: "One mistake often triggers a cascade of later errors, so fix the first reported problem and recompile before reading further. The message names the line where LaTeX noticed the problem, which may be after the actual mistake: an unclosed brace is reported where LaTeX gives up, not where the brace was opened.",
        },
        {
          title: "The usual suspects",
          text: "Most errors come from a few causes. 'Undefined control sequence' means a misspelled command or a missing \\usepackage. 'Missing $ inserted' means math syntax, such as _ or ^ or \\alpha, appeared outside math mode, often an underscore in a file name. Unbalanced braces produce runaway-argument errors. Warnings about an 'Overfull \\hbox' mean a line sticks into the margin; they are not fatal, but check the output.",
          points: [
            "Undefined control sequence: check spelling, then the package.",
            "Missing $ inserted: escape _ as \\_ in text, or wrap the math in $...$.",
            "?? in the output: a \\ref to a missing or misspelled \\label.",
          ],
        },
        {
          title: "Troubleshooting in Write",
          text: "In the LaTeX editor, Recompile updates the preview, and double-clicking the preview jumps to the matching source line. The Problems panel collects errors and packages the preview does not support, and the LaTeX quick reference covers structure, math, and citations. The in-browser preview renders a large subset of LaTeX, so before submission, compile the exported LaTeX project (.zip) once with pdfLaTeX and BibTeX, exactly as the venue will.",
          points: [
            "Recompile after each fix rather than fixing many things at once.",
            "Use double-click on the preview to find the source of a problem.",
            "Do a final full compile of the exported project before submitting.",
          ],
        },
      ],
      example: {
        title: "One error, three messages",
        text: "A sentence reads 'see results_final.csv for the data'. The build reports 'Missing $ inserted', then two more errors on later lines. Escaping the underscore as results\\_final.csv fixes all three, because the later errors were knock-on effects of LaTeX switching into math mode.",
      },
      exercise:
        "In a copy of a Write paper, introduce three deliberate mistakes: a misspelled command, an unescaped underscore, and a reference to a missing label. Recompile, read each message, and fix them one at a time.",
      quiz: {
        question:
          "The output shows '??' where a section number should be. What is the most likely cause?",
        options: [
          "The section is too long to number.",
          "A citation key is missing from the .bib file.",
          "The \\ref points to a label that does not exist or is misspelled.",
        ],
        answer: 2,
        explanation:
          "LaTeX prints ?? for a reference it cannot resolve. Check that the \\label exists, matches exactly, and sits after the heading or caption it names.",
      },
    },
  ],
};
