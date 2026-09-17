import assert from "node:assert/strict";
import test from "node:test";
import { readSearchStream } from "../src/searchStream.ts";

const complete = { type: "complete", total_docs_retrieved: 0, num_chunks: 0 };
const encoder = new TextEncoder();

function responseFor(text, byteLength = 1) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += byteLength) controller.enqueue(bytes.slice(i, i + byteLength));
      controller.close();
    },
  }));
}

test("SSE survives split UTF-8, CRLF, multiline data and heartbeats", async () => {
  const events = [];
  await readSearchStream(responseFor(': keepalive\r\n\r\ndata:{"type":"chunk_token",\r\ndata: "chunk_index":2,"token":"研究 café"}\r\n\r\ndata: ' + JSON.stringify(complete) + '\r\n\r\n'), event => events.push(event));
  assert.equal(events[0].token, "研究 café");
  assert.deepEqual(events[1], complete);
});

test("deep chunks and evaluations can arrive independently", async () => {
  const input = [
    { type: "chunk_start", chunk_index: 2, num_docs_in_chunk: 1 },
    { type: "chunk_end", chunk_index: 2, docs: [], generated_response: "answer" },
    { type: "chunk_token", chunk_index: 1, token: "another answer" },
    { type: "chunk_evaluation", chunk_index: 2, evaluation: { faithfulness_score: 1 } },
    complete,
  ];
  const events = [];
  await readSearchStream(responseFor(input.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), 7), e => events.push(e));
  assert.deepEqual(events, input);
});

test("a deep review carries the replacement answer and its evidence intact", async () => {
  const revised = {
    type: "chunk_evaluation", chunk_index: 1,
    generated_response: "The trial reported 20% improvement in adults [1].",
    answer_review: { status: "checked", revised: true, checks: 2 },
    evaluation: { faithfulness_score: 1, claims: [{
      claim: "The trial reported 20% improvement in adults [1].", verdict: "YES", supported: true,
      evidence: [{ source_id: 1, quote: "The trial reported 20% improvement in adults." }],
    }] },
  };
  const events = [];
  await readSearchStream(responseFor(`data: ${JSON.stringify(revised)}\n\ndata: ${JSON.stringify(complete)}\n\n`, 3), e => events.push(e));
  assert.deepEqual(events[0], revised);
});

test("a dropped stream reports an error instead of leaving loading stuck", async () => {
  await assert.rejects(readSearchStream(responseFor('data: {"type":"progress","message":"Searching"}\n\n'), () => {}), /ended before the search finished/);
});

test("malformed events are surfaced", async () => {
  await assert.rejects(readSearchStream(responseFor('data: invalid\n\n'), () => {}), /unreadable/);
});

test("completion without a trailing separator is handled", async () => {
  const events = [];
  await readSearchStream(responseFor('data: ' + JSON.stringify(complete)), e => events.push(e));
  assert.deepEqual(events, [complete]);
});

test("terminal events close the connection even if the server keeps it open", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: {"type":"error","message":"offline"}\n\n')); },
    cancel() { cancelled = true; },
  }));
  const events = [];
  await readSearchStream(response, e => events.push(e));
  assert.equal(events[0].message, "offline");
  assert.equal(cancelled, true);
});
