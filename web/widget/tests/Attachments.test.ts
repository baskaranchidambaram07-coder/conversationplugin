import { expect, test } from "vitest";

import { isPicture, LIMIT_BYTES, refusal, sizeOf } from "../src/Attachments";
import { turnsOf } from "../src/chat/history";
import { strings as t } from "../src/strings";

test("a file is refused before upload, in words, only for what the gateway would refuse too", () => {
  expect(refusal({ name: "lease.pdf", size: 1200 }, 0)).toBeNull();
  expect(refusal({ name: "Photo.JPEG", size: 1200 }, 4)).toBeNull();
  expect(refusal({ name: "essay.docx", size: LIMIT_BYTES }, 0)).toBeNull();
  expect(refusal({ name: "letter.doc", size: 1 }, 0)).toBeNull();

  expect(refusal({ name: "setup.exe", size: 10 }, 0)).toBe(t.fileWrongType("setup.exe"));
  expect(refusal({ name: "logo.svg", size: 10 }, 0)).toBe(t.fileWrongType("logo.svg"));
  expect(refusal({ name: "no-extension", size: 10 }, 0)).toBe(t.fileWrongType("no-extension"));
  expect(refusal({ name: "big.pdf", size: LIMIT_BYTES + 1 }, 0)).toBe(t.fileTooBig("big.pdf"));
  expect(refusal({ name: "empty.png", size: 0 }, 0)).toBe(t.fileEmpty("empty.png"));
  expect(refusal({ name: "sixth.pdf", size: 10 }, 5)).toBe(t.fileTooMany);
});

test("sizes read as people say them, and pictures are told apart by name", () => {
  expect([sizeOf(200), sizeOf(48_213), sizeOf(1024 * 1024), sizeOf(1.25 * 1024 * 1024)]).toEqual([
    "1 KB",
    "47 KB",
    "1 MB",
    "1.3 MB",
  ]);
  expect([isPicture("a.png"), isPicture("b.JPG"), isPicture("c.pdf")]).toEqual([true, true, false]);
});

test("a stored question brings back its text and its files, and a question without files has none", () => {
  const at = "2026-11-18T10:00:00Z";
  const file = { type: "file", id: "f_1", name: "lease.pdf", size: 1200, content_type: "application/pdf" } as const;
  const turns = turnsOf([
    { id: "m_1", role: "user", status: "complete", blocks: [{ type: "text", text: "What is this?" }, file], error: null, created_at: at },
    { id: "m_2", role: "assistant", status: "complete", blocks: [{ type: "markdown", text: "A lease." }], error: null, created_at: at },
    { id: "m_3", role: "user", status: "complete", blocks: [{ type: "text", text: "Thanks" }], error: null, created_at: at },
  ]);

  expect(turns.map((turn) => [turn.question, turn.files])).toEqual([
    ["What is this?", [file]],
    ["Thanks", undefined],
  ]);
});
