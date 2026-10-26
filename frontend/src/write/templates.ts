/**
 * Starting points for new papers.
 *
 * Visual templates are built as editor JSON directly, so creating one never
 * depends on converting LaTeX. LaTeX templates are complete projects that
 * compile with pdfLaTeX + BibTeX as they are.
 */

import type { JSONContent } from "@tiptap/core";
import { BIB_FILE, DEFAULT_SETTINGS, newDocumentId } from "./documents.ts";
import type { DocumentKind, PaperDocument, PaperSettings, ProjectFile } from "./documents.ts";
import { PREPRINT_STYLES } from "./preprintStyles.ts";

export interface TemplateInfo {
  id: string;
  kind: DocumentKind;
  name: string;
  description: string;
}

/** A paper design as the gallery shows it: one card, a visual and/or a LaTeX version. */
export interface TemplateDesign {
  id: string;
  name: string;
  description: string;
  group: "general" | "arxiv" | "venues";
  visual?: string;
  latex?: string;
}

export const DESIGN_GROUPS: { id: TemplateDesign["group"]; title: string; note?: string }[] = [
  { id: "general", title: "General" },
  {
    id: "arxiv",
    title: "arXiv preprint styles",
    note: "Look-alikes of layouts common on arXiv. To submit to a conference or journal, switch to its official style files.",
  },
  { id: "venues", title: "Conference and course formats" },
];

export const DESIGNS: TemplateDesign[] = [
  { id: "blank", group: "general", name: "Blank paper", description: "An empty page with paper typography and live numbering.", visual: "blank", latex: "latex-blank" },
  { id: "article", group: "general", name: "Research article", description: "Abstract, IMRaD sections, an equation, a results table and references.", visual: "research-article", latex: "latex-article" },
  { id: "review", group: "general", name: "Literature review", description: "Search strategy, inclusion criteria and a thematic synthesis.", visual: "literature-review" },
  { id: "arxiv", group: "arxiv", name: "arXiv preprint", description: "The familiar “A Preprint” layout: title between rules, Times, author–year citations.", visual: "arxiv-preprint", latex: "latex-arxiv-preprint" },
  { id: "mlconf", group: "arxiv", name: "ML conference preprint", description: "NeurIPS/ICML-style two columns with the abstract in the first column.", visual: "ml-conference", latex: "latex-ml-conference" },
  { id: "revtex", group: "arxiv", name: "Physics (APS/REVTeX-style)", description: "Two columns, Roman section heads, “FIG. 1.” captions, numbered citations.", visual: "physics-revtex", latex: "latex-revtex" },
  { id: "amsart", group: "arxiv", name: "Mathematics (AMS article)", description: "amsart layout with small-caps headings, theorems and proofs.", visual: "math-amsart", latex: "latex-amsart" },
  { id: "ieee", group: "venues", name: "IEEE conference paper", description: "Two columns, Times, Roman section numbers and Index Terms.", visual: "ieee-conference", latex: "latex-ieee" },
  { id: "apa", group: "venues", name: "APA 7 paper", description: "Double-spaced, author–date citations and unnumbered headings.", visual: "apa-paper" },
];

export const TEMPLATES: TemplateInfo[] = [
  { id: "blank", kind: "visual", name: "Blank paper", description: "An empty page with paper typography and live numbering." },
  { id: "research-article", kind: "visual", name: "Research article", description: "Abstract, IMRaD sections, an equation, a results table and numbered references." },
  { id: "ieee-conference", kind: "visual", name: "IEEE conference paper", description: "Two columns, Times, Roman section numbers and Index Terms." },
  { id: "apa-paper", kind: "visual", name: "APA 7 paper", description: "Double-spaced, author–date citations and unnumbered headings." },
  { id: "literature-review", kind: "visual", name: "Literature review", description: "Search strategy, inclusion criteria and a thematic synthesis." },
  { id: "latex-article", kind: "latex", name: "LaTeX article", description: "A complete project: theorem, algorithm, table and a BibTeX file." },
  { id: "latex-ieee", kind: "latex", name: "IEEE paper in LaTeX", description: "The IEEEtran conference layout, ready for submission edits." },
  { id: "latex-blank", kind: "latex", name: "Blank LaTeX", description: "A minimal article with a title and one section." },
  { id: "arxiv-preprint", kind: "visual", name: "arXiv preprint", description: "Single-column preprint with a running “A Preprint” head." },
  { id: "ml-conference", kind: "visual", name: "ML conference preprint", description: "Two columns with the abstract in the first column." },
  { id: "physics-revtex", kind: "visual", name: "Physics (APS/REVTeX-style)", description: "Two-column physics letter with Roman section heads." },
  { id: "math-amsart", kind: "visual", name: "Mathematics (AMS article)", description: "amsart layout with theorems and proofs." },
  { id: "latex-arxiv-preprint", kind: "latex", name: "arXiv preprint in LaTeX", description: "article + arxiv-preprint.sty, natbib author–year." },
  { id: "latex-ml-conference", kind: "latex", name: "ML conference preprint in LaTeX", description: "Two-column article + ml-preprint.sty." },
  { id: "latex-revtex", kind: "latex", name: "Physics paper in REVTeX 4.2", description: "revtex4-2 with affiliations, acknowledgments and apsrev." },
  { id: "latex-amsart", kind: "latex", name: "Mathematics paper in amsart", description: "amsart with theorem environments and amsplain." },
];

