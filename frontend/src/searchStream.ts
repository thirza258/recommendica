import type { StreamEvent } from "./interface";

/** Read SSE across arbitrary UTF-8/network boundaries until a terminal event. */
export async function readSearchStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This browser cannot read the search response.");
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  function dispatch(frame: string) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return; // SSE comments are heartbeats.
    let event: StreamEvent;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("The server sent an unreadable search response. Please try again.");
    }
    if (!event || typeof event.type !== "string") {
      throw new Error("The server sent an invalid search event. Please try again.");
    }
    onEvent(event);
    terminal = event.type === "complete" || event.type === "error";
  }

  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        dispatch(frame);
        if (terminal) break;
      }
      if (done) {
        if (!terminal && buffer.trim()) dispatch(buffer);
        if (!terminal) {
          throw new Error("The connection ended before the search finished. Please try again.");
        }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
