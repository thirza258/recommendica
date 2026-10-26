import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Dialog } from "../ui";
import { renderLatex, renderMath } from "../latex/render.ts";
import { wrapMultiline } from "./toLatex.ts";
import { bibToText, parseNames } from "../latex/bibtex.ts";
import type { BibEntry } from "../latex/bibtex.ts";
import type { RefTarget } from "./analysis.ts";
import { FONT_LABELS, LINE_SPACINGS } from "../documents.ts";
import type { PaperSettings } from "../documents.ts";
import { shortcut } from "../keys.ts";

const PALETTE: { label: string; items: [string, string][] }[] = [
  {
    label: "Structures",
    items: [
      ["a/b", "\\frac{a}{b}"],
      ["√", "\\sqrt{x}"],
      ["xⁿ", "x^{n}"],
      ["xᵢ", "x_{i}"],
      ["∑", "\\sum_{i=1}^{n}"],
      ["∫", "\\int_{a}^{b}"],
      ["∏", "\\prod_{i=1}^{n}"],
      ["lim", "\\lim_{x \\to \\infty}"],
      ["( )", "\\left( x \\right)"],
      ["x̂", "\\hat{x}"],
      ["x̄", "\\bar{x}"],
      ["→x", "\\vec{x}"],
      ["[ ]", "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}"],
      ["{ cases", "f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}"],
      ["ℝ", "\\mathbb{R}"],
      ["E[·]", "\\mathbb{E}\\left[ X \\right]"],
    ],
  },
  {
    label: "Greek",
    items: ["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Sigma", "Phi", "Omega"].map(
      (name) => [renderGreek(name), `\\${name}`] as [string, string],
    ),
  },
  {
    label: "Relations",
    items: [
      ["≤", "\\leq"],
      ["≥", "\\geq"],
      ["≠", "\\neq"],
      ["≈", "\\approx"],
      ["≡", "\\equiv"],
      ["∝", "\\propto"],
      ["∈", "\\in"],
      ["⊂", "\\subset"],
      ["⊆", "\\subseteq"],
      ["∀", "\\forall"],
      ["∃", "\\exists"],
      ["→", "\\to"],
      ["⇒", "\\Rightarrow"],
      ["⇔", "\\Leftrightarrow"],
      ["×", "\\times"],
      ["·", "\\cdot"],
      ["±", "\\pm"],
      ["∞", "\\infty"],
      ["∂", "\\partial"],
      ["∇", "\\nabla"],
    ],
  },
];

function renderGreek(name: string): string {
  const letters: Record<string, string> = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ",
    tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Sigma: "Σ", Phi: "Φ", Omega: "Ω",
  };
  return letters[name] ?? name;
}

interface MathDialogProps {
  display: boolean;
  initialLatex: string;
  initialNumbered?: boolean;
  isNew: boolean;
  onSubmit: (latex: string, numbered: boolean) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function MathDialog({ display, initialLatex, initialNumbered = true, isNew, onSubmit, onDelete, onClose }: MathDialogProps) {
  const [latex, setLatex] = useState(initialLatex);
  const [numbered, setNumbered] = useState(initialNumbered);
  const [group, setGroup] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => (latex.trim() ? renderMath(display ? wrapMultiline(latex) : latex, display) : null), [latex, display]);