const BIB_ML = `@inproceedings{vaswani2017attention,
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, {\\L}ukasz and Polosukhin, Illia},
  title     = {Attention Is All You Need},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {30},
  pages     = {5998--6008},
  year      = {2017}
}

@inproceedings{lewis2020retrieval,
  author    = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio and Karpukhin, Vladimir and Goyal, Naman and K{\\"u}ttler, Heinrich and Lewis, Mike and Yih, Wen-tau and Rockt{\\"a}schel, Tim and Riedel, Sebastian and Kiela, Douwe},
  title     = {Retrieval-Augmented Generation for Knowledge-Intensive {NLP} Tasks},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {33},
  pages     = {9459--9474},
  year      = {2020}
}

@inproceedings{he2016deep,
  author    = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},
  title     = {Deep Residual Learning for Image Recognition},
  booktitle = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition},
  pages     = {770--778},
  year      = {2016},
  doi       = {10.1109/CVPR.2016.90}
}

@article{lecun2015deep,
  author  = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title   = {Deep Learning},
  journal = {Nature},
  volume  = {521},
  number  = {7553},
  pages   = {436--444},
  year    = {2015},
  doi     = {10.1038/nature14539}
}
`;

const BIB_APA = `@article{kahneman1979prospect,
  author  = {Kahneman, Daniel and Tversky, Amos},
  title   = {Prospect Theory: An Analysis of Decision under Risk},
  journal = {Econometrica},
  volume  = {47},
  number  = {2},
  pages   = {263--291},
  year    = {1979},
  doi     = {10.2307/1914185}
}

@article{lecun2015deep,
  author  = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title   = {Deep Learning},
  journal = {Nature},
  volume  = {521},
  number  = {7553},
  pages   = {436--444},
  year    = {2015},
  doi     = {10.1038/nature14539}
}
`;

const BIB_REVIEW = `@article{page2021prisma,
  author  = {Page, Matthew J. and McKenzie, Joanne E. and Bossuyt, Patrick M. and Boutron, Isabelle and Hoffmann, Tammy C. and Mulrow, Cynthia D. and others},
  title   = {The {PRISMA} 2020 Statement: An Updated Guideline for Reporting Systematic Reviews},
  journal = {BMJ},
  volume  = {372},
  pages   = {n71},
  year    = {2021},
  doi     = {10.1136/bmj.n71}
}

@inproceedings{lewis2020retrieval,
  author    = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio and Karpukhin, Vladimir and Goyal, Naman and K{\\"u}ttler, Heinrich and Lewis, Mike and Yih, Wen-tau and Rockt{\\"a}schel, Tim and Riedel, Sebastian and Kiela, Douwe},
  title     = {Retrieval-Augmented Generation for Knowledge-Intensive {NLP} Tasks},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {33},
  pages     = {9459--9474},
  year      = {2020}
}
`;

const BIB_PREPRINT = `@misc{kaplan2020scaling,
  author        = {Kaplan, Jared and McCandlish, Sam and Henighan, Tom and Brown, Tom B. and Chess, Benjamin and Child, Rewon and Gray, Scott and Radford, Alec and Wu, Jeffrey and Amodei, Dario},
  title         = {Scaling Laws for Neural Language Models},
  year          = {2020},
  eprint        = {2001.08361},
  archivePrefix = {arXiv},
  primaryClass  = {cs.LG},
  doi           = {10.48550/arXiv.2001.08361},
  url           = {https://arxiv.org/abs/2001.08361}
}

@misc{brown2020language,
  author        = {Brown, Tom B. and Mann, Benjamin and Ryder, Nick and Subbiah, Melanie and Kaplan, Jared and Dhariwal, Prafulla and Neelakantan, Arvind and Shyam, Pranav and Sastry, Girish and Askell, Amanda and others},
  title         = {Language Models are Few-Shot Learners},
  year          = {2020},
  eprint        = {2005.14165},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CL},
  doi           = {10.48550/arXiv.2005.14165},
  url           = {https://arxiv.org/abs/2005.14165}
}

@inproceedings{vaswani2017attention,
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, {\\L}ukasz and Polosukhin, Illia},
  title     = {Attention Is All You Need},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {30},
  pages     = {5998--6008},
  year      = {2017}
}
`;

const BIB_PHYSICS = `@article{einstein1935can,
  author  = {Einstein, A. and Podolsky, B. and Rosen, N.},
  title   = {Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?},
  journal = {Physical Review},
  volume  = {47},
  number  = {10},
  pages   = {777--780},
  year    = {1935},
  doi     = {10.1103/PhysRev.47.777}
}

@article{bell1964einstein,
  author  = {Bell, J. S.},
  title   = {On the {E}instein {P}odolsky {R}osen Paradox},
  journal = {Physics Physique Fizika},
  volume  = {1},
  number  = {3},
  pages   = {195--200},
  year    = {1964},
  doi     = {10.1103/PhysicsPhysiqueFizika.1.195}
}

@article{aspect1982experimental,
  author  = {Aspect, Alain and Dalibard, Jean and Roger, G{\\'e}rard},
  title   = {Experimental Test of {B}ell's Inequalities Using Time-Varying Analyzers},
  journal = {Physical Review Letters},
  volume  = {49},
  number  = {25},
  pages   = {1804--1807},
  year    = {1982},
  doi     = {10.1103/PhysRevLett.49.1804}
}
`;

const BIB_MATH = `@article{selberg1949elementary,
  author  = {Selberg, Atle},
  title   = {An Elementary Proof of the Prime-Number Theorem},
  journal = {Annals of Mathematics},
  volume  = {50},
  number  = {2},
  pages   = {305},
  year    = {1949},
  doi     = {10.2307/1969455}
}

@article{erdos1949new,
  author  = {Erd{\\H{o}}s, P.},
  title   = {On a New Method in Elementary Number Theory Which Leads to an Elementary Proof of the Prime Number Theorem},
  journal = {Proceedings of the National Academy of Sciences},
  volume  = {35},
  number  = {7},
  pages   = {374--384},
  year    = {1949},
  doi     = {10.1073/pnas.35.7.374}
}
`;

// ── Editor JSON builders ───────────────────────────────────────────────────

