import type { Course } from "./types.ts";

export const writePaper: Course = {
  id: "write-paper",
  title: "Write a research paper",
  category: "Academic writing",
  description:
    "Turn finished research into a clear paper: one message, a focused introduction, checkable methods and results, an honest discussion, and an abstract that stands alone.",
  outcome:
    "A section-by-section outline of your paper and a revised abstract.",
  resources: [
    {
      title: "Mensh & Kording (2017): Ten simple rules for structuring papers",
      url: "https://doi.org/10.1371/journal.pcbi.1005619",
    },
    {
      title: "EQUATOR Network: reporting guidelines by study type",
      url: "https://www.equator-network.org/",
    },
    {
      title: "Academic Phrasebank, University of Manchester",
      url: "https://www.phrasebank.manchester.ac.uk/",
    },
  ],
  lessons: [
    {
      id: "one-message",
      title: "Build the paper around one message",
      minutes: 6,
      objective:
        "State your central contribution in two sentences and outline every section around it.",
      sections: [
        {
          title: "Find the message first",
          text: "Readers remember a paper for one idea. Before drafting, write the main finding and why it matters in no more than two sentences, in words a colleague from a neighboring field would follow. If you cannot, the problem is usually unfinished thinking rather than writing, and more drafting will not fix it.",
          points: [
            "What did you find, in one sentence?",
            "Why does it matter, and to whom, in a second sentence?",
            "Which result is the strongest evidence for it?",
          ],
        },
        {
          title: "Outline from the evidence",
          text: "Many experienced authors start from the figures and tables, arranged in the order that builds the argument, and write the results around them. Each paragraph then gets a one-line job in the outline. A paper with a clear sequence of evidence is easy to write; a pile of results looking for a story is not.",
        },
        {
          title: "Context, content, conclusion",
          text: "The same shape works at every scale. The whole paper moves from context (the problem and gap), through content (what you did and found), to conclusion (what it means). So does each section, and so does each paragraph: an opening that says what it is about, the details, and a closing sentence that says what follows.",
          points: [
            "Introduction: context. Methods and results: content. Discussion: conclusion.",
            "Open each paragraph with its point, not with background.",
            "End each section by stating what the reader now knows.",
          ],
        },
      ],
      example: {
        title: "A two-sentence message",
        text: "'Weekly low-stakes quizzes were associated with higher final-exam scores in a large introductory course, mainly among students who started with weaker grades. This suggests that retrieval practice may help close early achievement gaps, a claim worth testing in a randomized design.' Every section of this paper now has a job: set up the gap, describe the quizzes and analysis, show the subgroup result, and discuss its limits.",
      },
      exercise:
        "Write your paper's message in two sentences. Then list your figures and tables in the order that builds the argument, and give each a one-line caption that states its point.",
      quiz: {
        question: "What is the best first step before drafting a paper?",
        options: [
          "Write the abstract in final form.",
          "State the central message in a sentence or two and arrange the evidence that supports it.",
          "Collect every result you have, so nothing is left out.",
        ],
        answer: 1,
        explanation:
          "A clear message and an ordered sequence of evidence give every section a job. The abstract is easier to write last, and including every result buries the main one.",
      },
      practicePrompt:
        "What makes scientific papers clear and highly cited, according to research on scientific writing?",
    },
    {
      id: "write-introduction",
      title: "Write an introduction that sets up the gap",
      minutes: 7,
      objective:
        "Move from the established field to a specific gap and end with what your paper contributes.",
      sections: [
        {
          title: "Three moves",
          text: "John Swales's widely taught 'Create a Research Space' model describes introductions as three moves. First, establish the territory: why the topic matters and what is known, with citations. Second, establish a niche: what is missing, contested, or untested in that knowledge. Third, occupy the niche: state your question, approach, and contribution. Each move can take one paragraph in a short paper.",
          points: [
            "Territory: the problem and what research has established.",
            "Niche: the specific gap, conflict, or limitation.",
            "Occupation: your aim, approach, and main contribution.",
          ],
        },
        {
          title: "Make the gap follow from the literature",
          text: "A convincing gap is visible in the studies you cite: they disagree, they used designs that cannot answer the question, or they studied a different population. Claims such as 'no study has ever examined' are rarely safe and easily refuted. 'The studies we found examined large lecture courses; none examined small seminars' is checkable and modest.",
        },
        {
          title: "Close with the contribution",
          text: "End the introduction by telling readers what the paper does and finds, often in a sentence or two. Some fields add a short roadmap of the sections; check recent papers in your target venue. Avoid repeating the full methods here, and keep the background proportionate: an introduction is an argument for your study, not a review of the field.",
          points: [
            "State the question or aim in one sentence.",
            "Preview the main finding if your field's conventions allow it.",
            "Cut background that does not lead to the gap.",
          ],
        },
      ],
      example: {
        title: "A compact introduction",
        text: "Paragraph 1: retrieval practice improves learning in laboratory studies (territory). Paragraph 2: classroom studies mostly measure average effects in large courses, and rarely ask who benefits most (niche). Paragraph 3: 'We examine whether weekly quizzes relate differently to exam performance for students with weaker prior grades, using four years of course records' (occupation).",
      },
      exercise:
        "Draft your introduction as three paragraph topic sentences: one for the territory, one for the niche, one for your contribution. Check that each cited study supports the sentence it sits in.",
      quiz: {
        question: "Which statement establishes a gap most convincingly?",
        options: [
          "Nobody has ever studied this topic before.",
          "This topic is very important and interesting.",
          "Existing studies measured average effects in large courses; none compared students by prior achievement.",
        ],
        answer: 2,
        explanation:
          "A specific, checkable gap that follows from cited work persuades reviewers. Universal novelty claims are easy to disprove, and importance alone is not a gap.",
      },
      practicePrompt:
        "How do research article introductions establish a research gap, and what are the common rhetorical moves?",
    },
    {
      id: "methods-and-results",
      title: "Report methods and results others can check",
      minutes: 8,
      objective:
        "Describe what you did in replicable detail and present results with their size and uncertainty.",
      sections: [
        {
          title: "Methods: enough to repeat or judge the work",
          text: "A reader should be able to tell exactly what was done, and an expert should be able to repeat it or judge whether it was sound. Describe the design, the participants or materials and how they were selected, the measures, the procedure, and the analysis, including software and versions. Reporting guidelines list what reviewers expect for each study type, such as CONSORT for randomized trials, STROBE for observational studies, and PRISMA for systematic reviews.",
          points: [
            "Report how the sample size was decided.",
            "Describe exclusions and missing data, with numbers.",
            "Say which analyses were planned and which were exploratory.",
          ],
        },
        {
          title: "Results: answer the questions in order",
          text: "Present results in the order of the questions the introduction raised, starting with the main one. Give the size of each effect with its uncertainty, not only whether it was significant. Let each figure or table carry one point, and state that point in the text, without repeating every number the table already shows.",
        },
        {
          title: "Keep results and interpretation apart",
          text: "In many fields, the results section reports what was found and the discussion explains what it means. Keeping them apart helps readers judge the evidence before they meet your interpretation. Report unexpected and null results too: they are part of the evidence and often the most useful part for the next study.",
          points: [
            "Results: 'Scores were 6 points higher (95% CI 2 to 10).'",
            "Discussion: 'This suggests quizzes may help weaker students most.'",
            "Report the results that did not support your hypothesis as clearly as those that did.",
          ],
        },
      ],
      example: {
        title: "A results sentence that carries its evidence",
        text: "Weak version: 'Quizzes significantly improved scores (p < .05).' Stronger version: 'Students who completed at least eight quizzes scored 6 points higher on the final exam (95% CI 2 to 10; n = 412), adjusting for prior grades (Table 2).' The second sentence gives the size, the uncertainty, the sample, the adjustment, and where to look.",
      },
      exercise:
        "Find the reporting guideline for your study type on the EQUATOR Network. Check your methods draft against its first ten items and list what is missing.",
      quiz: {
        question:
          "Why do journals ask authors to follow reporting guidelines such as CONSORT or STROBE?",
        options: [
          "To make sure readers get the details needed to judge and repeat the study.",
          "To guarantee that the study's conclusions are correct.",
          "To replace peer review.",
        ],
        answer: 0,
        explanation:
          "Reporting guidelines are checklists of what to describe. Complete reporting lets readers assess the work; it does not by itself make the study right.",
      },
      practicePrompt:
        "Does adherence to reporting guidelines like CONSORT improve the completeness of published trials?",
    },
    {
      id: "discussion-and-limitations",
      title: "Discuss what the results mean, and what they do not",
      minutes: 7,
      objective:
        "Interpret the main finding against prior work, state limitations with their consequences, and keep claims proportionate.",
      sections: [
        {
          title: "Lead with the main finding",
          text: "Open the discussion by stating the main finding in a sentence, then interpret it. Compare it with earlier studies: where it agrees, where it differs, and plausible reasons for differences, such as population or measurement. Offer explanations as possibilities, and say what evidence would distinguish between them.",
        },
        {
          title: "Limitations with consequences",
          text: "A useful limitation says what could be wrong and in which direction it would push the result. 'The sample was small' is a ritual; 'with 40 participants, the study could not rule out effects as small as 2 points, which would still matter in practice' informs the reader. Also say what the design cannot establish, such as causation in an observational study.",
          points: [
            "Name the limitation, its likely effect on the result, and how you addressed it.",
            "Separate limits of the design from limits of execution.",
            "Avoid hiding the most serious limitation in a long list.",
          ],
        },
        {
          title: "Claims sized to the evidence",
          text: "Choose verbs that match the design: an observational association 'suggests' or 'is consistent with', while a well-run randomized trial can 'show' an effect in its population. Do not introduce new results in the discussion. End with implications and specific next steps, such as the study that would resolve your main uncertainty, rather than a generic call for more research.",
          points: [
            "Match causal language to the design.",
            "Generalize only as far as the sample allows.",
            "Name the next study that would most reduce uncertainty.",
          ],
        },
      ],
      example: {
        title: "From overclaim to calibrated claim",
        text: "Overclaim: 'Our study proves that quizzes close achievement gaps.' Calibrated: 'In one course over four years, quiz completion was associated with larger gains for students with weaker prior grades. Because students chose how many quizzes to complete, motivation may explain part of this pattern; a randomized trial assigning quiz schedules would test it directly.'",
      },
      exercise:
        "Write three limitations of your study. For each, add one sentence on how it could bias the result and in which direction. Then check every verb in your conclusion against your design.",
      quiz: {
        question:
          "Which limitation statement is most informative for readers?",
        options: [
          "Like all studies, this one has limitations.",
          "Because participants chose whether to join, more motivated students may be overrepresented, which would likely inflate the observed benefit.",
          "Future research is needed.",
        ],
        answer: 1,
        explanation:
          "It names the problem, the mechanism, and the likely direction of bias, so readers can weigh the result accordingly.",
      },
      practicePrompt:
        "How often do research papers overstate their findings, and how does spin appear in abstracts and conclusions?",
    },
    {
      id: "title-and-abstract",
      title: "Write the title and abstract last",
      minutes: 6,
      objective:
        "Write a specific title and a self-contained abstract that reports the question, method, key numbers, and conclusion.",
      sections: [
        {
          title: "The abstract stands alone",
          text: "Most readers, and every search engine, see the abstract before anything else, and many see nothing more. Write it last, once the paper's message is settled. It should make sense without the paper: the background in one sentence, the aim, the design and sample, the main results with numbers, and the conclusion, sized to the evidence.",
          points: [
            "Include the key numbers: effect sizes, intervals, sample size.",
            "Avoid abbreviations and citations unless the venue expects them.",
            "Make the conclusion no stronger than the discussion's.",
          ],
        },
        {
          title: "Follow the venue's format",
          text: "Many journals require structured abstracts with headings such as Background, Methods, Results, and Conclusions, and most set a word limit, often between 150 and 300 words. Conferences may limit characters instead. Read the author guidelines before drafting, and look at abstracts recently published in the venue.",
        },
        {
          title: "Titles that are specific and findable",
          text: "A good title tells readers what was studied and, where appropriate, what was found or how. Include the words people would search for, such as the population, intervention, and study design. Avoid jokes that hide the topic and vague titles such as 'A study of learning'. Choose keywords that add terms the title does not already contain.",
          points: [
            "Name the topic, population, and design where they matter.",
            "Prefer specific nouns to clever phrasing.",
            "Use keywords for synonyms and broader terms.",
          ],
        },
      ],
      example: {
        title: "Before and after",
        text: "Before: 'Quizzes and learning: an investigation.' After: 'Weekly quizzes and final-exam performance by prior achievement: a four-year cohort study in an introductory biology course.' The second title tells a searcher the intervention, outcome, subgroup, design, and setting.",
      },
      exercise:
        "Write a 200-word abstract for your paper with one sentence each for background, aim, and methods, two for results with numbers, and one for the conclusion. Then write two candidate titles and ask someone which one tells them more.",
      quiz: {
        question: "Which element does a good abstract need?",
        options: [
          "The main results, including key numbers.",
          "A list of every analysis performed.",
          "A teaser that leaves the main finding for the paper.",
        ],
        answer: 0,
        explanation:
          "Many readers only see the abstract, so it must report what was found. Withholding the result or listing every analysis makes it less useful.",
      },
      practicePrompt:
        "What characteristics of titles and abstracts are associated with research papers being read and cited?",
    },
    {
      id: "edit-for-readers",
      title: "Edit paragraphs and sentences for readers",
      minutes: 7,
      objective:
        "Make paragraphs flow and sentences clear, keep terms consistent, and use feedback well.",
      sections: [
        {
          title: "Paragraphs that announce their point",
          text: "Start each paragraph with a sentence that states its point, then support it. A quick test: read only the first sentence of every paragraph, in order. If those sentences tell the paper's story, the structure works. If they read as background or transitions, rewrite them until they carry the argument.",
        },
        {
          title: "Familiar before new, same term for same thing",
          text: "Sentences are easiest to follow when they begin with something the reader already knows and end with the new information, which then becomes the starting point of the next sentence. Keep one term for each concept: if 'participants' becomes 'subjects' and then 'respondents', readers will wonder whether these are different groups. Define abbreviations once and use them sparingly.",
          points: [
            "Begin sentences with known information; end with the new point.",
            "Use one term per concept throughout the paper.",
            "Replace abbreviations that save only a few words.",
          ],
        },
        {
          title: "Cut, then ask for specific feedback",
          text: "Remove phrases that announce rather than say, such as 'it is important to note that'. Turn hidden verbs back into verbs: 'we performed an analysis of' becomes 'we analyzed'. Use the active voice when it makes clear who did what. Then ask readers for specific feedback, such as 'Where did you get lost?' or 'What do you think the main finding is?', and compare their answer with your two-sentence message.",
          points: [
            "Delete throat-clearing openers and doubled hedges.",
            "Prefer verbs to nominalizations.",
            "Ask a reader to state your main finding; fix the paper if they cannot.",
          ],
        },
      ],
      example: {
        title: "One sentence, edited",
        text: "Before: 'It is important to note that an evaluation of the effectiveness of the intervention was conducted by the research team using the data.' After: 'We evaluated whether the intervention worked using course records.' The edit cuts the opener, restores the verb, names who acted, and keeps the meaning.",
      },
      exercise:
        "Take one page of your draft. Read only the first sentence of each paragraph and rewrite any that do not state a point. Then cut ten percent of the words without losing any meaning.",
      quiz: {
        question:
          "A draft calls the same group 'participants', 'subjects', and 'respondents'. Why change it?",
        options: [
          "Variety in word choice is required by most journals.",
          "Readers may think the words refer to different groups, so one consistent term is clearer.",
          "The words have identical meanings, so it does not matter.",
        ],
        answer: 1,
        explanation:
          "In technical writing, a change of term signals a change of meaning. Consistent terms prevent readers from searching for a distinction that is not there.",
      },
    },
  ],
};
