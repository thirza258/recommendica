function EmptyState() {
  return (
    <section className="content-grid">
      <article className="summary-card">
        <div className="card-header">
          <p className="section-label">AI summary</p>
        </div>
        <div className="empty-state">
          <p>No recommendations yet.</p>
          <span>Run a query to populate the result list.</span>
        </div>
      </article>
    </section>
  );
}

export default EmptyState;