// @vitest-environment jsdom
// The example gallery (M3 UI tests): our examples in ./gallery and the answers Purple Fabric gave in the recordings
// each render whole, and at every point a stream could have reached, without error.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { safeHref } from "./links";
import Markdown from "./Markdown";
import { BlockView, tooHeavy } from "./registry";

afterEach(cleanup);

const ours = import.meta.glob<string>("./gallery/*.md", { query: "?raw", import: "default", eager: true });
const recordings = import.meta.glob<string>("../../../../backend/fakepf/recordings/*.sse", {
  query: "?raw",
  import: "default",
  eager: true,
});
const answerOf = (sse: string): string =>
  sse
    .split("\n")
    .filter((line) => line.includes('"FINAL_RESPONSE"'))
    .map((line) => JSON.parse(line.slice(6)).content.response)[0];

const GALLERY = [
  ...Object.entries(ours),
  ...Object.entries(recordings).map(([name, sse]) => [name, answerOf(sse)] as const),
].map(([name, text]) => [name.split("/").pop(), text] as const);

test("the gallery holds our examples and every recorded Purple Fabric answer", () => {
  expect(GALLERY.map(([name]) => name).sort()).toEqual(["code.md", "formatting.md", "long.sse", "short.sse", "tables.md"]);
  for (const [, text] of GALLERY) expect(text.length).toBeGreaterThan(0);
});

test.each(GALLERY)("%s renders whole: headings below the chat's title, and only safe links", (_, text) => {
  const box = render(<Markdown text={text} />).container;

  expect(box.querySelector(".md")?.childElementCount).toBeGreaterThan(0);
  expect(box.querySelector("h1")).toBeNull();
  for (const link of box.querySelectorAll("a")) expect(safeHref(link.getAttribute("href"))).not.toBeNull();
});

// A stream can stop anywhere, but only a stop beside Markdown syntax (a fence, a table pipe, a list mark, a line end)
// can change what is drawn; a stop inside a word draws the same as one at its edge.
const SYNTAX = /[`*_~[\]()!#>|\\<:\n-]/;

test.each(GALLERY)("%s renders at every streamed prefix that ends beside Markdown syntax, without error", (_, text) => {
  const { rerender } = render(<Markdown text="" />);
  for (let end = 1; end <= text.length; end++) {
    if (SYNTAX.test(text[end - 1] ?? "") || SYNTAX.test(text[end] ?? "")) rerender(<Markdown text={text.slice(0, end)} />);
  }
}, 30_000);

// Very large or deeply nested answers (M3 security and performance tests). Just under the limits, the slowest shapes
// found still draw as Markdown within the budget; past them, the answer is plain text, drawn at once.
const fill = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const nestedList = (length: number) => {
  let list = "";
  for (let depth = 0; list.length < length; depth++) list += `${"  ".repeat(depth)}- item\n`;
  return list.slice(0, length);
};

const UNDER: Record<string, string> = {
  "a 1,000-row table": `| A | B |\n|---|---|\n${Array.from({ length: 1000 }, (_, n) => `| ${n} | x |`).join("\n")}`,
  "a 5,000-column table": `${fill("|a", 9_999)}\n${fill("|-", 9_999)}`,
  "2,000 unmatched emphasis marks": fill("_a*", 3_000),
  "a list nested by indentation up to the length limit": nestedList(20_000),
  "31 containers opened on one line": `${"> - ".repeat(15)}> x`,
  "50 blocks": Array.from({ length: 50 }, (_, n) => `## Part ${n}\n\nText ${n}.\n\n\`\`\`\ncode ${n}\n\`\`\``).join("\n\n"),
};

const OVER: Record<string, string> = {
  "more than 20,000 characters": "word ".repeat(4_001),
  "2,001 emphasis marks": `${fill("_a*", 3_000)}~`,
  "32 containers opened on one line": `${"> - ".repeat(16)}x`,
  "10,000 nested quotes": `${">".repeat(10_000)} x`,
};

test.each(Object.entries(UNDER))("%s draws as Markdown within two seconds", (_, text) => {
  expect(tooHeavy(text)).toBe(false);
  const start = performance.now();
  render(<Markdown text={text} />);
  expect(performance.now() - start).toBeLessThan(2_000);
});

test.each(Object.entries(OVER))("an answer with %s is shown as plain text, at once", (_, text) => {
  const start = performance.now();
  const box = render(<BlockView block={{ type: "markdown", text }} />).container;

  expect(box.querySelector(".md")).toBeNull();
  expect(box.querySelector("p.text")?.textContent).toBe(text);
  expect(performance.now() - start).toBeLessThan(200);
});