type Inline = JSONContent | string;

function text(value: string, ...marks: string[]): JSONContent {
  return marks.length ? { type: "text", text: value, marks: marks.map((type) => ({ type })) } : { type: "text", text: value };
}

function inline(parts: Inline[]): JSONContent[] {
  return parts.map((part) => (typeof part === "string" ? text(part) : part)).filter((part) => part.type !== "text" || part.text);
}

const p = (...parts: Inline[]): JSONContent => {
  const content = inline(parts);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};
const title = (value: string): JSONContent => ({ type: "paperTitle", content: value ? [text(value)] : undefined });
const authors = (...parts: Inline[]): JSONContent => ({ type: "paperAuthors", content: inline(parts) });
const abstract = (...paragraphs: JSONContent[]): JSONContent => ({ type: "paperAbstract", content: paragraphs });
const keywords = (value: string): JSONContent => ({ type: "paperKeywords", content: [text(value)] });
const h = (level: number, value: string, id = "", numbered = true): JSONContent => ({
  type: "heading",
  attrs: { level, numbered, id },
  content: [text(value)],
});
const cite = (...keys: string[]): JSONContent => ({ type: "citation", attrs: { keys } });
const ref = (target: string): JSONContent => ({ type: "crossRef", attrs: { target } });
const math = (latex: string): JSONContent => ({ type: "mathInline", attrs: { latex } });
const note = (value: string): JSONContent => ({ type: "footnote", attrs: { text: value } });
const equation = (latex: string, id: string): JSONContent => ({ type: "mathBlock", attrs: { latex, numbered: true, id } });
const figure = (id: string, caption: string): JSONContent => ({
  type: "figure",
  attrs: { src: "", alt: "", width: 80, id },
  content: [{ type: "figcaption", content: [text(caption)] }],
});
const table = (id: string, caption: string, rows: string[][]): JSONContent => ({
  type: "tableFigure",
  attrs: { id },
  content: [
    { type: "figcaption", content: [text(caption)] },
    {
      type: "table",
      content: rows.map((row, index) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: index === 0 ? "tableHeader" : "tableCell",
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [p(cell)],
        })),
      })),
    },
  ],
});
const bullets = (...items: Inline[][]): JSONContent => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(...item)] })),
});
const bibliography: JSONContent = { type: "bibliography" };
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

function researchArticle(ieee: boolean): JSONContent {
  return doc(
    title(ieee ? "A Retrieval-Augmented Approach to Your Research Problem" : "Your Paper Title: A Clear Statement of the Contribution"),
    authors("First Author, Second Author", { type: "hardBreak" }, "Department, University, City, Country · first.author@university.edu"),
    abstract(
      p(
        "State the problem in one or two sentences, then the gap your work closes. Describe the approach, the data and the main quantitative result, and finish with why the result matters. Most abstracts are 150 to 250 words.",
      ),
    ),
    keywords(ieee ? "retrieval-augmented generation, evaluation, language models" : "first keyword, second keyword, third keyword"),
    h(1, "Introduction", "sec-intro"),
    p(
      "Open with the broad problem and narrow quickly to the question this paper answers. Transformer models ",
      cite("vaswani2017attention"),
      " and retrieval-augmented generation ",
      cite("lewis2020retrieval"),
      " are examples of how a citation looks; insert your own with the Cite button.",
      note("Footnotes number themselves and move with the text."),
    ),
    p("End the introduction with your contributions and a map of the paper: ", ref("sec-method"), " describes the method and ", ref("sec-results"), " reports the results."),
    h(1, "Related Work", "sec-related"),
    p("Group prior work by idea rather than by paper. Deep networks ", cite("lecun2015deep"), " and residual learning ", cite("he2016deep"), " are typical anchors; say how each line of work differs from yours."),
    h(1, ieee ? "Proposed Method" : "Method", "sec-method"),
    h(2, "Problem formulation", "sec-formulation"),
    p("Define the notation before you use it. Given a query ", math("q"), " and a document ", math("d"), " embedded as vectors, we score relevance with the cosine similarity"),
    equation("s(q, d) = \\frac{\\mathbf{q}^{\\top}\\mathbf{d}}{\\lVert \\mathbf{q} \\rVert \\, \\lVert \\mathbf{d} \\rVert}", "eq-score"),
    p("and rank documents by the score in ", ref("eq-score"), ". Equations number themselves; click one to edit its LaTeX."),
    h(2, "Model", "sec-model"),
    p("Describe the architecture or procedure in enough detail to reproduce it, including hyperparameters and training data."),
    h(1, "Results", "sec-results"),
    p("Lead with the main finding, then the evidence. ", ref("tab-results"), " compares the approach with baselines and ", ref("fig-overview"), " gives an overview."),
    table("tab-results", "Accuracy on the evaluation set (replace with your results).", [
      ["Model", "Precision", "Recall", "F1"],
      ["Baseline", "0.71", "0.64", "0.67"],
      ["Ours", "0.82", "0.77", "0.79"],
    ]),
    figure("fig-overview", "Overview of the approach. Click the frame to upload your figure."),
    h(1, "Discussion", "sec-discussion"),
    p("Interpret the results, compare them with prior work, and state the limitations honestly."),
    h(1, "Conclusion", "sec-conclusion"),
    p("Summarize the contribution and the most promising next step in a few sentences."),
    h(1, "Acknowledgments", "sec-ack", false),
    p("Thank funders, colleagues and data providers."),
    bibliography,
  );
}

