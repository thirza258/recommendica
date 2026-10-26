/**
 * Renders LaTeX off the main thread, so typing in the source editor never
 * waits for parsing, KaTeX or bibliography formatting. The KaTeX cache lives
 * here for the life of the worker and is shared by every render.
 */

import { renderLatex } from "./render.ts";
import type { RenderOptions } from "./render.ts";

interface RenderRequest {
  id: number;
  source: string;
  options: RenderOptions;
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, source, options } = event.data;
  try {
    self.postMessage({ id, result: renderLatex(source, options) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
