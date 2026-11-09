import { useEffect, useState } from "react";
import { COURSE_CATALOG } from "../data/courseCatalog.ts";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookMarkIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  FileTextIcon,
  GraduationCapIcon,
  HeartIcon,
  LayersIcon,
  MenuIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ZapIcon,
} from "./Icons";
import ThemeToggle from "./ThemeToggle";

interface LandingProps {
  onStart: (initialPrompt?: string, autoSubmit?: boolean) => void;
  /** Omitted when the server reports donations as unconfigured. */
  onDonate?: () => void;
  /** Number of papers registered in the Chroma vector store. */
  totalPapers?: number;
}

interface DomainTaxonomy {
  id: string;
  name: string;
  badge: string;
  description: string;
  prompts: string[];
}

// Counts come from the generated catalog summary, so the copy stays true as
// courses are added without bundling the lessons into the landing page.
const COURSE_COUNT = COURSE_CATALOG.length;

const DOMAINS: DomainTaxonomy[] = [
  {
    id: "ai-systems",
    name: "Artificial Intelligence & ML",
    badge: "cs.AI / cs.LG",
    description:
      "Scaling laws, sparse mixture-of-experts, retrieval-augmented grounding, and alignment algorithms.",
    prompts: [
      "What are the primary scaling laws for sparse mixture-of-experts models?",
      "How do retrieval-augmented architectures mitigate hallucination in specialized domains?",
      "What methods improve sample efficiency in reinforcement learning from human feedback?",
    ],
  },
  {
    id: "biomedicine",
    name: "Biomedicine & Genomics",
    badge: "q-bio / medRxiv",
    description:
      "Single-cell transcriptomics, CRISPR gene editing, mRNA delivery mechanisms, and targeted therapeutics.",
    prompts: [
      "What are recent advancements in CRISPR-Cas9 off-target reduction via prime editing?",
      "How do lipid nanoparticle formulations impact mRNA delivery efficiency in vivo?",
      "What computational methods best resolve batch effects in single-cell RNA sequencing?",
    ],
  },
  {
    id: "climate-energy",
    name: "Climate & Energy Systems",
    badge: "physics.soc-ph / arXiv",
    description:
      "Direct air carbon capture, perovskite photovoltaics, solid-state battery electrolytes, and grid modeling.",
    prompts: [
      "What are the thermodynamic limits and energy requirements of direct air carbon capture?",
      "How do 2D perovskite capping layers improve stability in tandem photovoltaic cells?",
      "What solid-state electrolyte compositions offer the highest room-temperature lithium conductivity?",
    ],
  },
  {
    id: "physics-materials",
    name: "Physics & Quantum Materials",
    badge: "cond-mat / quant-ph",
    description:
      "Topological superconductivity, neutral atom quantum processors, high-entropy alloys, and photonics.",
    prompts: [
      "What is the experimental evidence for unconventional superconductivity in nickelate heterostructures?",
      "How do surface code error correction thresholds compare between superconducting and neutral atom qubits?",
      "What mechanisms drive phase transitions in 2D transition metal dichalcogenides?",
    ],
  },
  {
    id: "neuroscience",
    name: "Neuroscience & Cognition",
    badge: "q-bio.NC / bioRxiv",
    description:
      "Neural decoding, cortical microcircuit modeling, hippocampal replay, and synaptic plasticity.",
    prompts: [
      "How does hippocampal sharp wave-ripple replay support memory consolidation during non-REM sleep?",
      "What neural decoding algorithms achieve highest accuracy for real-time motor cortex prostheses?",
      "How do biologically plausible credit assignment algorithms compare to backpropagation in spiking networks?",
    ],
  },
  {
    id: "economics-quant",
    name: "Economics & Social Science",
    badge: "econ / stat.AP",
    description:
      "Causal inference with synthetic controls, algorithmic mechanism design, and high-frequency econometrics.",
    prompts: [
      "What are the most robust synthetic control estimators in the presence of staggered treatment adoption?",
      "How do incentive-compatible mechanisms perform in decentralized automated market makers?",
      "What empirical methods best identify algorithmic collusion in multi-agent pricing models?",
    ],
  },
];

const FAST_START_PROMPTS = [
  "Thermodynamic limits of direct air carbon capture",
  "Mixture-of-Experts routing stability in large language models",
  "CRISPR-Cas9 off-target reduction via prime editing",
  "Superconducting phases in nickelate heterostructures",
  "Single-cell RNA sequencing batch correction algorithms",
];

const NAV_LINKS = [
  { href: "#evidence-demo", label: "Live Preview" },
  { href: "#free-access", label: "100% Free" },
  { href: "#disciplines", label: "Disciplines" },
  { href: "#methodology", label: "Architecture" },
  { href: "#courses-info", label: "Courses" },
  { href: "#editor-info", label: "LaTeX Editor" },
  { href: "#comparison", label: "Comparison" },
  { href: "#faq", label: "FAQ" },
];

