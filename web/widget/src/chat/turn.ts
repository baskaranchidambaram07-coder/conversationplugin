// One question and its answer, start to finish (M2-T6). The answer streams; if the stream stalls (a proxy holding
// it back, or a dead connection) or drops, the finished answer is fetched instead, because PF finishes an answer
// even when nobody is listening (pf-capability-sheet.md section 6). Kept apart from the interface so every path
// can be tested.
import type { Message } from "@ucp/protocol/v1";

import { type Api, Failure } from "./api";
import { type Answer, apply, pending } from "./state";
import { eventReader } from "./stream";

/** The gateway sends a heartbeat every 15 s, so 20 s of silence means the stream is stalled. */
export const STALL_MS = 20_000;
const FIRST_POLL_MS = 1_000;
const POLL_MS = 2_000;
const GIVE_UP_MS = 120_000;

const aborted = () => new DOMException("The visitor stopped the answer", "AbortError");

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(aborted())), { once: true });
  });
}

/** The stored message as an answer the chat can show. */
export function fromRecord(record: Message, previous: Answer): Answer {
  return {
    ...previous,
    id: record.id,
    blocks: record.blocks,
    status: record.status === "in_progress" ? "streaming" : record.status,
    error: record.error,
    gap: false,
  };
}

/**
 * Runs one turn. onAnswer receives every new state of the answer. Resolves with the final answer (complete,
 * failed or stopped). Throws a Failure when the gateway refuses the question or nothing can be recovered, and an
 * AbortError when the visitor stops it.
 */
export async function runTurn(
  api: Api,
  conversationId: string,
  question: string,
  key: string,
  signal: AbortSignal,
  onAnswer: (answer: Answer) => void,
): Promise<Answer> {
  let answer = pending();
  const show = (next: Answer) => {
    answer = next;
    onAnswer(next);
  };

  // The stream's own controller, aborted by the visitor's stop or by the watchdog.
  const stream = new AbortController();
  signal.addEventListener("abort", () => stream.abort(), { once: true });
  let stalled = false;
  let watchdog = setTimeout(() => ((stalled = true), stream.abort()), STALL_MS);
  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ((stalled = true), stream.abort()), STALL_MS);
  };

  try {
    const reply = await api.send(conversationId, { text: question, client_message_id: key }, stream.signal);
    const feed = eventReader((event) => show(apply(answer, event)), alive);
    const reader = (reply.body as ReadableStream<Uint8Array>).getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) feed(chunk.value);
  } catch (error) {
    if (signal.aborted) throw error; // the visitor's stop
    // A refusal (too many messages, an ended session) is reported. Only a lost or stalled stream is recovered.
    if (error instanceof Failure && error.status !== 0) throw error;
    if (!stalled && !(error instanceof Failure) && !(error instanceof TypeError)) throw error;
  } finally {
    clearTimeout(watchdog);
  }

  if (answer.status === "failed" || (answer.status === "complete" && !answer.gap)) return answer;
  if (!answer.id) throw new Failure(0, null); // lost before the message existed: nothing to fetch
  return recover(api, conversationId, answer.id, signal, answer, show);
}

async function recover(
  api: Api,
  conversationId: string,
  messageId: string,
  signal: AbortSignal,
  last: Answer,
  show: (answer: Answer) => void,
): Promise<Answer> {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    await wait(attempt === 0 ? FIRST_POLL_MS : POLL_MS, signal);
    try {
      const answer = fromRecord(await api.message(conversationId, messageId), last);
      show(answer);
      if (answer.status !== "streaming") return answer;
      last = answer;
    } catch (error) {
      if (!(error instanceof Failure && error.status === 0)) throw error; // a network blip is retried
    }
    if (Date.now() - started > GIVE_UP_MS) throw new Failure(0, null);
  }
}
