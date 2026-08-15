import { BookMarkIcon } from "./Icons";
import { Status } from "../interface";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready",
  loading: "Searching",
  success: "Ready",
  error: "Error",
};

/**
 * Slim application bar: identity on the left, pipeline state on the right.
 * Deliberately not a live region — the progress banner announces changes, and
 * two live regions would double up on screen readers.
 */
function TopBar({ status }: { status: Status }) {
  return (
    <header className="topbar">
      <div className="wordmark">
        <BookMarkIcon size={30} className="wordmark-mark" />
        <p className="wordmark-text">Recommendica</p>
      </div>

      <div className="status-chip">
        <span className={`status-dot ${status}`} />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </header>
  );
}

export default TopBar;
