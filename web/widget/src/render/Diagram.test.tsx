// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import gallery from "./gallery/diagrams.md?raw";
import Diagram from "./Diagram";
import Markdown from "./Markdown";
import { fromDrawio, fromExcalidraw } from "./scene";

afterEach(cleanup);

const [drawio = "", excalidraw = ""] =[...gallery.matchAll(/```(?:xml|json)\n([\s\S]*?)```/g)].map((m) => m[1]!);
const cell = (attributes: string, value = "Box") =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="${value}" ${attributes} vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>`;

test("a draw.io answer is drawn: its boxes in their own colours, its lines routed and labelled, and all of it spoken", async () => {
  render(<Markdown text={gallery} />);

  const figure = (await screen.findByRole("region", { name: "Diagram from draw.io" })).closest("figure")!;
  const drawing = within(figure).getByRole("img", { name: "Diagram: 6 shapes and 7 lines" });
  expect(drawing.querySelector('rect[fill="#dae8fc"][stroke="#6c8ebf"]')).not.toBeNull();
  expect(drawing.textContent).toContain("4. Deliver OTP Message");
  expect(drawing.querySelector("desc")?.textContent).toContain(
    "User (Mobile/Web App) to App Frontend (Login Screen): 1. Enter Phone No.",
  );
  expect(drawing.getAttribute("aria-describedby")).toBe(drawing.querySelector("desc")?.id);
});

test("a line through waypoints leaves and enters its boxes where draw.io would, at right angles", () => {
  const line = fromDrawio(drawio)!.lines.find((l) => l.label === "4. Deliver OTP Message")!;

  expect(line.points[0]).toEqual([850, 80]); // up out of the top of the WhatsApp box
  expect(line.points.slice(1, 3)).toEqual([[850, 40], [120, 40]]);
  expect(line.points[line.points.length - 1]).toEqual([200, 110]); // into the user box's right side, as entryX=1 says
  for (const [i, p] of line.points.slice(1).entries()) {
    const q = line.points[i]!;
    expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
  }
});

test("an Excalidraw sketch is drawn with its bound text, its arrows' labels and dashes, and without deleted parts", async () => {
  const scene = fromExcalidraw(excalidraw)!;
  expect(scene.shapes.filter((s) => s.kind !== "text").map((s) => s.kind)).toEqual(["ellipse", "rect", "rhombus"]);
  expect(scene.lines.map((l) => [l.label, l.dashed, l.from, l.to])).toEqual([
    ["asks", false, "Visitor", "Gateway"],
    ["", true, "Gateway", "Agent"],
  ]);

  render(<Markdown text={gallery} />);
  expect(await screen.findByRole("img", { name: "Diagram: 3 shapes and 2 lines" })).toBeTruthy();
});

test("nothing in a diagram can fetch, link or run: colours are plain, labels are only text", () => {
  const hostile = cell(
    'style="html=1;fillColor=url(https://evil.example/x);strokeColor=red;fontColor=javascript:alert(1)"',
    "&lt;img src=x onerror=alert(1)&gt;Hello&lt;br&gt;&lt;a href=&quot;https://evil.example&quot;&gt;there&lt;/a&gt;",
  );
  const { container } = render(<Diagram code={hostile} language="xml" />);

  const svg = container.querySelector("svg[role=img]")!;
  expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
  expect(svg.querySelector("rect")?.getAttribute("stroke")).toBe("red");
  expect(svg.querySelector("text")?.getAttribute("fill")).toBe("#2b241f");
  expect([...svg.querySelectorAll("tspan")].map((t) => t.textContent)).toEqual(["Hello", "there"]);
  expect(container.querySelector("img, a, image, foreignObject, script, [href], [onerror]")).toBeNull();
});

test.each([
  ["a diagram still arriving", drawio.slice(0, drawio.length / 2)],
  ["a draw.io file saved compressed", "<mxfile><diagram>7ZVNb4MwDIZ/DdfJEGjXq6Nb</diagram></mxfile>"],
  ["broken Excalidraw", '{"type": "excalidraw", "elements": [ {'],
  ["too many parts to draw", cell("").replace('<mxCell id="a"', '<mxCell id="b"/>'.repeat(600) + '<mxCell id="a"')],
])("%s is shown as code instead", (_, code) => {
  const { container } = render(<Diagram code={code} language="xml" />);
  expect(container.querySelector("figure.code pre")?.textContent).toBe(code);
  expect(container.querySelector("figure.diagram")).toBeNull();
});

test("XML that is not a diagram never reaches the diagram renderer", () => {
  const { container } = render(<Markdown text={'```xml\n<note><to>Ana</to></note>\n```'} />);
  expect(container.querySelector("figure.code")).not.toBeNull();
});

test("its code can be shown and hidden, and copied to open in draw.io", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Diagram code={drawio} language="xml" />);

  const show = screen.getByRole("button", { name: "Show code" });
  expect(show.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(show);
  expect(screen.getByRole("region", { name: "Diagram source" }).textContent).toBe(drawio);
  fireEvent.click(screen.getByRole("button", { name: "Hide code" }));
  expect(screen.queryByRole("region", { name: "Diagram source" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Copy for draw.io" }));
  expect(writeText).toHaveBeenCalledWith(drawio);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});
