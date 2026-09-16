import { BookMarkIcon, HeartIcon } from "./Icons";
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
  onSearch?: () => void;
  isLearning?: boolean;
  /** Omitted when the server reports donations as unconfigured. */
  onDonate?: () => void;
}

/**
 * Slim application bar: identity on the left, pipeline state on the right.
 * Deliberately not a live region — the progress banner announces changes, and
 * two live regions would double up on screen readers.
 */
function TopBar({ status, onHome, onSearch, isLearning, onDonate }: TopBarProps) {
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
      </button>

      <div className="topbar-actions">
        <a
          href="#courses"
          className="ghost-button topbar-courses-link"
          aria-current={isLearning ? "page" : undefined}
        >
          Courses
        </a>
        {onSearch && (
          <button type="button" className="ghost-button" onClick={onSearch}>
            Search papers
          </button>
        )}
        {onHome && (
          <button type="button" className="ghost-button topbar-home-btn" onClick={onHome}>
            Overview &amp; Topics
          </button>
        )}
        {onDonate && (
          <button
            type="button"
            className="ghost-button topbar-donate-btn"
            onClick={onDonate}
          >
            <HeartIcon size={16} />
            <span>Donate</span>
          </button>
        )}
        {!isLearning && (
          <div className="status-chip">
            <span className={`status-dot ${status}`} />
            <span>{STATUS_LABEL[status]}</span>
          </div>
        )}
      </div>
    </header>
  );
}

export default TopBar;