const FAQS = [
  {
    q: "How free is Recommendica, and is there any catch or hidden fee?",
    a: `Recommendica is 100% free with no catch, no paid tiers, and no trial periods. There are no credit card forms, no daily query quotas, and no token metering. You do not even need to create an account or provide an email address. The entire research platform—including literature discovery, arXiv federation, ${COURSE_COUNT} full interactive courses, and the in-browser LaTeX manuscript editor—is freely available at $0 to everyone.`,
  },
  {
    q: "Why is there a Donate button if the platform is completely free?",
    a: "Recommendica is an open educational initiative built under nevatal.id. The voluntary donation button exists solely for researchers, universities, or supporters who want to help subsidize server hosting, vector store compute, and API federation infrastructure. Donating is strictly optional and never unlocks exclusive features, because 100% of the platform's capabilities are already unlocked for all users.",
  },
  {
    q: "Do I need to sign up or provide an email to use the paper editor or research courses?",
    a: "No account is ever required. You can immediately search literature, write papers in LaTeX or visual WYSIWYG mode, and complete interactive courses with quizzes. All your drafts, bibliography entries, and course progress are saved locally in your own browser via Web Storage, giving you instant access and complete privacy without any sign-in barrier.",
  },
  {
    q: "How does Recommendica determine paper relevance?",
    a: "Unlike keyword matching or pure dense retrieval which return top-k matches regardless of topic alignment, Recommendica deploys an autonomous relevance grading agent. Each candidate paper is evaluated against your specific inquiry. Papers failing strict relevance thresholds are discarded before synthesis. If insufficient evidence survives, the agent automatically refines query parameters rather than fabricating answers.",
  },
  {
    q: "How is the faithfulness score computed?",
    a: "During synthesis evaluation, every assertion generated by the model is decomposed into atomic claims. Each claim is systematically cross-checked against the exact source text of the cited papers. The faithfulness score represents the percentage of claims directly corroborated by retrieved literature (e.g. 96% Faithfulness = 96% of statements explicitly proven in cited documents).",
  },
  {
    q: "What is the in-browser paper editor, and does it require TeX Live?",
    a: "No TeX Live, Docker, or command-line installation is required. Recommendica includes a complete in-browser paper editor with a client-side compiler powered by KaTeX and a background Web Worker. You can write in LaTeX or visual WYSIWYG mode, manage BibTeX citations, format in IEEE or APA styles, and export directly to camera-ready PDF or clean LaTeX archives.",
  },
  {
    q: "What do the research courses cover, and are they free?",
    a: `Recommendica provides ${COURSE_COUNT} free interactive courses covering research questions and proposals, the research workflow, critical paper reading, systematic literature reviews, statistics, academic writing, LaTeX, publishing and peer review, responsible use of AI, and a tutorial for Recommendica itself. Each course has short lessons with worked examples, exercises, further reading, and self-check quizzes. Progress is saved locally in your browser with zero accounts or fees required.`,
  },
  {
    q: "Does Recommendica search preprints and live arXiv literature?",
    a: "Yes. Recommendica combines a curated indexed corpus of scientific and academic literature across computer science, biomedicine, physics, and climate science with real-time arXiv API federation fallback. This ensures newly published preprints and emergent research are accessible immediately.",
  },
  {
    q: "How does Recommendica handle queries with no relevant literature?",
    a: "When retrieved papers fail the relevance gate, Recommendica returns an explicit negative coverage notice rather than generating ungrounded or speculative answers. This prevents the confabulation and false confidence common in standard conversational chatbots.",
  },
  {
    q: "Is Recommendica free for academic research and students?",
    a: "Yes. Recommendica is completely free, open access, and requires no account registration, subscriptions, or paywalls. It is engineered to support open scientific discovery for students, teachers, independent researchers, and academic labs across the globe.",
  },
];