function apaPaper(): JSONContent {
  return doc(
    title("The Title of Your Paper in Title Case"),
    authors("Your Name", { type: "hardBreak" }, "Department of Psychology, University Name"),
    abstract(p("Write a single paragraph of 150 to 250 words covering the research question, participants, method, main results and conclusions.")),
    keywords("keyword one, keyword two, keyword three"),
    p(
      "Introduce the problem and review the literature that motivates your hypotheses. Decision-making research ",
      cite("kahneman1979prospect"),
      " shows how a citation appears in author–date style; the reference list is alphabetized for you.",
    ),
    h(1, "Method", "sec-method"),
    h(2, "Participants", "sec-participants"),
    p("Describe who took part, how they were recruited and any exclusions."),
    h(2, "Materials", "sec-materials"),
    p("Describe instruments and measures, with reliability where relevant."),
    h(2, "Procedure", "sec-procedure"),
    p("Explain what participants did, in order, so the study could be repeated."),
    h(1, "Results", "sec-results"),
    p("Report the statistics that test each hypothesis, for example ", math("t(48) = 2.31,\\ p = .025"), "."),
    h(1, "Discussion", "sec-discussion"),
    p("Interpret the findings in light of prior work ", cite("lecun2015deep"), " and discuss limitations and future research."),
    bibliography,
  );
}

function literatureReview(): JSONContent {
  return doc(
    title("A Review of Your Topic: Themes, Evidence and Gaps"),
    authors("Your Name", { type: "hardBreak" }, "Institution"),
    abstract(p("Summarize the review question, the search strategy, how many studies were included and the main themes that emerged.")),
    keywords("literature review, synthesis, research gaps"),
    h(1, "Introduction", "sec-intro"),
    p("Explain why the topic matters and state the review question precisely. ", ref("sec-method"), " describes how studies were found and selected."),
    h(1, "Review Method", "sec-method"),
    p("Report databases, search strings, dates and screening steps; reporting guidelines such as PRISMA 2020 ", cite("page2021prisma"), " list what to include."),
    table("tab-criteria", "Inclusion and exclusion criteria.", [
      ["Criterion", "Included", "Excluded"],
      ["Publication type", "Peer-reviewed articles", "Opinion pieces"],
      ["Years", "2015–2026", "Before 2015"],
      ["Language", "English", "Other languages"],
    ]),
    h(1, "Findings", "sec-findings"),
    h(2, "Theme one", "sec-theme-1"),
    p("Synthesize what the studies in this theme agree on and where they differ, citing each claim ", cite("lewis2020retrieval"), "."),
    h(2, "Theme two", "sec-theme-2"),
    p("Organize by idea, not study by study."),
    h(1, "Research Gaps", "sec-gaps"),
    bullets(["A question the literature has not answered."], ["A population or setting that is missing."], ["A method that has not been tried."]),
    h(1, "Conclusion", "sec-conclusion"),
    p("Answer the review question and say what researchers should do next."),
    bibliography,
  );
}

const raw = (source: string): JSONContent => ({ type: "rawLatex", attrs: { source } });

function arxivPreprint(): JSONContent {
  return doc(
    title("Your Preprint Title: Concise, Specific and Searchable"),
    authors("First Author, Second Author", { type: "hardBreak" }, "Department of Computer Science, University · first.author@university.edu"),
    abstract(
      p(
        "Summarize the question, the method and the main quantitative result in one paragraph. arXiv readers decide from the title and abstract alone, so name the task, the data and the size of the improvement.",
      ),
    ),
    keywords("language models · retrieval · scaling laws"),
    h(1, "Introduction", "sec-intro"),
    p(
      "Motivate the problem and state the gap. Language-model loss falls predictably with scale ",
      cite("kaplan2020scaling"),
      ", and large models learn new tasks from a few examples ",
      cite("brown2020language"),
      ". Close with your contributions and an outline: ",
      ref("sec-method"),
      " describes the method and ",
      ref("sec-experiments"),
      " the experiments.",
    ),
    h(1, "Related Work", "sec-related"),
    p("Position the work against the closest prior methods; the transformer architecture ", cite("vaswani2017attention"), " is the usual starting point."),
    h(1, "Method", "sec-method"),
    p("Define the setting precisely. Following the scaling-law form, the loss of a model with ", math("N"), " parameters is modelled as"),
    equation("L(N) = \\left( \\frac{N_c}{N} \\right)^{\\alpha_N}", "eq-scaling"),
    p("where ", math("N_c"), " and ", math("\\alpha_N"), " are fitted constants; ", ref("eq-scaling"), " is fitted on held-out loss."),
    h(1, "Experiments", "sec-experiments"),
    p("State the data, baselines and metrics, then the main result: ", ref("tab-results"), " lists the scores and ", ref("fig-curves"), " the training curves."),
    table("tab-results", "Held-out loss by model size (replace with your results).", [
      ["Parameters", "Loss", "Tokens"],
      ["125M", "3.21", "300B"],
      ["1.3B", "2.68", "300B"],
    ]),
    figure("fig-curves", "Training loss against compute. Click the frame to add your figure."),
    h(1, "Conclusion", "sec-conclusion"),
    p("Summarize what was shown, its limits and the next step."),
    h(1, "Acknowledgments", "sec-ack", false),
    p("Thank colleagues and funders."),
    bibliography,
  );
}

