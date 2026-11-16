import { expect, test } from "vitest";

import { fromMermaid, readFlowchart } from "./mermaid";
import type { Point, Shape } from "./scene";

const MACHINES = `flowchart TB
    SKF["Shared Knowledge Foundation"]
    CC["Command Centre Governance"]
    BUILD["BUILD Machine: New applications"]
    CHANGE["CHANGE Machine: Controlled change"]
    RUN["RUN Machine: Faster incident response"]
    MODERNISE["MODERNISE Machine: Legacy modernisation"]

    SKF --> BUILD
    SKF --> CHANGE
    SKF --> RUN
    SKF --> MODERNISE
    CC --> BUILD
    CC --> CHANGE
    CC --> RUN
    CC --> MODERNISE`;

const named = (shapes: Shape[], label: string) => shapes.find((s) => s.label.replace(/\n/g, " ") === label)!;
const overlap = (a: Shape, b: Shape) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const onRim = ([x, y]: Point, s: Shape) =>
  x >= s.x - 0.5 && x <= s.x + s.w + 0.5 && y >= s.y - 0.5 && y <= s.y + s.h + 0.5 &&
  (Math.abs(x - s.x) < 0.5 || Math.abs(x - s.x - s.w) < 0.5 || Math.abs(y - s.y) < 0.5 || Math.abs(y - s.y - s.h) < 0.5);

test("an answer's flowchart is laid out in layers: the foundations above the four machines, no box over another", () => {
  const scene = fromMermaid(MACHINES)!;

  expect(scene.kind).toBe("Mermaid");
  expect(scene.shapes).toHaveLength(6);
  expect(scene.lines).toHaveLength(8);
  const [foundation, machine] = [named(scene.shapes, "Shared Knowledge Foundation"), named(scene.shapes, "RUN Machine: Faster incident response")];
  expect(foundation.y + foundation.h).toBeLessThan(machine.y);
  for (const [i, a] of scene.shapes.entries()) for (const b of scene.shapes.slice(i + 1)) expect(overlap(a, b)).toBe(false);
  for (const line of scene.lines) {
    expect(line.end && !line.start && !line.dashed).toBe(true);
    expect(onRim(line.points[0]!, named(scene.shapes, line.from))).toBe(true);
    expect(onRim(line.points[line.points.length - 1]!, named(scene.shapes, line.to))).toBe(true);
  }
});

test("shapes, arrows and their words are read as Mermaid writes them, left to right when it says LR", () => {
  const scene = fromMermaid(`flowchart LR
    A([Start]) --> B{Is it open?}
    B -- yes --> C[(Bookings)]
    B -.->|no| D((Wait))
    C ==> E[[Done]]
    E --- F>Note]`)!;
  const shape = (label: string) => named(scene.shapes, label);
  const line = (from: string, to: string) => scene.lines.find((l) => l.from === from && l.to === to)!;

  expect(shape("Start").radius).toBe(shape("Start").h / 2);
  expect([shape("Is it open?").kind, shape("Bookings").kind, shape("Wait").kind]).toEqual(["rhombus", "cylinder", "ellipse"]);
  expect(shape("Start").x + shape("Start").w).toBeLessThan(shape("Is it open?").x);
  expect(line("Is it open?", "Bookings")).toMatchObject({ label: "yes", dashed: false, end: true });
  expect(line("Is it open?", "Wait")).toMatchObject({ label: "no", dashed: true, end: true });
  expect(line("Bookings", "Done").width).toBe(3);
  expect(line("Done", "Note")).toMatchObject({ end: false, start: false });
});

test("chains, several nodes joined with &, statements split by semicolons, and a loop drawn back up", () => {
  const chart = readFlowchart("graph TD; A --> B --> C; A & B --> D; C --> A")!;
  expect(chart.edges.map((e) => `${e.from}${e.to}`)).toEqual(["AB", "BC", "AD", "BD", "CA"]);

  const scene = fromMermaid("graph TD; A --> B --> C; C --> A")!;
  const [a, b, c] = ["A", "B", "C"].map((label) => named(scene.shapes, label));
  expect(a!.y < b!.y && b!.y < c!.y).toBe(true);
  const back = scene.lines.find((l) => l.from === "C" && l.to === "A")!;
  expect(onRim(back.points[back.points.length - 1]!, a!)).toBe(true); // the arrow still points at A
  expect(back.points.length).toBeGreaterThan(2); // round B, through a waypoint
});

test("a subgraph is a titled frame round its own nodes, beneath them", () => {
  const scene = fromMermaid(`flowchart TB
    visitor[Visitor] --> ask[Ask]
    subgraph desk [Front desk]
      ask --> log[Log it]
    end
    log --> team[Team]`)!;
  const frame = scene.shapes[0]!;

  expect(frame.label).toBe("Front desk");
  expect(overlap(frame, named(scene.shapes, "Visitor"))).toBe(false);
  for (const label of ["Ask", "Log it"]) { // Ask, named first outside, is the desk's: the subgraph names it too
    const s = named(scene.shapes, label);
    expect(s.x > frame.x && s.y > frame.y && s.x + s.w < frame.x + frame.w && s.y + s.h < frame.y + frame.h).toBe(true);
  }
  expect(overlap(frame, named(scene.shapes, "Team"))).toBe(false);
});

test("words lose their markup: line breaks kept, tags, icons and Markdown marks dropped, entities read", () => {
  const chart = readFlowchart('flowchart TB\n  A["Line one<br/>Line <b>two</b>"] --> B["`**Bold** fa:fa-car car #quot;quoted#quot;`"]')!;

  expect(chart.nodes.get("A")!.label).toBe("Line one\nLine two");
  expect(chart.nodes.get("B")!.label).toBe('Bold car "quoted"');
});

test("nothing in a chart can link, run or colour anything: click, style and classes are skipped", () => {
  const scene = fromMermaid(`flowchart TB
    A["<img src=x onerror=alert(1)>Hello<script>alert(2)</script>"] --> B
    click A "https://evil.example" "Go"
    click B call steal()
    style A fill:url(#x),stroke:#f00
    classDef bad fill:#f00
    class B bad
    linkStyle 0 stroke:#f00`)!;

  expect(scene.shapes.map((s) => s.label)).toEqual(["Helloalert(2)", "B"]);
  expect(new Set(scene.shapes.map((s) => s.fill))).toEqual(new Set(["#ffffff"]));
  expect(JSON.stringify(scene)).not.toMatch(/evil|steal|url\(|#f00/);
});

test("only flowcharts are drawn: other Mermaid diagrams, empty ones and very large ones are left as code", () => {
  for (const other of ["sequenceDiagram\n  A->>B: Hi", "classDiagram\n  A <|-- B", "pie\n  \"a\": 1", "flowchart TB", "", "A --> B"]) {
    expect(fromMermaid(other)).toBeNull();
  }
  const many = Array.from({ length: 201 }, (_, i) => `  n${i} --> n${i + 1}`).join("\n");
  expect(fromMermaid(`flowchart TB\n${many}`)).toBeNull();
  expect(fromMermaid("%%{init: {'theme': 'dark'}}%%\nflowchart TB\n  A --> B")).not.toBeNull(); // settings are skipped
});
