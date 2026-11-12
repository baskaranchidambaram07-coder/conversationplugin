// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { BlockView } from "./registry";

// The Markdown renderer breaks on one particular answer, as a renderer bug might.
vi.mock("./Markdown", () => ({
  default: ({ text }: { text: string }) => {
    if (text.includes("breaks")) throw new Error("renderer bug");
    return <p>rendered: {text}</p>;
  },
}));

afterEach(cleanup);

test("a block whose renderer fails shows its plain text, and the blocks around it are untouched", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {}); // React reports the caught error
  render(
    <>
      <BlockView block={{ type: "markdown", text: "Before" }} />
      <BlockView block={{ type: "markdown", text: "This one breaks" }} />
      <BlockView block={{ type: "markdown", text: "After" }} />
    </>,
  );

  expect(await screen.findByText("rendered: After")).toBeTruthy();
  expect(screen.getByText("rendered: Before")).toBeTruthy();
  expect(screen.getByText("This one breaks")).toBeTruthy();
});

test("plain text is never interpreted, an empty block draws nothing, and an unknown type shows its text", () => {
  const { container } = render(
    <>
      <BlockView block={{ type: "text", text: "# not a heading" }} />
      <BlockView block={{ type: "markdown", text: "" }} />
      <BlockView block={{ type: "chart", text: "Sales rose." }} />
      <BlockView block={{ type: "poll" }} />
    </>,
  );

  expect(screen.getByText("# not a heading").tagName).toBe("P");
  expect(container.querySelectorAll("p")).toHaveLength(3);
  expect(screen.getByText("Sales rose.")).toBeTruthy();
  expect(screen.getByText("This part of the answer cannot be shown here.")).toBeTruthy();
});
