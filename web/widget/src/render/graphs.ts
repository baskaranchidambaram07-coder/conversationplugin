// Mermaid's state, class, entity-relationship and mind-map diagrams (M3-T7), read into the flowchart's graph and laid
// out by its layered layout (mermaid.ts), on the same sheet. As with flowcharts, only words, shapes and the kinds of
// line are used: styling, classes, clicks, links and notes are skipped, so nothing in the source can run or fetch.
import { type Chart, type Direction, type Edge, layout, type Node } from "./mermaid";
import type { Head, Scene } from "./scene";

const MAX_NODES = 200;
const MAX_EDGES = 400;

/** The source's lines, trimmed, without comments, settings (a --- block) or empty ones. */
function linesOf(code: string): string[] {
  let lines = code.split("\n");
  if (lines[0]?.trim() === "---") lines = lines.slice(lines.slice(1).findIndex((l) => l.trim() === "---") + 2);
  return lines.map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
}

const unquote = (words: string) => words.trim().replace(/^"(.*)"$/, "$1").trim();
const edge = (from: string, to: string, fields: Partial<Edge> = {}): Edge => ({
  from,
  to,
  label: "",
  dashed: false,
  thick: false,
  start: false,
  end: false,
  hidden: false,
  ...fields,
});
const tooBig = (chart: Chart) => chart.nodes.size > MAX_NODES || chart.edges.length > MAX_EDGES;
const directionOf = (line: string): Direction | null => {
  const given = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line)?.[1]?.toUpperCase();
  return given ? ((given === "TD" ? "TB" : given) as Direction) : null;
};

/** A state diagram: states (with their descriptions), composite states as frames, start and end dots, choices, forks
 *  and joins, and the transitions between them with their words. */
export function readState(code: string): Chart | null {
  const lines = linesOf(code);
  if (!/^stateDiagram(?:-v2)?$/.test(lines[0] ?? "")) return null;
  const chart: Chart = { direction: "TB", nodes: new Map(), edges: [], groups: [] };
  const open: number[] = []; // composite states being read, innermost last
  const composite = new Map<string, number>(); // a composite state's name to its frame
  const scope = () => (open.length ? open[open.length - 1]! : null);
  const state = (id: string): string => {
    if (id === "[*]") return id;
    const node: Node = chart.nodes.get(id) ?? { label: id, kind: "rect", round: "soft", group: scope() };
    chart.nodes.set(id, node);
    return id;
  };
  // [*] is the start where a transition leaves it and the end where one reaches it, one of each in every frame.
  const dot = (end: boolean): string => {
    const id = `\u0001${end ? "end" : "start"}${scope() ?? ""}`;
    // Named for the spoken description: "Start", or inside a composite state "Paid, start".
    const where = scope() === null ? "" : `${chart.groups[scope()!]!.title}, `;
    const label = `${where}${end ? (where ? "end" : "End") : where ? "start" : "Start"}`;
    if (!chart.nodes.has(id)) chart.nodes.set(id, { label, kind: "ellipse", round: "square", group: scope(), dot: end ? "end" : "start" });
    return id;
  };
  let note = false;
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/:::[\w-]+/g, "").trim();
    if (note) {
      note = !/^end note$/i.test(line);
      continue;
    }
    if (/^note\b/i.test(line)) {
      note = !line.includes(":"); // a note of its own lines runs to "end note"
      continue;
    }
    const turn = directionOf(line);
    if (turn) {
      if (!open.length) chart.direction = turn;
      continue;
    }
    if (line === "--" || /^(classDef|class|style|click|accTitle|accDescr|hide|scale)\b/.test(line)) continue;
    if (line === "}") {
      open.pop();
      continue;
    }
    const block = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)\s*\{$/.exec(line);
    if (block) {
      chart.groups.push({ title: block[1] ?? block[2]!, parent: scope() });
      composite.set(block[2]!, chart.groups.length - 1);
      open.push(chart.groups.length - 1);
      continue;
    }
    const kind = /^state\s+([\w.-]+)\s+<<(choice|fork|join)>>$/.exec(line);
    if (kind) {
      chart.nodes.set(kind[1]!, { label: kind[2] === "choice" ? "" : kind[1]!, kind: kind[2] === "choice" ? "rhombus" : "rect", round: "square", group: scope(), ...(kind[2] === "choice" ? {} : { dot: "bar" as const }) });
      continue;
    }
    const named = /^state\s+"([^"]+)"\s+as\s+([\w.-]+)$/.exec(line);
    if (named) {
      chart.nodes.get(state(named[2]!))!.label = named[1]!;
      continue;
    }
    const move = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::\s*(.*))?$/.exec(line);
    if (move) {
      const from = move[1] === "[*]" ? dot(false) : state(move[1]!);
      const to = move[2] === "[*]" ? dot(true) : state(move[2]!);
      chart.edges.push(edge(from, to, { end: true, label: move[3]?.trim() ?? "" }));
      continue;
    }
    const described = /^([\w.-]+)\s*:\s*(.+)$/.exec(line);
    if (described) {
      const node = chart.nodes.get(state(described[1]!))!;
      node.body = node.body ? `${node.body}\n${described[2]!.trim()}` : described[2]!.trim();
      continue;
    }
    const alone = /^state\s+([\w.-]+)$|^([\w.-]+)$/.exec(line);
    if (alone) state(alone[1] ?? alone[2]!);
    else return null; // a line Mermaid would refuse: shown as code
    if (tooBig(chart)) return null;
  }
  // A line into or out of a composite state meets its start or end inside, as the layout joins only states.
  for (const e of chart.edges) {
    if (composite.has(e.to)) e.to = `\u0001start${composite.get(e.to)}`;
    if (composite.has(e.from)) e.from = `\u0001end${composite.get(e.from)}`;
  }
  for (const [name] of composite) chart.nodes.delete(name);
  chart.edges = chart.edges.filter((e) => chart.nodes.has(e.from) && chart.nodes.has(e.to));
  return chart.nodes.size && !tooBig(chart) ? chart : null;
}

