import type { Course } from "./types.ts";

export const systematicReview: Course = {
  id: "systematic-review",
  title: "Review the literature systematically",
  category: "Evidence synthesis",
  description:
    "Plan, search, screen, appraise, and synthesize a body of research with methods another team could repeat.",
  outcome:
    "A registered-style review protocol, a tested search strategy, and a reporting checklist.",
  resources: [
    {
      title: "PRISMA 2020 statement, checklist, and flow diagram",
      url: "https://www.prisma-statement.org/prisma-2020",
    },
    {
      title: "Cochrane Handbook for Systematic Reviews of Interventions",
      url: "https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current",
    },
    {
      title: "PROSPERO: international register of systematic review protocols",
      url: "https://www.crd.york.ac.uk/prospero/",
    },
    {
      title: "PRISMA extension for scoping reviews (PRISMA-ScR)",
      url: "https://www.prisma-statement.org/scoping",
    },
    {
      title: "GRADE Working Group: rating the certainty of evidence",
      url: "https://www.gradeworkinggroup.org/",
    },
  ],
  lessons: [
    {
      id: "choose-review-type",
      title: "Choose the right kind of review",
      minutes: 6,
      objective:
        "Match your question to a narrative, scoping, systematic, or rapid review, and know when a meta-analysis fits.",
      sections: [
        {
          title: "Reviews answer different questions",
          text: "A narrative review gives an expert overview and is free to be selective, which makes it quick to write and hard to check. A systematic review answers a focused question with pre-specified, reproducible methods: an exhaustive search, explicit eligibility criteria, appraisal of each study, and a transparent synthesis. A scoping review maps how much research exists on a broad topic, which concepts and methods it uses, and where the gaps are, usually without judging study quality. A rapid review streamlines systematic methods to meet a deadline and reports which shortcuts it took.",
          points: [
            "Is this intervention effective for this population? A systematic review.",
            "What has been studied about this topic, and how? A scoping review.",
            "A decision is due in weeks? A rapid review that declares its shortcuts.",
          ],
        },
        {
          title: "Meta-analysis is a method, not a review type",
          text: "A meta-analysis statistically combines results from several studies into a pooled estimate. It sits inside a systematic review when the included studies are similar enough in population, intervention, comparison, and outcome to combine meaningfully. Many systematic reviews correctly decide not to pool, because averaging very different studies produces a precise-looking number that answers no real question.",
        },
        {
          title: "Check feasibility before you commit",
          text: "Systematic methods take time: screening thousands of records, extracting data, and appraising every study usually needs at least two people and several months. Before starting, search registries and databases for an existing or ongoing review of the same question. If one exists and is recent, a new review needs a clear reason, such as a different population or newer studies.",
          points: [
            "Search a protocol registry and a major database for existing reviews.",
            "Estimate the size of the literature with a quick scoping search.",
            "Confirm a second reviewer is available for screening and extraction.",
          ],
        },
      ],
      example: {
        title: "Same topic, two reviews",
        text: "Topic: digital reminders and medication adherence. 'Do text-message reminders improve adherence in adults with hypertension, compared with usual care?' suits a systematic review, perhaps with a meta-analysis. 'What kinds of digital adherence tools have been studied, in which conditions, and with which outcomes?' suits a scoping review that maps the field without pooling results.",
      },
      exercise:
        "Write your review question in one sentence. Decide which review type answers it, and justify the choice in two sentences. Then search once for an existing review of the same question and note what you find.",
      quiz: {
        question:
          "You want to map which methods and outcomes have been used to study a broad topic. Which review fits best?",
        options: [
          "A scoping review",
          "A meta-analysis of every study you can find",
          "A narrative review with no stated methods",
        ],
        answer: 0,
        explanation:
          "Scoping reviews map the extent, range, and nature of research on a broad topic. A meta-analysis pools comparable effect estimates, which a mapping question does not need.",
      },
      practicePrompt:
        "What are the differences between scoping reviews and systematic reviews in health research?",
    },
    {
      id: "review-protocol",
      title: "Write and register a protocol",
      minutes: 7,
      objective:
        "Fix the question, eligibility criteria, and methods in advance so results cannot quietly steer the review.",
      sections: [
        {
          title: "Frame the question with a structure",
          text: "Frameworks turn a topic into searchable, decidable parts. PICO, for effectiveness questions, names the Population, Intervention, Comparison, and Outcome. PCC, common in scoping reviews, names the Population, Concept, and Context. The framework then drives both the search terms and the eligibility criteria, so every later decision traces back to it.",
          points: [
            "Population: who, and in what setting?",
            "Intervention or concept: what is studied?",
            "Comparison and outcome: compared with what, and measured how?",
          ],
        },
        {
          title: "Write eligibility criteria you can apply",
          text: "Criteria must be specific enough that two reviewers reach the same decision independently. State the study designs you include, the populations and settings, the outcomes, the date range, and any language limits, together with the reason for each limit. Vague criteria such as 'high-quality studies' push decisions into screening, where they are harder to see and to justify.",
        },
        {
          title: "Register before you screen",
          text: "A protocol records the planned methods before results are known, which protects the review from decisions made after seeing the data. Health-related systematic reviews can be registered in PROSPERO; other reviews, including scoping reviews, are often registered on OSF Registries or published as a protocol paper. If you later change a method, the final report states what changed and why.",
          points: [
            "Register once the criteria are final and before screening begins.",
            "Record the registration number; reporting guidelines ask for it.",
            "Report every deviation from the protocol with its reason.",
          ],
        },
      ],
      example: {
        title: "Criteria that two reviewers can share",
        text: "Include: randomized trials in adults with hypertension that compare text-message reminders with usual care and report adherence, published from 2005 onward. Exclude: studies of pharmacist-delivered calls only, conference abstracts without full results, and non-randomized designs. Each line can be checked against a paper without guessing what the review team meant.",
      },
      exercise:
        "Write a PICO or PCC for your question and turn it into five eligibility criteria. Ask a colleague to apply them to three abstracts without your help, then compare decisions and rewrite any criterion you disagreed on.",
      quiz: {
        question: "Why register a review protocol before screening begins?",
        options: [
          "Registration guarantees the review will be published.",
          "It records the planned methods before results can influence them.",
          "Registered reviews do not need to report deviations.",
        ],
        answer: 1,
        explanation:
          "A protocol makes the methods checkable against the final report. Changes remain allowed, but they must be reported with reasons.",
      },
      practicePrompt:
        "How common are discrepancies between registered protocols and published systematic reviews?",
    },
    {
      id: "search-strategy",
      title: "Build a search others can rerun",
      minutes: 8,
      objective:
        "Combine concepts, synonyms, and database syntax into a documented search that finds the studies you already know about.",
      sections: [
        {
          title: "From concepts to a search string",
          text: "Take two or three concepts from your framework, usually not all of them, because outcomes are often described inconsistently in titles and abstracts. List synonyms, spelling variants, and related terms for each concept. Combine the synonyms within a concept with OR and the concepts with AND. Add truncation for word endings and quotation marks for phrases, then each database's controlled vocabulary, such as MeSH in MEDLINE, alongside free-text terms.",
          points: [
            "OR widens within a concept; AND narrows across concepts.",
            "Truncation such as remind* catches reminder, reminders, and reminding.",
            "Pair controlled vocabulary with free text; indexing lags behind new papers.",
          ],
        },
        {
          title: "Search more than one place",
          text: "No single database covers a field. Search at least two or three relevant databases, and add sources for studies that journals do not index well: trial registries, theses, preprint servers, and reports from agencies. Then screen the reference lists of included studies and look up papers that cite them. Remove duplicates with a reference manager before screening.",
        },
        {
          title: "Test and document the search",
          text: "Collect a handful of papers you know should be included and check that the search retrieves every one; a miss shows which term or concept is too narrow. A librarian or information specialist can review the strategy, which catches most syntax errors. Save the exact search string for each database, the date it was run, and the number of records it returned, because the report must let others rerun it.",
          points: [
            "Check the search against known relevant papers before finalizing it.",
            "Save every string verbatim per database, with date and hit count.",
            "Rerun the searches shortly before analysis if months have passed.",
          ],
        },
      ],
      example: {
        title: "One concept, many words",
        text: "Concept: text-message reminders. Terms: (\"text messag*\" OR SMS OR \"short message service\" OR \"mobile phone\" OR mHealth) AND (remind* OR prompt*). Combined with (hypertension OR \"high blood pressure\") AND adherence, the search retrieved all six known trials; an earlier version without mHealth missed two of them.",
      },
      exercise:
        "Build a search string for two concepts of your question. Run it in one database, check it against three papers you know are relevant, and record the string, date, and number of results in a search log.",
      quiz: {
        question:
          "Your search misses two papers you know are eligible. What is the best next step?",
        options: [
          "Add the two papers manually and keep the search unchanged.",
          "Remove a concept so the search returns more records overall.",
          "Find out which terms those papers use, revise the search, and rerun it.",
        ],
        answer: 2,
        explanation:
          "Known papers test sensitivity. A miss usually reveals missing synonyms or indexing terms, and fixing the strategy also finds similar papers you did not know about.",
      },
      practicePrompt:
        "How many databases should be searched in a systematic review to find most relevant studies?",
    },
    {
      id: "screening",
      title: "Screen studies consistently",
      minutes: 7,
      objective:
        "Run two-stage, independent screening and record every decision for the PRISMA flow diagram.",
      sections: [
        {
          title: "Two stages, two reviewers",
          text: "Screening usually runs in two stages: titles and abstracts first, then the full text of everything that might be eligible. At the first stage, keep records when in doubt, because excluding is easy to do later and hard to undo. Two reviewers screen independently and then compare decisions, which catches errors and personal bias; disagreements are resolved by discussion or by a third reviewer.",
        },
        {
          title: "Calibrate before you start",
          text: "Before screening the full set, both reviewers screen the same pilot sample, for example 50 records, and compare. Disagreements usually reveal an ambiguous criterion, which you clarify in writing before continuing. Repeat the pilot if agreement is poor. Without calibration, two reviewers can both be consistent and still apply different rules.",
          points: [
            "Pilot the criteria on a shared sample of records.",
            "Turn every recurring disagreement into a written clarification.",
            "Report how disagreements were resolved.",
          ],
        },
        {
          title: "Record reasons and counts",
          text: "The PRISMA flow diagram reports how many records were found in each source, how many duplicates were removed, how many were screened and excluded, and how many full texts were assessed. Full-text exclusions need a reason for each paper, such as wrong population or wrong study design. Keep these records as you go; reconstructing them at the end rarely matches.",
          points: [
            "Count records from every source before deduplication.",
            "Give one main reason for each full-text exclusion.",
            "Note full texts you could not obtain rather than dropping them silently.",
          ],
        },
      ],
      example: {
        title: "A pilot that changed the rules",
        text: "Two reviewers screened 50 pilot abstracts and disagreed on 9. Seven disagreements involved studies where reminders were bundled with education sessions. The team added a clarification: include bundled interventions only if the trial reports the reminder effect separately. Agreement on the next 50 records rose to 48 out of 50.",
      },
      exercise:
        "Write three eligibility criteria and screen ten abstracts against them with a colleague, independently. Compare your decisions, count the disagreements, and write one clarification that would have prevented the most common one.",
      quiz: {
        question:
          "At the title-and-abstract stage, you are unsure whether a record is eligible. What should you do?",
        options: [
          "Keep it for full-text review.",
          "Exclude it to keep the workload manageable.",
          "Exclude it if the abstract is shorter than usual.",
        ],
        answer: 0,
        explanation:
          "Abstracts often omit details. Keeping uncertain records costs a full-text check; wrongly excluding an eligible study can change the review's conclusions.",
      },
      practicePrompt:
        "Does single-reviewer screening miss eligible studies compared with dual independent screening in systematic reviews?",
    },
    {
      id: "extract-and-appraise",
      title: "Extract data and appraise risk of bias",
      minutes: 8,
      objective:
        "Collect the same information from every study and judge how much each result can be trusted.",
      sections: [
        {
          title: "Design and pilot an extraction form",
          text: "An extraction form lists every item you will collect: study design, setting, participants, intervention and comparison details, outcomes with their definitions and time points, results with their uncertainty, and funding. Pilot it on two or three studies and revise it before extracting the rest. Ideally two people extract independently, or a second person checks every entry against the paper.",
          points: [
            "Extract numbers in a form you can analyze: counts, means, SDs, or effect estimates with intervals.",
            "Record where in the paper each number came from.",
            "Contact authors when key data are missing, and note whether they replied.",
          ],
        },
        {
          title: "Risk of bias is about the result, not the paper",
          text: "Appraisal asks whether a study's design and conduct could have pushed its result away from the truth. Use a tool designed for the study type: for example RoB 2 for randomized trials and ROBINS-I for non-randomized studies of interventions. These tools judge specific domains, such as randomization, missing outcome data, and selective reporting, rather than producing a single quality score.",
        },
        {
          title: "Do not confuse reporting with bias",
          text: "A well-written paper can describe a biased study, and a poorly reported study can be sound. Judge what was done, using protocols and trial registrations where available. Avoid summing checklist items into a quality score, because the items carry very different weight. Instead, report the judgment for each domain and use it in the synthesis, for example by checking whether high-risk studies change the overall result.",
        },
      ],
      example: {
        title: "Same size, different trust",
        text: "Two trials each report that reminders improved adherence by about 10 percentage points. In the first, allocation was random and concealed, and 95% of participants were followed up. In the second, clinic staff chose who received reminders and 30% dropped out, mostly from the control group. The headline numbers match, but only the first result is at low risk of bias.",
      },
      exercise:
        "Draft an extraction form of ten items for your question and pilot it on one paper. Note one item the paper did not report and how you would record it as missing rather than zero.",
      quiz: {
        question: "Why do risk-of-bias tools avoid a single summed quality score?",
        options: [
          "Scores take too long to calculate.",
          "Different items affect the trustworthiness of a result to very different degrees.",
          "Summed scores are only allowed in scoping reviews.",
        ],
        answer: 1,
        explanation:
          "A study can score well on many minor items and still have one serious flaw, such as non-random allocation. Domain-based judgments keep that flaw visible.",
      },
      practicePrompt:
        "How does risk of bias in included trials affect the results of meta-analyses?",
    },
    {
      id: "synthesize-and-report",
      title: "Synthesize and report the evidence",
      minutes: 8,
      objective:
        "Combine findings with a meta-analysis or a structured narrative synthesis, rate certainty, and report with PRISMA 2020.",
      sections: [
        {
          title: "Pool only what is comparable",
          text: "A meta-analysis weights each study by its precision and estimates an overall effect with a confidence interval. It also measures heterogeneity, how much the results differ beyond what chance would produce; a random-effects model allows the true effect to vary between studies. When studies are too different to combine, use a structured narrative synthesis: group studies by meaningful features and describe the direction, size, and consistency of their effects.",
          points: [
            "Explain why pooling is or is not appropriate before you pool.",
            "Investigate heterogeneity instead of only reporting it.",
            "Avoid counting how many studies were 'significant'; it ignores effect size and precision.",
          ],
        },
        {
          title: "Rate how certain the evidence is",
          text: "A pooled estimate needs a statement of how much confidence it deserves. The GRADE approach rates certainty for each outcome as high, moderate, low, or very low, considering risk of bias, inconsistency, indirectness, imprecision, and publication bias. A review can find a large effect and still conclude that the certainty is low.",
        },
        {
          title: "Report it so others can check it",
          text: "PRISMA 2020 provides a 27-item checklist and a flow diagram for reporting systematic reviews. Follow it while writing, not just before submission, and fill in where each item is reported. State the limitations of the review itself, such as language restrictions, unavailable full texts, or a search that ended months before publication.",
          points: [
            "Report the full search strategy for at least one database, ideally all.",
            "Show the flow diagram with numbers that add up.",
            "Share extraction data and analysis code where you can.",
          ],
        },
      ],
      example: {
        title: "A precise estimate with low certainty",
        text: "Six trials gave a pooled improvement in adherence of 8 percentage points (95% CI 3 to 13). Two trials were at high risk of bias and results varied widely between studies, so the certainty was rated low. The review concluded that reminders may improve adherence, and that larger, well-concealed trials are needed.",
      },
      exercise:
        "Choose a published systematic review in your area. Check five PRISMA 2020 items against it, including the search strategy and the flow diagram, and write down which ones are reported clearly.",
      quiz: {
        question:
          "Five studies of an intervention differ widely in population, dose, and outcome measures. What is the sound approach?",
        options: [
          "Pool them anyway, because more studies always increase precision.",
          "Report only the study with the largest effect.",
          "Use a structured narrative synthesis that groups studies and explains the differences.",
        ],
        answer: 2,
        explanation:
          "Pooling very different studies produces an average that applies to no real situation. A structured narrative synthesis keeps the differences visible.",
      },
      practicePrompt:
        "How do reviewers assess heterogeneity in meta-analyses, and what is the role of random-effects models?",
    },
  ],
};
