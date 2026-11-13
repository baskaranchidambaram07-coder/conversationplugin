// Earlier chats (M2-T8, with M7): stored messages back into the chat's turns, and when a chat was last active.
// Pure, so it can be tested without a gateway.
import type { Block, Message } from "@ucp/protocol/v1";

import { strings as t } from "../strings";
import { Failure } from "./api";
import { type Problem, problemOf } from "./problem";
import { type Answer, pending } from "./state";
import { fromRecord } from "./turn";

/** One question and its answer, as the chat shows them. A question can be missing at the top of a page. */
export type Turn = { key: string; question: string; answer: Answer; problem: Problem | null };

const textOf = (blocks: Block[]) => blocks.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n");

/** Stored messages, oldest first, as turns: each question with the answer stored after it. */
export function turnsOf(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ key: message.id, question: textOf(message.blocks), answer: pending(), problem: null });
      continue;
    }
    let turn = turns[turns.length - 1];
    if (!turn || turn.answer.id !== null) {
      turn = { key: message.id, question: "", answer: pending(), problem: null };
      turns.push(turn);
    }
    turn.answer = fromRecord(message, pending());
    turn.problem = message.status === "failed" ? problemOf(new Failure(502, message.error)) : null;
  }
  return turns;
}

const DAY = 86_400_000;
const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** When a chat was last active, as people say it: a time today, "Yesterday", a weekday this week, else a date. */
export function when(iso: string, now = new Date(), locale?: string): string {
  const date = new Date(iso);
  const days = Math.round((dayOf(now) - dayOf(date)) / DAY); // rounded, so a 23- or 25-hour day still counts as one
  if (days <= 0) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  if (days === 1) return t.yesterday;
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
  const year = date.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year }).format(date);
}
