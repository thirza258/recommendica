// ── Domain types ────────────────────────────────────────────────────────────

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

type StreamProgressEvent = {
  type: "progress"
  step: string
  status: "start" | "done"
  message: string
  count?: number
  elapsed_ms?: number
  num_chunks?: number
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
}

type StreamCompleteEvent = {
  type: "complete"
  total_docs_retrieved: number
  num_chunks: number
  chunk_size?: number
  elapsed_ms?: number
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
  ResearchInfo,
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
