export interface CourseLesson {
  id: string;
  title: string;
  minutes: number;
  objective: string;
  sections: { title: string; text: string; points?: string[] }[];
  example: { title: string; text: string };
  exercise: string;
  quiz: {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  };
  practicePrompt?: string;
}

export interface Course {
  id: string;
  title: string;
  category: string;
  description: string;
  outcome: string;
  resources: { title: string; url: string }[];
  lessons: CourseLesson[];
}

export const COURSES: Course[] = [
  {
    id: "create-research",
    title: "Create your first research project",
    category: "Foundations",
    description:
      "Turn an interesting topic into a focused question, a useful literature review, and a realistic research proposal.",
    outcome: "A research question and a one-page project proposal.",
    resources: [
      {
        title: "MIT UROP: planning a research proposal",
        url: "https://urop.mit.edu/guidelines/proposals-evaluations/",
      },
    ],
    lessons: [
      {
        id: "research-question",
        title: "Turn a topic into a research question",
        minutes: 6,
        objective:
          "Write a question that identifies what you will study and what evidence could answer it.",
        sections: [
          {
            title: "Start with an uncertainty",
            text: "A topic names an area of interest. A research question identifies something you do not yet know within that area. Begin with a problem you can explain in plain language, then ask what you would need to observe, compare, or interpret to understand it.",
            points: [
              "Name the people, material, system, or texts you will study.",
              "Specify the outcome or experience you want to understand.",
              "Set boundaries: a setting, time period, comparison, or dataset.",
            ],
          },
          {
            title: "Make the scope achievable",
            text: "Check whether you can access the evidence, learn the method, and finish within your time and resources. Avoid a question that assumes its own answer. Exploratory and qualitative projects can use open questions; a testable hypothesis is useful when your design evaluates a specific prediction.",
          },
        ],
        example: {
          title: "From broad topic to workable question",
          text: "Topic: learning with technology. Question: Among first-year students in one introductory course, how does using weekly practice quizzes relate to end-of-term scores? This names a population, an activity, and an outcome without assuming that the quizzes cause higher scores.",
        },
        exercise:
          "Write your topic in five words. Turn it into one question, underline the outcome, and list the evidence you would need. Narrow one part that you cannot realistically study.",
        quiz: {
          question: "Which question gives a first project the clearest scope?",
          options: [
            "How can we improve all education?",
            "Why are practice quizzes always effective?",
            "How do students in one introductory course describe their use of weekly practice quizzes?",
          ],
          answer: 2,
          explanation:
            "The question names a group, a setting, and a specific experience. It can be investigated without assuming a positive result.",
        },
        practicePrompt:
          "What research examines the relationship between practice quizzes and learning outcomes in undergraduate courses?",
      },
      {
        id: "literature-review",
        title: "Find the conversation and the gap",
        minutes: 7,
        objective:
          "Build a literature map that connects prior findings to a question worth investigating.",
        sections: [
          {
            title: "Search in more than one way",
            text: "Split your question into concepts and list synonyms for each. Search for broad reviews to learn the vocabulary, then locate original studies. Follow useful papers' references and, in a citation index, look for later work that cites them. Keep a record of the queries, dates, and places you searched.",
          },
          {
            title: "Synthesize across papers",
            text: "A literature review explains patterns and disagreements. Make a table with one row per paper and columns for question, setting, method, findings, and limitations. Group studies by the idea or method they examine. A gap may be a disagreement, an untested explanation, or a context that prior evidence does not cover.",
            points: [
              "Read the original source before describing its result.",
              "Record findings that challenge your preferred explanation.",
              "Treat an empty search as a reason to revise your search, not proof that nobody has studied the topic.",
            ],
          },
        ],
        example: {
          title: "A defensible gap statement",
          text: "The three studies I reviewed examine quiz scores in large lecture courses. I will investigate how students use feedback in a small seminar. This is a gap in my reviewed evidence; I still need broader searches before claiming the topic is new.",
        },
        exercise:
          "Create a five-column literature table for three papers. Write two sentences describing a pattern and one sentence identifying an uncertainty that remains.",
        quiz: {
          question:
            "Your first search returns no useful papers. What should you conclude?",
          options: [
            "The research question has never been studied.",
            "Try related terms, references, and other literature sources before claiming a gap.",
            "There is no reason to continue researching.",
          ],
          answer: 1,
          explanation:
            "Search coverage and vocabulary can limit what you find. Novelty needs more evidence than one empty result set.",
        },
      },
      {
        id: "research-design",
        title: "Choose a design that fits the question",
        minutes: 7,
        objective:
          "Connect your question to a method and state what that method can and cannot establish.",
        sections: [
          {
            title: "Match the evidence to the question",
            text: "Questions about experiences may call for interviews or observation. Questions about patterns may use surveys or existing datasets. A controlled experiment can help investigate effects when the comparison and assignment are appropriate. A literature-based project needs explicit rules for finding and comparing sources.",
          },
          {
            title: "Define the comparison and the limits",
            text: "Describe how you will select cases, measure or interpret the evidence, and analyze it. Think about alternative explanations before collecting data. Students who choose practice quizzes may already differ in motivation; comparing their scores alone does not isolate a quiz effect.",
            points: [
              "Define key terms so someone else understands what counts as an observation.",
              "Choose a sample and analysis approach with a supervisor or methods specialist when needed.",
              "For work involving people, sensitive data, or other regulated activities, check institutional ethics requirements before starting.",
            ],
          },
        ],
        example: {
          title: "Let the method shape the claim",
          text: "Interviewing students can reveal how they experience quiz feedback. It cannot, by itself, estimate how much quizzes improve examination scores. A useful project states this boundary in its question and conclusions.",
        },
        exercise:
          "Choose one method for your question. Write why it fits, what evidence it produces, and one conclusion that the design would not justify.",
        quiz: {
          question:
            "Quiz users score higher in an observational dataset. What is justified from that comparison alone?",
          options: [
            "Using quizzes caused the difference.",
            "Quizzes will help every student equally.",
            "Quiz use and scores are associated in this dataset; other explanations need investigation.",
          ],
          answer: 2,
          explanation:
            "An observed difference may reflect motivation, prior knowledge, or other factors. Causal claims need a design and assumptions that address such alternatives.",
        },
      },
      {
        id: "project-proposal",
        title: "Write a proposal you can act on",
        minutes: 6,
        objective:
          "Bring your question, evidence, method, and schedule together in a short proposal.",
        sections: [
          {
            title: "Explain the project in one page",
            text: "A proposal should let a reader understand why the question matters and how you intend to answer it. Start with the problem and relevant prior work. State the question, then describe the evidence and analysis. End with expected contributions and limits, without predicting a result as if it were already known.",
            points: [
              "Background and question: what is known and what remains uncertain?",
              "Method and feasibility: what will you do, with which resources?",
              "Deliverables and schedule: what will you produce and when will you review progress?",
            ],
          },
          {
            title: "Plan for decisions, not just dates",
            text: "Break the work into milestones such as a literature table, a pilot, a checked dataset, an analysis, and a draft. Identify dependencies like data access and feedback. Keep a smaller fallback scope in case a dependency fails. Agree with collaborators on responsibilities and how often you will discuss progress.",
          },
        ],
        example: {
          title: "A milestone with a decision",
          text: "By the end of week two, complete a pilot of the interview guide and discuss whether the questions address the research aim. Revise the guide before the main interviews. This is more useful than a calendar entry that only says 'do interviews'.",
        },
        exercise:
          "Draft a proposal with six short parts: background, question, method, resources and ethics, milestones, and expected output. Ask a reader to identify your question and first concrete step.",
        quiz: {
          question:
            "What belongs in a proposal before the study has been conducted?",
          options: [
            "A clear question, planned method, feasible milestones, and anticipated limitations.",
            "A claim that your preferred hypothesis has been proven.",
            "Only a title and a list of interesting papers.",
          ],
          answer: 0,
          explanation:
            "A proposal makes the intended work assessable. The findings must come from the research, not be decided in advance.",
        },
      },
    ],
  },
  {
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
    ],
  },
  {
    id: "website-tutorial",
    title: "Get started with Recommendica",
    category: "Website tutorial",
    description:
      "Walk through your first search, understand the answers, inspect the source papers, and refine your next question.",
    outcome:
      "A first literature search and a source you have checked yourself.",
    resources: [],
    lessons: [
      {
        id: "first-search",
        title: "Ask your first research question",
        minutes: 4,
        objective: "Open the research console and submit a focused question.",
        sections: [
          {
            title: "Choose a starting point",
            text: "On the home page, enter a question and select Search Papers to start immediately. Open Console takes you to the research form. Topic suggestions also start searches. In the console, edit the Research prompt field and select Research question when you are ready.",
          },
          {
            title: "Give the search useful context",
            text: "Write a natural-language question that includes the topic and the comparison, population, or outcome you care about. The search adjusts its depth automatically. You do not need to choose a search mode. Course practice buttons fill the prompt so you can edit it before submitting.",
            points: [
              "Start with one question rather than several unrelated requests.",
              "Spell out an unfamiliar abbreviation at least once.",
              "Use Stop search if you want to cancel; any results already received remain visible.",
            ],
          },
        ],
        example: {
          title: "A prompt you can try",
          text: "What research compares practice testing with rereading for long-term retention in university students? This gives the search a learning strategy, a comparison, an outcome, and a population.",
        },
        exercise:
          "Select Try this in search below. Review the prefilled question, adapt one detail to your interests, and select Research question when ready. Use Courses in the console header to return here.",
        quiz: {
          question:
            "What happens when you select Try this in search in a lesson?",
          options: [
            "A question is filled in so you can review it before submitting.",
            "A paid course subscription begins.",
            "The example is automatically accepted as a research finding.",
          ],
          answer: 0,
          explanation:
            "The course opens the console with a practice prompt. You choose when to submit the search.",
        },
        practicePrompt:
          "What research compares practice testing with rereading for long-term retention in university students?",
      },
      {
        id: "understand-answers",
        title: "Understand drafts and source checks",
        minutes: 5,
        objective:
          "Read the status of an answer before deciding how to use it.",
        sections: [
          {
            title: "Follow the answer as it develops",
            text: "The console shows search progress and, when available, a short explanation of the research approach. Answers arrive in groups called chunks. A draft can appear while checks are still running, and its wording may change after review. Wait for the review label before treating an answer as checked.",
          },
          {
            title: "Interpret the labels carefully",
            text: "Checked against the source excerpts means the app's review found support in the excerpts supplied to it. The source support score concerns that review; it does not measure the quality of the study or the probability that its conclusions are true.",
            points: [
              "A Draft label means the checks are in progress or incomplete.",
              "Read any limitations listed with a checked answer.",
              "Answer withheld means source checks did not pass; inspect the available papers instead of relying on the earlier draft.",
              "A score shown as unknown or unavailable is not evidence of zero support.",
            ],
          },
        ],
        example: {
          title: "Checked is a starting point for reading",
          text: "An answer can accurately summarize an abstract while the full study has a small sample or a limited setting. The source check helps you trace a statement; reading the original paper helps you judge whether its evidence is convincing.",
        },
        exercise:
          "After a search, locate one answer's review label. Write down whether it is a draft, checked, limited by a stated caveat, or withheld. Identify one claim you still need to inspect in the source.",
        quiz: {
          question:
            "Does a high source support score guarantee that a study is correct?",
          options: [
            "Yes, it replaces reading the paper.",
            "Yes, it means the findings were independently replicated.",
            "No. It reflects support in supplied excerpts, and the original evidence still needs assessment.",
          ],
          answer: 2,
          explanation:
            "Source support is about how the answer relates to the available excerpts. It does not independently validate the study's design or findings.",
        },
      },
      {
        id: "inspect-sources",
        title: "Open the papers behind an answer",
        minutes: 5,
        objective:
          "Trace an answer back to a source and check the context of a claim.",
        sections: [
          {
            title: "Expand the evidence",
            text: "Below an answer, open the source documents section. Each card shows the available title, summary, category, and authors. When a source link is available, View on arXiv opens the original record in another tab. Papers found through the live fallback are labeled live from arXiv.",
          },
          {
            title: "Check the original context",
            text: "If a claim list is available, expand it to inspect the assessment and supporting evidence. Then open the paper itself and locate the relevant passage, figure, or table. Check that the population, comparison, quantities, and caveats match the statement you want to use.",
            points: [
              "An excerpt or summary may omit important methodological details.",
              "An arXiv listing is not itself proof of peer review; check the record and publication history.",
              "If no source link is supplied, use the title and authors to find the original publication elsewhere.",
            ],
          },
        ],
        example: {
          title: "A traceable reading note",
          text: "Claim: a method improved performance on a benchmark. Source check: locate the table, identify which benchmark split and baseline were used, and record the limits stated by the authors. Save the title, authors, year, link, and table location in your notes.",
        },
        exercise:
          "Expand one source card, open its paper if a link is available, and locate one cited finding. Record the evidence location and a limitation in your own research notes.",
        quiz: {
          question: "What does the live from arXiv label tell you?",
          options: [
            "The study passed peer review.",
            "The paper came from the live arXiv search source.",
            "The app independently reproduced the experiment.",
          ],
          answer: 1,
          explanation:
            "The label identifies where the paper was retrieved. Publication status and study quality require separate checks.",
        },
      },
      {
        id: "refine-search",
        title: "Refine a search and keep useful notes",
        minutes: 4,
        objective:
          "Use the first results to improve your next question and build a reading list.",
        sections: [
          {
            title: "Use results as feedback",
            text: "If papers are too broad, add a specific setting, outcome, or comparison. If coverage is thin, remove one restrictive detail or try terminology used by a relevant paper. Edit the Research prompt and submit again. Each new search replaces the current results, so keep useful paper details in your own notes first.",
          },
          {
            title: "Know what an empty result means",
            text: "A notice about insufficient related papers describes this search's evidence. It does not establish that no research exists. Recommendica searches its available collection and may consult arXiv when coverage is weak. Use additional scholarly databases and reference lists when building a thorough review.",
            points: [
              "Keep the search question, date, paper links, and a brief relevance note.",
              "Compare related studies instead of relying on the first result.",
              "Courses keeps lesson completion in this browser; your research notes and searches are not saved as an account library.",
            ],
          },
        ],
        example: {
          title: "Refine one dimension at a time",
          text: "Too broad: What helps students learn? More focused: What evidence compares spaced practice with massed practice for retaining vocabulary? If that is too narrow, try removing the vocabulary setting while keeping the comparison.",
        },
        exercise:
          "Write a broad and a focused version of the same question. Try the version that addresses the problem in your first results, then record which change improved relevance.",
        quiz: {
          question:
            "A search reports insufficient related papers. What is a useful next action?",
          options: [
            "Try revised terminology and additional literature sources, and record the search limits.",
            "Write that the topic has never been researched.",
            "Use an unchecked draft as the final evidence.",
          ],
          answer: 0,
          explanation:
            "The notice is about the evidence available to that search. Revising terms and consulting other sources can improve coverage.",
        },
        practicePrompt:
          "What evidence compares spaced practice with massed practice for retaining vocabulary?",
      },
    ],
  },
  {
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
      },
    ],
  },
];
