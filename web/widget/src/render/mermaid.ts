// Mermaid flowcharts in answers, read into the same scene as draw.io and Excalidraw (scene.ts) and laid out here in
// layers, top to bottom or left to right as the chart says, the way Mermaid's own layout does. The chat cannot run
// the Mermaid library: it writes inline styles, which the chat's content policy refuses. Only `flowchart` and `graph`
// are read; any other Mermaid diagram, or one this cannot read, is shown as code.
// The source is untrusted: only its words, its shapes' kinds and its arrows' kinds are used. click, style, classDef,
// class and linkStyle are skipped, so a chart can neither link, fetch nor colour anything.

import { type Box, INK, type Line, type Point, rim, type Scene, type Shape, shape, text } from "./scene";

type Direction = "TB" | "BT" | "LR" | "RL";
/** A node's words. A box drawn in text (boxart.ts) may add a body under them: its paragraphs, one per line. */
export type Node = {
  label: string;
  kind: Shape["kind"];
  round: "square" | "soft" | "pill";
  group: number | null;
  body?: string;
  list?: boolean; // the body is a list, so it is set flush left
};
export type Edge = { from: string; to: string; label: string; dashed: boolean; thick: boolean; start: boolean; end: boolean; hidden: boolean };
type Group = { title: string; parent: number | null };

const MAX_NODES = 200;
const MAX_EDGES = 400;
const SIZE = 14; // px: a node's words
const BODY = 13; // px: a box's body, under its words
const BODY_INK = "#44403c";
const MAX_WAYPOINTS = 2_000; // an arrow over many layers bends through one in each; past this the chart is code
const CHAR = 0.55; // an average character's width, in ems, as Diagram.tsx measures
const LEAD = 1.25;
const WIDEST = 200; // px: a node's words wrap past this
const GAP = 36; // px between nodes in a layer
const FILL = "#ffffff";
const FRAME = "#f6efe6"; // a subgraph's ground
const FRAME_EDGE = "#cdbfae";
const TITLE = 26; // px: a subgraph's title band

// --- reading -----------------------------------------------------------------------------------------------------

/** Statements: one per line, or several separated by semicolons outside quotes and entities such as #quot;. */
function statements(code: string): string[] {
  const out: string[] = [];
  let lines = code.split("\n");
  if (lines[0]?.trim() === "---") lines = lines.slice(lines.slice(1).findIndex((l) => l.trim() === "---") + 2); // settings
  for (const line of lines) {
    if (line.trim().startsWith("%%")) continue;
    let current = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      if (ch === ";" && !quoted && !/#\w+$/.test(current)) {
        out.push(current.trim());
        current = "";
      } else current += ch;
    }
    out.push(current.trim());
  }
  return out.filter(Boolean);
}

