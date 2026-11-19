// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { fromGraph, readClass, readEr, readMindmap, readState } from "../../src/render/graphs";
import Markdown from "../../src/render/Markdown";
import { fromGantt, fromTimeline, readGantt } from "../../src/render/timelines";

afterEach(cleanup);

test("a state diagram's states, words and start and end dots are read; a composite state is a frame its lines meet inside", () => {
  const chart = readState(`stateDiagram-v2
    direction LR
    [*] --> Requested
    Requested --> Held : room free
    state "Paid in full" as Paid
    Held --> Paid
    Held : kept for a day
    state Stay {
      [*] --> In
      In --> [*]
    }
    Paid --> Stay
    state pick <<choice>>
    Stay --> pick
    note right of Held : a note is skipped
    Requested --> [*]`)!;
  expect(chart.direction).toBe("LR");
  const labels = [...chart.nodes.values()].map((n) => n.label);
  expect(labels).toEqual(expect.arrayContaining(["Start", "End", "Requested", "Held", "Paid in full", "In", "Stay, start", "Stay, end"]));
  expect(labels).not.toContain("Stay"); // the composite is the frame round its states, not a state of its own
  expect(chart.nodes.get("Held")!.body).toBe("kept for a day");
  expect(chart.nodes.get("pick")!.kind).toBe("rhombus");
  expect(chart.groups).toEqual([{ title: "Stay", parent: null }]);
  const into = chart.edges.find((e) => e.from === "Paid")!;
  expect(chart.nodes.get(into.to)!.label).toBe("Stay, start");
  expect(chart.edges.find((e) => e.to === "Held")!.label).toBe("room free");
  expect(chart.edges.every((e) => e.end)).toBe(true);
});

test("a class diagram reads members under each name, stereotypes, and UML's ends: triangles, diamonds and dotted lines", () => {
  const chart = readClass(`classDiagram
    class Room {
      <<abstract>>
      +int number
      +sleeps() int
    }
    Room <|-- GuestRoom
    Resident "1" *-- "many" Booking : makes
    Booking o-- Guest
    Booking ..> Payment : settled by
    Booking : +String reference
    class Shape~T~`)!;
  expect(chart.nodes.get("Room")).toMatchObject({ label: "«abstract»\nRoom", body: "+int number\n+sleeps() int", divider: true, list: true });
  expect(chart.nodes.get("GuestRoom")!.divider).toBeUndefined(); // no members, no rule
  expect(chart.nodes.get("Booking")!.body).toBe("+String reference");
  expect(chart.nodes.get("Shape")!.label).toBe("Shape<T>");
  const inherits = chart.edges.find((e) => e.to === "GuestRoom")!;
  expect(inherits).toMatchObject({ from: "Room", start: true, end: false, heads: ["triangle", "arrow"] });
  expect(chart.edges.find((e) => e.to === "Booking")).toMatchObject({ start: true, heads: ["diamond", "arrow"], label: "makes · 1 to many" });
  expect(chart.edges.find((e) => e.to === "Guest")!.heads![0]).toBe("odiamond");
  expect(chart.edges.find((e) => e.to === "Payment")).toMatchObject({ dashed: true, end: true, heads: ["arrow", "arrow"] });
});

test("an entity-relationship diagram reads attributes with their keys, and how many there are on each side of a line", () => {
  const chart = readEr(`erDiagram
    RESIDENT ||--o{ BOOKING : makes
    BOOKING }|..|| ROOM : "is for"
    RESIDENT {
      string id PK "their number"
      string house FK
    }`)!;
  expect(chart.nodes.get("RESIDENT")!.body).toBe("id: string PK\nhouse: string FK");
  expect(chart.edges[0]).toMatchObject({ from: "RESIDENT", to: "BOOKING", label: "makes (1 to 0..n)", dashed: false });
  expect(chart.edges[1]).toMatchObject({ label: "is for (1..n to 1)", dashed: true });
});