// A class diagram's line: its ends' marks around -- (a solid line) or .. (a dotted one).
const RELATION = /^([\w~,.]+)\s*(?:"([^"]*)"\s*)?(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s*(?:"([^"]*)"\s*)?([\w~,.]+)\s*(?::\s*(.+))?$/;
const MARKS: Record<string, Head> = { "<|": "triangle", "|>": "triangle", "*": "diamond", o: "odiamond", "<": "arrow", ">": "arrow" };
const generic = (name: string) => name.replace(/~([^~]+)~/g, "<$1>");

/** A class diagram: each class's name (and its stereotype) over its members, and the relations between classes with
 *  UML's marks: inheritance and realisation as hollow triangles, composition and aggregation as diamonds. */
export function readClass(code: string): Chart | null {
  const lines = linesOf(code);
  if (!/^classDiagram(?:-v2)?$/.test(lines[0] ?? "")) return null;
  const chart: Chart = { direction: "TB", nodes: new Map(), edges: [], groups: [] };
  const members = new Map<string, string[]>();
  const kinds = new Map<string, string>();
  const space: number[] = [];
  const known = (name: string) => {
    const id = name.replace(/~[^~]+~$/, "");
    if (!chart.nodes.has(id)) {
      chart.nodes.set(id, { label: generic(name), kind: "rect", round: "square", group: space.length ? space[space.length - 1]! : null, list: true, divider: true });
      members.set(id, []);
    }
    return id;
  };
  let inside: string | null = null; // the class whose { } block is being read
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/:::[\w-]+/g, "").trim();
    if (inside) {
      if (line === "}") inside = null;
      else if (/^<<.+>>$/.test(line)) kinds.set(inside, line.slice(2, -2));
      else members.get(inside)!.push(generic(line));
      continue;
    }
    const turn = directionOf(line);
    if (turn) {
      chart.direction = turn;
      continue;
    }
    if (/^(classDef|cssClass|style|click|link|callback|note|accTitle|accDescr)\b/.test(line)) continue;
    const namespace = /^namespace\s+([\w.-]+)\s*\{$/.exec(line);
    if (namespace) {
      chart.groups.push({ title: namespace[1]!, parent: space.length ? space[space.length - 1]! : null });
      space.push(chart.groups.length - 1);
      continue;
    }
    if (line === "}") {
      space.pop();
      continue;
    }
    const declared = /^class\s+([\w~,.]+)(?:\["([^"]*)"\])?\s*(\{)?\s*(\})?$/.exec(line);
    if (declared) {
      const id = known(declared[1]!);
      if (declared[2]) chart.nodes.get(id)!.label = declared[2];
      if (declared[3] && !declared[4]) inside = id;
      continue;
    }
    const stereotype = /^<<(.+)>>\s+([\w~,.]+)$/.exec(line);
    if (stereotype) {
      kinds.set(known(stereotype[2]!), stereotype[1]!);
      continue;
    }
    const relation = RELATION.exec(line);
    if (relation) {
      const [, a, near, left, dotted, right, far, b, words] = relation;
      const ends = [near, far].filter(Boolean);
      const label = [words?.trim(), ends.length === 2 ? `${near} to ${far}` : ""].filter(Boolean).join(" · ");
      chart.edges.push(
        edge(known(a!), known(b!), {
          label,
          dashed: dotted === "..",
          start: Boolean(left),
          end: Boolean(right),
          heads: [MARKS[left ?? ""] ?? "arrow", MARKS[right ?? ""] ?? "arrow"],
        }),
      );
      continue;
    }
    const member = /^([\w~,.]+)\s*:\s*(.+)$/.exec(line);
    if (member) members.get(known(member[1]!))!.push(generic(member[2]!.trim()));
    else return null;
    if (tooBig(chart)) return null;
  }
  for (const [id, node] of chart.nodes) {
    const kind = kinds.get(id);
    if (kind) node.label = `«${kind}»\n${node.label}`;
    const list = members.get(id)!;
    if (list.length) node.body = list.join("\n");
    else delete node.divider;
  }
  return chart.nodes.size && !tooBig(chart) ? chart : null;
}

