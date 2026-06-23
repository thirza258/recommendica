import { useState } from 'react'
import './App.css'
import {ClaimVerdict, Document, ResearchInfo } from './interface'

function parseDoc(doc: Document): ResearchInfo | null {
  try {
    const obj = JSON.parse(doc.document) as ResearchInfo
    if (obj?.title) return obj
  } catch {
    // document may be plain text rather than JSON
  }
  return {
    title: doc.document.slice(0, 120),
    category: doc.meta?.categories as string ?? '',
    summary: doc.document.slice(0, 300),
    authors: doc.meta?.authors_parsed as string ?? '',
  }
}

/** Format a 0-1 score as a percentage string. */
function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${Math.round(n * 100)}%`
}

// ── components ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  const cls = score == null ? 'score-muted' : score >= 0.7 ? 'score-high' : score >= 0.4 ? 'score-mid' : 'score-low'
  return (
    <span className={`score-badge ${cls}`} title={label}>
      {label}: {pct(score)}
    </span>
  )
}

function ClaimList({ claims }: { claims: ClaimVerdict[] }) {
  const [open, setOpen] = useState(false)
  if (!claims.length) return null

  return (
    <div className="claims-block">
      <button className="claims-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {claims.length} claim{claims.length !== 1 ? 's' : ''} verified
      </button>
      {open && (
        <ul className="claims-list">
          {claims.map((c, i) => (
            <li key={i} className={`claim-item ${c.supported ? 'supported' : 'unsupported'}`}>
              <span className="claim-verdict">{c.supported ? '✓' : '✗'}</span>
              <span>{c.claim}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { parseDoc, ScoreBadge, ClaimList, pct }