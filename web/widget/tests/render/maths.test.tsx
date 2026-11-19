// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Code, HIGHLIGHTED } from "../../src/render/Code";
import gallery from "../../src/render/gallery/maths.md?raw";
import code from "../../src/render/gallery/code.md?raw";
import { lowlight } from "../../src/render/highlight";
import Markdown from "../../src/render/Markdown";
import { INLINE, markMaths } from "../../src/render/mathsyntax";
import { fenceRenderer } from "../../src/render/registry";

afterEach(cleanup);

const inline = (tex: string) => `\`${INLINE}${tex} \``;

test("formulas are marked for drawing in every way agents write them, and money and code are left alone", () => {
  expect(markMaths("so $x^2$ and \\(y\\) and $$z$$ here")).toBe(`so ${inline("x^2")} and ${inline("y")} and ${inline("z")} here`);
  expect(markMaths("$$\nA = \\pi r^2\n$$")).toBe("```math\nA = \\pi r^2\n```");
  expect(markMaths("\\[\n\\sum_i x_i\n\\]")).toBe("```math\n\\sum_i x_i\n```");
  expect(markMaths("  $$E = mc^2$$")).toBe("  ```math\n  E = mc^2\n  ```"); // kept inside its list item
  for (const money of ["Rents are $650 a month and fees $1,200 a year.", "$5-$10", "$5 and $10", "US$5 or US$6", "a \\$5 note"])
    expect(markMaths(money)).toBe(money);
  expect(markMaths("`$x$` stays code")).toBe("`$x$` stays code");
  expect(markMaths("```python\nprice = \"$x$\"\n```")).toBe("```python\nprice = \"$x$\"\n```");
  expect(markMaths("| abs | $|x|$ |")).toBe(`| abs | ${inline("\\vert x\\vert ")} |`); // a bar would end the cell
  expect(markMaths("$$\nx = ")).toBe("$$\nx = "); // still arriving: text until it closes
});

test("formulas are drawn as MathML the browser lays out, with nothing styled, linked or run", async () => {
  const { container } = render(<Markdown text={gallery} />);

  await waitFor(() => expect(container.querySelectorAll(".maths math").length).toBeGreaterThanOrEqual(10));
  expect(container.querySelectorAll(".maths.block math[display=block]").length).toBe(5); // $$, \[, math, aligned, latex
  expect(container.querySelector("mfrac")).not.toBeNull();
  expect(container.querySelector("annotation[encoding='application/x-tex']")?.textContent).toContain("\\frac{r}{n}");
  expect(container.querySelectorAll(".maths [style], .maths a, .maths script")).toHaveLength(0);
  expect(screen.getByText(/Rents are \$650 a month and fees \$1,200 a year/)).toBeTruthy();
  expect(screen.getByText("\\frac{1}{").tagName).toBe("CODE"); // unreadable: its source
  expect(screen.getByText("\\undefinedcommand{x}").tagName).toBe("CODE");
  expect(screen.getByRole("region", { name: "python" }).textContent).toBe('price = "$5 and $10"');
});

test("a formula that asks to link or style is refused and shown as its source; a LaTeX document stays code", async () => {
  const { container } = render(<Markdown text={"$\\href{javascript:alert(1)}{x}$ and $\\style{color:red}{y}$"} />);
  await waitFor(() => expect(container.querySelectorAll("code")).toHaveLength(2));
  expect(container.querySelector("a, [style], math")).toBeNull();

  expect(fenceRenderer("latex", "\\documentclass{article}\n\\begin{document}x\\end{document}")).toBe(Code);
  expect(fenceRenderer("latex", "x^2", true)).toBe(fenceRenderer("math", "x^2", true));
});

test("every language name the chat colours is one the highlighter knows", () => {
  for (const name of HIGHLIGHTED) expect(lowlight.registered(name), name).toBe(true);
});

test("code is coloured token by token, copies exactly as written, and never runs", async () => {
  const python = /```python\n([\s\S]*?)```/.exec(code)![1]!.replace(/\n$/, "");
  const { container } = render(<Code code={python} language="python" />);

  await waitFor(() => expect(container.querySelector(".hljs-keyword")).not.toBeNull());
  expect(container.querySelector("pre")!.textContent).toBe(python);
  expect(container.querySelector(".hljs-string, .hljs-comment, .hljs-number")).not.toBeNull();

  cleanup();
  const hostile = render(<Code code={'<img src=x onerror="alert(1)"><script>alert(2)</script>'} language="html" />).container;
  await waitFor(() => expect(hostile.querySelector(".hljs-tag")).not.toBeNull());
  expect(hostile.querySelector("img, script")).toBeNull();

  cleanup();
  const plain = render(<Code code="+[-->-[>>+>-----<<]<--<---]>-." language="brainfuck" />).container;
  expect(plain.querySelector("pre span")).toBeNull();
});
