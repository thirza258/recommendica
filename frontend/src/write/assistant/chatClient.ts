/**
 * Client for the paper assistant endpoint (POST /api/v1/assistant/).
 *
 * Server-Sent Events with the same frame shape as the search stream:
 * {"type":"token","text"} until a terminal {"type":"complete"} or
 * {"type":"error","message"}.
 */

import { readSearchStream } from "../../searchStream.ts";

export interface AssistantHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRequestBody {
  question: string;
  document_title?: string;
  document_text: string;
  history: AssistantHistoryTurn[];
}

export type AssistantStreamEvent =
  | { type: "token"; text: string }
  | { type: "complete" }
  | { type: "error"; message: string };

export async function streamAssistant(
  body: AssistantRequestBody,
  onEvent: (event: AssistantStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/v1/assistant/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let message = "The assistant could not be reached. Please try again.";
    try {
      const data = await response.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // Non-JSON error body; keep the default message.
    }
    throw new Error(message);
  }

  await readSearchStream<AssistantStreamEvent>(response, onEvent);
}
