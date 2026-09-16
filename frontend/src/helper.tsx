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
    if (obj?.title) {
      return {
        title: obj.title,
        category: obj.category || (doc.meta?.categories as string) || (doc.meta?.category as string) || '',
        summary: obj.summary || (doc.meta?.abstract as string) || '',
        authors: obj.authors || (doc.meta?.authors as string) || '',
      }
    }
  } catch {
    // document may be plain text rather than JSON
  }

  const meta = doc.meta || {}
  let title = (meta.title as string) || ''
  let summary = (meta.abstract as string) || (meta.summary as string) || ''
  const category = (meta.categories as string) || (meta.category as string) || ''
  let authors = (meta.authors as string) || ''

  if (!authors && meta.authors_parsed) {
    try {
      const parsed = typeof meta.authors_parsed === 'string' ? JSON.parse(meta.authors_parsed) : meta.authors_parsed
      if (Array.isArray(parsed)) {
        authors = parsed
          .map((a: unknown) => (Array.isArray(a) ? a.filter(Boolean).reverse().join(' ') : String(a)))
          .join(', ')
      }
    } catch {
      authors = String(meta.authors_parsed)
    }
  }

  const docText = doc.document || ''
  if (!title && docText.startsWith('Title:')) {
    const parts = docText.split('\n\nAbstract:', 2)
    title = parts[0].replace(/^Title:\s*/, '').trim()
    if (!summary && parts.length > 1) {
      summary = parts[1].trim()
    }
  }

  if (!title) {
    title = docText.slice(0, 120)
  }
  if (!summary) {
    summary = docText.slice(0, 300)
  }

  return {
    title,
    category,
    summary,
    authors,
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
              <div>
                <span className="visually-hidden">
                  {c.supported ? 'Supported: ' : 'Not supported: '}
                </span>
                {c.claim}
                {c.evidence?.map((evidence, index) => (
                  <blockquote className="claim-evidence" key={index}>
                    <span>Source [{evidence.source_id}]</span>
                    <q>{evidence.quote}</q>
                  </blockquote>
                ))}
                {!c.supported && c.reason && <small>{c.reason}</small>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { parseDoc, ScoreBadge, ClaimList, pct }
