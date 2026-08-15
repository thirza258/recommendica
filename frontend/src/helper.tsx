import { useId, useState } from 'react'
import { ClaimVerdict, Document, ResearchInfo } from './interface'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  CrossIcon,
  MinusIcon,
} from './components/Icons'

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

/**
 * Faithfulness readout. The tier is carried by an icon as well as colour, so
 * the reading survives greyscale and colour-vision deficiency.
 */
function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  const tier =
    score == null ? 'muted' : score >= 0.7 ? 'high' : score >= 0.4 ? 'mid' : 'low'

  const Icon =
    tier === 'high'
      ? CheckIcon
      : tier === 'mid'
        ? AlertCircleIcon
        : tier === 'low'
          ? AlertTriangleIcon
          : MinusIcon

  return (
    <span className={`score-badge score-${tier}`}>
      <Icon size={14} />
      <span className="score-badge-label">{label}</span>
      <span>{pct(score)}</span>
    </span>
  )
}

function ClaimList({ claims }: { claims: ClaimVerdict[] }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (!claims.length) return null

  const supported = claims.filter((c) => c.supported).length

  return (
    <div className="claims-block">
      <button
        type="button"
        className="claims-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon size={16} className="claims-chevron" />
        {supported} of {claims.length} claim{claims.length !== 1 ? 's' : ''} supported
        by the sources
      </button>
      {open && (
        <ul className="claims-list" id={listId}>
          {claims.map((c, i) => (
            <li key={i} className={`claim-item ${c.supported ? 'supported' : 'unsupported'}`}>
              <span className="claim-verdict">
                {c.supported ? <CheckIcon size={15} /> : <CrossIcon size={15} />}
              </span>
              <span>
                <span className="visually-hidden">
                  {c.supported ? 'Supported: ' : 'Not supported: '}
                </span>
                {c.claim}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { parseDoc, ScoreBadge, ClaimList, pct }
