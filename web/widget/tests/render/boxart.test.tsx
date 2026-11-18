// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { fromBoxArt, readBoxArt } from "../../src/render/boxart";
import { Code } from "../../src/render/Code";
import gallery from "../../src/render/gallery/drawings.md?raw";
import Markdown, { fenceDrawings } from "../../src/render/Markdown";
import { fenceRenderer } from "../../src/render/registry";

afterEach(cleanup);

// The two drawings a Purple Fabric agent gave, names changed: one fenced, one written straight into the answer.
const complaint = /```\n([\s\S]*?)```/.exec(gallery)![1]!;
const short = gallery.slice(gallery.indexOf("┌", gallery.indexOf("### ")));

const arrows = (code: string) => {
  const chart = readBoxArt(code)!;
  const name = (id: string) => chart.nodes.get(id)!.label;
  return chart.edges.map((e) => `${name(e.from)} > ${name(e.to)}${e.label ? `: ${e.label}` : ""}`).sort();
};

test("an agent's flowchart drawn in text, its walls out of line, is read as its boxes and the arrows between them", () => {
  expect(arrows(complaint)).toEqual(
    [
      "START: BACKGROUND > PENSION TRANSFER ADVICE GIVEN",
      "PENSION TRANSFER ADVICE GIVEN > SERVICE FAILURES IDENTIFIED",
      "SERVICE FAILURES IDENTIFIED > REGULATORY BREACHES ALLEGED",
      "REGULATORY BREACHES ALLEGED > COMPLAINT FORMALLY RAISED — 05 APRIL 2023",
      "COMPLAINT FORMALLY RAISED — 05 APRIL 2023 > ACTIONS REQUESTED FROM FIRM",
      "ACTIONS REQUESTED FROM FIRM > DECISION POINT (8-WEEK RESPONSE WINDOW FROM FIRM)",
      "DECISION POINT (8-WEEK RESPONSE WINDOW FROM FIRM) > IF FIRM ACCEPTS LIABILITY",
      "DECISION POINT (8-WEEK RESPONSE WINDOW FROM FIRM) > IF FIRM REJECTS / NO RESPONSE",
      "IF FIRM ACCEPTS LIABILITY > REMEDIATION ACTIONS",
      "IF FIRM REJECTS / NO RESPONSE > ESCALATION TO FINANCIAL OMBUDSMAN SERVICE (FOS)",
      "ESCALATION TO FINANCIAL OMBUDSMAN SERVICE (FOS) > FOS DECISION ISSUED",
      "REMEDIATION ACTIONS > END: CASE RESOLVED",
      "FOS DECISION ISSUED > END: CASE RESOLVED",
    ].sort(),
  );
});

test("a box's heading is set over its body, whose wrapped lines are joined again, one list item to a line", () => {
  const nodes = [...readBoxArt(complaint)!.nodes.values()];
  const box = (label: string) => nodes.find((n) => n.label === label)!;

  expect(box("PENSION TRANSFER ADVICE GIVEN")).toMatchObject({
    body: [
      "• Mr. Hale advised to transfer pension to Ashby Wealth",
      "• Funds invested ONLY in Ashby's managed pension funds",
      "• Lost diversification/risk-spread of original company scheme",
    ].join("\n"),
    list: true,
  });
  expect(box("START: BACKGROUND")).toMatchObject({
    body: "Jan 2013 – Mr. Hale engages Ashby Wealth Management LLC (Post-RDR) for pension advice & annual review service",
    list: false,
  });
  expect(box("ACTIONS REQUESTED FROM FIRM").body?.split("\n")[0]).toBe(
    "1. Investigate suitability of pension transfer & all other products sold to Mr. Hale",
  );
  expect(box("DECISION POINT (8-WEEK RESPONSE WINDOW FROM FIRM)").body).toBeUndefined(); // all capitals: no heading
});