function mlConference(): JSONContent {
  return doc(
    title("A Two-Column Conference Preprint: Your Title Here"),
    authors("First Author, Second Author", { type: "hardBreak" }, "Machine Learning Lab, University"),
    abstract(
      p("Write a single paragraph of four to six sentences: the problem, why it is hard, the key idea, the main result with a number, and the take-away."),
    ),
    h(1, "Introduction", "sec-intro"),
    p(
      "Introduce the task and the limitation of current approaches. Scaling studies ",
      cite("kaplan2020scaling"),
      " and in-context learning ",
      cite("brown2020language"),
      " are example citations in author–year style. ",
      ref("sec-approach"),
      " presents the approach.",
    ),
    h(1, "Background", "sec-background"),
    p("Recall the standard formulation. Self-attention ", cite("vaswani2017attention"), " computes"),
    equation("\\operatorname{Attention}(Q, K, V) = \\operatorname{softmax}\\!\\left( \\frac{Q K^{\\top}}{\\sqrt{d_k}} \\right) V", "eq-attention"),
    h(1, "Approach", "sec-approach"),
    p("Describe the method and how it changes ", ref("eq-attention"), ". Keep notation consistent with the background."),
    h(1, "Experiments", "sec-experiments"),
    p("Report the main comparison in ", ref("tab-main"), " and an ablation in ", ref("fig-ablation"), "."),
    table("tab-main", "Accuracy on the benchmark (mean of three seeds).", [
      ["Method", "Accuracy", "Params"],
      ["Baseline", "71.2", "110M"],
      ["Ours", "74.8", "110M"],
    ]),
    figure("fig-ablation", "Ablation of the main components."),
    h(1, "Limitations", "sec-limitations"),
    p("Say where the method fails and what the experiments do not show."),
    h(1, "Conclusion", "sec-conclusion"),
    p("Summarize the contribution in two or three sentences."),
    bibliography,
  );
}

function physicsRevtex(): JSONContent {
  return doc(
    title("Violation of the CHSH Inequality with Entangled Photon Pairs"),
    authors("First Author, Second Author", { type: "hardBreak" }, "Department of Physics, University, City, Country"),
    abstract(
      p(
        "Summarize the measurement and its significance in one paragraph without citations. State the observed value with its uncertainty, for example the Bell parameter and how many standard deviations it lies above the classical bound.",
      ),
    ),
    keywords("Bell inequality, entanglement, quantum optics"),
    h(1, "Introduction", "sec-intro"),
    p(
      "Einstein, Podolsky and Rosen questioned whether quantum mechanics is complete ",
      cite("einstein1935can"),
      ". Bell showed that local hidden-variable theories obey inequalities that quantum mechanics violates ",
      cite("bell1964einstein"),
      ", and early experiments with time-varying analyzers confirmed the violation ",
      cite("aspect1982experimental"),
      ".",
    ),
    h(1, "Theory", "sec-theory"),
    p("For analyzer settings ", math("a, a'"), " and ", math("b, b'"), " the CHSH combination of correlations is"),
    equation("S = E(a, b) - E(a, b') + E(a', b) + E(a', b')", "eq-chsh"),
    p("Local hidden-variable models satisfy ", math("|S| \\le 2"), ", while quantum mechanics allows ", math("|S| = 2\\sqrt{2}"), " at optimal settings; see ", ref("eq-chsh"), "."),
    h(1, "Experimental Setup", "sec-setup"),
    p("Describe the source, detection and timing. ", ref("fig-setup"), " shows the layout."),
    figure("fig-setup", "Schematic of the setup. Click the frame to add your figure."),
    h(1, "Results", "sec-results"),
    p("The measured correlations are listed in ", ref("tab-correlations"), " and give ", math("S = 2.70 \\pm 0.05"), "."),
    table("tab-correlations", "Measured correlation coefficients (replace with your data).", [
      ["Settings", "E", "Uncertainty"],
      ["(a, b)", "−0.67", "0.02"],
      ["(a, b′)", "0.68", "0.02"],
      ["(a′, b)", "−0.68", "0.02"],
      ["(a′, b′)", "−0.67", "0.02"],
    ]),
    h(1, "Conclusion", "sec-conclusion"),
    p("State the result, the loopholes it does or does not close, and the outlook."),
    h(1, "Acknowledgments", "sec-ack", false),
    p("Acknowledge funding agencies and grant numbers."),
    bibliography,
  );
}

function mathAmsart(): JSONContent {
  return doc(
    title("On Elementary Proofs of the Prime Number Theorem"),
    authors("First Author", { type: "hardBreak" }, "Department of Mathematics, University, City, Country"),
    abstract(p("State the main theorem and the idea of its proof in a few sentences. Avoid citations and undefined notation in the abstract.")),
    keywords("prime number theorem, elementary methods, Selberg's formula"),
    h(1, "Introduction", "sec-intro"),
    p("Let ", math("\\pi(x)"), " denote the number of primes not exceeding ", math("x"), ". The prime number theorem asserts that"),
    equation("\\pi(x) \\sim \\frac{x}{\\log x} \\qquad (x \\to \\infty).", "eq-pnt"),
    p(
      "Elementary proofs of ",
      ref("eq-pnt"),
      ", avoiding complex analysis, were given by Selberg ",
      cite("selberg1949elementary"),
      " and Erdős ",
      cite("erdos1949new"),
      ". ",
      ref("sec-main"),
      " states the key identity.",
    ),
    h(1, "Preliminaries", "sec-prelim"),
    p("Write ", math("p"), " and ", math("q"), " for primes and let Chebyshev's function be"),
    equation("\\theta(x) = \\sum_{p \\le x} \\log p.", "eq-theta"),
    h(1, "The Main Identity", "sec-main"),
    raw(
      "\\begin{theorem}[Selberg's symmetry formula]\nFor $x \\ge 2$,\n\\[ \\sum_{p \\le x} \\log^2 p + \\sum_{pq \\le x} \\log p \\, \\log q = 2x \\log x + O(x). \\]\n\\end{theorem}\n\\begin{proof}\nWrite the proof here. In the exported PDF, theorems are numbered within sections.\n\\end{proof}",
    ),
    p("Explain how the identity yields ", ref("eq-pnt"), " and where the argument needs care."),
    h(1, "Concluding Remarks", "sec-remarks"),
    p("Mention generalizations and open questions."),
    bibliography,
  );
}

const LATEX_ARTICLE = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{algorithm}
\\usepackage{algpseudocode}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}

