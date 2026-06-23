function TopBar({ status }: { status: "idle" | "loading" | "success" | "error" }) {
  const statusLabel =
    status === "loading"
      ? "Searching"
      : status === "error"
        ? "Error"
        : status === "success"
          ? "Ready"
          : "Ready";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Recommendica</p>
        <h1>Research recommendations, grounded in papers.</h1>
      </div>
      <div className="status-chip">
        <span className={`status-dot ${status}`} />
        <span>{statusLabel}</span>
      </div>
    </header>
  );
}

export default TopBar;