test("a drawing written outside a fenced block is fenced, and its boxes, branches and a name on a rule are read", () => {
  expect(fenceDrawings(`Here:\n${short}`)).toBe(`Here:\n\`\`\`\n${short.trimEnd()}\n\`\`\`\n`);
  expect(arrows(short)).toEqual(
    [
      "Pension Advice Given (2013) > Service Failures (Missed reviews, poor risk disclosure)",
      "Service Failures (Missed reviews, poor risk disclosure) > FCA Breaches (P2, P6, P7, P9)",
      "FCA Breaches (P2, P6, P7, P9) > Complaint Filed (05 Apr 2023)",
      "Complaint Filed (05 Apr 2023) > Actions Requested (Investigate/Refund)",
      "Actions Requested (Investigate/Refund) > Accepted → Pay Redress",
      "Actions Requested (Investigate/Refund) > Escalate to FOS",
      "Accepted → Pay Redress > Resolved",
      "Escalate to FOS > Resolved",
    ].sort(),
  );
});

test("words on a line become its label, a line may run sideways, and an arrowhead sets which way it goes", () => {
  const drawing = [
    "┌───────┐      ┌────────┐",
    "│ Start │─ go ─►│ Booked │",
    "└───┬───┘      └────────┘",
    "    │",
    "   Yes",
    "    ▼",
    "┌───────┐",
    "│ Done  │",
    "└───┬───┘",
    "    ▲",
    "    │",
    "┌───┴───┐",
    "│ Later │",
    "└───────┘",
  ].join("\n");

  expect(arrows(drawing)).toEqual(["Later > Done", "Start > Booked: go", "Start > Done: Yes"]);
});

test("text that is not a flowchart stays text: one box, a table drawn in boxes, boxes inside a box, no lines", () => {
  const table = "┌─────┬─────┐\n│ a   │ b   │\n├─────┼─────┤\n│ 1   │ 2   │\n└─────┴─────┘";
  const nested = "┌──────────────┐\n│ ┌──┐  ┌──┐   │\n│ │a │─►│b │   │\n│ └──┘  └──┘   │\n└──────────────┘";
  const apart = "┌───┐  ┌───┐\n│ a │  │ b │\n└───┘  └───┘";

  for (const code of [table, nested, apart, "┌───┐\n│ a │\n└───┘"]) expect(readBoxArt(code)).toBeNull();
});

test("the flowchart is laid out afresh: every box drawn once, none over another, each one's words inside it", () => {
  const scene = fromBoxArt(complaint)!;
  const boxes = scene.shapes.filter((s) => s.kind === "rect");
  expect(boxes).toHaveLength(13);
  expect(scene.lines).toHaveLength(13);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  for (const words of scene.shapes.filter((s) => s.kind === "text"))
    expect(boxes.some((b) => words.x >= b.x && words.x + words.w <= b.x + b.w && words.y >= b.y && words.y + words.h <= b.y + b.h)).toBe(true);
});

test("a flowchart drawn in text shows as text while it streams, then as a drawing whose text is one press away", async () => {
  expect(fenceRenderer("", complaint, false)).toBe(Code);
  expect(fenceRenderer("", complaint, true)).toBe(fenceRenderer("mermaid", "", true));

  render(<Markdown text={gallery} />);
  const [first] = await screen.findAllByRole("region", { name: "Flowchart" });
  const figure = first!.closest("figure")!;
  expect(within(figure).getByRole("img", { name: "Diagram: 13 shapes and 13 lines" }).textContent).toContain("FOS DECISION ISSUED");
  expect(within(figure).getByRole("button", { name: "Copy text" })).toBeTruthy();

  fireEvent.click(within(figure).getByRole("button", { name: "Show text" }));
  expect(within(figure).getByRole("region", { name: "Text drawing" }).className).toBe("art");
  expect(screen.getAllByRole("region", { name: "Flowchart" })).toHaveLength(2);
});
