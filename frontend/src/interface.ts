// ── Domain types ────────────────────────────────────────────────────────────

/** Lifecycle of a single search request, shared by every UI surface. */
type Status = 'idle' | 'loading' | 'success' | 'error'

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
}

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
}

// ── API response (non-streaming, kept for backward compat) ─────────────────

type ApiResponse = {
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
  /** "query_check" | "variants" | "relevance" | "retrieval" | "verification" | "chunking" */
  step: string
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
  /** Present when ENABLE_ANSWER_EVALUATION is on. */
  evaluation?: ChunkEval
}

type StreamCompleteEvent = {
  type: "complete"
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
  | StreamCompleteEvent
  | StreamErrorEvent

export type {
  Status,
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
}
