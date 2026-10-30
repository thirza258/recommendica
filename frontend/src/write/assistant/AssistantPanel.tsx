import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ToolButton } from "../ui";
import { streamAssistant } from "./chatClient.ts";
import type { AssistantHistoryTurn } from "./chatClient.ts";
import { extractLatexBlock } from "./editBlock.ts";

interface AssistantPanelProps {
  paperTitle: string;
  /** Current document text, read at send time so unsaved edits are included. */
  documentText: () => string;
  onApplyEdit: (latex: string) => void;
  onClose: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  stopped?: boolean;
  error?: string;
  applied?: boolean;
}

/**
 * The model rewrites the whole document on edits, so what we send has to fit
 * its context alongside the answer. Just under the server's 60k cap.
 */
const MAX_DOC_CHARS = 58000;

function truncateDocument(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOC_CHARS) return { text, truncated: false };
  const cut = text.lastIndexOf("\n\n", MAX_DOC_CHARS);
  const sliced = (cut > 0 ? text.slice(0, cut) : text.slice(0, MAX_DOC_CHARS)) +
    "\n\n% [The rest of the paper was left out to fit the assistant's context.]";
  return { text: sliced, truncated: true };
}

/** Everything before the opening fence: the prose reply. */
function proseOf(content: string): string {
  const fence = content.indexOf("```");
  return (fence === -1 ? content : content.slice(0, fence)).trim();
}

export default function AssistantPanel({ paperTitle, documentText, onApplyEdit, onClose }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (patch: Partial<ChatMessage>) => {
    setMessages((previous) => {
      const next = [...previous];
      const last = next.length - 1;
      if (last >= 0 && next[last].role === "assistant") {
        next[last] = { ...next[last], ...patch };
      }
      return next;
    });
  };

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    const { text: docText, truncated: wasTruncated } = truncateDocument(documentText());
    const history: AssistantHistoryTurn[] = messages
      .filter((message) => !message.error)
      .map((message) => ({ role: message.role, content: message.content }));

    setMessages((previous) => [...previous, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setTruncated(wasTruncated);

    let accumulated = "";
    try {
      await streamAssistant(
        { question, document_title: paperTitle, document_text: docText, history },
        (event) => {
          if (event.type === "token") {
            accumulated += event.text;
            patchLast({ content: accumulated });
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        patchLast({ stopped: true });
      } else {
        patchLast({ error: error instanceof Error ? error.message : "The assistant request failed." });
      }
    } finally {
      setBusy(false);
    }
  };

  const stop = () => abort.current?.abort();

  const apply = (index: number) => {
    const message = messages[index];
    const block = extractLatexBlock(message.content);
    if (!block) return;
    onApplyEdit(block);
    setMessages((previous) => previous.map((item, i) => (i === index ? { ...item, applied: true } : item)));
  };

  return (
    <aside className="write-panel write-panel--right write-assistant" aria-label="AI assistant">
      <div className="write-panel-head">
        <h2>
          <Icon name="sparkles" size={15} /> AI assistant
        </h2>
        <ToolButton icon="close" label="Close assistant" onClick={onClose} />
      </div>
      <div className="write-panel-body write-assistant-body" ref={bodyRef}>
        {messages.length === 0 && (
          <p className="write-empty write-assistant-intro">
            Ask about this paper, or describe a change — “Shorten the abstract”, “Add a limitations paragraph”. Proposed edits are shown
            for review before anything in the paper is replaced.
          </p>
        )}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <p key={index} className="write-assistant-msg write-assistant-msg--user">
              {message.content}
            </p>
          ) : (
            <div key={index} className="write-assistant-msg write-assistant-msg--assistant">
              {proseOf(message.content) && <p>{proseOf(message.content)}</p>}
              {message.stopped && !message.content && <p className="write-hint">Stopped before the assistant replied.</p>}
              {busy && index === messages.length - 1 && !message.content && <p className="write-hint">Thinking…</p>}
              {(() => {
                const block = extractLatexBlock(message.content);
                if (!block) {
                  return message.error ? (
                    <p className="write-error" role="alert">
                      {message.error}
                    </p>
                  ) : null;
                }
                return (
                  <div className="write-assistant-proposal">
                    <span>Revised document ready.</span>
                    {message.applied ? (
                      <span className="write-hint">
                        <Icon name="check" size={13} /> Applied to the document.
                      </span>
                    ) : (
                      <button type="button" className="primary-button" disabled={busy} onClick={() => apply(index)}>
                        Apply to document
                      </button>
                    )}
                  </div>
                );
              })()}
              {message.stopped && message.content && <p className="write-hint">Stopped.</p>}
            </div>
          ),
        )}
        {truncated && (
          <p className="write-hint">The paper is long, so the assistant saw only the first ~58k characters.</p>
        )}
      </div>
      <form
        className="write-assistant-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={2}
          value={draft}
          placeholder="Ask about this paper…"
          aria-label="Message the assistant"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="ghost-button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary-button" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </aside>
  );
}
