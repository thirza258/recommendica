import type { Course } from "./types.ts";

export const readResearch: Course = {
  id: "read-research",
  title: "Read research with confidence",
  category: "Critical reading",
  description:
    "Find a paper's main idea, examine its methods and results, and take notes that preserve the meaning of the evidence.",
  outcome:
    "A critical reading note with a finding, supporting evidence, and limitations.",
  resources: [
    {
      title: "S. Keshav: How to Read a Paper",
      url: "https://www.cl.cam.ac.uk/~ey204/teaching/ACS/R244_2025_2026/aid/keshav.pdf",
    },
    {
      title: "Jason Eisner, Johns Hopkins: How to Read a Technical Paper",
      url: "https://www.cs.jhu.edu/~jason/advice/how-to-read-a-paper.html",
    },
    {
      title: "EQUATOR Network: reporting guidelines by study type",
      url: "https://www.equator-network.org/",
    },
  ],
  lessons: [
    {
      id: "map-the-paper",
      title: "First, map the paper",
      minutes: 5,
      objective:
        "Identify the question and contribution before reading every detail.",
      sections: [
        {
          title: "Read in passes",
          text: "S. Keshav's three-pass approach separates orientation, understanding, and detailed examination. First scan the title, abstract, introduction, headings, and conclusion to decide what the paper is about. A second pass follows the argument and figures. A deeper pass examines assumptions and reconstructs the reasoning when the paper matters to your work.",
        },
        {
          title: "Create a map before judging",
          text: "Write down the research question, the type of paper, the evidence used, and the claimed contribution. Notice whether you are reading an original study, a review, a theoretical argument, or a position paper. These require different kinds of evidence. An abstract is an orientation aid, not enough on its own to evaluate a finding.",
        },
        {
          title: "Place the paper in its field",
          text: "A paper is easier to judge once you know what it is replying to. Check who it cites most and who cites it: the cited cluster shows the conversation it joins, and the citing cluster shows whether the field received it as a building block, a curiosity, or a contested claim. Ten minutes in a citation index often tells you more about a paper's standing than the paper's own introduction does.",
          points: [
            "Note the two or three works the introduction treats as its foundation.",
            "Skim one paper that cites it critically, if any exist yet.",
            "Recent work citing it tells you what the open questions now are.",
          ],
        },
      ],
      example: {
        title: "A four-line paper map",
        text: "Question: Does a new retrieval method improve finding relevant documents? Type: benchmark experiment. Evidence: comparisons on specified datasets. Contribution claimed: better retrieval under the tested conditions. Next reading task: examine the baselines and evaluation setup.",
      },
      exercise:
        "Choose a paper and make a four-line map: question, paper type, evidence, and claimed contribution. List two unfamiliar terms and decide which section to read next.",
      quiz: {
        question: "What is the main purpose of the first reading pass?",
        options: [
          "Memorize every equation.",
          "Understand the paper's direction and decide where deeper reading is needed.",
          "Accept the abstract's conclusions without examining evidence.",
        ],
        answer: 1,
        explanation:
          "Orientation helps you allocate attention. It prepares you to evaluate the details in later reading passes.",
      },
      practicePrompt:
        "What are recent advances in dense passage retrieval for open-domain question answering?",
    },
    {
      id: "evaluate-methods",
      title: "Ask whether the methods support the claim",
      minutes: 7,
      objective:
        "Evaluate the connection between the study design and the conclusion.",
      sections: [
        {
          title: "Inspect how the evidence was produced",
          text: "Identify what was studied, how cases were selected, what was measured, and what was compared. Ask whether the measures capture the concept in the research question. Check exclusions, missing observations, and whether relevant procedures are described well enough to assess.",
        },
        {
          title: "Look for plausible alternatives",
          text: "Consider what else might explain the result. In an observational study, groups may differ before the exposure of interest. In a benchmark, test data may overlap with training data or a baseline may receive less tuning. In an interview study, recruitment and the researcher's interpretation shape which experiences are represented.",
          points: [
            "Is the comparison appropriate and treated fairly?",
            "Does the sample cover the population or setting named in the conclusion?",
            "Are assumptions, deviations, and limitations explained?",
            "What additional evidence would make the argument stronger?",
          ],
        },
        {
          title: "Check whether the study can be rerun",
          text: "A method you cannot inspect is a method you must take on faith. Look for the artefacts that make checking possible: the code and data, or a clear statement of why they cannot be shared; exact settings for models and instruments; and enough procedure detail that a competent reader could repeat the study. Papers that promise reproducibility and provide a broken link have told you something important.",
          points: [
            "Try one shared artefact — a link, a repository — rather than assuming it works.",
            "Check whether hyperparameters, thresholds, and preprocessing are stated numerically.",
            "Absence of sharing details is itself a finding worth recording in your notes.",
          ],
        },
      ],
      example: {
        title: "A comparison that needs scrutiny",
        text: "A paper says a new search method is better, but it tests the new method on a newer dataset than the baseline. You cannot tell whether the difference comes from the method or the evaluation setup without a comparable test.",
      },
      exercise:
        "Find the methods section of your paper. Record the sample or dataset, comparison, outcome measure, and one possible alternative explanation for the main result.",
      quiz: {
        question:
          "What most directly weakens a claim that method A outperforms method B?",
        options: [
          "The paper includes a limitations section.",
          "The authors explain how to reproduce the comparison.",
          "The methods were evaluated on different test sets without accounting for the difference.",
        ],
        answer: 2,
        explanation:
          "An unequal evaluation can confound a method difference with a dataset difference. Stating limitations or providing reproducibility details improves assessability.",
      },
      practicePrompt:
        "How do differences in evaluation datasets affect comparisons between information retrieval methods?",
    },
    {
      id: "interpret-results",
      title: "Read figures, numbers, and uncertainty",
      minutes: 7,
      objective:
        "Describe a result accurately without losing its scale or uncertainty.",
      sections: [
        {
          title: "Read the figure before the headline",
          text: "Start with the caption, axes, units, legend, and sample information. Check whether an axis is truncated or logarithmic. Find out whether plotted values are counts, proportions, averages, or model estimates. Error bars can mean different things, so look for their definition before interpreting them.",
        },
        {
          title: "Keep magnitude and uncertainty together",
          text: "Ask how large the difference is, how uncertain the estimate is, and whether the size matters for the question. A statistical significance threshold does not establish a large or useful effect. A non-significant result does not by itself show that two conditions are equivalent. For qualitative results, examine how the cited material supports each theme and whether contrary cases are addressed.",
        },
        {
          title: "Read tables deliberately",
          text: "Tables carry the paper's real evidence, and most readers skim them. Slow down at the main table: find the sample size each row rests on, which rows are missing (a condition absent from the table is often a condition that failed), and what the best and worst cells actually differ by. A table you can narrate — 'this column is the baseline, this is the new method, the gap is X on Y' — is a table you can cite honestly.",
          points: [
            "Locate the counts behind each row before reading any average.",
            "Notice bolding and footnotes: they mark where authors want your eyes.",
            "Check whether the table's numbers match the sentence that cites it.",
          ],
        },
      ],
      example: {
        title: "Percentage points versus relative change",
        text: "In a hypothetical study, accuracy rises from 40% to 50%. That is an increase of 10 percentage points, or 25% relative to the original 40%. Saying only 'a 10% improvement' is ambiguous. The sample, comparison, and uncertainty still matter.",
      },
      exercise:
        "Choose one figure or table. Write a sentence naming the comparison, units, magnitude, and reported uncertainty. If the uncertainty is not given, record that rather than inventing it.",
      quiz: {
        question:
          "A proportion increases from 20% to 30%. Which description is accurate?",
        options: [
          "An increase of 10 percentage points and a 50% relative increase.",
          "An increase of 10 percentage points and a 10% relative increase.",
          "An increase of 50 percentage points.",
        ],
        answer: 0,
        explanation:
          "The absolute change is 30 − 20 = 10 percentage points. Relative to the initial value, 10 ÷ 20 = 0.5, or 50%.",
      },
      practicePrompt:
        "How does presenting results as relative or absolute changes affect how readers interpret them?",
    },
    {
      id: "notes-and-citations",
      title: "Take useful notes and cite responsibly",
      minutes: 6,
      objective:
        "Create notes that separate a source's finding, its limits, and your own interpretation.",
      sections: [
        {
          title: "Write a note your future self can use",
          text: "Jason Eisner recommends writing as you read and keeping both detailed annotations and a higher-level account of what you learned. Include a link to the paper and the location of relevant evidence. Explain the main idea in your own words and connect it to other work or questions.",
        },
        {
          title: "Preserve the boundaries of the claim",
          text: "Keep quotations visibly separate from paraphrases and your own ideas. Cite the original paper for a finding you have checked, and verify author names, title, year, and publication details. A paper mentioned in another author's bibliography is not a source you have personally read. Compare several studies before making a claim about a whole field.",
          points: [
            "Finding: what was observed or argued, in which setting?",
            "Evidence: which passage, figure, table, or analysis supports it?",
            "Limitations: what cannot be concluded?",
            "Your response: how does this affect your question or next step?",
          ],
        },
        {
          title: "Grow notes into related work",
          text: "A pile of per-paper notes becomes related-work material only when someone synthesises it. Every few weeks, reread your notes and write short paragraphs that compare rather than list: which studies agree, which contradict, and what the disagreement turns on — populations, measures, or methods. Claims about a field need at least a small cluster of sources behind them, and the synthesis paragraph is where you find out whether your cluster is one.",
          points: [
            "Group notes by claim, not by paper, when you start writing.",
            "Name the axes of disagreement explicitly; vague synthesis hides real conflicts.",
            "A single study rarely supports 'researchers have shown that…' — check the cluster.",
          ],
        },
      ],
      example: {
        title: "A reusable note template",
        text: "Citation and link → research question → method and sample → main finding with evidence location → limitations → connection to my project → unresolved question. Label any exact copied words as a quotation immediately.",
      },
      exercise:
        "Write a six-sentence critical note on one paper using the template. Check each sentence against the original and mark which sentences are your own interpretation.",
      quiz: {
        question: "Which note best supports responsible use of a paper?",
        options: [
          "A copied paragraph without quotation marks or a source location.",
          "A paraphrased finding with its citation, evidence location, limitations, and your separate interpretation.",
          "An AI summary saved as proof that the original study is correct.",
        ],
        answer: 1,
        explanation:
          "Traceable evidence and clear attribution help preserve the source's meaning and keep your interpretation distinct from its findings.",
      },
      practicePrompt:
        "How common are citation and quotation errors in published research papers?",
    },
    {
      id: "question-the-numbers",
      title: "Question the numbers like a reader",
      minutes: 7,
      objective:
        "Interpret effect sizes, uncertainty, and significance claims without needing a statistics course.",
      sections: [
        {
          title: "Ask how big and how sure",
          text: "Two questions sit behind almost every quantitative claim. How big is the effect, in units that matter to the reader? And how sure is the estimate, shown as an interval, a spread, or an honest statement of what is unknown? A result can be statistically significant and practically tiny; an estimate can be impressive and so imprecise that it barely constrains the truth. Reports that give only a threshold verdict make both questions impossible to answer.",
          points: [
            "Prefer claims that state the size of the effect, not just its direction.",
            "Treat an interval as the estimate's honest shadow; a wide interval is information.",
            "Statistical significance is about the threshold the authors chose, not about importance.",
          ],
        },
        {
          title: "Watch the denominators",
          text: "Every percentage hides a base. An improvement from 2% to 4% doubles the number yet adds two percentage points; which framing matters depends entirely on the question. Check how many cases each number rests on, whether anyone dropped out between the groups, and whether many comparisons were made — a single impressive result among dozens of tests deserves more scepticism than one pre-specified comparison.",
        },
        {
          title: "Check what was compared",
          text: "A number means little without its comparison. Find out which groups were compared, whether they were similar at the start, and whether the figure is raw or adjusted for other variables. A subgroup result, a secondary outcome, or a time point chosen after seeing the data deserves more caution than the pre-specified main comparison, and an association from observational data does not show what would happen if someone intervened.",
          points: [
            "Find the main, pre-specified comparison before reading the rest.",
            "Check whether the groups differed at the start, and how that was handled.",
            "Notice causal verbs attached to observational associations.",
          ],
        },
      ],
      example: {
        title: "The same table, described two ways",
        text: "Ten of twenty patients improved with the treatment; eight of twenty with the placebo. That is an absolute gain of ten percentage points, on twenty patients per arm — an interval wide enough to include a much smaller benefit. A summary that says only '25% more patients improved' skips both the small base and the uncertainty.",
      },
      exercise:
        "Find one numbered claim in a paper you are reading. Write down the base it is computed from, the absolute change in its natural units, and whether the report gives any measure of uncertainty. Record what is missing.",
      quiz: {
        question: "A study reports a difference that is 'not statistically significant'. What follows?",
        options: [
          "The study proves the two treatments are equivalent.",
          "The study failed to distinguish an effect from no effect at the chosen threshold; equivalence was not demonstrated.",
          "The study was fraudulent.",
        ],
        answer: 1,
        explanation:
          "Absence of a significant difference is not evidence of no difference. Showing equivalence needs a design and analysis built for that question.",
      },
      practicePrompt:
        "How common is selective reporting of outcomes in clinical trials?",
    },
    {
      id: "venue-and-version",
      title: "Judge the venue and the version",
      minutes: 6,
      objective:
        "Tell preprints, peer-reviewed versions, and corrected or retracted work apart before relying on a paper.",
      sections: [
        {
          title: "Versions of the same work",
          text: "Much current research appears first as a preprint, then again as a peer-reviewed article — sometimes rewritten, occasionally with different results. Before building on a paper, check whether a published version exists, and cite the version you actually read, noting the preprint when that is all there is. The preprint is not wrong for being a preprint; it simply has not been through review, and your note should carry that fact.",
        },
        {
          title: "The health of a venue",
          text: "Peer review ranges from rigorous to rubber-stamp, and a polished website proves nothing. Signals that help: is the editorial board real and relevant, is the venue indexed where you would expect, do its published papers get discussed and built on. Also check the paper's own history — corrections, retractions, and disputes are usually visible on the publisher's page, and citing a retracted result is the kind of mistake readers never forgive.",
          points: [
            "Look up the paper title plus 'retraction' or 'correction' once, before heavy reliance.",
            "A venue outside your field deserves an extra moment of checking.",
            "When in doubt, weight the work by its evidence, not by its venue's branding.",
          ],
        },
        {
          title: "See what happened next",
          text: "A paper's reception is evidence too. Look forward at later work that cites it: replications, failed replications, reanalyses, commentaries, and systematic reviews that appraised it. Citation counts measure attention rather than correctness, and a famous result can rest on one small study that later attempts did not reproduce. A few minutes in a citation index can change how much weight a single paper deserves.",
          points: [
            "Search for replications or reanalyses of the key result.",
            "Check whether a recent systematic review included and appraised it.",
            "Treat citation counts as popularity, not proof.",
          ],
        },
      ],
      example: {
        title: "Citing the right version",
        text: "A method paper exists as arXiv v1 (March) and as a conference paper (December) with an extra ablation. The note cites the conference version for the method, keeps the arXiv id in the same entry, and mentions the extra ablation lives only in the published version — so a reader knows where each claim was checked.",
      },
      exercise:
        "Take one paper you have saved. Find whether a preprint or a published version exists beyond the copy you read, and check its page for corrections or retractions. Record which version you will cite and why.",
      quiz: {
        question: "A paper you found on arXiv is…",
        options: [
          "A preprint: posted without journal peer review, though it may later be published.",
          "Certified as peer reviewed because arXiv hosts it.",
          "Retracted until a journal accepts it.",
        ],
        answer: 0,
        explanation:
          "arXiv screening checks fit and topic, not scientific validity. The record's publication status needs its own check.",
      },
      practicePrompt:
        "How often do findings change between preprints and their published versions?",
    },
  ],
};