test("a mind map is read as a tree from its indentation, its root a pill and a ((circle)) a circle", () => {
  const chart = readMindmap(`mindmap
  root((College))
    Rooms
      Single
      ::icon(fa fa-bed)
    Study (and quiet)
      id[Library]`)!;
  expect([...chart.nodes.values()].map((n) => n.label)).toEqual(["College", "Rooms", "Single", "Study (and quiet)", "Library"]);
  expect(chart.nodes.get("n0")).toMatchObject({ kind: "ellipse", round: "pill" });
  expect(chart.edges.map((e) => [e.from, e.to])).toEqual([["n0", "n1"], ["n1", "n2"], ["n0", "n3"], ["n3", "n4"]]);
  expect(readMindmap("mindmap\n  one\ntwo")).toBeNull(); // two roots
});

test("a line none of these readers knows leaves the diagram as code", () => {
  expect(readState("stateDiagram-v2\n  A --> B\n  this is not a state line ->")).toBeNull();
  expect(readClass("classDiagram\n  A <|-- B\n  %%{ init }%%\n  ???")).toBeNull();
  expect(readEr("erDiagram\n  A ||--o{ B makes")).toBeNull();
  expect(fromGraph("gitGraph\n  commit")).toBeNull();
});

test("a Gantt chart's tasks are dated from their starts, durations, ends and other tasks", () => {
  const gantt = readGantt(`gantt
    title Autumn term
    dateFormat YYYY-MM-DD
    excludes weekends
    section Arrival
    Welcome week :done, w1, 2026-09-21, 7d
    Inspections :active, after w1, 5d
    Next : 2d
    section Teaching
    Lectures begin :milestone, m1, 2026-10-05, 0d
    Exams :2026-12-07, 2026-12-18`)!;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  expect(gantt.title).toBe("Autumn term");
  expect(gantt.tasks.map((t) => [t.name, t.start, t.end])).toEqual([
    ["Welcome week", day("2026-09-21"), day("2026-09-28")],
    ["Inspections", day("2026-09-28"), day("2026-10-03")],
    ["Next", day("2026-10-03"), day("2026-10-05")],
    ["Lectures begin", day("2026-10-05"), day("2026-10-05")],
    ["Exams", day("2026-12-07"), day("2026-12-18")],
  ]);
  expect([...gantt.tasks[0]!.tags]).toEqual(["done"]);
  expect(gantt.tasks[3]!.section).toBe("Teaching");
  expect(readGantt("gantt\n  dateFormat HH:mm\n  A :10:00, 1h")).toBeNull(); // a format this does not read
  expect(readGantt("gantt\n  A :2026-02-30, 1d")).toBeNull(); // no such day
  expect(readGantt("gantt\n  A :2026-03-02, 2026-03-01")).toBeNull(); // ends before it starts
});

test("a Gantt chart and a timeline say what they show as sentences", () => {
  const gantt = fromGantt("gantt\n  title Plan\n  section Arrival\n  Welcome :crit, 2026-09-21, 7d\n  Go live :milestone, 2026-10-01, 0d")!;
  expect(gantt.description).toBe("Plan. Arrival: Welcome, 21 Sept 2026 to 27 Sept 2026, critical. Go live, 1 Oct 2026 (milestone).");
  const timeline = fromTimeline("timeline\n  title Year\n  section Start\n    Week 1 : Keys : Dinner\n    Week 2 : Warden\n           : Library")!;
  expect(timeline.description).toBe("Year. Week 1: Keys; Dinner. Week 2: Warden; Library.");
});

test("each kind is drawn in an answer: hollow triangles and diamonds on a class diagram's lines, a Gantt chart's bars", async () => {
  render(
    <Markdown
      text={[
        "```mermaid",
        "classDiagram",
        "  Room <|-- GuestRoom",
        "  Resident *-- Booking",
        "```",
        "",
        "```mermaid",
        "gantt",
        "  Welcome :2026-09-21, 7d",
        "```",
      ].join("\n")}
    />,
  );
  const [classes, plan] = await screen.findAllByRole("img", { name: /^Diagram: / });
  const heads = [...classes!.querySelectorAll("polygon")];
  expect(heads.some((h) => h.getAttribute("fill") === "#ffffff")).toBe(true); // the hollow triangle
  expect(heads.some((h) => h.getAttribute("points")!.split(" ").length === 4)).toBe(true); // the diamond
  expect(within(plan!.closest("figure")!).getByRole("img").querySelector("desc")!.textContent).toBe("Welcome, 21 Sept 2026 to 27 Sept 2026.");
});
