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

export type { ResearchInfo, Document, ClaimVerdict, ChunkEval, ChunkResponse, ApiResponse }