// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { specOfMermaidPie } from "../../src/render/derive";
import gallery from "../../src/render/gallery/mermaid.md?raw";
import Markdown from "../../src/render/Markdown";
import { fenceRenderer } from "../../src/render/registry";
import { fromSequence, readSequence } from "../../src/render/sequence";

afterEach(cleanup);

const [booking = "", pie = "", gantt = ""] = [...gallery.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]!);

test("a sequence diagram's participants, messages, notes and blocks are read as Mermaid writes them", () => {
  const seq = readSequence(booking)!;

  expect(seq.numbered).toBe(true);
  expect(seq.participants).toEqual([
    { id: "Resident", label: "Resident", actor: true },
    { id: "Chat", label: "Chat assistant", actor: false },
    { id: "Desk", label: "Front desk", actor: false },
    { id: "Rooms", label: "Room system", actor: false },
  ]);
  expect(seq.events.map((e) => e.kind)).toEqual([
    "message", "message", "message", "message", "note", "message",
    "open", "message", "message", "message", "else", "message", "close",
    "open", "message", "close", "note", "deactivate",
  ]);
  expect(seq.events[0]).toMatchObject({ from: "Resident", to: "Chat", activate: true, arrow: { dashed: false, end: true } });
  expect(seq.events[2]).toMatchObject({ from: "Rooms", to: "Chat", deactivate: true, arrow: { dashed: true, end: true } });
  expect(seq.events[4]).toMatchObject({ kind: "note", side: "over", ids: ["Resident", "Chat"] });
  expect(seq.events[6]).toMatchObject({ kind: "open", name: "alt", label: "Room still free" });
});

test("it is laid out as Mermaid lays it out: participants across, lifelines down, messages in order, blocks round theirs", () => {
  const scene = fromSequence(booking)!;
  const box = (label: string) => scene.shapes.filter((s) => s.label === label && s.kind !== "text");
  const messages = scene.lines.filter((l) => l.label);
  const tops = ["Chat assistant", "Front desk", "Room system"].map((label) => box(label)[0]!);

  expect(box("Chat assistant")).toHaveLength(2); // at the top and again at the foot
  for (let i = 1; i < tops.length; i++) expect(tops[i]!.x).toBeGreaterThan(tops[i - 1]!.x + tops[i - 1]!.w); // no box over another
  expect(messages.map((l) => l.label.split("\n")[0])).toEqual([
    "1. Is a guest room free on Friday?", "2. Check availability (Friday)", "3. Room 4 and Room 7 are free",
    "4. Two rooms are free. Book one?", "5. Book Room 4", "6. Hold Room 4 for the resident", "7. Held for 24 hours",
    "8. Booked. Pay at the desk on arrival.", "9. Sorry, Room 4 has just gone.", "10. Release unpaid holds",
  ]);
  const ys = messages.map((l) => l.points[0]![1]);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys); // down the page in order
  expect(messages[2]).toMatchObject({ dashed: true, end: true, shift: expect.any(Number) }); // a reply, its words above
  expect(messages[9]!.points).toHaveLength(4); // a message to itself loops out and back
  const lifelines = scene.lines.filter((l) => l.dashed && !l.label && l.points[0]![0] === l.points[1]![0]);
  expect(lifelines).toHaveLength(4);
  const alt = scene.shapes.find((s) => s.label === "alt")!; // the block's tag, at its frame's corner
  const frame = scene.shapes.find((s) => s.x === alt.x && s.y === alt.y && s.fill === "none")!;
  for (const held of messages.slice(5, 9)) {
    expect(held.points[0]![1]).toBeGreaterThan(frame.y);
    expect(held.points[0]![1]).toBeLessThan(frame.y + frame.h);
  }
});

test("a sequence diagram is drawn with its words spoken, a pie as a chart, and other Mermaid kinds as code", async () => {
  render(<Markdown text={gallery} />);

  const drawing = await screen.findByRole("img", { name: /^Diagram: \d+ shapes and \d+ lines$/ });
  expect(drawing.querySelector("desc")?.textContent).toContain("Resident to Chat assistant: 1. Is a guest room free on Friday?");
  expect(drawing.querySelector("desc")?.textContent).not.toContain("A line."); // lifelines are drawing, not content
  const chart = await screen.findByRole("group", { name: "Pie chart: Questions this term" });
  expect(within(chart.closest("figure")!).getByRole("button", { name: "Copy for Mermaid" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Diagram source" }).textContent).toContain("gantt");
  expect(fenceRenderer("mermaid", pie, false)).toBe(fenceRenderer("python", "x = 1")); // still arriving: code
  expect(fenceRenderer("mermaid", gantt, true)).toBe(fenceRenderer("mermaid", booking, true)); // a diagram, shown as code by it
});

test("a pie's slices and title are read; one Mermaid would refuse is not drawn", () => {
  const term = specOfMermaidPie(pie)!;
  expect(term).toMatchObject({ type: "pie", title: "Questions this term" });
  expect(term.data).toHaveLength(5);
  expect(term.data[0]).toEqual({ Label: "Accommodation", Value: 412 });
  expect(specOfMermaidPie('pie title Pets\n  "Dogs" : 386\n  "Cats" : 85.5')!.data).toEqual([
    { Label: "Dogs", Value: 386 },
    { Label: "Cats", Value: 85.5 },
  ]);
  expect(specOfMermaidPie('pie\n  "Loss" : -5')).toBeNull();
  expect(specOfMermaidPie('pie\n  click "x" call alert()')).toBeNull();
  expect(specOfMermaidPie("pie\n")).toBeNull();
});

test("nothing in a sequence diagram can link, style or run: such lines are skipped, and its words stay words", () => {
  const scene = fromSequence(
    [
      "sequenceDiagram",
      "  participant A as <img src=x onerror=alert(1)>Alice",
      "  link A: Dashboard @ https://evil.example",
      "  A->>B: <script>alert(1)</script>",
      "  style A fill:red",
    ].join("\n"),
  )!;
  const name = scene.shapes.find((s) => s.kind === "rect")!.label.replace(/\s+/g, " "); // wrapped to fit its box
  expect(name).toBe("<img src=x onerror=alert(1)>Alice"); // drawn as text
  expect(scene.lines.filter((l) => l.label).map((l) => l.label)).toEqual(["<script>alert(1)</script>"]);
  const { container } = render(<Markdown text={"```mermaid\nsequenceDiagram\n  A->>B: <b>hi</b>\n```"} />);
  expect(container.querySelector("b, img, script")).toBeNull();
  expect(readSequence("flowchart TD\n A-->B")).toBeNull();
  expect(readSequence(`sequenceDiagram\n${Array.from({ length: 41 }, (_, i) => `participant P${i}`).join("\n")}`)).toBeNull();
});
