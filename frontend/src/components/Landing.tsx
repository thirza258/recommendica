import {
  AlertTriangleIcon,
  BookMarkIcon,
  ChevronRightIcon,
  FileTextIcon,
  SearchIcon,
  ZapIcon,
} from "./Icons";

/**
 * First screen of the app: what Recommendica does, scientific coverage, FAQs, and entry points.
 *
 * Deliberately not wired to <TopBar> — the status chip would report a
 * meaningless "Ready" before any search exists. It borrows the wordmark
 * classes instead, so the two surfaces still read as one product.
 */
function Landing({ onStart }: { onStart: () => void }) {
  const sampleTopics = [
    "Machine Learning & RAG Architectures",
    "Climate Change & Carbon Capture",
    "Genomic Medicine & CRISPR",
    "Quantum Computing Algorithms",
    "Neuroscience & Cognitive Models",
    "Autonomous Robotics & Control",
  ];

  const faqs = [
    {
      q: "What is Recommendica and how does it work?",
      a: "Recommendica is a research recommendation search engine built on retrieval-augmented generation (RAG). You ask a research question in plain language; it expands your query across multiple representations (HyDE, step-back prompting, RAG-fusion), searches indexed literature and arXiv, grades each paper for direct relevance, and writes a synthesized answer grounded strictly in verified papers.",
    },
    {
      q: "How does Recommendica prevent AI hallucinations?",
      a: "Unlike generic conversational chatbots, Recommendica uses an autonomous relevance agent that screens candidate papers before generation, clustered concurrent generation, and claim-level verification. Every generated assertion is scored for faithfulness against the original papers, and the engine stays silent or refines queries rather than guessing from unrelated documents.",
    },
    {
      q: "What paper repositories does Recommendica search?",
      a: "Recommendica searches curated collections of scientific and academic literature across Computer Science, Artificial Intelligence, Climate Science, Biomedicine, Physics, and Mathematics, supplemented by real-time arXiv paper retrieval fallback.",
    },
    {
      q: "Is Recommendica free to use for academic researchers and students?",
      a: "Yes, Recommendica is 100% free and requires no account registration, subscriptions, or login to search papers and read grounded summaries.",
    },
  ];

  return (
    <div className="landing">
      <header className="landing-bar">
        <div className="wordmark">
          <BookMarkIcon size={30} className="wordmark-mark" />
          <p className="wordmark-text">Recommendica</p>
        </div>

        <button type="button" className="ghost-button" onClick={onStart}>
          Get started
          <ChevronRightIcon size={16} />
        </button>
      </header>

      <main className="landing-main">
        {/* ── Pitch ─────────────────────────────────────────────────────── */}
        <section className="landing-hero" aria-labelledby="hero-title">
          <p className="section-label">Retrieval-augmented research search</p>
          <h1 className="landing-title" id="hero-title">
            Ask a research question. Get an answer the papers actually support.
          </h1>
          <p className="landing-lead">
            Recommendica searches a corpus of research papers, keeps only the
            ones that genuinely answer your question, and writes a response
            grounded in them — with every source it used attached.
          </p>

          <div className="landing-cta">
            <button type="button" className="primary-button" onClick={onStart}>
              Get started
              <ChevronRightIcon size={18} />
            </button>
            <p className="helper-copy">
              No sign-up. Type a question and the pipeline runs.
            </p>
          </div>
        </section>

        {/* ── Scientific Disciplines ───────────────────────────────────── */}
        <section className="landing-block" aria-labelledby="covered-disciplines">
          <h2 className="landing-section-title" id="covered-disciplines">
            Explore scientific domains
          </h2>
          <p className="landing-block-intro">
            Search peer-reviewed literature and preprint research across diverse disciplines:
          </p>
          <div className="topic-tag-grid">
            {sampleTopics.map((topic) => (
              <button
                key={topic}
                type="button"
                className="topic-tag-pill"
                onClick={onStart}
                title={`Search papers related to ${topic}`}
              >
                <SearchIcon size={14} className="topic-tag-icon" />
                <span>{topic}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── How a search works ────────────────────────────────────────── */}
        <section className="landing-block" aria-labelledby="how-it-works">
          <h2 className="landing-section-title" id="how-it-works">
            How a search works
          </h2>
          <ol className="flow-list">
            <li className="flow-item">
              <span className="flow-step" aria-hidden="true">
                1
              </span>
              <h3 className="flow-title">Retrieve</h3>
              <p className="flow-text">
                Your question is expanded into several query variants and
                searched against the paper corpus in one batched pass, so
                differently-worded work still surfaces.
              </p>
            </li>
            <li className="flow-item">
              <span className="flow-step" aria-hidden="true">
                2
              </span>
              <h3 className="flow-title">Generate</h3>
              <p className="flow-text">
                Related papers are split into small groups, and each group
                produces an answer that streams back token by token as it is
                written.
              </p>
            </li>
            <li className="flow-item">
              <span className="flow-step" aria-hidden="true">
                3
              </span>
              <h3 className="flow-title">Verify</h3>
              <p className="flow-text">
                With grounding checks enabled, each claim is graded against the
                sources it came from and the answer carries a faithfulness
                score.
              </p>
            </li>
          </ol>
        </section>

        {/* ── What makes it different ───────────────────────────────────── */}
        <section className="landing-block" aria-labelledby="what-you-get">
          <h2 className="landing-section-title" id="what-you-get">
            What you get
          </h2>
          <ul className="feature-grid">
            <li className="feature-card">
              <span className="feature-icon">
                <SearchIcon size={20} />
              </span>
              <h3 className="feature-title">Papers are graded, not just ranked</h3>
              <p className="feature-text">
                Plain retrieval returns its top matches however off-topic they
                are. A relevance agent scores each candidate against your
                question, drops the unrelated ones, and searches again with a
                refined query when too few survive.
              </p>
            </li>

            <li className="feature-card">
              <span className="feature-icon">
                <ZapIcon size={20} />
              </span>
              <h3 className="feature-title">Answers arrive while they are written</h3>
              <p className="feature-text">
                Groups of papers are answered concurrently and streamed, so you
                start reading the first response before the rest have finished
                generating.
              </p>
            </li>

            <li className="feature-card">
              <span className="feature-icon">
                <FileTextIcon size={20} />
              </span>
              <h3 className="feature-title">Every source stays in view</h3>
              <p className="feature-text">
                Each answer lists the papers behind it — title, category,
                authors and summary — so you can judge the evidence yourself
                and go to the original.
              </p>
            </li>

            <li className="feature-card">
              <span className="feature-icon">
                <AlertTriangleIcon size={20} />
              </span>
              <h3 className="feature-title">It stays quiet rather than guessing</h3>
              <p className="feature-text">
                When nothing in the corpus is related enough, you get a notice
                saying so — not a confident answer assembled from papers that
                were already judged irrelevant.
              </p>
            </li>
          </ul>
        </section>

        {/* ── Frequently Asked Questions (SEO & User Clarity) ──────────── */}
        <section className="landing-block" aria-labelledby="faq-title">
          <h2 className="landing-section-title" id="faq-title">
            Frequently asked questions
          </h2>
          <div className="faq-accordion-group">
            {faqs.map((faq) => (
              <details key={faq.q} className="faq-accordion-item">
                <summary className="faq-accordion-summary">
                  <span>{faq.q}</span>
                  <ChevronRightIcon size={16} className="faq-chevron" />
                </summary>
                <div className="faq-accordion-content">
                  <p>{faq.a}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ── Closing call to action ────────────────────────────────────── */}
        <section className="landing-closer">
          <h2 className="landing-closer-title">Ready to search?</h2>
          <p className="landing-closer-text">
            Start with one of the sample questions, or write your own.
          </p>
          <button type="button" className="primary-button" onClick={onStart}>
            Get started
            <ChevronRightIcon size={18} />
          </button>
        </section>
      </main>

      <footer className="landing-foot">
        <p>
          Answers are generated from retrieved papers. Check the cited sources
          before relying on them.
        </p>
      </footer>
    </div>
  );
}

export default Landing;
