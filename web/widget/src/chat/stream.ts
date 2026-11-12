// Reads the gateway's streamed reply (D2): server-sent events over fetch. Bytes arrive in arbitrary chunks,
// so one event, or one character, may be split across two of them.
import type { StreamEvent } from "@ucp/protocol/v1";

const TYPES = new Set([
  "message.started",
  "content_block.started",
  "content_block.delta",
  "content_block.completed",
  "message.completed",
  "message.failed",
]);

/** The event if it is a version 1 event of a type this chat knows; otherwise null, and the caller skips it. */
export function asEvent(data: unknown): StreamEvent | null {
  const event = data as { v?: unknown; seq?: unknown; type?: unknown } | null;
  return typeof event === "object" &&
    event !== null &&
    event.v === 1 &&
    Number.isInteger(event.seq) &&
    TYPES.has(event.type as string)
    ? (data as StreamEvent)
    : null;
}

/** Feed it chunks as they arrive. Every event or heartbeat calls alive(), which is how a stalled stream is noticed. */
export function eventReader(onEvent: (event: StreamEvent) => void, alive: () => void = () => {}) {
  const decoder = new TextDecoder();
  let buffer = "";
  return (chunk: Uint8Array) => {
    // Normalised after joining, so a CRLF split across two chunks still counts as one line break.
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      alive();
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue; // a heartbeat (`: ping`) or other comment
      try {
        const event = asEvent(JSON.parse(data));
        if (event) onEvent(event);
      } catch {
        // A malformed event is skipped; the completed block or a reload repairs what it would have said.
      }
    }
  };
}
