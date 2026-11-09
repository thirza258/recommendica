import type { Course } from "./types.ts";

export const researchStepByStep: Course = {
  id: "research-step-by-step",
  title: "Do research, step by step",
  category: "Research workflow",
  description:
    "Move from a proposal to a documented study, a careful analysis, and a research paper someone else can follow.",
  outcome: "A practical workflow from study protocol to final report.",
  resources: [
    {
      title: "MIT UROP: project plans and evaluations",
      url: "https://urop.mit.edu/guidelines/proposals-evaluations/",
    },
    {
      title: "The Turing Way: a handbook for reproducible, ethical, and collaborative research",
      url: "https://book.the-turing-way.org/",
    },
  ],
  lessons: [
    {
      id: "plan-and-pilot",
      title: "Step 1 — Write a protocol and run a pilot",
      minutes: 7,
      objective:
        "Turn the proposal into clear procedures and test them on a small scale.",
      sections: [
        {
          title: "Record the decisions before the results",
          text: "A protocol describes the sequence of work: question, study design, eligibility rules, materials, measurements, and analysis. Specify how you will handle missing observations and departures from the plan. For confirmatory work, consider preregistering the question and analysis before observing outcomes; clearly separate later exploratory work.",
        },
        {
          title: "Use a pilot to find practical problems",
          text: "Test your survey, interview guide, code, or extraction sheet on a small suitable example after any necessary approvals. Check whether instructions are clear and the process produces the evidence you need. A pilot tests feasibility; it is not a shortcut to a definitive finding.",
          points: [
            "Write down each problem and the change it motivates.",
            "Version the protocol so changes remain visible.",
            "Decide and document whether pilot observations can belong in the final analysis.",
          ],
        },
        {
          title: "Decide what the pilot must prove",
          text: "A pilot without a question becomes a rehearsal with no notes. Before running it, write down what would count as 'worked' and what would count as 'needs changing': instructions understood without help, extraction fields filled without guessing, code finishing in tolerable time. These are feasibility criteria, not results, and recording them in advance keeps the pilot's findings honest.",
          points: [
            "Name one observable sign of success per piloted step.",
            "Time the steps — the pilot is the only cheap place to learn the true cost.",
            "End the pilot with a dated change list, each entry saying which problem motivated it.",
          ],
        },
      ],
      example: {
        title: "Pilot a literature extraction sheet",
        text: "Two readers extract methods and findings from the same two papers. They discover that 'sample size' is ambiguous because one paper reports both participants and repeated observations. They add separate fields and record the decision before processing the full set.",
      },
      exercise:
        "Write a numbered protocol with at least five actions. Identify one action you can pilot, a sign that it worked, and a rule for documenting revisions.",
      quiz: {
        question:
          "A pilot reveals that an important question is ambiguous. What should you do?",
        options: [
          "Keep it unchanged to avoid documenting a revision.",
          "Revise it, record why, and check the revised procedure before the main study.",
          "Treat the pilot as the final study.",
        ],
        answer: 1,
        explanation:
          "Finding problems is the purpose of a pilot. A documented revision improves the procedure while preserving the history of the work.",
      },
      practicePrompt:
        "How do pilot studies improve the design of research protocols?",
    },
    {
      id: "collect-and-organize",
      title: "Step 2 — Collect and organize the evidence",
      minutes: 7,
      objective:
        "Keep observations traceable from their original source through cleaning and analysis.",
      sections: [
        {
          title: "Keep an untouched source copy",
          text: "Preserve original data or source records and work on a separate analysis copy. For each file, record where it came from, when it was obtained, and what permission or access conditions apply. Use consistent identifiers and file names. Store sensitive material only in an appropriate approved location.",
        },
        {
          title: "Make your evidence understandable",
          text: "Create a data dictionary that explains fields, units, allowed values, and missing-value codes. Keep a research log for collection issues and a reproducible record of cleaning decisions. For qualitative work, preserve the connection between an interpretation and the relevant passage.",
          points: [
            "Check duplicates, impossible values, inconsistent units, and missing records.",
            "Explain exclusions instead of silently deleting inconvenient observations.",
            "Back up working files and keep personal identifiers separate where appropriate.",
          ],
        },
        {
          title: "Choose formats that outlive tools",
          text: "Evidence stored in a format only one tool can open has a shorter life than the project. Prefer open, documented formats for anything meant to last — plain text, CSV, standard image types — and keep a README in the data folder explaining what each file is and which produced which. A folder that explains itself survives staff changes, new computers, and the author's own memory a year later.",
          points: [
            "Store source material in open formats; keep a tool-specific copy only if a workflow demands it.",
            "Give files names that carry meaning six months from now.",
            "Note software versions next to files they produced or consumed.",
          ],
        },
      ],
      example: {
        title: "A cleaning decision someone can follow",
        text: "A time column mixes seconds and minutes. Preserve the original column, create a standardized seconds column, and record the conversion rule and affected rows. Do not overwrite the only original record.",
      },
      exercise:
        "Create a small data dictionary with field name, meaning, unit, and missing-value rule. Write one sample log entry explaining a change to the analysis copy.",
      quiz: {
        question:
          "You discover a suspicious observation. What is the best next step?",
        options: [
          "Delete it because it weakens the result.",
          "Change its value to match neighboring observations.",
          "Check the source, apply a documented rule, and preserve the original record.",
        ],
        answer: 2,
        explanation:
          "A traceable decision lets others understand and assess the analysis. A surprising value is not by itself a reason to remove it.",
      },
    },
    {
      id: "analyze-and-interpret",
      title: "Step 3 — Analyze and question the result",
      minutes: 8,
      objective:
        "Separate what the evidence shows from the interpretation you place on it.",
      sections: [
        {
          title: "Start with a description",
          text: "Inspect the evidence before fitting complex models or forming themes. Summarize distributions, missingness, and variation, or become familiar with qualitative material through repeated reading. Then follow your planned analysis and record deviations. Label analyses suggested by the observed results as exploratory.",
        },
        {
          title: "Test your interpretation",
          text: "Ask whether a different reasonable analysis, selection rule, or explanation changes the conclusion. Quantitative reports should communicate effect sizes and uncertainty where appropriate, not only a threshold for statistical significance. Qualitative reports should connect interpretations to evidence and consider cases that challenge a theme.",
          points: [
            "Distinguish an association from a causal effect.",
            "Check whether the finding depends heavily on a few observations or assumptions.",
            "Describe what the sample, measures, and design leave unresolved.",
          ],
        },
        {
          title: "Chain each claim to its evidence",
          text: "A report is strongest where every claim can show its chain: the finding, the specific result or passage supporting it, and the reasoning from one to the other. Writing the chain down exposes weak links while they are still cheap to fix — a claim with no result behind it becomes either supported or deleted. Keep interpretation out of the results section and evidence out of the discussion's speculations; each belongs where readers expect it.",
          points: [
            "For each conclusion, one sentence of result, one of interpretation, and a pointer to the table or passage.",
            "Mark claims that rest on one case or one study as such.",
            "Re-read the report asking of every sentence: known, shown, or guessed?",
          ],
        },
      ],
      example: {
        title: "Results versus interpretation",
        text: "Result: students using quizzes had higher average scores in the observed course. Interpretation: quizzes may support learning, but prior knowledge or self-selection could explain the difference. A further study would need to address those alternatives.",
      },
      exercise:
        "Write one result sentence and one interpretation sentence using your own project or the example. Add an alternative explanation and a check that could help investigate it.",
      quiz: {
        question:
          "Several reasonable analysis choices give very different results. What should the report do?",
        options: [
          "Show the sensitivity and explain why the conclusion is uncertain.",
          "Present only the analysis with the strongest result.",
          "Claim that more analysis always guarantees the preferred conclusion.",
        ],
        answer: 0,
        explanation:
          "A conclusion that changes with reasonable assumptions needs that uncertainty made visible. Selecting only a favorable analysis hides relevant evidence.",
      },
      practicePrompt:
        "How does self-selection bias affect estimates from observational studies?",
    },
    {
      id: "write-and-share",
      title: "Step 4 — Write, revise, and share the study",
      minutes: 7,
      objective:
        "Write a report whose question, methods, evidence, and conclusions connect clearly.",
      sections: [
        {
          title: "Give each section a job",
          text: "Adapt the structure to your field and publication requirements. A common empirical structure uses an introduction for the question and context, methods for what you did, results for what you found, and discussion for interpretation and limits. Write the abstract after the main argument is stable.",
          points: [
            "Support background claims with sources you have checked.",
            "Include enough methodological detail for another researcher to understand the work.",
            "Label figures with units, sample information, and explanations of uncertainty.",
          ],
        },
        {
          title: "Audit the claims before sharing",
          text: "Check each conclusion against a result and each citation against its original source. Report unexpected and inconclusive findings honestly. Ask a reader to identify gaps in the argument. Prepare data, code, or supporting materials for sharing when consent, privacy, licenses, and institutional rules allow it; explain any access restrictions.",
        },
        {
          title: "Revise in passes",
          text: "Trying to fix structure, evidence, and wording at once produces a draft that is half-improved everywhere. Read the draft several times with one job per pass: first whether the sections appear in an order the argument needs, then whether every claim has its evidence attached, and only last for sentence-level clarity. Reading the draft aloud, or having a tool read it to you, catches the rough edges the eyes skip.",
          points: [
            "Structure pass: could a reader outline the argument from the headings alone?",
            "Evidence pass: does every claim point to a result, quote, table, or citation?",
            "Language pass last — polishing sentences that a later pass might delete is wasted work.",
          ],
        },
      ],
      example: {
        title: "A conclusion with the right scope",
        text: "In this course, quiz use was associated with higher scores. Because participation was voluntary, the study does not isolate the effect of quizzes. A comparison designed to address self-selection would strengthen the evidence.",
      },
      exercise:
        "Outline your report using question, methods, results, discussion, and references. For each planned conclusion, name the evidence that would support it and one boundary on the claim.",
      quiz: {
        question: "Which practice makes a research report more useful?",
        options: [
          "Hide deviations so the process appears perfectly planned.",
          "Describe procedures, relevant deviations, uncertainty, and access to supporting materials.",
          "Remove all inconclusive results.",
        ],
        answer: 1,
        explanation:
          "Transparent reporting lets readers assess how the study was conducted and what its findings can support.",
      },
    },
    {
      id: "qualitative-evidence",
      title: "Work with interviews, texts, and observations",
      minutes: 7,
      objective:
        "Analyse non-numeric material so another researcher could follow how a claim traces back to the words.",
      sections: [
        {
          title: "Code close to the words",
          text: "Qualitative analysis earns trust the same way statistics does: through a followable procedure. Read a transcript more than once before labelling anything. Mark short passages with codes in the participants' own vocabulary where possible, then group related codes into themes. Each theme should be able to name at least one quotation that supports it and, ideally, one passage that complicates it.",
          points: [
            "Keep codes anchored to exact quotes, so interpretations stay checkable.",
            "Let a second reader code a sample independently and discuss the disagreements.",
            "Count nothing you have not defined; even 'how often a theme appears' needs a rule.",
          ],
        },
        {
          title: "Show the trail from words to claims",
          text: "An audit trail is the qualitative answer to reproducibility: the raw material, the codes, the themes, and the final claims arranged so a reader can walk from one to the next. A short reflexivity note — who analysed the material, and what perspective they bring — helps readers judge what the interpretation filters out. Report the cases that fought the theme; a theme that survives its counter-examples is worth much more than one that never met any.",
        },
        {
          title: "Decide how much material is enough",
          text: "Qualitative studies choose participants and texts for what they can reveal, not for statistical representativeness: purposive sampling seeks people with relevant and varied experience of the question. How many is enough depends on how broad the question is, how specific the sample is, and how rich each conversation turns out to be. Many researchers stop when new material adds little to the themes that answer the question, often called saturation; whatever rule you use, set it in advance and report how you applied it.",
          points: [
            "Choose participants for relevant, varied experience, and say how.",
            "Set a provisional number and a stopping rule before you start.",
            "Report when and why you stopped collecting.",
          ],
        },
      ],
      example: {
        title: "A theme with its trail",
        text: "Theme: students treated practice quizzes as a schedule, not feedback. Trail: eleven quotes where quiz scores led to planning comments ('that one means I'm behind'); two complicating quotes where scores triggered strategy changes. The report names both, and the complicating cases shape the limitation section.",
      },
      exercise:
        "Code one page of an interview or one long text. Produce five codes, one theme, one supporting quote, and one passage that complicates the theme. Note what in your own background might bend your reading.",
      quiz: {
        question: "Several interviews contradict a theme you had begun to trust. What does good practice look like?",
        options: [
          "Leave those interviews out of the report as outliers.",
          "Recode them until they fit the theme.",
          "Report the contrary cases and discuss what they mean for the theme's scope.",
        ],
        answer: 2,
        explanation:
          "Contrary evidence delimits a theme instead of destroying it. Hiding or forcing it makes the analysis unfalsifiable and the claim weaker.",
      },
      practicePrompt:
        "How do researchers measure the reliability of qualitative coding, such as inter-rater agreement?",
    },
    {
      id: "reproducible-analysis",
      title: "Make the study rerunnable",
      minutes: 6,
      objective:
        "Package data, code, and environment so a peer could rerun the analysis and get the same tables.",
      sections: [
        {
          title: "Scripts over clicks",
          text: "An analysis that lives in a sequence of button presses cannot be repeated exactly, by you or by anyone else. Write the analysis as scripts or notebooks that run end to end on the raw data, pin the software versions, and set a seed wherever randomness is involved. A README that says what to run, in what order, turns a folder of files into an analysis someone else can execute.",
          points: [
            "Every figure and table should be traceable to a script that produces it.",
            "Pin versions of the language, key packages, and any external service.",
            "If steps cannot be scripted, document them precisely enough for a stranger to follow.",
          ],
        },
        {
          title: "Share what you can, say what you cannot",
          text: "A data availability statement is now standard: name what is shared, where, and under what licence. When consent, privacy, or licensing prevents sharing, a synthetic dataset with the same structure lets others test that the pipeline runs, and the restriction is documented rather than mysterious. Sharing code has a side benefit for you — it catches broken steps long before a reader does.",
        },
        {
          title: "Keep a history and freeze a version",
          text: "Version control, such as Git, records every change to code and text with a note explaining why, so you can return to the exact analysis behind any draft. Treat raw data as read-only: scripts read it and write cleaned files elsewhere, so a mistake never overwrites the original. When the paper is submitted, tag that version and archive it in a repository that issues a DOI, so the paper can cite the exact code and data it reports.",
          points: [
            "Commit small changes with messages that say why.",
            "Never edit raw data by hand; derive cleaned files with scripts.",
            "Archive the submitted version under a persistent identifier.",
          ],
        },
      ],
      example: {
        title: "A folder a reviewer can run",
        text: "An analysis folder holds data/ (de-identified), scripts/01_clean.R and scripts/02_model.R, a RESULTS.md with the produced tables, and a README: 'Run 01 then 02 with R 4.3 and the versions in renv.lock; figures land in figures/.' A reviewer reproduces every table without emailing the author.",
      },
      exercise:
        "Write a README for your project: the exact steps to rerun the analysis, the software and versions, and which file produces which figure. Mark any step that cannot be rerun and say why.",
      quiz: {
        question: "Which practice most directly makes an analysis reproducible?",
        options: [
          "A scripted pipeline that runs end to end, with software versions pinned.",
          "Performing each step manually in interactive tools, carefully.",
          "Describing the analysis in prose without scripts or data.",
        ],
        answer: 0,
        explanation:
          "Reproducibility means someone else (or you in a year) can rerun the exact procedure. Manual steps and prose descriptions do not survive the transfer.",
      },
      practicePrompt:
        "How often can published computational analyses be reproduced from shared code and data?",
    },
  ],
};
