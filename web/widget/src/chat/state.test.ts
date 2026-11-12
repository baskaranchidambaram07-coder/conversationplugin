import type { StreamEvent } from "@ucp/protocol/v1";
import { expect, test } from "vitest";

import { apply, pending } from "./state";

const envelope = { v: 1, conversation_id: "c_1", message_id: "m_1", correlation_id: "r_1" } as const;
const started = (seq: number) => ({ ...envelope, seq, type: "message.started" }) as StreamEvent;
const open = (seq: number, index = 0) =>
  ({ ...envelope, seq, type: "content_block.started", index, block: { type: "markdown", text: "" } }) as StreamEvent;
const delta = (seq: number, text: string, index = 0) =>
  ({ ...envelope, seq, type: "content_block.delta", index, text }) as StreamEvent;
const done = (seq: number, text: string, index = 0) =>
  ({ ...envelope, seq, type: "content_block.completed", index, block: { type: "markdown", text } }) as StreamEvent;
const completed = (seq: number) => ({ ...envelope, seq, type: "message.completed" }) as StreamEvent;
const failed = (seq: number) =>
  ({
    ...envelope,
    seq,
    type: "message.failed",
    error: { code: "assistant_unavailable", message: "Try again.", retryable: true, retry_after: null, reference: "r_1" },
  }) as StreamEvent;

const run = (events: StreamEvent[]) => events.reduce(apply, pending());

test("a normal stream builds the answer and completes it", () => {
  const answer = run([started(0), open(1), delta(2, "Open "), delta(3, "10:00"), done(4, "Open 10:00"), completed(5)]);

  expect(answer).toMatchObject({ id: "m_1", status: "complete", gap: false, reference: "r_1" });
  expect(answer.blocks).toEqual([{ type: "markdown", text: "Open 10:00" }]);
});

test("a repeated event changes nothing", () => {
  const answer = run([started(0), open(1), delta(2, "Open "), delta(2, "Open "), delta(3, "late")]);

  expect(answer.blocks).toEqual([{ type: "markdown", text: "Open late" }]);
  expect(answer.gap).toBe(false);
});

test("a missing event is flagged, and the completed block repairs the text", () => {
  const halfway = run([started(0), open(1), delta(2, "Open "), delta(4, "18:00")]);
  expect(halfway.gap).toBe(true);
  expect(halfway.blocks).toEqual([{ type: "markdown", text: "Open 18:00" }]);

  expect(apply(halfway, done(5, "Open 10:00 to 18:00")).blocks).toEqual([
    { type: "markdown", text: "Open 10:00 to 18:00" },
  ]);
});

test("text whose block never started becomes a Markdown block of its own", () => {
  expect(run([started(0), delta(2, "Hello")]).blocks).toEqual([{ type: "markdown", text: "Hello" }]);
});

test("a failure in the middle of a block keeps what arrived and records the error", () => {
  const answer = run([started(0), open(1), delta(2, "Open "), failed(3)]);

  expect(answer.status).toBe("failed");
  expect(answer.error?.code).toBe("assistant_unavailable");
  expect(answer.blocks).toEqual([{ type: "markdown", text: "Open " }]);
});

test("nothing changes an answer once it has ended", () => {
  const answer = run([started(0), open(1), delta(2, "Done"), completed(3)]);

  expect(run([started(0), open(1), delta(2, "Done"), completed(3), delta(4, " and more")])).toEqual(answer);
});

test("a block of a type this chat does not know is kept as it came", () => {
  const unknown = { ...envelope, seq: 1, type: "content_block.started", index: 0, block: { type: "chart", text: "Sales rose" } };

  expect(run([started(0), unknown as StreamEvent]).blocks).toEqual([{ type: "chart", text: "Sales rose" }]);
});
