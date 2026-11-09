import type { Course } from "./types.ts";

export const createResearch: Course = {
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
    {
      title: "Center for Open Science: Preregistration",
      url: "https://www.cos.io/initiatives/prereg",
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
        {
          title: "Sharpen the question into sub-questions",
          text: "A workable question usually hides three or four smaller ones. Splitting it makes the project plannable: each sub-question names evidence you can actually gather, and together they should answer the main question. If one sub-question cannot be answered with anything you could observe, collect, or read, the main question needs another cut.",
          points: [
            "Write two to four sub-questions that jointly cover the main question.",
            "Give each one a sentence about what evidence would answer it.",
            "Keep the main question visible while you work, so sub-questions stay a decomposition rather than a drift.",
          ],
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
        {
          title: "Keep the search auditable",
          text: "A literature review is itself a small study, and its method deserves the same traceability. Record the databases and indexes used, the exact queries, the dates, and any inclusion or exclusion rules you applied. Weeks later, when a reader asks whether you considered a line of work, the log answers instead of your memory — and if the review is ever published, the log becomes its methods section.",
          points: [
            "Save queries verbatim, with the date and the source next to each.",
            "Note why each borderline paper was included or set aside.",
            "Store the search log with your literature table so they travel together.",
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
      practicePrompt:
        "How does feedback from practice quizzes affect learning in university courses?",
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
        {
          title: "Pressure-test the design on paper",
          text: "Before collecting anything, walk one imaginary case through the whole design: how it is selected, what is measured, how the numbers or notes are analysed, and what sentence could be written at the end. Breaks discovered this way are free. The walk also exposes the analysis you are assuming but have not planned — the point where many projects quietly stall.",
          points: [
            "Write the sentence you hope to end with and check the design produces its evidence.",
            "List what happens when a participant drops out or a source turns out unusable.",
            "Note the strongest objection a methods reviewer would raise, and what the design says back.",
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
      practicePrompt:
        "Which research designs have been used to study the effect of practice quizzes on exam performance?",
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
        {
          title: "Write for a sceptical reader",
          text: "The proposal's real audience is a supervisor or committee looking for reasons to say no. Give them the answers in the proposal itself: why this question rather than a neighbouring one, why this method rather than a cheaper one, and what the project will not attempt. A limitations paragraph written before the study reads as competence, not weakness — it shows the boundaries are chosen rather than discovered later.",
          points: [
            "State the question in the first paragraph; never make a reader hunt for it.",
            "Name the two most likely objections and the planned response to each.",
            "Say what would cause the fallback scope to be activated.",
          ],
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
    {
      id: "research-ethics",
      title: "Work out what your project may do",
      minutes: 7,
      objective:
        "Check a project against consent, privacy, and review expectations before any data is collected.",
      sections: [
        {
          title: "Ethics is a design input, not a form",
          text: "Studies that involve people, their personal data, or material they produced carry obligations that shape the design itself: what is collected, how long it is kept, and who can see it. Institutional rules differ, so the safe order is to find out what your institution expects before recruiting anyone. Collect the minimum you need, store it where unauthorised people cannot reach it, and separate identities from responses where the research question allows it.",
          points: [
            "Find your institution's ethics procedure early; coursework projects often need at least a short application.",
            "Collect the minimum data the question requires, and say why each field is needed.",
            "De-identify where possible, and keep the key linking names to responses apart from the data.",
          ],
        },
        {
          title: "Consent and credit",
          text: "People who contribute data deserve to know what they are taking part in, that they can decline or withdraw, and what will happen to their contributions. Written consent can be one clear sentence for a low-risk classroom survey or a full form for something more sensitive. Credit works the same way in reverse: name the sources of any data, code, or ideas you did not produce, and agree with collaborators on who is an author before the writing starts.",
        },
        {
          title: "Anticipate risks and power",
          text: "Review boards ask what could go wrong and for whom, and so should you. Sensitive topics, vulnerable groups, and unequal relationships raise the stakes: students asked by their own tutor may not feel free to refuse, so recruit through someone else or collect responses anonymously. Decide in advance what you will do if a participant becomes distressed or discloses something serious, and plan the whole life of the data, including whether the consent wording allows sharing it later.",
          points: [
            "Ask who might feel unable to say no, and remove that pressure.",
            "Write down how you will respond to distress or a serious disclosure.",
            "Make the consent wording match any later data sharing you intend.",
          ],
        },
      ],
      example: {
        title: "Checking before collecting",
        text: "Two students plan to survey classmates about study habits. They write a consent line explaining the purpose, that participation is optional, and that answers are anonymous. Their institution's guidance says coursework surveys need a short application, which they file and have approved before collecting a single response.",
      },
      exercise:
        "List every kind of data your project touches. For each, note who it belongs to, where it will be stored, who can access it, and whether your institution expects a review before collection.",
      quiz: {
        question: "When should an ethics review be requested?",
        options: [
          "After the data has been collected and the results are known.",
          "Only for medical or clinical trials.",
          "Before collecting data from people or their personal data.",
        ],
        answer: 2,
        explanation:
          "Review protects participants, so it must happen before collection. Many non-medical projects involving people or personal data still need at least a procedural check.",
      },
      practicePrompt:
        "What are good practices for obtaining informed consent in online research studies?",
    },
    {
      id: "hypothesis-or-not",
      title: "Decide between a hypothesis and an open question",
      minutes: 6,
      objective:
        "Choose the framing that matches the evidence you can gather, and state it so the results can surprise you.",
      sections: [
        {
          title: "Confirmatory questions name a prediction",
          text: "A hypothesis is useful when prior evidence supports a specific, falsifiable prediction and your design can compare the predicted outcome against its alternative. The analysis should be decided before the data arrives: which comparison counts as a test, and what result would count against the prediction. A prediction that no plausible observation could refute explains nothing.",
        },
        {
          title: "Exploratory questions name a territory",
          text: "When a setting, population, or experience has hardly been described, an open question is the honest framing. Interviews, observations, and early datasets can surface categories nobody predicted, but they cannot confirm a hypothesis about an effect size. The serious risk is hindsight: presenting an exploratory finding as if it had been hypothesised all along hides how uncertain it is.",
          points: [
            "Label analyses as exploratory when the data suggested them.",
            "An exploratory study earns its keep by generating a question the next study can test.",
            "Either framing is respectable; mixing them in one claim is not.",
          ],
        },
        {
          title: "Fix the test before the data",
          text: "For a confirmatory question, write down the hypothesis, the outcome measure, the comparison, and the analysis before collecting or looking at the data, and date the document; a public preregistration makes that record checkable by others. State which result would count against the prediction, including the smallest difference that would matter. One study can honestly do both: a preregistered main test, plus clearly labelled exploration of whatever else the data show.",
          points: [
            "Name the outcome, comparison, and analysis in advance.",
            "State the result that would count against the prediction.",
            "Keep a dated record, such as a preregistration, that others can see.",
          ],
        },
      ],
      example: {
        title: "The same interest, framed two ways",
        text: "Predictive: students who space their practice over a week will recall more after seven days than students who cram, measured on the same test. Exploratory: how do first-year students decide when to start revising? The first can fail, which is its strength. The second can be surprised, which is its strength.",
      },
      exercise:
        "Write your question both ways: as a prediction with a comparison, and as an open question. Pick the framing your evidence can support and record one observation that would count against it.",
      quiz: {
        question:
          "An interview study describing how researchers choose which conferences to submit to is best framed as…",
        options: [
          "A confirmatory test of a specific prediction.",
          "An exploratory open question, because it describes experiences rather than comparing a prediction.",
          "A hypothesis is always required before any study.",
        ],
        answer: 1,
        explanation:
          "Describing how people navigate a decision is descriptive work. A prediction about which factor dominates could come later, tested with a design built for comparison.",
      },
      practicePrompt:
        "Does spaced practice improve long-term recall compared with massed practice?",
    },
  ],
};