  const insertAtCaret = (snippet: string) => {
    const element = area.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${latex.slice(0, start)}${snippet}${latex.slice(end)}`;
    setLatex(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const submit = () => {
    if (!latex.trim()) return;
    onSubmit(latex.trim(), numbered);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey || (!display && !event.shiftKey))) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      title={display ? (isNew ? "Insert equation" : "Edit equation") : isNew ? "Insert inline math" : "Edit inline math"}
      onClose={onClose}
      initialFocusId="write-math-input"
      footer={
        <>
          {onDelete && (
            <button type="button" className="ghost-button write-footer-start" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={submit} disabled={!latex.trim() || Boolean(preview?.error)}>
            {isNew ? "Insert" : "Update"}
          </button>
        </>
      }
    >
      <label className="write-field">
        <span>LaTeX</span>
        <textarea
          ref={area}
          id="write-math-input"
          className="write-code"
          rows={display ? 5 : 2}
          value={latex}
          spellCheck={false}
          placeholder={display ? "E = mc^2" : "x^2 + y^2"}
          onChange={(event) => setLatex(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="write-math-preview" aria-live="polite" aria-label="Preview">
        {preview === null ? (
          <span className="write-hint">The rendered formula appears here.</span>
        ) : preview.error ? (
          <p className="write-math-error">{preview.error.replace(/^KaTeX parse error:\s*/, "")}</p>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: preview.html }} />
        )}
      </div>
      <div className="write-tabs" role="tablist" aria-label="Symbols">
        {PALETTE.map((entry, index) => (
          <button key={entry.label} type="button" role="tab" aria-selected={group === index} onClick={() => setGroup(index)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="write-palette">
        {PALETTE[group].items.map(([label, snippet]) => (
          <button key={snippet} type="button" title={snippet} onClick={() => insertAtCaret(snippet)}>
            {label}
          </button>
        ))}
      </div>
      {display && (
        <label className="write-check">
          <input type="checkbox" checked={numbered} onChange={(event) => setNumbered(event.target.checked)} /> Number this equation
        </label>
      )}
      <p className="write-hint">
        {display ? `Use & and \\\\ for multi-line alignment. ${shortcut("Mod+Enter")} to ${isNew ? "insert" : "update"}.` : "Press Enter to insert; Shift+Enter for a new line."}
      </p>
    </Dialog>
  );
}

function shortReference(entry: BibEntry): { title: string; meta: string } {
  const { names } = parseNames(entry.fields.author ?? entry.fields.editor ?? "");
  const authors = names.length ? `${bibToText(names[0].last)}${names.length > 1 ? " et al." : ""}` : "Unknown author";
  return { title: bibToText(entry.fields.title ?? entry.key), meta: `${authors}${entry.fields.year ? `, ${entry.fields.year}` : ""} · ${entry.key}` };
}

interface CitationDialogProps {
  entries: BibEntry[];
  initialKeys: string[];
  onSubmit: (keys: string[]) => void;
  onManage: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function CitationDialog({ entries, initialKeys, onSubmit, onManage, onDelete, onClose }: CitationDialogProps) {
  const [keys, setKeys] = useState<string[]>(initialKeys);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => !needle || `${entry.key} ${bibToText(entry.fields.title ?? "")} ${bibToText(entry.fields.author ?? "")} ${entry.fields.year ?? ""}`.toLowerCase().includes(needle));
  }, [entries, query]);

  const toggle = (key: string) => setKeys((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));

  return (
    <Dialog
      title={initialKeys.length ? "Edit citation" : "Insert citation"}
      onClose={onClose}
      initialFocusId="write-cite-search"
      footer={
        <>
          {onDelete && (
            <button type="button" className="ghost-button write-footer-start" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onManage}>
            Manage references
          </button>
          <button type="button" className="primary-button" disabled={!keys.length} onClick={() => onSubmit(keys)}>
            {initialKeys.length ? "Update" : `Cite ${keys.length > 1 ? `${keys.length} sources` : ""}`.trim()}
          </button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p>This paper has no references yet. Add them by DOI, arXiv id or BibTeX in the references panel, then cite them here.</p>
      ) : (
        <>
          <label className="write-field">
            <span>Search references</span>
            <input id="write-cite-search" type="search" value={query} placeholder="Author, title, year or key" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <ul className="write-pick-list">
            {visible.map((entry) => {
              const short = shortReference(entry);
              return (
                <li key={entry.key}>
                  <label>
                    <input type="checkbox" checked={keys.includes(entry.key)} onChange={() => toggle(entry.key)} />
                    <span>
                      {short.title}
                      <small>{short.meta}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}

interface CrossRefDialogProps {
  targets: RefTarget[];
  current?: string;
  onSubmit: (id: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<RefTarget["kind"], string> = { section: "Sections", figure: "Figures", table: "Tables", equation: "Equations" };

export function CrossRefDialog({ targets, current, onSubmit, onDelete, onClose }: CrossRefDialogProps) {
  const groups = (["section", "figure", "table", "equation"] as const).map((kind) => ({ kind, items: targets.filter((target) => target.kind === kind) }));
  return (
    <Dialog
      title={current ? "Change cross-reference" : "Insert cross-reference"}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button type="button" className="ghost-button write-footer-start" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p>Add a heading, figure, table or numbered equation first; then you can refer to it here and the number will stay correct.</p>
      ) : (
        groups
          .filter((group) => group.items.length)
          .map((group) => (
            <div key={group.kind}>
              <p className="write-field-label">{KIND_LABEL[group.kind]}</p>
              <ul className="write-pick-list">
                {group.items.map((target) => (
                  <li key={target.id}>
                    <button type="button" aria-current={target.id === current} onClick={() => onSubmit(target.id)}>
                      <span>
                        {target.label}
                        <small>{target.text ? (target.text.length > 90 ? `${target.text.slice(0, 90)}…` : target.text) : "Untitled"}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </Dialog>
  );
}

interface TextDialogProps {
  title: string;
  label: string;
  initial: string;
  placeholder?: string;
  submitLabel: string;
  multiline?: boolean;
  hint?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onDelete?: () => void;
  deleteLabel?: string;
  onClose: () => void;
}

/** One text field: footnotes, links, alt text. */
export function TextDialog({ title, label, initial, placeholder, submitLabel, multiline, hint, validate, onSubmit, onDelete, deleteLabel = "Delete", onClose }: TextDialogProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const submit = () => {
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(value.trim());
  };
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      initialFocusId="write-text-dialog"
      footer={
        <>
          {onDelete && (
            <button type="button" className="ghost-button write-footer-start" onClick={onDelete}>
              {deleteLabel}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="write-text-dialog-form" className="primary-button">
            {submitLabel}
          </button>
        </>
      }
    >
      <form
        id="write-text-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="write-field">
          <span>{label}</span>
          {multiline ? (
            <textarea
              id="write-text-dialog"
              rows={4}
              value={value}
              placeholder={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          ) : (
            <input id="write-text-dialog" value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} />
          )}
        </label>
        {error && <p className="write-math-error">{error}</p>}
        {hint && <p className="write-hint">{hint}</p>}
      </form>
    </Dialog>
  );
}

interface RawLatexDialogProps {
  initial: string;
  bib: string;
  isNew: boolean;
  onSubmit: (source: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function RawLatexDialog({ initial, bib, isNew, onSubmit, onDelete, onClose }: RawLatexDialogProps) {
  const [source, setSource] = useState(initial);
  const result = useMemo(() => (source.trim() ? renderLatex(source, { bibliography: bib, idPrefix: "dlg-" }) : null), [source, bib]);
  return (
    <Dialog
      title={isNew ? "Insert LaTeX block" : "Edit LaTeX block"}
      size="lg"
      onClose={onClose}
      initialFocusId="write-raw-latex"
      footer={
        <>
          {onDelete && (
            <button type="button" className="ghost-button write-footer-start" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" disabled={!source.trim()} onClick={() => onSubmit(source)}>
            {isNew ? "Insert" : "Update"}
          </button>
        </>
      }
    >
      <p>Anything the editor has no button for — an algorithm, a custom environment, a TikZ figure — can be written in LaTeX. It is exported exactly as written.</p>
      <div className="write-field-row">
        <label className="write-field">
          <span>LaTeX</span>
          <textarea id="write-raw-latex" className="write-code" rows={12} spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <div className="write-field">
          <span className="write-field-label">Preview</span>
          <div className="paper paper--indent paper--size-11 write-raw-preview" dangerouslySetInnerHTML={{ __html: result?.html ?? "" }} />
        </div>
      </div>
      {result && result.diagnostics.length > 0 && (
        <ul className="write-hint">
          {result.diagnostics.slice(0, 5).map((diagnostic, index) => (
            <li key={index}>
              Line {diagnostic.line}: {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

interface PageSetupDialogProps {
  settings: PaperSettings;
  onSubmit: (settings: PaperSettings) => void;
  onClose: () => void;
}

export function PageSetupDialog({ settings, onSubmit, onClose }: PageSetupDialogProps) {
  const [draft, setDraft] = useState(settings);
  const set = <K extends keyof PaperSettings>(key: K, value: PaperSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Dialog
      title="Page setup"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => onSubmit(draft)}>
            Apply
          </button>
        </>
      }
    >
      <div className="write-field-row">
        <label className="write-field">
          <span>Style</span>
          <select
            value={draft.theme}
            onChange={(event) => {
              const theme = event.target.value as PaperSettings["theme"];
              setDraft((current) => ({
                ...current,
                theme,
                ...(theme === "ieee" ? { columns: 2 as const, font: "times" as const, fontSize: 10 as const, lineSpacing: 1, citationStyle: "ieee" as const } : {}),
                ...(theme === "apa" ? { columns: 1 as const, font: "times" as const, fontSize: 12 as const, lineSpacing: 2, citationStyle: "apa" as const, numberedHeadings: false } : {}),
              }));
            }}
          >
            <option value="article">Article (LaTeX default)</option>
            <option value="ieee">IEEE conference</option>
            <option value="apa">APA 7</option>
          </select>
        </label>
        <label className="write-field">
          <span>Citation style</span>
          <select value={draft.citationStyle} onChange={(event) => set("citationStyle", event.target.value as PaperSettings["citationStyle"])}>
            <option value="ieee">Numbered [1] (IEEE)</option>
            <option value="apa">Author–year (APA)</option>
          </select>
        </label>
      </div>
      <div className="write-field-row">
        <label className="write-field">
          <span>Paper size</span>
          <select value={draft.paper} onChange={(event) => set("paper", event.target.value as PaperSettings["paper"])}>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">US Letter (8.5 × 11 in)</option>
          </select>
        </label>
        <label className="write-field">
          <span>Margins</span>
          <select value={draft.margins} onChange={(event) => set("margins", event.target.value as PaperSettings["margins"])}>
            <option value="narrow">Narrow (0.5 in)</option>
            <option value="normal">Normal (1 in)</option>
            <option value="wide">Wide (1.5 in)</option>
          </select>
        </label>
        <label className="write-field">
          <span>Columns</span>
          <select value={draft.columns} onChange={(event) => set("columns", Number(event.target.value) === 2 ? 2 : 1)}>
            <option value={1}>One</option>
            <option value={2}>Two</option>
          </select>
        </label>
      </div>
      <div className="write-field-row">
        <label className="write-field">
          <span>Font</span>
          <select value={draft.font} onChange={(event) => set("font", event.target.value as PaperSettings["font"])}>
            {Object.entries(FONT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="write-field">
          <span>Size</span>
          <select value={draft.fontSize} onChange={(event) => set("fontSize", Number(event.target.value) as PaperSettings["fontSize"])}>
            <option value={10}>10 pt</option>
            <option value={11}>11 pt</option>
            <option value={12}>12 pt</option>
          </select>
        </label>
        <label className="write-field">
          <span>Line spacing</span>
          <select value={draft.lineSpacing} onChange={(event) => set("lineSpacing", Number(event.target.value))}>
            {LINE_SPACINGS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? "Single" : value === 2 ? "Double" : value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="write-field-row">
        <label className="write-field">
          <span>Paragraphs</span>
          <select value={draft.paragraphStyle} onChange={(event) => set("paragraphStyle", event.target.value as PaperSettings["paragraphStyle"])}>
            <option value="indent">Indent first line (LaTeX)</option>
            <option value="spaced">Space between (block)</option>
          </select>
        </label>
        <label className="write-check" style={{ alignSelf: "end", paddingBottom: 8 }}>
          <input type="checkbox" checked={draft.numberedHeadings} onChange={(event) => set("numberedHeadings", event.target.checked)} /> Number sections
        </label>
      </div>
    </Dialog>
  );
}
