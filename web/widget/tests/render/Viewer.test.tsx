// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { codeFile } from "../../src/render/Code";
import { standalone } from "../../src/render/image";
import Markdown from "../../src/render/Markdown";
import { BlockView } from "../../src/render/registry";
import { Frame } from "../../src/frame";
import { Viewer } from "../../src/Viewer";

afterEach(cleanup);

const rows = Array.from({ length: 14 }, (_, i) => `| Room ${i + 1} | ${i + 1} |`).join("\n");
const TABLE = `| Room | Floor |\n| --- | --- |\n${rows}\n`;

test("a long table opens whole in the viewer, which zooms, closes on its button and gives focus back", async () => {
  render(<Markdown text={TABLE} />);
  const open = await screen.findByRole("button", { name: "Full screen" });
  open.focus();
  fireEvent.click(open);

  const viewer = screen.getByRole("dialog", { name: "Table: Room, Floor" });
  expect(within(viewer).getAllByRole("row")).toHaveLength(15);
  expect(within(viewer).queryByRole("button", { name: "Show all 14 rows" })).toBeNull(); // every row already shows
  expect(within(viewer).queryByRole("button", { name: "Full screen" })).toBeNull();
  expect(within(viewer).getByRole("button", { name: "Download CSV" })).toBeTruthy();

  const zoom = within(viewer).getByRole("group", { name: "Zoom" });
  fireEvent.click(within(zoom).getByRole("button", { name: "Zoom in" }));
  expect(viewer.style.getPropertyValue("--zoom")).toBe("1.25");
  fireEvent.keyDown(viewer, { key: "-" });
  fireEvent.keyDown(viewer, { key: "-" });
  expect(within(zoom).getByRole("button", { name: /^Zoom 75%/ })).toBeTruthy();
  fireEvent.keyDown(viewer, { key: "0" });
  expect(viewer.style.getPropertyValue("--zoom")).toBe("1");

  fireEvent.click(within(viewer).getByRole("button", { name: "Close full screen" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(open);
});

test("a floating panel fills the window while the viewer shows, and goes back after; Escape never closes the chat", () => {
  const expand = vi.fn();
  const chat = vi.fn();
  window.addEventListener("keydown", chat);
  const shown = render(
    <Frame.Provider value={{ expandable: true, expanded: false, expand }}>
      <Viewer title="Diagram" onClose={() => shown.unmount()}>
        <p>drawing</p>
      </Viewer>
    </Frame.Provider>,
  );
  expect(expand).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(chat).not.toHaveBeenCalled();
  shown.unmount();
  expect(expand).toHaveBeenLastCalledWith(false);
  window.removeEventListener("keydown", chat);
});

test("a panel already filling the window, or a chart that redraws itself, is left as it is", () => {
  const expand = vi.fn();
  render(
    <Frame.Provider value={{ expandable: true, expanded: true, expand }}>
      <Viewer title="Chart" zoomable={false} onClose={() => {}}>
        <p>chart</p>
      </Viewer>
    </Frame.Provider>,
  );
  expect(expand).not.toHaveBeenCalled();
  expect(screen.queryByRole("group", { name: "Zoom" })).toBeNull();
});

test("code saves under a name from its language", () => {
  expect(codeFile("python")).toBe("code.py");
  expect(codeFile("TypeScript")).toBe("code.ts");
  expect(codeFile("mermaid")).toBe("diagram.mmd");
  expect(codeFile("")).toBe("code.txt");
  expect(codeFile("brainfuck")).toBe("code.txt");
  expect(codeFile("", true)).toBe("drawing.txt");
});

test("a code block offers Download beside Copy", async () => {
  render(<Markdown text={"```python\nprint('hi')\n```"} />);
  const caption = (await screen.findByRole("region", { name: "python" })).closest("figure")!;
  expect(within(caption).getByRole("button", { name: "Download" })).toBeTruthy();
});

test("a drawing saved as a picture carries its paint on each part, not the page's classes", () => {
  document.head.insertAdjacentHTML("beforeend", "<style>.c1 { fill: rgb(42, 120, 214); }</style>");
  document.body.insertAdjacentHTML(
    "beforeend",
    '<svg id="drawn" width="40" height="20"><rect class="c1" width="10" height="10"/><text class="tick">3</text></svg>',
  );
  const markup = standalone(document.getElementById("drawn") as unknown as SVGSVGElement, 80, 40);
  expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(markup).toContain('width="80"');
  expect(markup).toMatch(/<rect[^>]*fill="rgb\(42, 120, 214\)"/);
  expect(markup).not.toContain("class=");
});

test("a part of an answer this chat does not know shows what text it has, and can be saved", () => {
  render(<BlockView block={{ type: "sources", text: "Two sources" } as never} />);
  expect(screen.getByText("Two sources")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download this part" })).toBeTruthy();
});