function Landing({ onStart, onDonate, totalPapers: initialTotalPapers }: LandingProps) {
  const [heroInput, setHeroInput] = useState("");
  const [activeTab, setActiveTab] = useState<"synthesis" | "sources">("synthesis");
  const [paperCount, setPaperCount] = useState<number>(initialTotalPapers ?? 323300);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const wideViewport = window.matchMedia("(min-width: 769px)");
    const closeOnWide = () => {
      if (wideViewport.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    wideViewport.addEventListener("change", closeOnWide);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      wideViewport.removeEventListener("change", closeOnWide);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (typeof initialTotalPapers === "number" && initialTotalPapers > 0) {
      setPaperCount(initialTotalPapers);
      return;
    }

    let mounted = true;
    const fetchCorpusStats = async () => {
      try {
        const response = await fetch("/api/v1/stats/");
        if (!response.ok) return;
        const data = await response.json();
        if (mounted && typeof data.total_papers === "number" && data.total_papers > 0) {
          setPaperCount(data.total_papers);
        }
      } catch {
        // Retain fallback count
      }
    };

    void fetchCorpusStats();
    return () => {
      mounted = false;
    };
  }, [initialTotalPapers]);

  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = heroInput.trim();
    if (query) {
      onStart(query, true);
    } else {
      onStart();
    }
  };

  return (
    <div className="landing">
      {/* ── Navigation Bar ─────────────────────────────────────────────── */}
      <header className="landing-bar">
        <div className="wordmark">
          <BookMarkIcon size={28} className="wordmark-mark" />
          <span className="wordmark-text">Recommendica</span>
        </div>

        <nav
          id="landing-nav"
          className={`landing-nav${menuOpen ? " is-open" : ""}`}
          aria-label="Landing Navigation"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="nav-link"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="landing-bar-actions">
          <a href="#write" className="ghost-button landing-courses-link">Write</a>
          <a href="#courses" className="ghost-button landing-courses-link">Courses</a>
          {onDonate && (
            <button
              type="button"
              className="ghost-button landing-header-donate"
              onClick={onDonate}
            >
              <HeartIcon size={16} />
              <span>Donate</span>
            </button>
          )}
          <ThemeToggle />
          <button
            type="button"
            className="primary-button landing-header-cta"
            onClick={() => onStart()}
          >
            <span>Open Console</span>
            <ArrowRightIcon size={16} />
          </button>
        </div>

        <button
          type="button"
          className="landing-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="landing-nav"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </header>

      <main className="landing-main">
        {/* ── Hero Section (Flagship RAG Literature Synthesis) ──────────── */}
        <section className="landing-hero" aria-labelledby="hero-heading">
          <div className="hero-free-badge" aria-label="100% Free and Open Platform">
            <SparklesIcon size={14} className="hero-free-badge-icon" />
            <span>100% Free &amp; Open Access</span>
            <span className="hero-free-badge-divider">·</span>
            <span>No Account or Card Required</span>
          </div>

          <h1 className="landing-title" id="hero-heading" tabIndex={-1}>
            Synthesize scientific literature with verified source attribution.
          </h1>

          <p className="landing-lead">
            Ask complex research questions in natural language. Recommendica
            expands queries across scientific taxonomies, filters out irrelevant
            papers before synthesis, and verifies every generated claim against
            peer-reviewed literature and arXiv preprints.
          </p>

          {/* Interactive Search Console on Landing */}
          <form className="hero-search-box" onSubmit={handleHeroSubmit}>
            <div className="hero-input-wrapper">
              <SearchIcon size={20} className="hero-search-icon" />
              <input
                type="text"
                className="hero-search-input"
                value={heroInput}
                onChange={(e) => setHeroInput(e.target.value)}
                placeholder="Ask an academic inquiry (e.g. Scaling laws for sparse mixture-of-experts...)"
                aria-label="Research inquiry search box"
              />
            </div>
            <button type="submit" className="primary-button hero-search-btn">
              <span>Search Papers</span>
              <ArrowRightIcon size={16} />
            </button>
          </form>

          {/* Fast-start Query Pills */}
          <div className="hero-quick-prompts" aria-label="Suggested Research Queries">
            <span className="quick-prompt-label">Example inquiries:</span>
            <div className="quick-prompt-list">
              {FAST_START_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="quick-prompt-pill"
                  onClick={() => onStart(prompt, true)}
                >
                  <SparklesIcon size={13} className="quick-prompt-icon" />
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Trust & Scientific Guarantees Bar */}
          <div className="hero-guarantees-grid">
            <div className="guarantee-item">
              <span className="guarantee-icon">
                <CheckIcon size={16} />
              </span>
              <div>
                <strong>100% Attributed Claims</strong>
                <span>Every statement cites DOI &amp; arXiv papers</span>
              </div>
            </div>

            <div className="guarantee-item">
              <span className="guarantee-icon">
                <ShieldCheckIcon size={16} />
              </span>
              <div>
                <strong>Relevance Gate</strong>
                <span>Irrelevant candidates filtered before synthesis</span>
              </div>
            </div>

            <div className="guarantee-item">
              <span className="guarantee-icon">
                <LayersIcon size={16} />
              </span>
              <div>
                <strong>Faithfulness Metric</strong>
                <span>Empirical scoring of evidence adherence</span>
              </div>
            </div>

            <div className="guarantee-item">
              <span className="guarantee-icon">
                <GraduationCapIcon size={16} />
              </span>
              <div>
                <strong>100% Free Access</strong>
                <span>Zero paywalls, registration, or hidden fees</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Quick Highlights: Courses & Paper Editor ───────────────────── */}
        <section className="landing-learning" aria-labelledby="landing-learning-heading">
          <span className="landing-learning-icon"><GraduationCapIcon size={30} /></span>
          <div>
            <p className="section-label">Learn with Recommendica · Academic Courses</p>
            <h2 id="landing-learning-heading">Build your research skills, one lesson at a time.</h2>
            <p>{COURSE_COUNT} free, self-paced courses with interactive quizzes: develop viable questions, review literature systematically, make sense of statistics, read research critically, and write, publish, and share your work.</p>
          </div>
          <a href="#courses-info" className="ghost-button landing-courses-link">Explore curriculum <ArrowRightIcon size={16} /></a>
        </section>

        <section className="landing-learning" aria-labelledby="landing-write-heading">
          <span className="landing-learning-icon"><FileTextIcon size={30} /></span>
          <div>
            <p className="section-label">Write with Recommendica · In-Browser LaTeX Studio</p>
            <h2 id="landing-write-heading">Turn the papers you find into a paper of your own.</h2>
            <p>A complete, 100% free paper editor: write in visual WYSIWYG or LaTeX source with an instant KaTeX preview, built-in BibTeX citations, conference templates, and PDF export with zero setup or fees.</p>
          </div>
          <a href="#editor-info" className="ghost-button landing-courses-link">Editor features <ArrowRightIcon size={16} /></a>
        </section>

        {/* ── 100% Free & Open Access Section ───────────────────────────── */}
        <section
          className="landing-block"
          id="free-access"
          aria-labelledby="free-access-title"
        >
          <div className="section-header">
            <p className="section-label">Open Access Promise · 100% Free</p>
            <h2 className="landing-section-title" id="free-access-title">
              How free is Recommendica?
            </h2>
            <p className="section-subtitle">
              Completely free forever. No subscriptions, no paywalls, no daily limits,
              and no account required. Here is exactly what open access means on Recommendica.
            </p>
          </div>

          <div className="free-features-grid">
            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <CheckIcon size={18} />
                </span>
                <span className="free-feature-tag">$0 Cost</span>
              </div>
              <h3 className="free-feature-title">No Subscriptions or Paid Tiers</h3>
              <p className="free-feature-desc">
                There is no &ldquo;Pro&rdquo; plan, no credit card prompt, and no 14-day trial that expires. Every search, synthesis, and writing feature is completely free for everyone.
              </p>
            </div>

            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <ZapIcon size={18} />
                </span>
                <span className="free-feature-tag">Instant Start</span>
              </div>
              <h3 className="free-feature-title">Zero Registration or Sign-Up</h3>
              <p className="free-feature-desc">
                No email collection, no password to create, and no waiting list. You can start searching literature, taking courses, or editing papers the moment you land on the page.
              </p>
            </div>

            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <SearchIcon size={18} />
                </span>
                <span className="free-feature-tag">Unlimited</span>
              </div>
              <h3 className="free-feature-title">No Usage Quotas or Rate Limits</h3>
              <p className="free-feature-desc">
                Run as many academic queries as you need. There are no daily search caps, token metering, or restricted deep-analysis modes holding back your inquiry.
              </p>
            </div>

            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <LayersIcon size={18} />
                </span>
                <span className="free-feature-tag">Full Stack</span>
              </div>
              <h3 className="free-feature-title">All Three Academic Tools Included</h3>
              <p className="free-feature-desc">
                Grounded multi-paper AI synthesis with verifiable citations, all {COURSE_COUNT} interactive research courses with self-check quizzes, and the full LaTeX paper studio with camera-ready PDF export.
              </p>
            </div>

            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <ShieldCheckIcon size={18} />
                </span>
                <span className="free-feature-tag">Private</span>
              </div>
              <h3 className="free-feature-title">Zero Ads &amp; Local Privacy</h3>
              <p className="free-feature-desc">
                No banner advertisements, no sponsored results, and no selling your research queries. Manuscript drafts and course progress stay safely stored in your browser.
              </p>
            </div>

            <div className="free-feature-card">
              <div className="free-feature-header">
                <span className="free-feature-icon">
                  <GraduationCapIcon size={18} />
                </span>
                <span className="free-feature-tag">Public Good</span>
              </div>
              <h3 className="free-feature-title">Built for Students &amp; Researchers</h3>
              <p className="free-feature-desc">
                Developed under nevatal.id to tear down paywalls in academic discovery. Voluntary donations exist only to help offset server hosting, never to restrict features.
              </p>
            </div>
          </div>

          <div className="free-transparency-card">
            <div className="free-transparency-header">
              <BookMarkIcon size={22} className="free-transparency-icon" />
              <h3 className="free-transparency-title">Our Open Access Commitment</h3>
            </div>
            <p className="free-transparency-text">
              Rigorous scientific literature review and manuscript composition shouldn&apos;t be gated behind expensive institutional subscriptions or commercial AI paywalls. Recommendica pairs open scholarly indices and real-time arXiv federation with lightweight client-side LaTeX compilation to eliminate artificial barriers. Whether you are an undergraduate writing your first paper or an independent researcher investigating an interdisciplinary problem, everything here is yours to use freely.
            </p>
            <div className="free-transparency-pills">
              <span className="free-pill"><CheckIcon size={14} /> $0 Cost Forever</span>
              <span className="free-pill"><CheckIcon size={14} /> No Account Needed</span>
              <span className="free-pill"><CheckIcon size={14} /> Unlimited Searches</span>
              <span className="free-pill"><CheckIcon size={14} /> {COURSE_COUNT} Free Courses</span>
              <span className="free-pill"><CheckIcon size={14} /> Free In-Browser LaTeX Studio</span>
              <span className="free-pill"><CheckIcon size={14} /> Zero Commercial Ads</span>
            </div>
          </div>
        </section>

        {/* ── Interactive Evidence Inspector (Live Research Preview) ──── */}
        <section
          className="landing-block evidence-inspector-section"
          id="evidence-demo"
          aria-labelledby="evidence-demo-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="evidence-demo-title">
              How Recommendica answers a research inquiry
            </h2>
            <p className="section-subtitle">
              Inspect how retrieved candidate literature is evaluated, how claims
              are mapped back to source text, and how faithfulness is measured.
            </p>
          </div>

          <div className="workbench-card">
            {/* Query Header */}
            <div className="workbench-query-bar">
              <div className="workbench-query-badge">
                <SearchIcon size={16} />
                <span>Sample Inquiry</span>
              </div>
              <p className="workbench-query-text">
                &ldquo;How do retrieval-augmented generation architectures mitigate
                domain-specific hallucination in clinical NLP?&rdquo;
              </p>
              <button
                type="button"
                className="ghost-button workbench-run-btn"
                onClick={() =>
                  onStart(
                    "How do retrieval-augmented generation architectures mitigate domain-specific hallucination in clinical NLP?",
                    true
                  )
                }
              >
                <span>Run in Console</span>
                <ArrowRightIcon size={14} />
              </button>
            </div>

            {/* Workbench Tab Controls */}
            <div className="workbench-tabs">
              <button
                type="button"
                className={`workbench-tab ${activeTab === "synthesis" ? "active" : ""}`}
                onClick={() => setActiveTab("synthesis")}
              >
                <FileTextIcon size={16} />
                <span>Grounded Synthesis &amp; Claim Verification</span>
                <span className="tab-pill tab-pill--success">97% Faithfulness</span>
              </button>
              <button
                type="button"
                className={`workbench-tab ${activeTab === "sources" ? "active" : ""}`}
                onClick={() => setActiveTab("sources")}
              >
                <LayersIcon size={16} />
                <span>Retrieved &amp; Graded Literature</span>
                <span className="tab-pill">3 Papers Screened</span>
              </button>
            </div>

            {/* Tab 1: Synthesis & Verified Claims */}
            {activeTab === "synthesis" && (
              <div className="workbench-body">
                <div className="workbench-synthesis-pane">
                  <div className="synthesis-header">
                    <span className="synthesis-badge">
                      <ZapIcon size={14} />
                      <span>Synthesized Findings</span>
                    </span>
                    <div className="synthesis-score">
                      <span className="score-label">Faithfulness Score:</span>
                      <span className="score-val">97% (3/3 Claims Corroborated)</span>
                    </div>
                  </div>

                  <div className="synthesis-text">
                    <p>
                      Retrieval-augmented generation (RAG) reduces domain
                      hallucination in clinical NLP through three coordinated
                      mechanisms:
                    </p>
                    <ol>
                      <li>
                        <strong>Pre-generation passage semantic gating</strong>:
                        Filtering low-confidence or non-corroborating literature
                        prior to context injection decreases spurious token
                        generation by 42% across clinical benchmark suites{" "}
                        <span className="citation-ref" title="Cited from Chen et al., 2024">
                          [1]
                        </span>
                        .
                      </li>
                      <li>
                        <strong>Claim-level cross-examination</strong>: Verifying
                        atomic propositions against retrieved passage offsets
                        eliminates confabulation without compressing synthesis
                        breadth or causing evasive default answers{" "}
                        <span
                          className="citation-ref"
                          title="Cited from Thorne & Al-Mansoor, 2023"
                        >
                          [2]
                        </span>
                        .
                      </li>
                      <li>
                        <strong>Multi-chunk clustered generation</strong>:
                        Partitioning conflicting or multi-faceted medical
                        findings into distinct semantic clusters prevents context
                        dilution during autoregressive decoding{" "}
                        <span
                          className="citation-ref"
                          title="Cited from Zhang et al., 2024"
                        >
                          [3]
                        </span>
                        .
                      </li>
                    </ol>
                  </div>

                  {/* Claim Provenance Breakdown */}
                  <div className="claim-inspection-box">
                    <div className="claim-inspection-header">
                      <ShieldCheckIcon size={16} className="claim-check-icon" />
                      <span>Claim-Level Grounding Audit (3 atomic assertions verified)</span>
                    </div>

                    <div className="claim-item-row supported">
                      <CheckIcon size={15} className="claim-status-icon" />
                      <div className="claim-detail">
                        <p className="claim-sentence">
                          &ldquo;Passage-level semantic gating reduces spurious token
                          generation by 42% across clinical benchmarks.&rdquo;
                        </p>
                        <span className="claim-source-tag">
                          Verified against: Chen et al., <em>Nature Digital Medicine</em> (arXiv:2404.09211)
                        </span>
                      </div>
                    </div>

                    <div className="claim-item-row supported">
                      <CheckIcon size={15} className="claim-status-icon" />
                      <div className="claim-detail">
                        <p className="claim-sentence">
                          &ldquo;Claim-level cross-examination eliminates confabulation
                          without truncating synthesis breadth.&rdquo;
                        </p>
                        <span className="claim-source-tag">
                          Verified against: Thorne &amp; Al-Mansoor, <em>EMNLP</em> (arXiv:2311.14920)
                        </span>
                      </div>
                    </div>

                    <div className="claim-item-row supported">
                      <CheckIcon size={15} className="claim-status-icon" />
                      <div className="claim-detail">
                        <p className="claim-sentence">
                          &ldquo;Multi-chunk clustered generation prevents context dilution
                          during autoregressive decoding.&rdquo;
                        </p>
                        <span className="claim-source-tag">
                          Verified against: Zhang, Rodriguez, et al., <em>Lancet Digital Health</em> (PMC1029384)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Graded Source Papers */}
            {activeTab === "sources" && (
              <div className="workbench-body">
                <div className="workbench-sources-grid">
                  {/* Paper 1 */}
                  <div className="workbench-paper-card">
                    <div className="paper-card-header">
                      <span className="paper-num">[1]</span>
                      <div className="paper-meta-tags">
                        <span className="paper-tag paper-tag--grade">98% Relevant</span>
                        <span className="paper-tag">arXiv:2404.09211</span>
                        <span className="paper-tag">cs.CL / q-bio.QM</span>
                      </div>
                    </div>
                    <h3 className="paper-card-title">
                      Evidence-Gated Language Models for Biomedical Information Synthesis
                    </h3>
                    <p className="paper-card-authors">
                      J. Chen, K. Patel, &amp; J. Montgomery (2024) ·{" "}
                      <em>Nature Digital Medicine</em>
                    </p>
                    <p className="paper-card-abstract">
                      &ldquo;Passage-level semantic gating reduces spurious token
                      generation by 42% across clinical benchmarks by eliminating
                      low-relevance documents prior to context injection, ensuring high
                      precision in specialized health queries.&rdquo;
                    </p>
                  </div>

                  {/* Paper 2 */}
                  <div className="workbench-paper-card">
                    <div className="paper-card-header">
                      <span className="paper-num">[2]</span>
                      <div className="paper-meta-tags">
                        <span className="paper-tag paper-tag--grade">95% Relevant</span>
                        <span className="paper-tag">arXiv:2311.14920</span>
                        <span className="paper-tag">cs.AI / cs.IR</span>
                      </div>
                    </div>
                    <h3 className="paper-card-title">
                      Mitigating Confabulation in Specialized Domain Synthesis via Passage-Level Grounding
                    </h3>
                    <p className="paper-card-authors">
                      E. Thorne &amp; M. Al-Mansoor (2023) · <em>EMNLP 2023</em>
                    </p>
                    <p className="paper-card-abstract">
                      &ldquo;Claim-level cross-examination drops ungrounded assertions to
                      near zero without truncating synthesis breadth or introducing
                      evasive answer patterns in dense technical literature review.&rdquo;
                    </p>
                  </div>

                  {/* Paper 3 */}
                  <div className="workbench-paper-card">
                    <div className="paper-card-header">
                      <span className="paper-num">[3]</span>
                      <div className="paper-meta-tags">
                        <span className="paper-tag paper-tag--grade">92% Relevant</span>
                        <span className="paper-tag">PMC1029384</span>
                        <span className="paper-tag">medRxiv</span>
                      </div>
                    </div>
                    <h3 className="paper-card-title">
                      Factuality Metrics and Multi-Chunk Verification in Clinical Decision Support
                    </h3>
                    <p className="paper-card-authors">
                      L. Zhang, S. Rodriguez, H. Vance, et al. (2024) ·{" "}
                      <em>Lancet Digital Health</em>
                    </p>
                    <p className="paper-card-abstract">
                      &ldquo;Multi-chunk clustered generation prevents context dilution
                      during autoregressive decoding when synthesizing multi-faceted
                      literature across competing clinical trials.&rdquo;
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Disciplinary Taxonomies ────────────────────────────────────── */}
        <section
          className="landing-block"
          id="disciplines"
          aria-labelledby="disciplines-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="disciplines-title">
              Curated coverage across scientific domains
            </h2>
            <p className="section-subtitle">
              Explore peer-reviewed literature, conference proceedings, and arXiv
              preprints. Click any inquiry to launch directly into the search engine.
            </p>
          </div>

          <div className="domain-cards-grid">
            {DOMAINS.map((domain) => (
              <div key={domain.id} className="domain-card">
                <div className="domain-card-header">
                  <span className="domain-category">{domain.badge}</span>
                  <h3 className="domain-card-name">{domain.name}</h3>
                </div>
                <p className="domain-card-desc">{domain.description}</p>
                <div className="domain-prompt-list">
                  {domain.prompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="domain-prompt-btn"
                      onClick={() => onStart(p, true)}
                    >
                      <SearchIcon size={13} className="domain-prompt-icon" />
                      <span>{p}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Architecture & Methodology ────────────────────────────────── */}
        <section
          className="landing-block"
          id="methodology"
          aria-labelledby="methodology-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="methodology-title">
              The four-stage grounded retrieval pipeline
            </h2>
            <p className="section-subtitle">
              How Recommendica prevents hallucinations and ensures verified
              bibliographic provenance at every step.
            </p>
          </div>

          <div className="pipeline-steps-grid">
            <div className="pipeline-step-card">
              <div className="step-num-badge">01</div>
              <h3 className="pipeline-step-title">Multi-Vector Query Expansion</h3>
              <p className="pipeline-step-desc">
                Your question is expanded using <strong>HyDE</strong> (Hypothetical
                Document Embeddings) and <strong>step-back prompting</strong>. This
                bridges nomenclature variations and captures differently phrased
                literature across interdisciplinary databases.
              </p>
              <div className="step-meta">
                <span>HyDE Embeddings</span>
                <span>Step-Back Prompting</span>
                <span>RAG-Fusion</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">02</div>
              <h3 className="pipeline-step-title">Autonomous Relevance Filtration</h3>
              <p className="pipeline-step-desc">
                An autonomous relevance agent scores candidate papers against the
                inquiry. Off-topic candidates are pruned. If insufficient evidence
                survives, the system automatically refines search parameters instead
                of guessing.
              </p>
              <div className="step-meta">
                <span>Zero-Hallucination Gate</span>
                <span>Autonomous Refinement</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">03</div>
              <h3 className="pipeline-step-title">Clustered Concurrent Synthesis</h3>
              <p className="pipeline-step-desc">
                Surviving literature is grouped into coherent semantic clusters and
                synthesized concurrently. Findings stream token-by-token with zero
                buffering delay, paired directly with complete bibliographic
                citations.
              </p>
              <div className="step-meta">
                <span>SSE Token Streaming</span>
                <span>Concurrent Clusters</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">04</div>
              <h3 className="pipeline-step-title">Claim-Level Verification &amp; Scoring</h3>
              <p className="pipeline-step-desc">
                Every generated assertion is decomposed into atomic claims and
                cross-examined against source text offsets. An empirical faithfulness
                score quantifies adherence to cited literature.
              </p>
              <div className="step-meta">
                <span>Atomic Claim Parsing</span>
                <span>Faithfulness Metric</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Detailed Courses Information ───────────────────────────────── */}
        <section
          className="landing-block"
          id="courses-info"
          aria-labelledby="courses-info-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="courses-info-title">
              Interactive research courses
            </h2>
            <p className="section-subtitle">
              Beyond automated search, Recommendica provides {COURSE_COUNT} free,
              self-paced courses to build research instincts—from question
              formulation and evidence synthesis to writing, publishing, and
              responsible use of AI.
            </p>
          </div>

          <div className="pipeline-steps-grid">
            {COURSE_CATALOG.map((course, index) => (
              <div className="pipeline-step-card" key={course.id}>
                <div className="step-num-badge">{String(index + 1).padStart(2, "0")}</div>
                <h3 className="pipeline-step-title">{course.title}</h3>
                <p className="pipeline-step-desc">{course.description}</p>
                <div className="step-meta">
                  <span>{course.category}</span>
                  <span>{course.lessons} lessons</span>
                  <span>~{course.minutes} min</span>
                </div>
              </div>
            ))}
          </div>

          <div className="landing-courses-action">
            <a href="#courses" className="ghost-button landing-courses-link">
              <span>Browse all courses in catalog</span>
              <ArrowRightIcon size={16} />
            </a>
          </div>
        </section>

        {/* ── Detailed LaTeX Editor Information ──────────────────────────── */}
        <section
          className="landing-block"
          id="editor-info"
          aria-labelledby="editor-info-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="editor-info-title">
              In-browser LaTeX compiler &amp; paper editor
            </h2>
            <p className="section-subtitle">
              Turn synthesized evidence into publication-ready manuscripts with
              an instant client-side LaTeX compiler, live KaTeX math typesetting,
              and native BibTeX citation management.
            </p>
          </div>

          <div className="pipeline-steps-grid">
            <div className="pipeline-step-card">
              <div className="step-num-badge">
                <FileTextIcon size={16} />
              </div>
              <h3 className="pipeline-step-title">Zero-Setup Web Worker Compiler</h3>
              <p className="pipeline-step-desc">
                Compiles LaTeX and math in milliseconds entirely in your browser using
                a background Web Worker and KaTeX. Complete privacy—no drafts sent
                to remote servers and zero TeX Live installation needed.
              </p>
              <div className="step-meta">
                <span>Client-Side</span>
                <span>KaTeX Math</span>
                <span>Zero Latency</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">
                <ZapIcon size={16} />
              </div>
              <h3 className="pipeline-step-title">Dual-Mode Writing Workflow</h3>
              <p className="pipeline-step-desc">
                Write comfortably in a distraction-free visual WYSIWYG editor with live
                math and formatted tables, or switch to a full code editor with
                syntax highlighting and instant compilation preview.
              </p>
              <div className="step-meta">
                <span>Visual WYSIWYG</span>
                <span>LaTeX Code</span>
                <span>Live Preview</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">
                <BookMarkIcon size={16} />
              </div>
              <h3 className="pipeline-step-title">Native BibTeX Management</h3>
              <p className="pipeline-step-desc">
                Paste or import <code>.bib</code> bibliography files. Citations resolve
                automatically in IEEE numeric (<code>[1]</code>) or APA author-year styles
                with active DOI links.
              </p>
              <div className="step-meta">
                <span>BibTeX Engine</span>
                <span>IEEE &amp; APA</span>
                <span>DOI Links</span>
              </div>
            </div>

            <div className="pipeline-step-card">
              <div className="step-num-badge">
                <LayersIcon size={16} />
              </div>
              <h3 className="pipeline-step-title">Preprint Templates &amp; Export</h3>
              <p className="pipeline-step-desc">
                Launch with ready-to-submit templates for arXiv preprints, NeurIPS / ICML,
                IEEEtran, REVTeX Physics, and AMS-LaTeX. Export to camera-ready PDF
                or download compilable LaTeX packages.
              </p>
              <div className="step-meta">
                <span>arXiv Templates</span>
                <span>Camera-Ready PDF</span>
                <span>.tex Zip Export</span>
              </div>
            </div>
          </div>

          <div className="landing-courses-action">
            <a href="#write" className="ghost-button landing-courses-link">
              <span>Open the paper editor</span>
              <ArrowRightIcon size={16} />
            </a>
          </div>
        </section>

        {/* ── Comparison Table ─────────────────────────────────────────── */}
        <section
          className="landing-block"
          id="comparison"
          aria-labelledby="comparison-title"
        >
          <div className="section-header">
            <h2 className="landing-section-title" id="comparison-title">
              Why grounded literature synthesis matters
            </h2>
            <p className="section-subtitle">
              How Recommendica compares to traditional academic search engines and
              generic conversational AI chatbots across discovery, methodology, and publishing.
            </p>
          </div>

          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "26%" }}>
                    Capability
                  </th>
                  <th scope="col" className="col-highlight" style={{ width: "28%" }}>
                    Recommendica
                  </th>
                  <th scope="col" style={{ width: "23%" }}>
                    Generic LLMs (ChatGPT/Claude)
                  </th>
                  <th scope="col" style={{ width: "23%" }}>
                    Keyword Search (Google Scholar)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Citation Integrity</strong>
                    <span className="td-hint">Verification of cited papers</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Direct DOI &amp; arXiv links with verified text</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <AlertTriangleIcon size={16} />
                      <span>Frequent hallucinated URLs &amp; phantom papers</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <CheckIcon size={16} />
                      <span>Raw paper links without synthesis</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Hallucination Defense</strong>
                    <span className="td-hint">Safeguard against false claims</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Pre-generation relevance gate + claim scoring</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <AlertTriangleIcon size={16} />
                      <span>Uncontrolled confabulation on specialized topics</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>N/A (No synthesis performed)</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Preprint Recency</strong>
                    <span className="td-hint">Access to latest publications</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Live arXiv API federation for emergent work</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <span>Restricted to training cutoff dates</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-positive">
                      <span>Indexed post-publication with crawl delay</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Claim Verification</strong>
                    <span className="td-hint">Quantitative faithfulness</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Empirical claim-by-claim scoring metric</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <span>No verification or evidence metrics</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Requires manual reading of all papers</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Research Courses</strong>
                    <span className="td-hint">Methodology &amp; training</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>{COURSE_COUNT} Free interactive courses with quizzes</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Unstructured conversational advice only</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <span>None</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>In-Browser LaTeX Editor</strong>
                    <span className="td-hint">Manuscript typesetting</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Instant KaTeX compiler, BibTeX &amp; PDF export</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Raw code only; requires external TeX Live</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>BibTeX export only; no editor or compiler</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Access &amp; Pricing</strong>
                    <span className="td-hint">Barriers to entry</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>100% Free forever (No card, no tiers, no paywalls)</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-negative">
                      <AlertTriangleIcon size={16} />
                      <span>Paid subscriptions ($20+/mo) for latest models</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Free index, but frequent $35+ publisher paywalls</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>Account &amp; Friction</strong>
                    <span className="td-hint">Sign-up requirements</span>
                  </td>
                  <td className="col-highlight">
                    <div className="comp-cell-val val-positive">
                      <CheckIcon size={16} />
                      <span>Zero sign-up (No email, password, or login)</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Mandatory account and phone or email verification</span>
                    </div>
                  </td>
                  <td>
                    <div className="comp-cell-val val-neutral">
                      <span>Account required for alerts and citation library</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Frequently Asked Questions ─────────────────────────────────── */}
        <section className="landing-block" id="faq" aria-labelledby="faq-heading">
          <div className="section-header">
            <h2 className="landing-section-title" id="faq-heading">
              Technical details &amp; researcher guidelines
            </h2>
          </div>

          <div className="faq-accordion-group">
            {FAQS.map((faq) => (
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

        {/* ── Closing Call to Action ────────────────────────────────────── */}
        <section className="landing-closer">
          <div className="landing-closer-badge">
            <SparklesIcon size={14} />
            <span>100% Free · No Sign-Up Needed</span>
          </div>
          <h2 className="landing-closer-title">Begin your literature search — 100% Free</h2>
          <p className="landing-closer-text">
            Enter an academic question or select an interdisciplinary topic to
            generate grounded, cited research recommendations. Everything is completely free with zero accounts, subscriptions, or paywalls.
          </p>
          <div className="landing-closer-actions">
            <button
              type="button"
              className="primary-button landing-closer-btn"
              onClick={() => onStart()}
            >
              <span>Launch Search Console</span>
              <ArrowRightIcon size={18} />
            </button>
            <a href="#courses" className="ghost-button landing-closer-btn">
              <GraduationCapIcon size={18} />
              <span>Explore Courses</span>
            </a>
            <a href="#write" className="ghost-button landing-closer-btn">
              <FileTextIcon size={18} />
              <span>Open Paper Editor</span>
            </a>
          </div>
          <div className="landing-closer-perks">
            <span><CheckIcon size={13} /> $0 Cost Forever</span>
            <span><CheckIcon size={13} /> No Sign-Up Required</span>
            <span><CheckIcon size={13} /> Unlimited Searches</span>
            <span><CheckIcon size={13} /> In-Browser LaTeX Studio</span>
          </div>
        </section>
      </main>

      {/* ── Scholarly Footer ───────────────────────────────────────────── */}
      <footer className="landing-foot">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="wordmark">
              <BookMarkIcon size={24} className="wordmark-mark" />
              <span className="wordmark-text">Recommendica</span>
            </div>
            <p className="footer-tagline">
              Grounded research paper recommendations powered by relevance-graded
              retrieval-augmented generation, complemented by interactive research courses
              and an in-browser LaTeX paper editor.
            </p>
          </div>

          <div className="footer-notes">
            <p>
              <strong>Academic Integrity Notice:</strong> Synthesized findings are
              generated strictly from retrieved literature and scored for
              faithfulness. Researchers should inspect and cite the original
              source publications directly.
            </p>
            <p className="footer-subtext">
              Federated with arXiv preprint retrieval and indexed scientific corpora ({paperCount.toLocaleString()} indexed papers).
              100% free and open research access. · <a href="#privacy" style={{ color: "var(--accent)", textDecoration: "underline" }}>Privacy Policy</a> · <a href="#terms" style={{ color: "var(--accent)", textDecoration: "underline" }}>Terms of Service</a>
            </p>
            <p className="footer-subtext" style={{ marginTop: "4px" }}>
              This project is under nevatal.id for educational purposes.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