/** A label's words: quotes, Markdown strings, HTML line breaks and tags, icons and entities reduced to plain text. */
function words(raw: string): string {
  const entity = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");
  return text(
    raw
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/^`([\s\S]*)`$/, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/fa:fa-[\w-]+\s*/g, "")
      .replace(/\*\*|__/g, "")
      .replace(/#quot;/g, '"')
      .replace(/#(\d+);/g, (_, n: string) => entity(Number(n)))
      .replace(/&(lt|gt|amp|quot|#39);/g, (_, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" })[e] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim(),
  );
}

const ID = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[-.](?=[\p{L}\p{N}_]))*/u;

// Each opening bracket, its possible closings, and the shape it draws. Longer openings first.
const SHAPES: [string, string[], Shape["kind"], Node["round"]][] = [
  ["(((", [")))"], "ellipse", "square"],
  ["((", ["))"], "ellipse", "square"],
  ["([", ["])"], "rect", "pill"],
  ["[[", ["]]"], "rect", "square"],
  ["[(", [")]"], "cylinder", "square"],
  ["[/", ["/]", "\\]"], "rect", "square"],
  ["[\\", ["\\]", "/]"], "rect", "square"],
  ["{{", ["}}"], "rect", "soft"],
  ["(", [")"], "rect", "soft"],
  ["[", ["]"], "rect", "square"],
  ["{", ["}"], "rhombus", "square"],
  [">", ["]"], "rect", "square"],
];

type Read = { id: string; end: number; node?: Pick<Node, "label" | "kind" | "round"> };

/** A node at `at`: its ID and, if it has one, its bracketed shape and label. */
function nodeAt(s: string, at: number): Read | null {
  const id = ID.exec(s.slice(at))?.[0];
  if (!id) return null;
  let end = at + id.length;
  for (const [open, closes, kind, round] of SHAPES) {
    if (!s.startsWith(open, end)) continue;
    let from = end + open.length;
    while (s[from] === " ") from++;
    let inner = from;
    if (s[from] === '"') {
      const quote = s.indexOf('"', from + 1);
      if (quote < 0) return null;
      inner = quote + 1;
      while (s[inner] === " ") inner++;
    }
    const found = closes.map((close) => [s.indexOf(close, inner), close.length] as const).filter(([i]) => i >= 0);
    if (!found.length) return null;
    const [close, length] = found.reduce((a, b) => (b[0] < a[0] ? b : a));
    return { id, end: close + length, node: { label: words(s.slice(from, close)), kind, round } };
  }
  return { id, end };
}

type Link = Omit<Edge, "from" | "to">;

const WITH_TEXT = /^([<ox])?(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.-+)([>ox])?(?=\s|$|[\p{L}\p{N}_])/u;
const PLAIN = /^([<ox])?(-{2,}|={2,}|-\.+-|~{3,})([>ox])?(?:\s*\|([^|]*)\|)?/;

/** An arrow at `at`, with its words if it has any: --> --- -.-> ==> <--> -- words --> -->|words| ~~~ and so on. */
function linkAt(s: string, at: number): [Link, number] | null {
  const rest = s.slice(at);
  const spoken = WITH_TEXT.exec(rest);
  const plain = spoken ? null : PLAIN.exec(rest);
  const m = spoken ?? plain;
  if (!m) return null;
  const [body, ending] = spoken ? [`${spoken[2]}${spoken[4]}`, spoken[5]] : [plain![2]!, plain![3]];
  const link = {
    label: words((spoken ? spoken[3] : plain![4]) ?? ""),
    dashed: body.includes("."),
    thick: body.startsWith("="),
    start: m[1] === "<",
    end: ending === ">",
    hidden: body.startsWith("~"),
  };
  return [link, at + m[0].length];
}

export type Chart = { direction: Direction; nodes: Map<string, Node>; edges: Edge[]; groups: Group[] };

/** The chart's nodes, arrows and subgraphs, or null when it is not a flowchart or holds nothing to draw. */
export function readFlowchart(code: string): Chart | null {
  const all = statements(code);
  const header = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$/i.exec(all[0] ?? "");
  if (!header) return null;
  const given = (header[1] ?? "TB").toUpperCase();
  const chart: Chart = { direction: (given === "TD" ? "TB" : given) as Direction, nodes: new Map(), edges: [], groups: [] };
  const open: number[] = []; // the subgraphs being read, innermost last
  const inner = () => (open.length ? open[open.length - 1]! : null);

  const meet = (read: Read) => {
    const known = chart.nodes.get(read.id);
    const node: Node = known ?? { label: read.id, kind: "rect", round: "square", group: null };
    if (read.node) Object.assign(node, read.node, { label: read.node.label || read.id });
    if (open.length) node.group = inner(); // as in Mermaid, a node belongs to the last subgraph that names it
    chart.nodes.set(read.id, node);
  };

  for (const s of all.slice(1)) {
    const word = /^\w+/.exec(s)?.[0] ?? "";
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)$/.test(word)) continue;
    if (word === "subgraph") {
      const rest = s.slice(8).trim();
      const named = /^[\p{L}\p{N}_-]+\s*\[(.*)\]$/u.exec(rest);
      chart.groups.push({ title: words(named ? named[1]! : rest), parent: inner() });
      open.push(chart.groups.length - 1);
      continue;
    }
    if (s === "end") {
      open.pop();
      continue;
    }
    // node (& node)* (arrow node (& node)*)*; a statement that does not read so is skipped, as Mermaid would refuse it
    const found: Edge[] = [];
    const met: Read[] = [];
    let previous: string[] = [];
    let link: Link | null = null;
    let at = 0;
    let ok = true;
    while (ok) {
      const group: string[] = [];
      for (;;) {
        while (s[at] === " ") at++;
        const read = nodeAt(s, at);
        if (!read) break;
        met.push(read);
        group.push(read.id);
        at = read.end;
        while (s[at] === " ") at++;
        if (s[at] !== "&") break;
        at++;
      }
      if (!group.length) ok = false;
      else if (link) for (const from of previous) for (const to of group) found.push({ from, to, ...link });
      previous = group;
      while (s[at] === " ") at++;
      if (!ok || at >= s.length) break;
      const next = linkAt(s, at);
      if (next) [link, at] = next;
      else ok = false;
    }
    if (!ok) continue;
    met.forEach(meet);
    chart.edges.push(...found);
    if (chart.nodes.size > MAX_NODES || chart.edges.length > MAX_EDGES) return null;
  }
  return chart.nodes.size ? chart : null;
}

