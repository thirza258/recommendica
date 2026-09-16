// ── Domain types ────────────────────────────────────────────────────────────

/** Lifecycle of a single search request, shared by every UI surface. */
type Status = 'idle' | 'loading' | 'success' | 'error'
type SearchMode = 'adaptive' | 'fast' | 'deep'

type ResearchPlan = {
  strategy: 'focused' | 'expanded'
  reason: string
  steps: string[]
  escalated: boolean
}

type ResearchInfo = {
  title: string
  category: string
  summary: string
  authors: string
}

type Document = {
  document: string // JSON-serialised ResearchInfo
  meta: Record<string, unknown>
}

type ClaimVerdict = {
  claim: string
  verdict: 'YES' | 'NO' | 'PARTIALLY' | 'UNKNOWN'
  supported: boolean
  reason?: string
  evidence?: { source_id: number; quote: string }[]
}

type AnswerReview = {
  status: 'checking' | 'rechecking' | 'revising' | 'checked' | 'limited' | 'withheld' | 'unverified'
  revised?: boolean
  checks?: number
  issues?: string[]
  limitations?: string[]
}

type AnswerReviewSummary = { checked: number; revised: number; limited: number; withheld: number }

type ChunkEval = {
  faithfulness_score: number | null
  total_claims?: number
  supported_claims?: number
  claims?: ClaimVerdict[]
  reason?: string
  error?: string
}

type ChunkResponse = {
  chunk_index: number
  num_docs_in_chunk: number
  docs: Document[]
  generated_response: string
  evaluation?: ChunkEval
  answer_review?: AnswerReview
  error?: string
  complete?: boolean
}

// ── API response (non-streaming, kept for backward compat) ─────────────────

type ApiResponse = {
  mode?: SearchMode
  research_plan?: ResearchPlan
  answer_review?: AnswerReviewSummary
  status?: number
  message?: string
  query?: string
  total_docs_retrieved?: number
  num_chunks?: number
  chunk_size?: number
  aggregate_faithfulness?: number
  data?: ChunkResponse[]
  error?: string
}

// ── SSE streaming event types ──────────────────────────────────────────────

/** Pre-flight verdict on the query, before the pipeline spends anything. */
type QueryCheck = {
  ok: boolean
  /** "research" | "empty" | "too_short" | "too_long" | "greeting" | ... */
  kind: string
  /** "deterministic" | "checked" | "unavailable" | "skipped" */
  status: string
  reason?: string
  suggestion?: string
  error?: string
}

/** Deterministic report on the papers an answer was built from. */
type ResultVerification = {
  docs: number
  /** Document count per origin, e.g. { collection: 4, arxiv_api: 2 }. */
  sources?: Record<string, number>
  min_relevant?: number
  min_relevant_met?: boolean
  /** null when nothing carried a vector distance (a live-source-only answer). */
  retrieval_confidence?: number | null
  confidence_threshold?: number
  query_term_coverage?: number
  agent_outcome?: string
  graded?: boolean
  rejected?: number
  fallback_used?: boolean
  fallback_kept?: number
  /** Set when arXiv was consulted but unreachable; the collection was used alone. */
  fallback_error?: string
  warnings?: string[]
  error?: string
}

type StreamProgressEvent = {
  type: "progress"
  research_plan?: ResearchPlan
  /** "query_check" | "variants" | "collection" | "relevance" | "retrieval" | "verification" | "chunking" | "answer_review" */
  step: string
  chunk_index?: number
  /**
   * "start" | "done" for pipeline stages; the relevance agent also reports
   * "searching" | "graded" | "refining" | "empty" | "deadline" |
   * "grader_unavailable", and, for the live arXiv fallback,
   * "fallback_searching" | "fallback_graded" | "fallback_empty" |
   * "fallback_unavailable" | "fallback_ungraded".
   */
  status: string
  message: string
  count?: number
  elapsed_ms?: number
  num_chunks?: number
  /** Relevance-agent detail. */
  iteration?: number
  kept?: number
  rejected?: number
  related_total?: number
  refined_query?: string
  /** Live-fallback detail. */
  source?: string
  error?: string
  /** Attached to the "query_check" / "verification" steps respectively. */
  query_check?: QueryCheck
  verification?: ResultVerification
}

type StreamChunkStartEvent = {
  type: "chunk_start"
  chunk_index: number
  num_docs_in_chunk: number
  answer_review?: AnswerReview
}

type StreamChunkTokenEvent = {
  type: "chunk_token"
  chunk_index: number
  token: string
}

type StreamChunkEndEvent = {
  type: "chunk_end"
  chunk_index: number
  num_docs_in_chunk: number
  docs: Document[]
  generated_response: string
  error?: string
  /** Legacy evaluation; Deep analysis sends a separate chunk_evaluation event. */
  evaluation?: ChunkEval
  answer_review?: AnswerReview
}

type StreamChunkEvaluationEvent = {
  type: "chunk_evaluation"
  chunk_index: number
  evaluation: ChunkEval | null
  generated_response?: string
  answer_review?: AnswerReview
}

type StreamCompleteEvent = {
  type: "complete"
  mode?: SearchMode
  research_plan?: ResearchPlan
  answer_review?: AnswerReviewSummary
  total_docs_retrieved: number
  num_chunks: number
  chunk_size?: number
  elapsed_ms?: number
  /** Mean faithfulness across chunks; null when not evaluated. */
  aggregate_faithfulness?: number | null
  /** Set by the relevance agent, e.g. no related papers were found. */
  notice?: string
  /** "accepted" | "no_candidates" | "no_relevant" | "grader_unavailable" */
  agent_outcome?: string
  /** Present when the query was rejected before the pipeline ran. */
  query_check?: QueryCheck
  /** Present when result verification is enabled. */
  verification?: ResultVerification
}

type StreamErrorEvent = {
  type: "error"
  message: string
}

type StreamEvent =
  | StreamProgressEvent
  | StreamChunkStartEvent
  | StreamChunkTokenEvent
  | StreamChunkEndEvent
  | StreamChunkEvaluationEvent
  | StreamCompleteEvent
  | StreamErrorEvent


/**
 * Donations (Paddle).
 *
 * `GET /donate/config/` always answers 200: a deployment with no Paddle
 * credentials reports `enabled: false` rather than 404, so the UI treats a
 * missing donate button as a configuration state, not an error.
 */
interface DonationSettings {
  environment: "sandbox" | "production"
  client_token: string
  /** Default currency — the first entry of `currencies`. */
  currency: string
  currencies: string[]
  /** Suggested amounts in major units, e.g. ["5", "15", "50"]. */
  presets: string[]
  min_amount: string
  max_amount: string
}

type DonationConfigResponse =
  | ({ enabled: true } & DonationSettings)
  | { enabled: false; reason?: string }

/** Response of `POST /donate/checkout/`. */
interface DonationCheckout {
  transaction_id: string
  client_token: string
  environment: "sandbox" | "production"
  amount: string
  currency: string
  /** Only set when the Paddle account has a default payment link. */
  checkout_url: string | null
}

export type {
  Status,
  SearchMode,
  ResearchPlan,
  AnswerReview,
  ResearchInfo,
  QueryCheck,
  ResultVerification,
  Document,
  ClaimVerdict,
  ChunkEval,
  ChunkResponse,
  ApiResponse,
  StreamEvent,
  StreamProgressEvent,
  StreamChunkStartEvent,
  StreamChunkTokenEvent,
  StreamChunkEndEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  DonationSettings,
  DonationConfigResponse,
  DonationCheckout,
}