\\newtheorem{theorem}{Theorem}[section]
\\newcommand{\\R}{\\mathbb{R}}

\\title{Your Paper Title}
\\author{First Author \\\\ University \\and Second Author \\\\ Institute}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
State the problem, the approach, the main result and why it matters in 150--250 words.
\\end{abstract}

\\section{Introduction}\\label{sec:intro}
Transformers~\\cite{vaswani2017attention} and retrieval-augmented generation~\\cite{lewis2020retrieval}
are example citations from \\texttt{references.bib}. Section~\\ref{sec:method} describes the method.%
\\footnote{The preview resolves references, citations and footnotes as you type.}

\\section{Method}\\label{sec:method}
Given a query $q$ and documents $d \\in \\R^n$, we score relevance with
\\begin{equation}\\label{eq:score}
  s(q, d) = \\frac{\\mathbf{q}^{\\top}\\mathbf{d}}{\\lVert \\mathbf{q} \\rVert \\, \\lVert \\mathbf{d} \\rVert}.
\\end{equation}

\\begin{theorem}\\label{thm:bound}
For unit vectors, $-1 \\le s(q, d) \\le 1$.
\\end{theorem}
\\begin{proof}
This is the Cauchy--Schwarz inequality applied to Eq.~\\eqref{eq:score}.
\\end{proof}

\\begin{algorithm}[t]
\\caption{Top-$k$ retrieval}\\label{alg:topk}
\\begin{algorithmic}[1]
\\Require query $q$, corpus $D$, integer $k$
\\State $S \\gets \\emptyset$
\\For{each $d \\in D$}
  \\State add $(d, s(q, d))$ to $S$
\\EndFor
\\State \\Return the $k$ highest-scoring documents in $S$
\\end{algorithmic}
\\end{algorithm}

\\section{Results}\\label{sec:results}
Table~\\ref{tab:results} compares the method with a baseline, and
Figure~\\ref{fig:overview} gives an overview.

\\begin{table}[t]
  \\centering
  \\caption{Accuracy on the evaluation set.}\\label{tab:results}
  \\begin{tabular}{lccc}
    \\toprule
    Model & Precision & Recall & F$_1$ \\\\
    \\midrule
    Baseline & 0.71 & 0.64 & 0.67 \\\\
    Ours     & \\textbf{0.82} & \\textbf{0.77} & \\textbf{0.79} \\\\
    \\bottomrule
  \\end{tabular}
\\end{table}

\\begin{figure}[t]
  \\centering
  % Upload an image in the Files panel and replace the box, for example:
  % \\includegraphics[width=0.8\\linewidth]{overview.png}
  \\fbox{\\parbox[c][3cm][c]{0.8\\linewidth}{\\centering Figure placeholder}}
  \\caption{Overview of the approach.}\\label{fig:overview}
\\end{figure}

\\section{Conclusion}
Summarize the contribution and the most promising next step.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`;

const LATEX_IEEE = `\\documentclass[conference]{IEEEtran}
\\usepackage{cite}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}

\\begin{document}

\\title{Paper Title (use Title Case)}

\\author{\\IEEEauthorblockN{First Author}
\\IEEEauthorblockA{Department, University\\\\
City, Country \\\\
first.author@university.edu}
\\and
\\IEEEauthorblockN{Second Author}
\\IEEEauthorblockA{Research Institute\\\\
City, Country \\\\
second.author@institute.org}}

\\maketitle

\\begin{abstract}
State the problem, the method, the main quantitative result and its significance.
\\end{abstract}

\\begin{IEEEkeywords}
retrieval, language models, evaluation
\\end{IEEEkeywords}

\\section{Introduction}\\label{sec:intro}
Attention-based models~\\cite{vaswani2017attention} and residual networks~\\cite{he2016deep}
are example citations. Section~\\ref{sec:method} presents the method.

\\section{Method}\\label{sec:method}
\\subsection{Problem Formulation}
We minimise the cross-entropy loss
\\begin{equation}\\label{eq:loss}
  \\mathcal{L}(\\theta) = -\\sum_{i=1}^{N} \\log p_\\theta(y_i \\mid x_i).
\\end{equation}

\\section{Experiments}
Table~\\ref{tab:results} reports the results.

\\begin{table}[htbp]
\\caption{Results on the test set}\\label{tab:results}
\\centering
\\begin{tabular}{lcc}
\\toprule
Method & Accuracy & F1 \\\\
\\midrule
Baseline & 0.71 & 0.67 \\\\
Ours & \\textbf{0.82} & \\textbf{0.79} \\\\
\\bottomrule
\\end{tabular}
\\end{table}

\\section{Conclusion}
Summarise the contribution.

\\bibliographystyle{IEEEtran}
\\bibliography{references}

\\end{document}
`;

const LATEX_BLANK = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}

\\title{Untitled Paper}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Start writing here. Inline math looks like $e^{i\\pi} + 1 = 0$.

\\end{document}
`;

const LATEX_ARXIV = `\\documentclass[11pt,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{newtxtext,newtxmath}
\\usepackage[margin=1in]{geometry}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage[round]{natbib}
\\usepackage{arxiv-preprint}
\\usepackage{hyperref}

\\title{Your Preprint Title: Concise, Specific and Searchable}
\\author{First Author \\\\ Department of Computer Science \\\\ University
  \\and Second Author \\\\ Research Institute}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
Summarize the question, the method and the main quantitative result in one
paragraph. arXiv readers decide from the title and abstract alone.
\\end{abstract}
\\keywords{language models, retrieval, scaling laws}

\\section{Introduction}\\label{sec:intro}
Language-model loss falls predictably with scale \\citep{kaplan2020scaling},
and large models learn new tasks from a few examples \\citep{brown2020language}.
Section~\\ref{sec:method} describes the method.

\\section{Method}\\label{sec:method}
Following \\citet{kaplan2020scaling}, the loss of a model with $N$ parameters is
\\begin{equation}\\label{eq:scaling}
  L(N) = \\left( \\frac{N_c}{N} \\right)^{\\alpha_N}.
\\end{equation}

\\section{Experiments}\\label{sec:experiments}
Table~\\ref{tab:results} lists the results.
\\begin{table}[t]
  \\centering
  \\caption{Held-out loss by model size.}\\label{tab:results}
  \\begin{tabular}{lcc}
    \\toprule
    Parameters & Loss & Tokens \\\\
    \\midrule
    125M & 3.21 & 300B \\\\
    1.3B & 2.68 & 300B \\\\
    \\bottomrule
  \\end{tabular}
\\end{table}

\\section{Conclusion}
Summarize what was shown, its limits and the next step.

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`;

