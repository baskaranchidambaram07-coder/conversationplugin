import type { Message } from "@ucp/protocol/v1";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { type Api, Failure } from "./api";
import { STALL_MS, runTurn } from "./turn";

const envelope = { v: 1, conversation_id: "c_1", message_id: "m_1", correlation_id: "r_1" };
const started = { ...envelope, seq: 0, type: "message.started" };
const opened = { ...envelope, seq: 1, type: "content_block.started", index: 0, block: { type: "markdown", text: "" } };
const delta = (seq: number, text: string) => ({ ...envelope, seq, type: "content_block.delta", index: 0, text });
const done = (seq: number, text: string) => ({
  ...envelope,
  seq,
  type: "content_block.completed",
  index: 0,
  block: { type: "markdown", text },
});
const completed = (seq: number) => ({ ...envelope, seq, type: "message.completed" });
const record = (status: Message["status"], text: string): Message => ({
  id: "m_1",
  role: "assistant",
  status,
  blocks: [{ type: "markdown", text }],
  error: null,
  created_at: "2026-11-12T10:00:00Z",
});

/** A gateway whose reply stream the test drives, event by event, and whose stored message it scripts. */
function gateway(records: (Message | Failure)[] = [], refuse?: Failure) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const push = (text: string) => controller.enqueue(new TextEncoder().encode(text));
  const api = {
    send: vi.fn(async (_conversation: string, _body: unknown, signal: AbortSignal) => {
      if (refuse) throw refuse;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
      signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      return new Response(body);
    }),
    message: vi.fn(async () => {
      const next = records.length > 1 ? records.shift() : records[0];
      if (next instanceof Failure) throw next;
      return next as Message;
    }),
  } as unknown as Api & { message: ReturnType<typeof vi.fn> };
  return {
    api,
    event: (event: object) => push(`data: ${JSON.stringify(event)}\n\n`),
    ping: () => push(": ping\n\n"),
    end: () => controller.close(),
    drop: () => controller.error(new TypeError("network error")),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const stop = new AbortController();
const turn = (api: Api, signal = stop.signal, seen: string[] = []) =>
  runTurn(api, "c_1", "When does the library open?", "cm_1", signal, (answer) => seen.push(answer.status));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a normal stream completes without fetching anything", async () => {
  const g = gateway();
  const result = turn(g.api);
  await flush();
  for (const event of [started, opened, delta(2, "Open"), done(3, "Open"), completed(4)]) g.event(event);
  g.end();

  expect(await result).toMatchObject({ status: "complete", blocks: [{ type: "markdown", text: "Open" }] });
  expect(g.api.message).not.toHaveBeenCalled();
});

test.each([
  ["drops", (g: ReturnType<typeof gateway>) => g.drop()],
  ["simply ends", (g: ReturnType<typeof gateway>) => g.end()],
])("a stream that %s after the message exists is recovered by fetching the finished answer", async (_, cut) => {
  const g = gateway([record("in_progress", "Open 10"), record("complete", "Open 10:00 to 18:00.")]);
  const seen: string[] = [];
  const result = turn(g.api, stop.signal, seen);
  await flush();
  g.event(started);
  g.event(opened);
  g.event(delta(2, "Open"));
  cut(g);
  await vi.advanceTimersByTimeAsync(1_000 + 2_000);

  expect(await result).toMatchObject({ status: "complete", blocks: [{ text: "Open 10:00 to 18:00." }] });
  expect(g.api.message).toHaveBeenCalledTimes(2);
  expect(seen[seen.length - 1]).toBe("complete");
});

test("a stalled stream is abandoned after 20 seconds of silence, and the finished answer fetched", async () => {
  const g = gateway([record("complete", "Open 10:00 to 18:00.")]);
  const result = turn(g.api);
  await flush();
  g.event(started);
  await vi.advanceTimersByTimeAsync(STALL_MS - 1);
  expect(g.api.message).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1 + 1_000);
  expect(await result).toMatchObject({ status: "complete" });
});

test("heartbeats keep a slow stream alive, so nothing is fetched", async () => {
  const g = gateway();
  const result = turn(g.api);
  await flush();
  g.event(started);
  for (let beat = 0; beat < 4; beat++) {
    await vi.advanceTimersByTimeAsync(15_000);
    g.ping();
  }
  for (const event of [opened, delta(2, "Open"), done(3, "Open"), completed(4)]) g.event(event);
  g.end();

  expect(await result).toMatchObject({ status: "complete" });
  expect(g.api.message).not.toHaveBeenCalled();
});

test("an answer that completed with a missing event is reloaded once to repair it", async () => {
  const g = gateway([record("complete", "Open 10:00 to 18:00.")]);
  const result = turn(g.api);
  await flush();
  for (const event of [started, opened, delta(3, "18:00."), completed(4)]) g.event(event);
  g.end();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(await result).toMatchObject({ status: "complete", gap: false, blocks: [{ text: "Open 10:00 to 18:00." }] });
});

test("a stream lost before the message exists cannot be recovered and is reported", async () => {
  const g = gateway();
  const result = turn(g.api);
  await flush();
  g.drop();

  await expect(result).rejects.toMatchObject({ status: 0 });
  expect(g.api.message).not.toHaveBeenCalled();
});

test("a refused question is reported, never recovered", async () => {
  const refusal = new Failure(429, { code: "rate_limited", message: "", retryable: true, retry_after: 30, reference: "r_2" });
  const g = gateway([], refusal);

  await expect(turn(g.api)).rejects.toBe(refusal);
  expect(g.api.message).not.toHaveBeenCalled();
});

test("stopping while the answer is being recovered stops it", async () => {
  const g = gateway([record("in_progress", "Open")]);
  const visitor = new AbortController();
  const result = turn(g.api, visitor.signal);
  result.catch(() => {});
  await flush();
  g.event(started);
  g.drop();
  await flush();
  visitor.abort();

  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});

test("recovery keeps trying through network blips, and gives up after two minutes of an unfinished answer", async () => {
  const blip = gateway([new Failure(0, null), record("complete", "Open.")]);
  const recovered = turn(blip.api);
  await flush();
  blip.event(started);
  blip.drop();
  await vi.advanceTimersByTimeAsync(1_000 + 2_000);
  expect(await recovered).toMatchObject({ status: "complete" });

  const endless = gateway([record("in_progress", "Open")]);
  const abandoned = turn(endless.api);
  abandoned.catch(() => {});
  await flush();
  endless.event(started);
  endless.drop();
  await vi.advanceTimersByTimeAsync(125_000);
  await expect(abandoned).rejects.toMatchObject({ status: 0 });
});
