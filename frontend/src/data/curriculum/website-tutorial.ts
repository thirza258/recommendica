import type { Course } from "./types.ts";

export const websiteTutorial: Course = {
  id: "website-tutorial",
  title: "Get started with Recommendica",
  category: "Website tutorial",
  description:
    "Walk through your first search, understand the answers, inspect the source papers, and refine your next question.",
  outcome:
    "A first literature search and a source you have checked yourself.",
  resources: [
    {
      title: "arXiv help: paper versions and their availability",
      url: "https://info.arxiv.org/help/versions.html",
    },
    {
      title: "The LaTeX Project: official documentation",
      url: "https://www.latex-project.org/help/documentation/",
    },
  ],
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
        {
          title: "What the search does with your question",
          text: "Knowing the shape of the pipeline helps you write for it. Your question is turned into search variants, matched against the available paper collection (consulting arXiv when coverage is thin), and used to draft an answer from the retrieved excerpts — which is then reviewed against those same excerpts before it earns a checked label. That explains two practical habits: name the population and comparison you care about, because retrieval matches on words; and expect better answers when relevant papers actually exist in the collection.",
          points: [
            "The answer is built from retrieved excerpts, so unseen parts of a paper cannot inform it.",
            "The review step compares the draft against the same excerpts — it is not an independent fact-check of the field.",
            "A refined question reruns the whole pipeline; each search is a fresh attempt.",
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
        {
          title: "When two answers disagree",
          text: "Run the same topic twice with different wording and the answers may differ — that is information, not a malfunction. Disagreement usually traces to different papers being retrieved, so open the source cards from both searches and compare: are the same studies cited, and where do their findings part ways? Conflicts between sources belong in your notes as open questions in the literature, which is often exactly where a research gap hides.",
          points: [
            "Note both wordings and the papers behind each answer.",
            "Treat a conflict as a finding about the literature, not a verdict on the tool.",
            "Resolve the conflict by reading the primary studies, not by rerunning the search until one answer feels right.",
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
      practicePrompt:
        "How accurately do retrieval-augmented language models attribute claims to their sources?",
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
        {
          title: "Skim the paper efficiently",
          text: "Once the paper is open, resist the urge to read linearly. Confirm from the abstract what the paper claims, then go straight to the results — tables and figures — and from there to the methods sections those results depend on. This mirrors the three-pass habit from critical reading: the point of the first visit is to locate the evidence behind the one claim you are checking, not to absorb the whole paper.",
          points: [
            "Find the exact sentence in the paper that matches the claim you are verifying.",
            "Check the number in the text against the table it cites.",
            "Note the section you would read next if the claim mattered more to your work.",
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
      practicePrompt:
        "Which benchmarks are used to evaluate dense retrieval methods, and how do their splits differ?",
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
        {
          title: "Turn searches into a small review file",
          text: "Searches evaporate; a review file does not. Keep one running document with a dated entry per search: the question, the terms that worked and the ones that did not, the paper links worth keeping, and a one-line relevance note for each. Over a few weeks this file becomes the raw material for a literature review — and, unlike browser history, it is yours to sort, search, and reuse.",
          points: [
            "One line per paper: link, year, and why it matters to your question.",
            "Record dead ends too, so future-you does not repeat them.",
            "The Write editor's references panel is a natural home for the papers worth citing.",
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
    {
      id: "write-your-paper",
      title: "Draft a paper in the Write editor",
      minutes: 6,
      objective:
        "Start a paper from a template, move between the visual and LaTeX editors, and use the AI assistant safely.",
      sections: [
        {
          title: "Pick the editor that fits the moment",
          text: "Open Write from the home page and start from a template. The visual editor behaves like a word processor and is fastest for getting a draft down; the LaTeX editor gives fine control over structure and is what venues usually expect. Switching between them converts the paper in place, and the references panel keeps the bibliography shared between both. Papers live in this browser only, so export a copy when a draft matters.",
        },
        {
          title: "Work with the AI assistant",
          text: "The assistant panel can answer questions about the paper that is open — 'What does my abstract claim?' — and can rewrite it on request. Proposed edits come back as a complete revised document that you review and apply with a button; nothing changes until you apply it. Remember that the assistant reads your paper's text, so treat it like showing the draft to a colleague: fine for ordinary content, not the place for anything you would not share.",
          points: [
            "Questions about the paper get short prose answers; change requests get a full revised document.",
            "Review the proposal before selecting Apply — you stay the editor.",
            "Ask for one change at a time; small requests are easier to check.",
          ],
        },
        {
          title: "Start from what you already have",
          text: "An existing draft does not need retyping. On the Write home page, Import a document converts a Word (.docx), Markdown, or plain-text file into a LaTeX paper, and Upload a LaTeX project brings in a .zip, the project's files, or a whole folder. Compare the result with the original, especially equations, tables, and figures. The Write papers in LaTeX course covers importing, citations, and fixing errors in more depth.",
          points: [
            "Import a document: Word, Markdown, or plain text becomes a LaTeX paper.",
            "Upload a LaTeX project: a .zip, its files, or a folder.",
            "Check the import against the original before editing further.",
          ],
        },
      ],
      example: {
        title: "A working loop",
        text: "Draft three results sections in the visual editor, then ask the assistant 'Which sections are missing limitations?' It answers in prose. Then ask 'Add a limitations paragraph to the conclusion', review the revised document it returns, and apply. The switch to the LaTeX editor now carries that paragraph with it.",
      },
      exercise:
        "Create a paper from a template, ask the assistant one question about it, and request one small change. Read the proposal carefully before applying, and note one thing you would have asked differently.",
      quiz: {
        question: "What happens when the assistant proposes an edit to your paper?",
        options: [
          "The paper is replaced immediately while you read.",
          "A revised document is shown for review, and nothing changes until you select Apply.",
          "The proposal is emailed to your co-authors.",
        ],
        answer: 1,
        explanation:
          "Proposed edits are explicit: you see the revised document and apply it yourself. Reviewing before applying keeps you in charge of the text.",
      },
    },
    {
      id: "export-and-share",
      title: "Export, print, and hand your paper over",
      minutes: 5,
      objective:
        "Choose the export that fits the destination and check it before sending anything out.",
      sections: [
        {
          title: "Match the export to the destination",
          text: "PDF (print) produces the paginated document reviewers and supervisors expect. The LaTeX project export (.zip) keeps main.tex, the other source files, the bibliography, and the figures together — what a collaborator or a venue that compiles source will ask for. A single .tex file suits quick sharing only when the paper fits in one file, and the web page export is a convenient preview, not a submission format.",
        },
        {
          title: "Check before you send",
          text: "An export is your paper's first impression, so give it one careful pass: every reference resolves to a number rather than a bold question mark, figures appear where the text calls them, the citation style matches the venue, and the author line is what the venue expects — anonymised when review is double-blind. Compile the exported zip once if you can; that is exactly what the recipient will do.",
          points: [
            "Search the PDF for '??' — the signature of a broken \\ref or \\cite.",
            "Confirm images made the trip, especially after switching editors.",
            "Keep the exported copy that you actually sent, dated.",
          ],
        },
        {
          title: "Keep copies you control",
          text: "Write keeps papers in this browser's storage, not on a server. Clearing the site's data deletes them, a private window may discard them when it closes, and another computer never sees them; the header warns 'Not saved — browser storage is unavailable' when the browser refuses to store anything. Export a LaTeX project (.zip) at each milestone and keep it with your other files; to continue on another device, use Upload a LaTeX project there.",
          points: [
            "Export a .zip at every milestone, not only at submission.",
            "Name exports by date or version, so you can tell them apart.",
            "Move between devices by exporting and uploading the .zip.",
          ],
        },
      ],
      example: {
        title: "A submission check in three minutes",
        text: "Before submitting a workshop paper: export the zip, open the printed PDF, search for '??' (none), check that both figures render at the right width, and confirm the reference style is the venue's numbered style. The exported zip is saved as v3-submission — the exact bytes sent.",
      },
      exercise:
        "Export your practice paper both as PDF and as a zip. Check the PDF for unresolved references and missing figures, and note which export a venue of your choice would ask for.",
      quiz: {
        question: "Which export keeps main.tex, the other source files, and the images together?",
        options: [
          "PDF (print).",
          "The LaTeX project export (.zip).",
          "The web page export.",
        ],
        answer: 1,
        explanation:
          "Only the zip carries the whole project — source files, bibliography, and figures — which is what compiling the paper elsewhere requires.",
      },
    },
  ],
};