const LATEX_ML = `\\documentclass[10pt,twocolumn,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{newtxtext,newtxmath}
\\usepackage[margin=0.75in,columnsep=0.25in]{geometry}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage[round]{natbib}
\\usepackage{ml-preprint}
\\usepackage{hyperref}

\\title{A Two-Column Conference Preprint: Your Title Here}
\\author{First Author \\\\ Machine Learning Lab, University
  \\and Second Author \\\\ Research Institute}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
One paragraph: the problem, why it is hard, the key idea, the main result
with a number, and the take-away.
\\end{abstract}

\\section{Introduction}\\label{sec:intro}
Scaling studies \\citep{kaplan2020scaling} and in-context learning
\\citep{brown2020language} are example citations. Section~\\ref{sec:approach}
presents the approach.

\\section{Background}
Self-attention \\citep{vaswani2017attention} computes
\\begin{equation}\\label{eq:attention}
  \\operatorname{Attention}(Q, K, V) = \\operatorname{softmax}\\!\\left( \\frac{Q K^{\\top}}{\\sqrt{d_k}} \\right) V.
\\end{equation}

\\section{Approach}\\label{sec:approach}
Describe how the method changes Eq.~\\eqref{eq:attention}.

\\section{Experiments}
\\begin{table}[t]
  \\centering
  \\caption{Accuracy on the benchmark (mean of three seeds).}\\label{tab:main}
  \\begin{tabular}{lcc}
    \\toprule
    Method & Accuracy & Params \\\\
    \\midrule
    Baseline & 71.2 & 110M \\\\
    Ours & \\textbf{74.8} & 110M \\\\
    \\bottomrule
  \\end{tabular}
\\end{table}
Table~\\ref{tab:main} reports the main comparison.

\\section{Limitations}
Say where the method fails and what the experiments do not show.

\\section{Conclusion}
Summarize the contribution in two or three sentences.

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`;

const LATEX_REVTEX = `\\documentclass[aps,reprint,amsmath,amssymb]{revtex4-2}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{hyperref}

\\begin{document}

\\title{Violation of the CHSH Inequality with Entangled Photon Pairs}

\\author{First Author}
\\author{Second Author}
\\affiliation{Department of Physics, University, City, Country}

\\date{\\today}

\\begin{abstract}
Summarize the measurement and its significance in one paragraph without
citations, including the observed Bell parameter and its uncertainty.
\\end{abstract}

\\keywords{Bell inequality, entanglement, quantum optics}

\\maketitle

\\section{Introduction}
Einstein, Podolsky and Rosen questioned whether quantum mechanics is
complete~\\cite{einstein1935can}. Bell showed that local hidden-variable
theories obey inequalities that quantum mechanics violates~\\cite{bell1964einstein},
as confirmed with time-varying analyzers~\\cite{aspect1982experimental}.

\\section{Theory}\\label{sec:theory}
For analyzer settings $a, a'$ and $b, b'$,
\\begin{equation}\\label{eq:chsh}
  S = E(a, b) - E(a, b') + E(a', b) + E(a', b').
\\end{equation}
Local models satisfy $|S| \\le 2$; quantum mechanics allows $|S| = 2\\sqrt{2}$.

\\section{Results}
Table~\\ref{tab:correlations} gives $S = 2.70 \\pm 0.05$, using Eq.~\\eqref{eq:chsh}.
\\begin{table}[b]
  \\caption{Measured correlation coefficients.}\\label{tab:correlations}
  \\begin{ruledtabular}
  \\begin{tabular}{lcc}
    Settings & $E$ & Uncertainty \\\\
    \\hline
    $(a, b)$ & $-0.67$ & 0.02 \\\\
    $(a, b')$ & $0.68$ & 0.02 \\\\
    $(a', b)$ & $-0.68$ & 0.02 \\\\
    $(a', b')$ & $-0.67$ & 0.02 \\\\
  \\end{tabular}
  \\end{ruledtabular}
\\end{table}

\\section{Conclusion}
State the result, the loopholes it does or does not close, and the outlook.

\\begin{acknowledgments}
Acknowledge funding agencies and grant numbers.
\\end{acknowledgments}

\\bibliography{references}

\\end{document}
`;

