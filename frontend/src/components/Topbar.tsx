import { BookMarkIcon } from "./Icons";
import { Status } from "../interface";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready",
  loading: "Searching",
  success: "Ready",
  error: "Error",
};

interface TopBarProps {
  status: Status;
  onHome?: () => void;
}

/**
 * Slim application bar: identity on the left, pipeline state on the right.
 * Deliberately not a live region — the progress banner announces changes, and
 * two live regions would double up on screen readers.
 */
function TopBar({ status, onHome }: TopBarProps) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="wordmark wordmark-btn"
        onClick={onHome}
        aria-label="Recommendica Home"
      >
        <BookMarkIcon size={28} className="wordmark-mark" />
        <span className="wordmark-text">Recommendica</span>
        <span className="wordmark-badge">Search Console</span>
      </button>

      <div className="topbar-actions">
        {onHome && (
          <button type="button" className="ghost-button topbar-home-btn" onClick={onHome}>
            Overview &amp; Topics
          </button>
        )}
        <div className="status-chip">
          <span className={`status-dot ${status}`} />
          <span>{STATUS_LABEL[status]}</span>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