// --- laying out --------------------------------------------------------------------------------------------------

/** About how wide words are in the chat's typeface, in ems: capitals are wider than lower case, spaces narrower. */
export function ems(words: string, bold = false): number {
  let sum = 0;
  for (const ch of words) sum += /[A-Z]/.test(ch) ? 0.7 : /[a-z]/.test(ch) ? 0.57 : /[  ]/.test(ch) ? 0.27 : /[.,:;'()|!-]/.test(ch) ? 0.34 : 0.62;
  return sum * (bold ? 1.04 : 1);
}

const MARK = /^(?:[•●◦▪‣]|\d{1,2}[.)])\s+/u;

/** Words wrapped to the widest a node may be, as lines. A list item's further lines hang under its words. */
function wrap(label: string, widest = WIDEST, size = SIZE, bold = false): string[] {
  const room = widest - 24;
  return label.split("\n").flatMap((paragraph) => {
    const hang = " ".repeat(Math.round(ems(MARK.exec(paragraph)?.[0] ?? "") / 0.27));
    const out: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ems(next, bold) * size > room) {
        out.push(line);
        line = hang + word;
      } else line = next;
    }
    return [...out, line];
  });
}

const widthOf = (lines: string[], size: number, bold = false) => Math.max(0, ...lines.map((line) => ems(line, bold) * size));

