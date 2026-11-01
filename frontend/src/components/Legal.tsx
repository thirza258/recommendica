import { useState, useEffect } from "react";
import TopBar from "./Topbar";
import { BookMarkIcon } from "./Icons";

export function Legal() {
  const hash = typeof window !== "undefined" ? window.location.hash || window.location.pathname : "";
  const initialTab = hash.includes("terms") ? "terms" : "privacy";
  const [activeTab, setActiveTab] = useState<"privacy" | "terms">(initialTab);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  return (
    <div className="landing-root">
      <TopBar
        status="idle"
        onHome={() => {
          if (typeof window !== "undefined") {
            window.location.hash = "home";
            window.location.pathname = "/";
          }
        }}
      />

      <main className="landing-main" style={{ maxWidth: "900px", margin: "40px auto", padding: "0 24px" }}>
        <div style={{ marginBottom: "32px", borderBottom: "1px solid var(--border-color, #e2e8f0)", paddingBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h1 style={{ fontSize: "2rem", fontWeight: "700", margin: "0 0 8px 0" }}>
                {activeTab === "privacy" ? "Privacy Policy" : "Terms of Service"}
              </h1>
              <p style={{ margin: 0, color: "var(--muted-color, #64748b)", fontSize: "0.875rem" }}>
                Recommendica Research Discovery &amp; Paper Studio · Updated November 2026
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", background: "var(--sunken-bg, #f1f5f9)", padding: "4px", borderRadius: "8px" }}>
              <button
                type="button"
                onClick={() => setActiveTab("privacy")}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: "600",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                  background: activeTab === "privacy" ? "var(--primary-color, #0f172a)" : "transparent",
                  color: activeTab === "privacy" ? "#ffffff" : "var(--muted-color, #64748b)"
                }}
              >
                Privacy Policy
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("terms")}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: "600",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                  background: activeTab === "terms" ? "var(--primary-color, #0f172a)" : "transparent",
                  color: activeTab === "terms" ? "#ffffff" : "var(--muted-color, #64748b)"
                }}
              >
                Terms of Service
              </button>
            </div>
          </div>
        </div>

        {activeTab === "privacy" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px", lineHeight: "1.7", fontSize: "0.95rem" }}>
            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                1. 100% Self-Hosted &amp; Private Scholarly Environment
              </h2>
              <p style={{ margin: "0 0 12px 0" }}>
                Recommendica is completely self-hosted on your institution&apos;s or personal infrastructure.
                All paper queries, literature recommendations, generated synthesis reports, and in-browser LaTeX/Visual paper drafts
                are persisted exclusively within your self-hosted PostgreSQL database and local storage.
              </p>
              <p style={{ margin: 0 }}>
                We do not track your research across third-party websites, employ advertising networks,
                or sell user research topics, reading lists, or document drafts to data aggregators.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                2. AI Synthesis &amp; OpenRouter Integration
              </h2>
              <p style={{ margin: "0 0 12px 0" }}>
                Recommendica uses Large Language Models for query transformation (step-back prompting, multi-angle querying),
                faithfulness evaluation, answer synthesis, and the interactive writing assistant.
                Upstream model calls are dispatched via <strong>OpenRouter</strong>.
              </p>
              <p style={{ margin: "0 0 12px 0" }}>
                When performing AI-assisted discovery or editing:
              </p>
              <ul style={{ margin: "0 0 16px 0", paddingLeft: "20px" }}>
                <li>Only the query string, selected paper abstracts, and explicit author prompts are securely sent to OpenRouter.</li>
                <li>Your broader server databases, unpublished manuscript files outside the active editor context, and environment secrets remain completely private.</li>
              </ul>
              <div style={{ padding: "16px", borderRadius: "8px", background: "var(--sunken-bg, #f8fafc)", border: "1px solid var(--border-color, #e2e8f0)" }}>
                <p style={{ margin: "0 0 8px 0", fontSize: "0.8rem", fontWeight: "600", textTransform: "uppercase" }}>
                  OpenRouter Terms and Privacy Documentation
                </p>
                <div style={{ display: "flex", gap: "20px", fontSize: "0.875rem" }}>
                  <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color, #2563eb)", textDecoration: "underline" }}>
                    OpenRouter Privacy Policy ↗
                  </a>
                  <a href="https://openrouter.ai/terms" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color, #2563eb)", textDecoration: "underline" }}>
                    OpenRouter Terms of Service ↗
                  </a>
                </div>
              </div>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                3. Browser Caching &amp; Document Security
              </h2>
              <p style={{ margin: 0 }}>
                The paper editor stores local undo/redo stacks, asset caches, and auto-saved manuscript versions in your browser&apos;s
                IndexedDB and localStorage. You can clear this data at any time via your browser settings.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                4. Privacy Contact
              </h2>
              <p style={{ margin: 0 }}>
                For any data questions, privacy inquiries, or server administration assistance, please reach out to:{" "}
                <a href="mailto:nevatalapp@gmail.com" style={{ color: "var(--accent-color, #2563eb)", fontWeight: "600", textDecoration: "underline" }}>
                  nevatalapp@gmail.com
                </a>
              </p>
            </section>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px", lineHeight: "1.7", fontSize: "0.95rem" }}>
            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                1. Acceptance of Terms
              </h2>
              <p style={{ margin: 0 }}>
                By using Recommendica, you agree to these Terms of Service.
                Recommendica is an open-access platform built for scientific literature discovery, academic synthesis, and manuscript composition.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                2. Academic Integrity &amp; Citation Responsibility
              </h2>
              <p style={{ margin: "0 0 12px 0" }}>
                Recommendations, summaries, and synthesized answers generated by the platform are meant to accelerate research,
                not replace primary literature review.
              </p>
              <p style={{ margin: 0 }}>
                Researchers must independently verify claims, methodology, and citations in original peer-reviewed source publications
                before incorporating them into academic work or publications.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                3. Acceptable Use of AI Features
              </h2>
              <p style={{ margin: 0 }}>
                Users agree not to submit prompts that violate the safety standards of upstream model providers
                as specified in <a href="https://openrouter.ai/terms" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color, #2563eb)", textDecoration: "underline" }}>OpenRouter&apos;s Terms of Service</a>.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                4. Warranty Disclaimer
              </h2>
              <p style={{ margin: 0 }}>
                Recommendica is provided &ldquo;AS IS&rdquo; without warranties of completeness, accuracy, or uninterrupted service.
                Authors and contributors disclaim liability for errors in synthesized scientific text.
              </p>
            </section>

            <section style={{ padding: "24px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)", background: "var(--card-bg, #ffffff)" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginTop: 0, marginBottom: "12px" }}>
                5. Terms Inquiries
              </h2>
              <p style={{ margin: 0 }}>
                For terms inquiries or copyright questions, contact:{" "}
                <a href="mailto:nevatalapp@gmail.com" style={{ color: "var(--accent-color, #2563eb)", fontWeight: "600", textDecoration: "underline" }}>
                  nevatalapp@gmail.com
                </a>
              </p>
            </section>
          </div>
        )}
      </main>

      <footer className="landing-foot" style={{ marginTop: "40px" }}>
        <div className="footer-content">
          <div className="footer-brand">
            <div className="wordmark">
              <BookMarkIcon size={24} className="wordmark-mark" />
              <span className="wordmark-text">Recommendica</span>
            </div>
            <p className="footer-tagline">
              Self-Hosted Grounded Scientific Literature Discovery · Privacy &amp; Terms
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Legal;
