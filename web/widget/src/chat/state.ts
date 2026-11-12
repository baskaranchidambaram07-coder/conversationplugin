// One assistant answer, built from stream events. Pure, so every order of events can be tested.
import type { ApiError, Block, StreamEvent } from "@ucp/protocol/v1";

export type Answer = {
  id: string | null;
  status: "pending" | "streaming" | "complete" | "failed" | "stopped";
  blocks: Block[];
  /** The last sequence number applied. */
  seq: number;
  /** An event went missing. The completed block repairs a block; if the answer ends like this, reload it. */
  gap: boolean;
  error: ApiError | null;
  /** The correlation ID, shown with any error so support can find the request. */
  reference: string | null;
};

export const pending = (): Answer => ({
  id: null,
  status: "pending",
  blocks: [],
  seq: -1,
  gap: false,
  error: null,
  reference: null,
});

const settled = (answer: Answer) => ["complete", "failed", "stopped"].includes(answer.status);

export function apply(answer: Answer, event: StreamEvent): Answer {
  if (event.seq <= answer.seq || settled(answer)) return answer; // a duplicate, or something after the end
  const next: Answer = {
    ...answer,
    id: event.message_id,
    reference: event.correlation_id,
    seq: event.seq,
    gap: answer.gap || event.seq > answer.seq + 1,
    status: "streaming",
  };
  const blocks = [...answer.blocks];
  switch (event.type) {
    case "message.started":
      return next;
    case "content_block.started":
    case "content_block.completed":
      blocks[event.index] = event.block;
      return { ...next, blocks };
    case "content_block.delta": {
      const block = blocks[event.index];
      // A delta whose start went missing starts a Markdown block of its own (the gap flag is already set).
      blocks[event.index] =
        block && typeof block.text === "string"
          ? ({ ...block, text: block.text + event.text } as Block)
          : { type: "markdown", text: event.text };
      return { ...next, blocks };
    }
    case "message.completed":
      return { ...next, status: "complete" };
    case "message.failed":
      return { ...next, status: "failed", error: event.error };
  }
}