// How many on each side of an entity-relationship line, as people write it.
const MANY: Record<string, string> = { "|o": "0..1", "o|": "0..1", "||": "1", "}o": "0..n", "o{": "0..n", "}|": "1..n", "|{": "1..n" };
const ENTITY = String.raw`("[^"]+"|[\w-]+)`;
const LINK = new RegExp(String.raw`^${ENTITY}\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*${ENTITY}\s*:\s*(.+)$`);

/** An entity-relationship diagram: each entity over its attributes (keys marked), and each relationship's words with
 *  how many there are on each side ("places (1 to 0..n)"); a dotted line where the relationship does not identify. */
export function readEr(code: string): Chart | null {
  const lines = linesOf(code);
  if (!/^erDiagram$/.test(lines[0] ?? "")) return null;
  const chart: Chart = { direction: "TB", nodes: new Map(), edges: [], groups: [] };
  const attributes = new Map<string, string[]>();
  const entity = (name: string) => {
    const label = unquote(name);
    if (!chart.nodes.has(label)) {
      chart.nodes.set(label, { label, kind: "rect", round: "square", group: null, list: true, divider: true });
      attributes.set(label, []);
    }
    return label;
  };
  let inside: string | null = null;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (inside) {
      if (line === "}") inside = null;
      else {
        const field = /^([\w()[\],.-]+)\s+([\w-]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"[^"]*")?$/.exec(line);
        if (!field) return null;
        attributes.get(inside)!.push(`${field[2]}: ${field[1]}${field[3] ? ` ${field[3].replace(/\s+/g, "")}` : ""}`);
      }
      continue;
    }
    const turn = directionOf(line);
    if (turn) {
      chart.direction = turn;
      continue;
    }
    if (/^(classDef|class|style|accTitle|accDescr)\b/.test(line)) continue;
    const block = new RegExp(String.raw`^${ENTITY}(?:\s*\[[^\]]*\])?\s*\{$`).exec(line);
    if (block) {
      inside = entity(block[1]!);
      continue;
    }
    const link = LINK.exec(line);
    if (link) {
      const [, a, left, dotted, right, b, words] = link;
      const label = `${unquote(words!)} (${MANY[left!]} to ${MANY[right!]})`;
      chart.edges.push(edge(entity(a!), entity(b!), { label, dashed: dotted === ".." }));
      continue;
    }
    const alone = new RegExp(String.raw`^${ENTITY}$`).exec(line);
    if (alone) entity(alone[1]!);
    else return null;
    if (tooBig(chart)) return null;
  }
  for (const [name, node] of chart.nodes) {
    const list = attributes.get(name)!;
    if (list.length) node.body = list.join("\n");
    else delete node.divider;
  }
  return chart.nodes.size && !tooBig(chart) ? chart : null;
}

/** A mind map: its tree, read from the indentation, laid out from the root outwards. The root is a pill, a node
 *  written ((like this)) a circle, and the rest soft boxes; icons and classes are skipped. */
export function readMindmap(code: string): Chart | null {
  const raw = code.split("\n").filter((line) => line.trim() && !line.trim().startsWith("%%"));
  if (raw[0]?.trim() !== "mindmap") return null;
  const chart: Chart = { direction: "LR", nodes: new Map(), edges: [], groups: [] };
  const stack: { depth: number; id: string }[] = [];
  for (const line of raw.slice(1)) {
    const words = line.trim();
    if (/^::icon\(|^:::/.test(words)) continue;
    const depth = line.length - line.trimStart().length;
    // id[square], id(round), id((circle)), id))bang((, id)cloud(, id{{hexagon}}: the shape follows the id at once.
    const shaped = /^[\w-]*(\(\(|\)\)|\{\{|\[|\(|\))(.+?)(\)\)|\(\(|\}\}|\]|\)|\()$/.exec(words.replace(/:::[\w-\s]+$/, "").trim());
    const label = unquote(shaped ? shaped[2]! : words.replace(/:::[\w-\s]+$/, ""));
    if (!label) continue;
    const id = `n${chart.nodes.size}`;
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent && chart.nodes.size) return null; // a second root: not a mind map Mermaid would draw
    chart.nodes.set(id, { label, kind: shaped?.[1] === "((" ? "ellipse" : "rect", round: parent ? "soft" : "pill", group: null });
    if (parent) chart.edges.push(edge(parent.id, id));
    stack.push({ depth, id });
    if (tooBig(chart)) return null;
  }
  return chart.nodes.size ? chart : null;
}

/** A state, class, entity-relationship or mind-map diagram drawn as a scene, or null when the source is none of
 *  them, or one of them this cannot read. */
export function fromGraph(code: string): Scene | null {
  const chart = readState(code) ?? readClass(code) ?? readEr(code) ?? readMindmap(code);
  const drawn = chart && layout(chart);
  return drawn && { kind: "Mermaid", ...drawn };
}