/** A node's box for its wrapped words, its body and its shape. */
function size(node: Node, lines: string[], body: string[]): { w: number; h: number } {
  const w = Math.max(widthOf(lines, SIZE, Boolean(node.body)), widthOf(body, BODY)) + 24;
  const h = lines.length * SIZE * LEAD + (body.length ? 6 + body.length * BODY * LEAD : 0) + 18;
  if (node.kind === "rhombus") return { w: Math.max(w + h, 70), h: Math.max(w + h, 70) * 0.75 };
  if (node.kind === "ellipse") {
    const d = Math.hypot(w, h);
    return { w: Math.max(d, 60), h: Math.max(d, 60) };
  }
  return { w: Math.max(w, 70), h: Math.max(h, 40) + (node.kind === "cylinder" ? 14 : 0) };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** A flowchart drawn as a scene, or null when the source is not one this reads. */
export function fromMermaid(code: string): Scene | null {
  const chart = readFlowchart(code);
  const drawn = chart && layout(chart);
  return drawn && { kind: "Mermaid", ...drawn };
}

/** A chart's nodes in layers along its direction and its arrows between them, or null when it is too big to draw. */
export function layout(chart: Chart, widest = WIDEST): Pick<Scene, "shapes" | "lines"> | null {
  const { direction, nodes, edges, groups } = chart;
  const across = direction === "TB" || direction === "BT" ? "w" : "h";
  const along = across === "w" ? "h" : "w";
  const ids = [...nodes.keys()];
  const lines = new Map(ids.map((id) => [id, wrap(nodes.get(id)!.label, widest, SIZE, Boolean(nodes.get(id)!.body))]));
  const bodies = new Map(ids.map((id) => [id, nodes.get(id)!.body ? wrap(nodes.get(id)!.body!, widest, BODY) : []]));
  const boxes = new Map(ids.map((id) => [id, size(nodes.get(id)!, lines.get(id)!, bodies.get(id)!)]));

  // Layers: an arrow back up the chart is turned round to find them, so a loop still reads top to bottom.
  const outgoing = new Map(ids.map((id) => [id, [] as Edge[]]));
  for (const edge of edges) if (edge.from !== edge.to) outgoing.get(edge.from)!.push(edge);
  const state = new Map<string, 1 | 2>();
  const back = new Set<Edge>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const edge of outgoing.get(id)!) {
      if (state.get(edge.to) === 1) back.add(edge);
      else if (!state.has(edge.to)) visit(edge.to);
    }
    state.set(id, 2);
  };
  ids.forEach((id) => state.has(id) || visit(id));
  const down = edges.filter((e) => e.from !== e.to).map((e) => (back.has(e) ? { e, top: e.to, bottom: e.from } : { e, top: e.from, bottom: e.to }));
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let changed = true, rounds = 0; changed && rounds <= ids.length; rounds++) {
    changed = false;
    for (const { top, bottom } of down) {
      if (rank.get(bottom)! < rank.get(top)! + 1) {
        rank.set(bottom, rank.get(top)! + 1);
        changed = true;
      }
    }
  }

  // An arrow over several layers passes through a waypoint in each layer between, so it can bend round nodes.
  const layers: string[][] = [];
  const place = (id: string, r: number) => (layers[r] ??= []).push(id);
  ids.forEach((id) => place(id, rank.get(id)!));
  const waypoints = down.reduce((sum, { top, bottom }) => sum + rank.get(bottom)! - rank.get(top)! - 1, 0);
  if (waypoints > MAX_WAYPOINTS) return null;
  const wide = new Map<string, number>(); // the waypoints of an arrow with words are as wide as its words
  const chains = down.map(({ e, top, bottom }, i) => {
    const said = e.label.split("\n");
    const room = across === "w" ? Math.max(...said.map((l) => l.length)) * 13 * CHAR + 12 : said.length * 13 * LEAD + 8;
    const via = Array.from({ length: rank.get(bottom)! - rank.get(top)! - 1 }, (_, k) => {
      const id = `\u0000${i}.${k}`;
      rank.set(id, rank.get(top)! + k + 1);
      place(id, rank.get(id)!);
      if (e.label) wide.set(id, room);
      return id;
    });
    return { e, path: [top, ...via, bottom], reversed: back.has(e) };
  });
  const above = new Map<string, string[]>();
  const below = new Map<string, string[]>();
  for (const { path } of chains) {
    for (let k = 1; k < path.length; k++) {
      (above.get(path[k]!) ?? above.set(path[k]!, []).get(path[k]!)!).push(path[k - 1]!);
      (below.get(path[k - 1]!) ?? below.set(path[k - 1]!, []).get(path[k - 1]!)!).push(path[k]!);
    }
  }
  const spanOf = (id: string) => boxes.get(id)?.[across] ?? wide.get(id) ?? 12;
  const outer = (id: string) => {
    let g = nodes.get(id)?.group ?? null;
    while (g !== null && groups[g]!.parent !== null) g = groups[g]!.parent;
    return g;
  };

  // Order within each layer: towards the mean place of each node's neighbours, a subgraph's nodes kept together.
  for (let sweep = 0; sweep < 6; sweep++) {
    const downward = sweep % 2 === 0;
    const range = downward ? layers.map((_, r) => r).slice(1) : layers.map((_, r) => r).slice(0, -1).reverse();
    for (const r of range) {
      const other = layers[downward ? r - 1 : r + 1]!;
      const neighbours = downward ? above : below;
      const score = new Map(
        layers[r]!.map((id, i) => {
          const near = (neighbours.get(id) ?? []).map((n) => other.indexOf(n));
          return [id, near.length ? mean(near) : i] as const;
        }),
      );
      const together = new Map<number, number>();
      for (const id of layers[r]!) {
        const g = outer(id);
        if (g !== null && !together.has(g)) together.set(g, mean(layers[r]!.filter((o) => outer(o) === g).map((o) => score.get(o)!)));
      }
      const key = (id: string) => [outer(id) === null ? score.get(id)! : together.get(outer(id)!)!, score.get(id)!];
      layers[r]!.sort((a, b) => {
        const [ka, kb] = [key(a), key(b)];
        return ka[0]! - kb[0]! || ka[1]! - kb[1]!;
      });
    }
  }

  // Positions across each layer: centred under the node's neighbours where there is room, packed where there is not.
  const at = new Map<string, number>();
  const pack = (layer: string[], wanted: number[]) => {
    const placed = [...wanted];
    for (let i = 1; i < layer.length; i++) {
      const gap = layer[i]!.startsWith("\u0000") || layer[i - 1]!.startsWith("\u0000") ? GAP / 2 : GAP;
      placed[i] = Math.max(placed[i]!, placed[i - 1]! + (spanOf(layer[i - 1]!) + spanOf(layer[i]!)) / 2 + gap);
    }
    const shift = mean(placed.map((p, i) => p - wanted[i]!));
    layer.forEach((id, i) => at.set(id, placed[i]! - shift));
  };
  for (const layer of layers) {
    let x = 0;
    pack(
      layer,
      layer.map((id) => (x += spanOf(id) + GAP) - spanOf(id) / 2),
    );
  }
  for (let sweep = 0; sweep < 8; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const neighbours = downward ? above : below;
      pack(
        layer,
        layer.map((id) => {
          const near = neighbours.get(id) ?? [];
          return near.length ? mean(near.map((n) => at.get(n)!)) : at.get(id)!;
        }),
      );
    }
  }

  // Positions along: each layer as deep as its deepest node, with room between for arrows and their words.
  const gap = (groups.length ? 76 : 52) + (edges.some((e) => e.label) ? 16 : 0);
  const depth: number[] = [];
  layers.forEach((layer, r) => {
    const deepest = Math.max(0, ...layer.map((id) => boxes.get(id)?.[along] ?? 0));
    const before = r ? depth[r - 1]! + Math.max(0, ...layers[r - 1]!.map((id) => boxes.get(id)?.[along] ?? 0)) / 2 + gap : 0;
    depth[r] = before + deepest / 2;
  });
  const centre = (id: string): Point => {
    const [a, d] = [at.get(id)!, depth[rank.get(id)!]!];
    return { TB: [a, d], BT: [a, -d], LR: [d, a], RL: [-d, a] }[direction] as Point;
  };
  const boxOf = (id: string): Box => {
    const [x, y] = centre(id);
    const { w, h } = boxes.get(id)!;
    return { x: x - w / 2, y: y - h / 2, w, h, kind: nodes.get(id)!.kind };
  };

  // Subgraphs: a frame round their nodes, innermost first; a frame that would hold a node not in it is left out.
  const inside = (g: number, id: string) => {
    for (let n = nodes.get(id)?.group ?? null; n !== null; n = groups[n]!.parent) if (n === g) return true;
    return false;
  };
  const depthOf = (g: number): number => (groups[g]!.parent === null ? 0 : 1 + depthOf(groups[g]!.parent!));
  const frames = new Map<number, Box>();
  for (const g of groups.map((_, i) => i).sort((a, b) => depthOf(b) - depthOf(a))) {
    const parts = [...ids.filter((id) => inside(g, id)).map(boxOf), ...[...frames].filter(([c]) => groups[c]!.parent === g).map(([, b]) => b)];
    if (!parts.length) continue;
    const [x0, y0] = [Math.min(...parts.map((b) => b.x)) - 14, Math.min(...parts.map((b) => b.y)) - 14 - TITLE];
    const [x1, y1] = [Math.max(...parts.map((b) => b.x + b.w)) + 14, Math.max(...parts.map((b) => b.y + b.h)) + 14];
    const extra = Math.max(0, groups[g]!.title.length * 13 * CHAR + 24 - (x1 - x0)) / 2; // room for its title
    const frame: Box = { x: x0 - extra, y: y0, w: x1 - x0 + 2 * extra, h: y1 - y0, kind: "rect" };
    const crosses = ids.some((id) => {
      if (inside(g, id)) return false;
      const b = boxOf(id);
      return b.x < frame.x + frame.w && b.x + b.w > frame.x && b.y < frame.y + frame.h && b.y + b.h > frame.y;
    });
    if (!crosses) frames.set(g, frame);
  }

  const shapes: Shape[] = [...frames]
    .sort(([a], [b]) => depthOf(a) - depthOf(b))
    .map(([g, b]) =>
      shape({ ...b, radius: 10, fill: FRAME, stroke: FRAME_EDGE, label: groups[g]!.title, size: 13, bold: true, valign: "top", wrap: false }),
    );
  for (const id of ids) {
    const node = nodes.get(id)!;
    const b = boxOf(id);
    const radius = node.round === "pill" ? b.h / 2 : node.round === "soft" ? 10 : 2;
    const body = bodies.get(id)!;
    if (!body.length) {
      shapes.push(shape({ ...b, radius, fill: FILL, stroke: INK, width: 1.5, label: lines.get(id)!.join("\n"), size: SIZE, wrap: false }));
      continue;
    }
    // Its words in bold over its body, both set from the top of the box.
    const head = lines.get(id)!.length * SIZE * LEAD;
    const words = { kind: "text" as const, valign: "top" as const, wrap: false };
    const left = node.list ? { x: b.x + 12, w: b.w - 24, align: "start" as const } : { x: b.x, w: b.w, align: "middle" as const };
    shapes.push(
      shape({ ...b, radius, fill: FILL, stroke: INK, width: 1.5 }),
      shape({ ...words, x: b.x, y: b.y + 9, w: b.w, h: head, label: lines.get(id)!.join("\n"), size: SIZE, bold: true }),
      shape({ ...words, ...left, y: b.y + 15 + head, h: b.h - 24 - head, label: body.join("\n"), size: BODY, color: BODY_INK }),
    );
  }

  const drawn: Line[] = [];
  const line = (e: Edge, points: Point[]): Line => ({
    points,
    stroke: INK,
    width: e.thick ? 3 : 1.5,
    dashed: e.dashed,
    start: e.start,
    end: e.end,
    label: e.label,
    at: 0.5,
    size: 13,
    color: INK,
    from: nodes.get(e.from)!.label,
    to: nodes.get(e.to)!.label,
  });
  for (const { e, path, reversed } of chains) {
    if (e.hidden) continue;
    const middle = path.slice(1, -1).map(centre);
    const [top, bottom] = [path[0]!, path[path.length - 1]!];
    const points = [rim(boxOf(top), middle[0] ?? centre(bottom)), ...middle, rim(boxOf(bottom), middle[middle.length - 1] ?? centre(top))];
    drawn.push(line(e, reversed ? points.reverse() : points));
  }
  for (const e of edges.filter((e) => e.from === e.to && !e.hidden)) {
    const b = boxOf(e.from);
    const [right, y] = [b.x + b.w, b.y + b.h / 2];
    drawn.push(line(e, [[right, y - 8], [right + 22, y - 8], [right + 22, y + 8], [right, y + 8]]));
  }
  return { shapes, lines: drawn };
}
