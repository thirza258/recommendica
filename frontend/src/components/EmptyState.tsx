import { SearchIcon } from "./Icons";

/**
 * Idle state. Rather than a hollow "AI summary" card, it explains what the
 * pipeline will do — so the wait that follows the first search is expected
 * rather than unexplained.
 */
function EmptyState() {
  return (
    <section className="empty-panel">
      <div className="empty-icon">
        <SearchIcon size={24} />
      </div>
      <h2 className="empty-title">No recommendations yet</h2>
      <p className="empty-body">
        Ask a research question above. Answers appear here as they are
        generated, each one paired with the papers it was drawn from.
      </p>

      <ol className="empty-steps">
        <li>
          <strong>Retrieve</strong>
          Relevant papers are pulled from the corpus and graded for relevance.
        </li>
        <li>
          <strong>Generate</strong>
          Each group of papers produces an answer, streamed token by token.
        </li>
        <li>
          <strong>Verify</strong>
          Every claim is checked against the sources and scored for
          faithfulness.
        </li>
      </ol>
    </section>
  );
}

export default EmptyState;
