import type { Course } from "./types.ts";

export const publishResearch: Course = {
  id: "publish-research",
  title: "Publish and share your research",
  category: "Publishing",
  description:
    "Choose a trustworthy venue, prepare a complete submission, agree authorship, work through peer review, and share your work openly.",
  outcome:
    "A shortlist of venues, a submission checklist, and a plan for sharing your paper, data, and code.",
  resources: [
    {
      title: "Think. Check. Submit.: choose trusted journals and publishers",
      url: "https://thinkchecksubmit.org/",
    },
    {
      title: "ICMJE: defining the role of authors and contributors",
      url: "https://www.icmje.org/recommendations/browse/roles-and-responsibilities/defining-the-role-of-authors-and-contributors.html",
    },
    {
      title: "CRediT: Contributor Role Taxonomy",
      url: "https://credit.niso.org/",
    },
    {
      title: "COPE: Committee on Publication Ethics",
      url: "https://publicationethics.org/",
    },
    {
      title: "Open policy finder: publisher open access and self-archiving policies",
      url: "https://openpolicyfinder.jisc.ac.uk/",
    },
    {
      title: "ORCID: a persistent identifier for researchers",
      url: "https://orcid.org/",
    },
  ],
  lessons: [
    {
      id: "choose-a-venue",
      title: "Choose where to submit",
      minutes: 7,
      objective:
        "Shortlist journals or conferences that fit your paper, reach your readers, and are run with integrity.",
      sections: [
        {
          title: "Fit comes first",
          text: "The strongest predictor of a quick rejection is a paper that does not fit the venue. Read the aims and scope, then skim recent issues or proceedings: do they publish your kind of question, method, and article length? Look at where the papers you cite most were published; that is often where your readers are.",
          points: [
            "Match topic, method, and article type to recent publications.",
            "Check word limits and formatting before you commit.",
            "Note typical time to first decision and any fees.",
          ],
        },
        {
          title: "Journals, conferences, and preprints",
          text: "Fields differ. In much of computer science, peer-reviewed conference proceedings are the main venue; in most other fields, journals are. A preprint, posted on a server such as arXiv, bioRxiv, or SSRN, shares the work immediately but is not peer reviewed. Most journals accept submissions that were posted as preprints, but policies vary, so check the target venue's policy first.",
        },
        {
          title: "Avoid deceptive publishers",
          text: "Some publishers take fees without providing real peer review or editing. Warning signs include unsolicited emails flattering your work, promises of very fast acceptance, vague or missing fee information, and editorial boards you cannot verify. Checklists such as Think. Check. Submit. help; so does asking whether colleagues in your field read and cite the venue.",
          points: [
            "Verify the editorial board and the stated indexing.",
            "Find the fees and the peer review process before submitting.",
            "Be wary of invitations that arrive unprompted.",
          ],
        },
      ],
      example: {
        title: "A three-venue shortlist",
        text: "For a classroom study of quizzes, a student lists: a broad education-research journal where two key cited papers appeared; a specialist journal on teaching in higher education with a faster turnaround; and a teaching conference to present early results. For each, they note scope fit, word limit, review model, fees, and preprint policy.",
      },
      exercise:
        "List three possible venues for your paper. For each, note one recent paper similar to yours, the word limit, the fees, and the preprint policy. Rank them and write one sentence explaining your first choice.",
      quiz: {
        question:
          "An email invites you to submit to a journal outside your field, promising acceptance within a week for a fee. What should you do?",
        options: [
          "Submit quickly, since fast acceptance helps your career.",
          "Treat it as a warning sign and check the publisher before considering it.",
          "Reply asking for a discount.",
        ],
        answer: 1,
        explanation:
          "Unsolicited invitations and guaranteed fast acceptance are common signs of deceptive publishing. Real peer review takes time.",
      },
      practicePrompt:
        "How can researchers identify predatory journals, and how common are they?",
    },
    {
      id: "prepare-submission",
      title: "Prepare a complete submission",
      minutes: 7,
      objective:
        "Assemble the manuscript, cover letter, declarations, and supporting files a venue requires.",
      sections: [
        {
          title: "Follow the author guidelines exactly",
          text: "Author guidelines specify the article types, length, structure, reference style, figure formats, and the files to upload. Editors notice when they are ignored, and some submissions are returned unreviewed for formatting alone. If the venue uses double-anonymous review, remove names, affiliations, acknowledgments, and self-identifying references or file metadata from the manuscript.",
        },
        {
          title: "The cover letter",
          text: "A cover letter is a short note to the editor, not a second abstract. In a few paragraphs, say what the paper finds, why it suits this venue's readers, and confirm what the venue asks you to confirm, typically that the work is original and not under consideration elsewhere. Submitting the same paper to two journals at once is not allowed.",
          points: [
            "Name the article type and title.",
            "Explain the main finding and the fit with the venue in plain terms.",
            "Mention any related papers or preprints the editor should know about.",
          ],
        },
        {
          title: "Declarations and supporting files",
          text: "Most venues ask for statements on funding, competing interests, ethics approval and consent, data and code availability, and author contributions. Many also expect a completed reporting checklist, such as CONSORT or PRISMA, for the study type. Preparing these alongside the manuscript avoids delays and catches gaps, such as an ethics approval number nobody recorded.",
          points: [
            "Funding sources and competing interests for every author.",
            "Ethics approval reference and consent procedure, if applicable.",
            "Where the data and code are, or why they cannot be shared.",
          ],
        },
      ],
      example: {
        title: "A returned submission",
        text: "A manuscript was returned before review because the venue requires double-anonymous review and the PDF metadata listed the first author's name. The authors removed the metadata, replaced self-citations with 'Author (2023)', resubmitted, and the paper went out to reviewers the following week.",
      },
      exercise:
        "Open the author guidelines of your first-choice venue and turn them into a checklist. Mark each item done or missing for your current draft, and draft a four-sentence cover letter.",
      quiz: {
        question: "Which of these is acceptable when submitting a paper?",
        options: [
          "Submitting the same manuscript to two journals at once to save time.",
          "Ignoring the reference style, since editors reformat anyway.",
          "Posting a preprint first, when the venue's policy allows it.",
        ],
        answer: 2,
        explanation:
          "Most venues accept preprints, but simultaneous submission is not permitted, and guidelines on format and references are expected to be followed.",
      },
    },
    {
      id: "authorship-and-credit",
      title: "Agree authorship and credit early",
      minutes: 6,
      objective:
        "Decide who qualifies as an author, how contributions are described, and how everyone is identified.",
      sections: [
        {
          title: "Who is an author",
          text: "Widely used criteria from the International Committee of Medical Journal Editors (ICMJE) require all four of: a substantial contribution to the work, drafting or critically revising it, approving the final version, and agreeing to be accountable for it. Fields differ in detail, but the principle holds: authorship is earned by contribution and carries responsibility. Contributors who do not meet the criteria are thanked in the acknowledgments.",
        },
        {
          title: "Describe contributions precisely",
          text: "Many journals ask for a contribution statement, often using the CRediT taxonomy, which names 14 roles such as conceptualization, methodology, formal analysis, writing of the original draft, and supervision. Author order conventions vary by field, from contribution-ordered lists to alphabetical ones, so agree on the order and its meaning early and revisit it when roles change.",
          points: [
            "Discuss authorship at the start of a project, not at submission.",
            "Record who does what as the work progresses.",
            "Revisit the agreement when someone's role changes.",
          ],
        },
        {
          title: "Identify yourself consistently",
          text: "An ORCID iD is a free, persistent identifier that links you to your work even if your name, spelling, or institution changes. Many publishers and funders request it at submission. Use the same name form across publications, and keep your ORCID record updated so your work is attributed correctly.",
        },
      ],
      example: {
        title: "Settling credit before it becomes a dispute",
        text: "At the first project meeting, a team of four lists the expected contributions and agrees on a provisional author order. Six months later, a research assistant takes over most of the analysis; the team updates the order and the CRediT statement, and records the change in their project notes.",
      },
      exercise:
        "For a current or planned project, list each contributor and their CRediT roles. Check each person against the four ICMJE criteria and decide who should be an author and who should be acknowledged.",
      quiz: {
        question:
          "A colleague provided funding and lab space but did not take part in designing, conducting, or writing the study. How is this best recognized under ICMJE criteria?",
        options: [
          "List the colleague in the acknowledgments.",
          "Add the colleague as last author.",
          "Leave the contribution unmentioned.",
        ],
        answer: 0,
        explanation:
          "Providing resources alone does not meet authorship criteria. Acknowledging the contribution credits it accurately.",
      },
      practicePrompt:
        "How common are honorary and ghost authorship in scientific publications?",
    },
    {
      id: "peer-review-process",
      title: "Understand peer review and decisions",
      minutes: 6,
      objective:
        "Know what happens after submission, what reviewers look for, and how to read an editor's decision.",
      sections: [
        {
          title: "From submission to decision",
          text: "An editor first checks scope, quality, and completeness; many submissions are declined at this stage without external review, a desk rejection. Papers that pass are sent to reviewers, usually two or three experts. The editor weighs their reports and decides. The process takes weeks to months, and venues usually publish typical timelines.",
        },
        {
          title: "Review models",
          text: "In single-anonymous review, reviewers know who the authors are but not the reverse. In double-anonymous review, neither side knows. In open review, identities, and sometimes the reports themselves, are public. Reviewers are asked to judge whether the question matters, whether the methods support the conclusions, and whether the paper is clearly reported.",
          points: [
            "Single-anonymous: reviewers see author names.",
            "Double-anonymous: neither side sees names.",
            "Open: names and sometimes reports are published.",
          ],
        },
        {
          title: "Reading the decision",
          text: "Typical decisions are accept, minor revision, major revision, and reject. Acceptance without any revision is rare. A major revision is an invitation to improve the paper, not a rejection. A rejection is common even for good work; read the reports carefully, improve the paper, adapt it to the next venue's guidelines, and submit elsewhere.",
          points: [
            "Major revision: the editor wants the paper if the concerns are addressed.",
            "Reject: use the reports to strengthen the next submission.",
            "Ask the editor if the decision letter is unclear.",
          ],
        },
      ],
      example: {
        title: "A rejection that helped",
        text: "A paper was rejected after review because both reviewers doubted that a single course could support the general claims. The authors narrowed the conclusions, added a robustness analysis, and submitted to a specialist journal, where it was accepted after minor revisions.",
      },
      exercise:
        "Find a journal in your field that publishes its peer review reports, or read an open review on a preprint platform. Note the main concerns raised and how the authors responded.",
      quiz: {
        question: "What does a 'major revision' decision usually mean?",
        options: [
          "The paper has been rejected.",
          "The paper is accepted, and changes are optional.",
          "The editor will reconsider the paper if the substantial concerns are addressed.",
        ],
        answer: 2,
        explanation:
          "Major revision invites a resubmission that addresses the reviewers' concerns. Acceptance is not guaranteed, but the door is open.",
      },
      practicePrompt:
        "Does double-anonymous peer review reduce bias compared with single-anonymous review?",
    },
    {
      id: "respond-to-reviewers",
      title: "Respond to reviewers",
      minutes: 7,
      objective:
        "Write a point-by-point response that answers every comment and makes each change easy to verify.",
      sections: [
        {
          title: "Point by point",
          text: "A response letter quotes or numbers each reviewer comment and answers it directly below. For each one, say what you changed and where, with page and line numbers, or explain why you did not change it. Thank the reviewers once, briefly, at the start, and keep the tone factual throughout.",
          points: [
            "Number every comment, and answer every one.",
            "Quote the revised text, so reviewers need not hunt for it.",
            "Mark changes in the manuscript if the venue asks for it.",
          ],
        },
        {
          title: "Disagree with evidence",
          text: "You do not have to make every requested change. When a request is wrong or out of scope, say so politely and give the reason, with evidence or citations. Where reviewers misunderstood something, treat it as a sign that the text was unclear, and clarify the manuscript as well as replying.",
        },
        {
          title: "Plan the revision",
          text: "Read all reports, wait a day, then sort the comments into quick fixes, substantial work, and disagreements. Do the substantial work first, because it may change other answers. Check the deadline for resubmission and ask the editor for an extension early if you need one.",
          points: [
            "Group comments by effort before starting.",
            "Re-run analyses with the same care as the originals.",
            "Have a co-author check the letter against the manuscript.",
          ],
        },
      ],
      example: {
        title: "One comment, one answer",
        text: "Reviewer 2, comment 3: 'The authors do not account for prior achievement.' Response: 'Thank you. We now adjust for prior GPA in all models (Methods, p. 7, lines 140-152). The main estimate changes from 6.1 to 5.4 points (95% CI 1.6 to 9.2); see the revised Table 2.' The answer is specific, checkable, and reports how the result changed.",
      },
      exercise:
        "Take three critical comments you have received on any piece of writing. Write a point-by-point response to each: what you changed and where, or why you disagree, with evidence.",
      quiz: {
        question:
          "A reviewer requests an analysis you believe is inappropriate. What is the best response?",
        options: [
          "Ignore the comment and hope the editor does not notice.",
          "Run the analysis even though you think it is wrong, without comment.",
          "Explain politely, with evidence, why the analysis is not appropriate, and clarify the text if needed.",
        ],
        answer: 2,
        explanation:
          "Reasoned disagreement is acceptable and expected. Silence looks evasive, and running an analysis you consider invalid without explanation can mislead readers.",
      },
    },
    {
      id: "open-access-and-sharing",
      title: "Share your work openly and widely",
      minutes: 7,
      objective:
        "Choose an open access route and license, share data and code, and present the work beyond the paper.",
      sections: [
        {
          title: "Open access routes",
          text: "Gold open access publishes the final article free to read, sometimes for an article processing charge. Green open access means depositing a version, often the accepted manuscript, in a repository, sometimes after an embargo. Diamond open access journals charge neither authors nor readers. Publisher policies on what you may share and when are listed in services such as Open policy finder.",
          points: [
            "Gold: open on the publisher's site, possibly with a fee.",
            "Green: a manuscript version in a repository.",
            "Diamond: no fees for authors or readers.",
          ],
        },
        {
          title: "Licenses and rights",
          text: "Read the publishing agreement before signing: some transfer copyright to the publisher, others grant a license to publish while you keep copyright. Open access articles commonly use Creative Commons licenses; CC BY lets anyone reuse the work if they credit you. Your funder or institution may require a specific license or immediate open access, so check their policy too.",
        },
        {
          title: "Share data, code, and the story",
          text: "Deposit data and code in a repository that issues a persistent identifier such as a DOI, with a README explaining the files and a license, unless consent or privacy prevents sharing. Then present the work: a poster or talk built around your one main message, a plain-language summary, and links from your ORCID record and profiles, so the people who need the finding can find it.",
          points: [
            "Use a repository with persistent identifiers, not a personal web page.",
            "Explain restrictions honestly when data cannot be shared.",
            "Write a three-sentence plain-language summary of the finding.",
          ],
        },
      ],
      example: {
        title: "A complete sharing plan",
        text: "After acceptance in a subscription journal, the authors deposit their accepted manuscript in their university repository as the publisher's policy allows, put the anonymized data and analysis code in a public repository with a DOI, cite both in the article, and present the findings at a teaching conference with a poster built around one chart.",
      },
      exercise:
        "Look up your target journal's policy in Open policy finder. Note which version you may share, where, and when. Then write a three-sentence plain-language summary of your paper.",
      quiz: {
        question: "What does green open access mean?",
        options: [
          "Depositing a version of the paper, often the accepted manuscript, in a repository.",
          "Publishing in a journal focused on environmental research.",
          "Paying a fee so the publisher makes the article free to read.",
        ],
        answer: 0,
        explanation:
          "Green open access is self-archiving in a repository, sometimes after an embargo. Paying the publisher to open the article is gold open access.",
      },
      practicePrompt:
        "Do open access articles receive more citations than subscription articles?",
    },
  ],
};