const LATEX_AMSART = `\\documentclass[11pt]{amsart}
\\usepackage{amssymb}
\\usepackage{hyperref}

\\newtheorem{theorem}{Theorem}[section]
\\newtheorem{lemma}[theorem]{Lemma}
\\theoremstyle{definition}
\\newtheorem{definition}[theorem]{Definition}
\\theoremstyle{remark}
\\newtheorem{remark}[theorem]{Remark}
\\numberwithin{equation}{section}

\\begin{document}

\\title{On Elementary Proofs of the Prime Number Theorem}
\\author{First Author}
\\address{Department of Mathematics, University, City, Country}
\\email{first.author@university.edu}

\\subjclass[2020]{11N05}
\\keywords{prime number theorem, elementary methods, Selberg's formula}

\\begin{abstract}
State the main theorem and the idea of its proof in a few sentences.
\\end{abstract}

\\maketitle

\\section{Introduction}\\label{sec:intro}
Let $\\pi(x)$ denote the number of primes not exceeding $x$. The prime number
theorem asserts that
\\begin{equation}\\label{eq:pnt}
  \\pi(x) \\sim \\frac{x}{\\log x} \\qquad (x \\to \\infty).
\\end{equation}
Elementary proofs of \\eqref{eq:pnt} were given by
Selberg~\\cite{selberg1949elementary} and Erd\\H{o}s~\\cite{erdos1949new}.

\\section{Preliminaries}
\\begin{definition}
Chebyshev's function is $\\theta(x) = \\sum_{p \\le x} \\log p$, the sum taken over primes.
\\end{definition}

\\section{The main identity}\\label{sec:main}
\\begin{theorem}[Selberg's symmetry formula]\\label{thm:selberg}
For $x \\ge 2$,
\\[
  \\sum_{p \\le x} \\log^2 p + \\sum_{pq \\le x} \\log p \\, \\log q = 2x \\log x + O(x).
\\]
\\end{theorem}

\\begin{proof}
Write the proof here.
\\end{proof}

\\begin{remark}
Theorem~\\ref{thm:selberg} is the starting point of both elementary proofs.
\\end{remark}

\\bibliographystyle{amsplain}
\\bibliography{references}

\\end{document}
`;

const VISUAL: Record<string, { settings: Partial<PaperSettings>; content: () => JSONContent; bib: string; title: string }> = {
  blank: { settings: {}, content: () => doc(title(""), p()), bib: "", title: "Untitled paper" },
  "research-article": { settings: {}, content: () => researchArticle(false), bib: BIB_ML, title: "Research article" },
  "ieee-conference": {
    settings: { theme: "ieee", columns: 2, font: "times", fontSize: 10, paper: "letter", lineSpacing: 1, citationStyle: "ieee" },
    content: () => researchArticle(true),
    bib: BIB_ML,
    title: "IEEE conference paper",
  },
  "apa-paper": {
    settings: { theme: "apa", font: "times", fontSize: 12, paper: "letter", lineSpacing: 2, citationStyle: "apa", numberedHeadings: false },
    content: apaPaper,
    bib: BIB_APA,
    title: "APA paper",
  },
  "literature-review": { settings: {}, content: literatureReview, bib: BIB_REVIEW, title: "Literature review" },
  "arxiv-preprint": {
    settings: { theme: "arxiv", columns: 1, font: "times", fontSize: 11, paper: "letter", lineSpacing: 1, citationStyle: "apa" },
    content: arxivPreprint,
    bib: BIB_PREPRINT,
    title: "arXiv preprint",
  },
  "ml-conference": {
    settings: { theme: "mlconf", columns: 2, font: "times", fontSize: 10, paper: "letter", lineSpacing: 1, citationStyle: "apa" },
    content: mlConference,
    bib: BIB_PREPRINT,
    title: "ML conference preprint",
  },
  "physics-revtex": {
    settings: { theme: "revtex", columns: 2, font: "cm", fontSize: 10, paper: "letter", lineSpacing: 1, citationStyle: "ieee" },
    content: physicsRevtex,
    bib: BIB_PHYSICS,
    title: "Physics paper",
  },
  "math-amsart": {
    settings: { theme: "amsart", columns: 1, font: "cm", fontSize: 11, paper: "letter", lineSpacing: 1, citationStyle: "ieee" },
    content: mathAmsart,
    bib: BIB_MATH,
    title: "Mathematics paper",
  },
};

const LATEX: Record<string, { source: string; bib: string; title: string; files?: ProjectFile[] }> = {
  "latex-article": { source: LATEX_ARTICLE, bib: BIB_ML, title: "LaTeX article" },
  "latex-ieee": { source: LATEX_IEEE, bib: BIB_ML, title: "IEEE paper" },
  "latex-blank": { source: LATEX_BLANK, bib: "", title: "Untitled LaTeX paper" },
  "latex-arxiv-preprint": {
    source: LATEX_ARXIV,
    bib: BIB_PREPRINT,
    title: "arXiv preprint (LaTeX)",
    files: [{ name: "arxiv-preprint.sty", content: PREPRINT_STYLES["arxiv-preprint"] }],
  },
  "latex-ml-conference": {
    source: LATEX_ML,
    bib: BIB_PREPRINT,
    title: "ML conference preprint (LaTeX)",
    files: [{ name: "ml-preprint.sty", content: PREPRINT_STYLES["ml-preprint"] }],
  },
  "latex-revtex": { source: LATEX_REVTEX, bib: BIB_PHYSICS, title: "Physics paper (REVTeX)" },
  "latex-amsart": { source: LATEX_AMSART, bib: BIB_MATH, title: "Mathematics paper (amsart)" },
};

export function createFromTemplate(templateId: string, now = Date.now()): PaperDocument {
  const base = {
    id: newDocumentId(),
    template: templateId,
    createdAt: now,
    updatedAt: now,
    files: [],
    assets: [],
  };
  const latex = LATEX[templateId];
  if (latex) {
    return {
      ...base,
      title: latex.title,
      kind: "latex",
      settings: { ...DEFAULT_SETTINGS },
      content: null,
      bib: "",
      source: latex.source,
      files: [{ name: BIB_FILE, content: latex.bib }, ...(latex.files ?? [])],
    };
  }
  const visual = VISUAL[templateId] ?? VISUAL.blank;
  return {
    ...base,
    template: VISUAL[templateId] ? templateId : "blank",
    title: visual.title,
    kind: "visual",
    settings: { ...DEFAULT_SETTINGS, ...visual.settings },
    content: visual.content(),
    bib: visual.bib,
    source: "",
  };
}
