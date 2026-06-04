import { FormEvent, useState } from 'react'
import './App.css'

type ResearchResult = {
  title: string
  category: string
  summary: string
  authors: string
}

type ApiResponse = {
  status?: number
  message?: string
  data?: {
    response?: string
    research_results?: ResearchResult[]
  }
  error?: string
}

function App() {
  const [prompt, setPrompt] = useState(
    'What are the most relevant papers on climate change and public health?',
  )
  const [summary, setSummary] = useState(
    'Ask the model for a short recommendation summary and a ranked paper list.',
  )
  const [results, setResults] = useState<ResearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState('')
  const statusLabel =
    status === 'loading'
      ? 'Searching'
      : status === 'error'
        ? 'Error'
        : status === 'success'
          ? 'Ready'
          : 'Ready'

  const samplePrompts = [
    'What papers explain the impact of AI on healthcare?',
    'Show research on renewable energy adoption in cities.',
    'Find papers about machine learning for medical diagnosis.',
  ]

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      setError('Enter a research question to continue.')
      setStatus('error')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const response = await fetch('/api/v1/prompt/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input_prompt: trimmedPrompt }),
      })

      const payload = (await response.json()) as ApiResponse

      if (!response.ok) {
        throw new Error(payload.error || 'The recommendation request failed.')
      }

      setSummary(payload.data?.response ?? 'No summary was returned.')
      setResults(payload.data?.research_results ?? [])
      setStatus('success')
    } catch (requestError) {
      setStatus('error')
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The recommendation request failed.',
      )
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Recommendica</p>
          <h1>Research recommendations with a calm white interface.</h1>
        </div>
        <div className="status-chip">
          <span className={`status-dot ${status}`} />
          <span>{statusLabel}</span>
        </div>
      </header>

      <main className="layout">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="section-label">Find better sources faster</p>
            <p className="hero-text">
              Ask for papers by topic, get a concise answer, and scan ranked
              research results without fighting the interface.
            </p>
            <div className="hero-metrics" aria-label="Product highlights">
              <div>
                <strong>5</strong>
                <span>top matches</span>
              </div>
              <div>
                <strong>1</strong>
                <span>clear prompt</span>
              </div>
              <div>
                <strong>0</strong>
                <span>visual clutter</span>
              </div>
            </div>
          </div>

          <form className="query-panel" onSubmit={runSearch}>
            <label className="input-label" htmlFor="research-prompt">
              Research prompt
            </label>
            <textarea
              id="research-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Enter a research question"
            />

            <div className="sample-row" aria-label="Sample prompts">
              {samplePrompts.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="sample-pill"
                  onClick={() => setPrompt(sample)}
                >
                  {sample}
                </button>
              ))}
            </div>

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={status === 'loading'}>
                {status === 'loading' ? 'Searching...' : 'Generate recommendations'}
              </button>
              <p className="helper-copy">
                Backend: <code>/api/v1/prompt/</code>
              </p>
            </div>

            {error ? <p className="error-banner">{error}</p> : null}
          </form>
        </section>

        <section className="content-grid">
          <article className="summary-card">
            <div className="card-header">
              <p className="section-label">AI summary</p>
              <span className="card-badge">{results.length} results</span>
            </div>
            <p className="summary-text">{summary}</p>
          </article>

          <article className="results-card">
            <div className="card-header">
              <p className="section-label">Recommended papers</p>
              <span className="card-badge">Ranked list</span>
            </div>

            <div className="results-list">
              {results.length > 0 ? (
                results.map((result, index) => (
                  <article className="result-item" key={`${result.title}-${index}`}>
                    <div className="result-index">{index + 1}</div>
                    <div className="result-body">
                      <div className="result-title-row">
                        <h2>{result.title}</h2>
                        <span>{result.category}</span>
                      </div>
                      <p>{result.summary}</p>
                      <div className="result-meta">{result.authors}</div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <p>No recommendations yet.</p>
                  <span>Run a query to populate the result list.</span>
                </div>
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
