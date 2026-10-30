/**
 * Extract a complete fenced LaTeX block from streamed assistant text.
 *
 * The assistant's edit protocol is: one short sentence, then the COMPLETE
 * revised document in a fenced code block (```latex, ```tex, or a bare
 * fence). While tokens are still arriving the closing fence is missing, so
 * nothing is returned until the block is whole — apply buttons must only
 * appear for complete documents.
 */

const FENCE = /```(?:latex|tex)?[ \t]*\r?\n([\s\S]*?)```/g;

/** The last complete fenced LaTeX block, or null while there is none. */
export function extractLatexBlock(text: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(text)) !== null) {
    last = match[1];
  }
  return last === null ? null : last.replace(/\r\n/g, "\n").trim();
}
