import type { Message } from "@ucp/protocol/v1";
import { expect, test } from "vitest";

import { turnsOf, when } from "./history";

const at = "2026-11-12T10:00:00Z";
const question = (id: string, text: string): Message => ({
  id,
  role: "user",
  status: "complete",
  blocks: [{ type: "text", text }],
  error: null,
  created_at: at,
});
const answer = (id: string, status: Message["status"], text = ""): Message => ({
  id,
  role: "assistant",
  status,
  blocks: text ? [{ type: "markdown", text }] : [],
  error:
    status === "failed"
      ? { code: "assistant_unavailable", message: "x", retryable: true, retry_after: null, reference: "r_9" }
      : null,
  created_at: at,
});

test("stored messages become turns: each question with the answer after it, as it was left", () => {
  const turns = turnsOf([
    question("m_1", "When does the library open?"),
    answer("m_2", "complete", "At **8**."),
    question("m_3", "And on Sunday?"),
    answer("m_4", "failed"),
    question("m_5", "Hello?"),
    answer("m_6", "in_progress", "Let me"),
  ]);

  expect(turns.map((turn) => [turn.key, turn.question, turn.answer.status, turn.answer.id])).toEqual([
    ["m_1", "When does the library open?", "complete", "m_2"],
    ["m_3", "And on Sunday?", "failed", "m_4"],
    ["m_5", "Hello?", "streaming", "m_6"], // still being written: the chat follows it until it settles
  ]);
  expect(turns[0]?.answer.blocks).toEqual([{ type: "markdown", text: "At **8**." }]);
  expect(turns[1]?.problem).toEqual({ kind: "unavailable", reference: "r_9", retryable: true });
  expect(turns[0]?.problem).toBeNull();
});

test("an answer whose question is on the page before stands alone, without an empty bubble", () => {
  const turns = turnsOf([answer("m_2", "complete", "Earlier answer"), question("m_3", "Next"), answer("m_4", "stopped")]);

  expect(turns.map((turn) => [turn.question, turn.answer.status])).toEqual([
    ["", "complete"],
    ["Next", "stopped"],
  ]);
});

test("a chat's time reads as people say it: today's time, yesterday, a weekday, a date, a date with its year", () => {
  const now = new Date(2026, 10, 13, 15, 0); // Friday 13 November 2026, 3 pm, local time
  const local = (day: number, hour = 9, year = 2026, month = 10) => new Date(year, month, day, hour, 5).toISOString();

  expect(when(local(13), now, "en-GB")).toBe("9:05");
  expect(when(local(12, 23), now, "en-GB")).toBe("Yesterday");
  expect(when(local(9), now, "en-GB")).toBe("Monday");
  expect(when(local(2), now, "en-GB")).toBe("2 Nov");
  expect(when(local(20, 9, 2025, 11), now, "en-GB")).toBe("20 Dec 2025");
});
