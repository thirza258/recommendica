import type { ReactNode } from "react";
import { BookMarkIcon } from "../components/Icons";
import { Icon } from "./icons";
import { WRITE_HOME_HREF } from "./routes.ts";
import { SAVE_LABEL } from "./useAutosave.ts";
import type { SaveState } from "./useAutosave.ts";
import type { DocumentKind } from "./documents.ts";

interface WorkspaceHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  kind: DocumentKind;
  saveState: SaveState;
  persistent: boolean;
  menubar?: ReactNode;
  actions: ReactNode;
}

/** Document title, save status and the editor's primary actions, as in Docs. */
export default function WorkspaceHeader({ title, onTitleChange, kind, saveState, persistent, menubar, actions }: WorkspaceHeaderProps) {
  const status = persistent ? SAVE_LABEL[saveState] : "Not saved — browser storage is unavailable";
  return (
    <header className="write-header">
      <a className="write-header-logo" href={WRITE_HOME_HREF} aria-label="All papers" title="All papers">
        <BookMarkIcon size={26} />
      </a>
      <div className="write-header-main">
        <div className="write-title-row">
          <input
            className="write-title-input"
            aria-label="Paper title"
            value={title}
            size={Math.min(Math.max(title.length, 8), 60)}
            maxLength={200}
            onChange={(event) => onTitleChange(event.target.value)}
            onBlur={(event) => {
              if (!event.target.value.trim()) onTitleChange("Untitled paper");
            }}
          />
          <span className={`write-kind write-kind--${kind}`}>{kind === "latex" ? "LaTeX" : "Visual"}</span>
          <span
            className={`write-save-state${saveState === "error" || !persistent ? " write-save-state--error" : ""}`}
            role={saveState === "error" ? "alert" : undefined}
          >
            {saveState === "saved" && persistent ? <Icon name="check" size={14} /> : null}
            {status}
          </span>
        </div>
        {menubar}
      </div>
      <div className="write-header-actions">{actions}</div>
    </header>
  );
}
