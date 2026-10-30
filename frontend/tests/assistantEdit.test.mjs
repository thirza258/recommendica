import assert from "node:assert/strict";
import test from "node:test";
import { extractLatexBlock } from "../src/write/assistant/editBlock.ts";

test("extracts a latex-tagged fenced block", () => {
  const text = 'Shortened the abstract.\n\n```latex\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n```\n';
  assert.equal(extractLatexBlock(text), "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}");
});

test("accepts tex tags and bare fences", () => {
  const tex = "Rewrote it.\n```tex\nA\n```\ndone";
  assert.equal(extractLatexBlock(tex), "A");

  const bare = "Here you go:\n```\nB\n```";
  assert.equal(extractLatexBlock(bare), "B");
});

test("returns null while the closing fence has not arrived", () => {
  const partial = "Working on it…\n```latex\n\\documentclass{article}\n";
  assert.equal(extractLatexBlock(partial), null);
  assert.equal(extractLatexBlock("no fences at all"), null);
  assert.equal(extractLatexBlock(""), null);
});

test("returns the last complete block when several are present", () => {
  const text = [
    "```latex",
    "FIRST",
    "```",
    "mid text",
    "```latex",
    "SECOND",
    "```",
  ].join("\n");
  assert.equal(extractLatexBlock(text), "SECOND");
});

test("normalizes CRLF and trims surrounding whitespace", () => {
  const text = "```latex\r\nA\r\nB\r\n```\r\n";
  assert.equal(extractLatexBlock(text), "A\nB");
});
