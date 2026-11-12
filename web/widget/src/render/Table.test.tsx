// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import Markdown from "./Markdown";
import { toCsv } from "./Table";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const table = (rows: number) =>
  `| Day | Opens |\n|---|---|\n${Array.from({ length: rows }, (_, n) => `| Day ${n + 1} | 10:00 |`).join("\n")}`;

function clipboard() {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

test("CSV quotes what needs quoting and keeps formulas from running in a spreadsheet", () => {
  expect(
    toCsv([
      ["Name", "Note"],
      ["Smith, Jo", 'Said "hi"'],
      ["Two\nlines", "=HYPERLINK(\"https://evil.example\")"],
      ["+44 20", "@SUM(A1)"],
      ["-5", "-cmd"],
    ]),
  ).toBe(
    'Name,Note\r\n"Smith, Jo","Said ""hi"""\r\n"Two\nlines","\'=HYPERLINK(""https://evil.example"")"\r\n' +
      "'+44 20,'@SUM(A1)\r\n-5,'-cmd",
  );
});

test("a table scrolls in a named region a keyboard can reach, and copies as CSV", async () => {
  const writeText = clipboard();
  render(<Markdown text={table(2)} />);
  const region = screen.getByRole("region", { name: "Table: Day, Opens" });

  expect(region.tabIndex).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Copy as CSV" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Day,Opens\r\nDay 1,10:00\r\nDay 2,10:00"));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("rows past the tenth fold behind a button that shows them all; a short table has no such button", () => {
  const { container } = render(<Markdown text={table(11)} />);

  expect(container.querySelector(".scroll")?.classList.contains("folded")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Show all 11 rows" }));
  expect(container.querySelector(".scroll")?.classList.contains("folded")).toBe(false);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();

  cleanup();
  render(<Markdown text={table(10)} />);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});

test("a code block is a named region a keyboard can scroll, and copies exactly its code", async () => {
  const writeText = clipboard();
  render(<Markdown text={"```python\nprint('hi')\n```"} />);

  expect(screen.getByRole("region", { name: "python" }).tabIndex).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("print('hi')"));
});

test("a copy the browser refuses says so, instead of claiming it worked", async () => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
  render(<Markdown text={"```python\nprint('hi')\n```"} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

  expect(await screen.findByRole("button", { name: "Could not copy" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});
