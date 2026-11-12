// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { safeHref } from "./links";
import corpus from "./gallery/injection.json?raw";
import Markdown from "./Markdown";

afterEach(cleanup);

const draw = (text: string) => render(<Markdown text={text} />).container;

test("headings start one level below the chat's title, and lists, quotes and emphasis render", () => {
  const box = draw("# Library\n\n## Hours\n\n- Monday\n- Sunday\n\n> Bring your card.\n\n**Bold** and ~~gone~~");

  expect(box.querySelector("h2")?.textContent).toBe("Library");
  expect(box.querySelector("h3")?.textContent).toBe("Hours");
  expect(box.querySelector("h1")).toBeNull();
  expect(box.querySelectorAll("li")).toHaveLength(2);
  expect(box.querySelector("blockquote")?.textContent?.trim()).toBe("Bring your card.");
  expect(box.querySelector("strong")?.textContent).toBe("Bold");
  expect(box.querySelector("del")?.textContent).toBe("gone");
});

test("a Markdown table becomes a real table with header cells", () => {
  const box = draw("| Room | Floor |\n|---|---|\n| Library | 1 |\n| Gym | 0 |");

  expect([...box.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Room", "Floor"]);
  expect(box.querySelectorAll("tbody tr")).toHaveLength(2);
});

test("a safe link opens in a new tab without giving the page a handle on ours", () => {
  draw("See [the library page](https://college.example/library).");
  const link = screen.getByRole("link", { name: "the library page" });

  expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual([
    "https://college.example/library",
    "_blank",
    "noopener noreferrer nofollow",
  ]);
});

test("an image is never fetched: it becomes a link the visitor can choose to follow", () => {
  const box = draw("![The library at night](https://college.example/library.jpg)");

  expect(box.querySelector("img")).toBeNull();
  expect(screen.getByRole("link", { name: "Image: The library at night" }).getAttribute("href")).toBe(
    "https://college.example/library.jpg",
  );
});

test("a fenced block is shown as labelled code; a diagram fence is labelled as diagram source", () => {
  const box = draw("```python\nprint('hi')\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```");
  const figures = box.querySelectorAll("figure.code");

  expect([...figures].map((figure) => figure.querySelector("figcaption span")?.textContent)).toEqual([
    "python",
    "Diagram source",
  ]);
  expect(figures[1]?.querySelector("code")?.textContent).toBe("flowchart LR\n  A --> B");
});

test("half-finished Markdown, as it arrives mid-stream, renders without error", () => {
  const answer = "# Hours\n\n| Day | Open |\n|---|---|\n| Sunday | 10:00 |\n\n```python\nprint('x')\n```\n\nDone.";
  for (let end = 1; end <= answer.length; end++) {
    cleanup();
    expect(() => draw(answer.slice(0, end))).not.toThrow();
  }
});

// The security corpus (M3 security tests), shared with the browser tests: nothing here may run, load or style anything.
const CORPUS: string[] = JSON.parse(corpus);

test.each(CORPUS)("the injection attempt %j runs, loads and styles nothing", (attempt) => {
  const box = draw(attempt);

  // Our own icons are the only SVG allowed: content can never produce one, since raw HTML is never rendered.
  expect(box.querySelectorAll("script, iframe, style, img, svg:not(.glyph), object, embed, link, meta")).toHaveLength(0);
  for (const element of box.querySelectorAll("*")) {
    expect([...element.attributes].filter((attribute) => /^on/i.test(attribute.name))).toEqual([]);
    expect(element.getAttribute("style") ?? "").not.toMatch(/url\(|expression|javascript/i);
  }
  for (const link of box.querySelectorAll("a")) expect(safeHref(link.getAttribute("href"))).not.toBeNull();
  expect((window as { hacked?: number }).hacked).toBeUndefined();
});

test("a task list's boxes are named marks, not controls", () => {
  draw("- [x] Visa letter printed\n- [ ] Bank letter requested");

  expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Not done" })).toBeTruthy();
  expect(document.querySelector("input")).toBeNull();
});

test("a phone number links to a call, as a mail address links to a message", () => {
  draw("Call [+44 20 7000 0000](tel:+442070000000) or write to <help@example.org>.");

  expect(screen.getByRole("link", { name: "+44 20 7000 0000" }).getAttribute("href")).toBe("tel:+442070000000");
  expect(screen.getByRole("link", { name: "help@example.org" }).getAttribute("href")).toBe("mailto:help@example.org");
});
