import type { StreamEvent } from "@ucp/protocol/v1";
import { expect, test, vi } from "vitest";

import { eventReader } from "./stream";

const envelope = { v: 1, conversation_id: "c_1", message_id: "m_1", correlation_id: "r_1" } as const;
const EVENTS = [
  { ...envelope, seq: 0, type: "message.started" },
  { ...envelope, seq: 1, type: "content_block.started", index: 0, block: { type: "markdown", text: "" } },
  { ...envelope, seq: 2, type: "content_block.delta", index: 0, text: "Café hours: 東京 😀" },
  { ...envelope, seq: 3, type: "message.completed" },
] as StreamEvent[];
const WIRE = EVENTS.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(": ping\n\n");
const BYTES = new TextEncoder().encode(WIRE);

function read(chunks: Uint8Array[]) {
  const events: StreamEvent[] = [];
  const alive = vi.fn();
  const feed = eventReader((event) => events.push(event), alive);
  for (const chunk of chunks) feed(chunk);
  return { events, alive };
}

test("every event arrives intact wherever the bytes are split, even inside a multi-byte character", () => {
  for (let at = 1; at < BYTES.length; at++) {
    expect(read([BYTES.slice(0, at), BYTES.slice(at)]).events).toEqual(EVENTS);
  }
  expect(read(Array.from(BYTES, (byte) => Uint8Array.of(byte))).events).toEqual(EVENTS);
});

test("heartbeats prove the stream alive without producing an event", () => {
  const { events, alive } = read([new TextEncoder().encode(": ping\n\n: ping\n\n")]);

  expect(events).toEqual([]);
  expect(alive).toHaveBeenCalledTimes(2);
});

test("CRLF line endings work, even when a CRLF is split across two chunks", () => {
  const crlf = new TextEncoder().encode(WIRE.replace(/\n/g, "\r\n"));
  const split = crlf.indexOf(13); // the first \r

  expect(read([crlf.slice(0, split + 1), crlf.slice(split + 1)]).events).toEqual(EVENTS);
});

test("a malformed event, an unknown event type and a newer version are skipped; what follows still arrives", () => {
  const wire =
    "data: {not json\n\n" +
    `data: ${JSON.stringify({ ...envelope, seq: 1, type: "message.paused" })}\n\n` +
    `data: ${JSON.stringify({ ...envelope, v: 2, seq: 2, type: "message.completed" })}\n\n` +
    `data: ${JSON.stringify(EVENTS[3])}\n\n`;

  expect(read([new TextEncoder().encode(wire)]).events).toEqual([EVENTS[3]]);
});

test("an event cut off at the end of the stream is held back, not half-delivered", () => {
  expect(read([BYTES.slice(0, BYTES.length - 1)]).events).toEqual(EVENTS.slice(0, 3));
});
