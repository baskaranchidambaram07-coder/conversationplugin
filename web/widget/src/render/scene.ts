// Diagrams in answers: draw.io XML and Excalidraw JSON, read into one small scene of shapes and lines that
// Diagram.tsx draws as SVG. The source is untrusted: only numbers, plain colours and text leave this file, so
// nothing in a diagram can fetch, link or run anything. A diagram this cannot read is shown as code instead.

export type Point = [number, number];
type Align = "start" | "middle" | "end";

export type Shape = {
  kind: "rect" | "ellipse" | "rhombus" | "cylinder" | "actor" | "text" | "swimlane";
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  angle: number; // degrees, about the centre
  fill: string;
  stroke: string;
  width: number;
  dashed: boolean;
  label: string;
  size: number;
  color: string;
  bold: boolean;
  align: Align;
  valign: "top" | "middle";
  wrap: boolean;
};

export type Line = {
  points: Point[];
  stroke: string;
  width: number;
  dashed: boolean;
  start: boolean; // an arrowhead at the first point
  end: boolean;
  label: string;
  at: number; // where along the line its label sits, 0 to 1
  size: number;
  color: string;
  from: string; // what it joins, for the spoken description
  to: string;
};

export type Scene = { kind: "draw.io" | "Excalidraw"; shapes: Shape[]; lines: Line[] };

const INK = "#2b241f";
const PAPER = "#ffffff";
const MAX_ITEMS = 500;

/** A colour the diagram may use: #rgb or #rrggbb, a plain colour name, or none. Never a url() or anything else. */
export function colour(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "transparent") return "none";
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v) || /^[a-z]{3,20}$/.test(v) ? v : fallback;
}

const num = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? Math.max(-100_000, Math.min(100_000, n)) : fallback;
};

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 500) : "");

function shape(fields: Partial<Shape> & Pick<Shape, "x" | "y" | "w" | "h">): Shape {
  return {
    kind: "rect",
    radius: 0,
    angle: 0,
    fill: PAPER,
    stroke: INK,
    width: 1,
    dashed: false,
    label: "",
    size: 12,
    color: INK,
    bold: false,
    align: "middle",
    valign: "middle",
    wrap: true,
    ...fields,
  };
}

// --- draw.io --------------------------------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number; kind: Shape["kind"] };

const centre = (b: Box): Point => [b.x + b.w / 2, b.y + b.h / 2];

/** Where a line from the box's centre towards p leaves the box. */
function rim(b: Box, p: Point): Point {
  const [cx, cy] = centre(b);
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const a = b.w / 2 || 1;
  const c = b.h / 2 || 1;
  const k =
    b.kind === "ellipse"
      ? 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (c * c))
      : b.kind === "rhombus"
        ? 1 / (Math.abs(dx) / a + Math.abs(dy) / c)
        : Math.min(Math.abs(a / (dx || 1e-9)), Math.abs(c / (dy || 1e-9)));
  return [cx + dx * k, cy + dy * k];
}

/** The style string as a map; a bare word (such as "ellipse" or "text") names the shape. */
function styleOf(style: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (style ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at)] = part.slice(at + 1);
    else if (part && !out.bare) out.bare = part;
  }
  return out;
}

function kindOf(s: Record<string, string>): Shape["kind"] {
  const name = s.shape ?? s.bare ?? "";
  if (/ellipse/i.test(name)) return "ellipse";
  if (name === "rhombus") return "rhombus";
  if (/cylinder|datastore/i.test(name)) return "cylinder";
  if (/actor/i.test(name)) return "actor";
  if (name === "text" || name === "edgeLabel" || name === "label") return "text";
  if (name === "swimlane") return "swimlane";
  return "rect";
}

/** A label's words: draw.io labels may be HTML, of which only the text and its line breaks are kept. */
function words(value: string, html: boolean): string {
  if (!html || !/[<&]/.test(value)) return text(value);
  const doc = new DOMParser().parseFromString(value.replace(/<br\s*\/?>|<\/(?:div|p|li)>/gi, "\n"), "text/html");
  return text(doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n");
}

/** Bends a path through its points at right angles, as draw.io's orthogonal edges run. */
function orthogonal(points: Point[]): Point[] {
  const out: Point[] = [points[0]!];
  let horizontal = true;
  for (const p of points.slice(1)) {
    const q = out[out.length - 1]!;
    if (Math.abs(q[0] - p[0]) > 0.5 && Math.abs(q[1] - p[1]) > 0.5) out.push(horizontal ? [p[0], q[1]] : [q[0], p[1]]);
    const last = out[out.length - 1]!;
    horizontal = Math.abs(last[1] - p[1]) > 0.5; // the next turn follows the direction just taken
    out.push(p);
  }
  return out;
}

/** The end of an edge on its box: a fixed point when the style names one, else the side facing `towards`. */
function endOn(b: Box, s: Record<string, string>, side: "exit" | "entry", towards: Point, square: boolean): Point {
  if (s[`${side}X`] !== undefined && s[`${side}Y`] !== undefined) {
    return [b.x + b.w * num(s[`${side}X`], 0.5), b.y + b.h * num(s[`${side}Y`], 0.5)];
  }
  if (square && towards[0] > b.x && towards[0] < b.x + b.w) return [towards[0], towards[1] < b.y ? b.y : b.y + b.h];
  if (square && towards[1] > b.y && towards[1] < b.y + b.h) return [towards[0] < b.x ? b.x : b.x + b.w, towards[1]];
  return rim(b, towards);
}

/** Two boxes joined at right angles with no points given: side to side through the gap between them. */
function elbow(a: Box, b: Box): Point[] | null {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  if (b.x > a.x + a.w || b.x + b.w < a.x) {
    const right = bx > ax;
    const start: Point = [right ? a.x + a.w : a.x, ay];
    const end: Point = [right ? b.x : b.x + b.w, by];
    const mid = (start[0] + end[0]) / 2;
    return [start, [mid, start[1]], [mid, end[1]], end];
  }
  if (b.y > a.y + a.h || b.y + b.h < a.y) {
    const down = by > ay;
    const start: Point = [ax, down ? a.y + a.h : a.y];
    const end: Point = [bx, down ? b.y : b.y + b.h];
    const mid = (start[1] + end[1]) / 2;
    return [start, [start[0], mid], [end[0], mid], end];
  }
  return null;
}

export function fromDrawio(xml: string): Scene | null {
  // Only a finished diagram is parsed: WebKit's error document for broken XML carries an inline style, which the
  // chat's content policy refuses and reports, once for each streamed piece of a diagram still arriving.
  if (!/<\/(?:mxGraphModel|mxfile)>\s*$/.test(xml)) return null;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  // shortcut: a compressed <diagram> (draw.io's saved-file default) is shown as code; inflate it when agents send one.
  const model = doc.getElementsByTagName("mxGraphModel")[0];
  if (!model) return null;
  const cells = [...model.getElementsByTagName("mxCell")];
  if (!cells.length || cells.length > MAX_ITEMS) return null;

  type Cell = { id: string; el: Element; s: Record<string, string>; label: string; geo: Element | null };
  const byId = new Map<string, Cell>();
  for (const el of cells) {
    // Cells with properties of their own are wrapped in <object> or <UserObject>, which holds the ID and label.
    const wrap = el.parentElement && el.parentElement !== model.firstElementChild ? el.parentElement : null;
    const holder = wrap && /^(object|UserObject)$/.test(wrap.nodeName) ? wrap : el;
    const s = styleOf(el.getAttribute("style"));
    const raw = holder.getAttribute(holder === el ? "value" : "label") ?? "";
    const id = holder.getAttribute("id") ?? "";
    const geo = [...el.children].find((child) => child.nodeName === "mxGeometry") ?? null;
    byId.set(id, { id, el, s, label: words(raw, s.html === "1"), geo });
  }

  // A vertex inside a group or container is placed relative to it.
  const boxes = new Map<string, Box>();
  const boxOf = (cell: Cell, depth = 0): Box | null => {
    if (boxes.has(cell.id)) return boxes.get(cell.id)!;
    if (cell.el.getAttribute("vertex") !== "1" || !cell.geo || depth > 20) return null;
    const parent = byId.get(cell.el.getAttribute("parent") ?? "");
    if (parent?.el.getAttribute("edge") === "1") return null; // a label on an edge, placed with its edge
    const offset = parent ? boxOf(parent, depth + 1) : null;
    const g = cell.geo;
    const box: Box = {
      x: num(g.getAttribute("x")) + (offset?.x ?? 0),
      y: num(g.getAttribute("y")) + (offset?.y ?? 0),
      w: Math.max(0, num(g.getAttribute("width"))),
      h: Math.max(0, num(g.getAttribute("height"))),
      kind: kindOf(cell.s),
    };
    boxes.set(cell.id, box);
    return box;
  };

  const shapes: Shape[] = [];
  const lines: Line[] = [];
  for (const cell of byId.values()) {
    const box = boxOf(cell);
    if (!box) continue;
    const s = cell.s;
    const style = Number.parseInt(s.fontStyle ?? "0", 10) || 0;
    shapes.push(
      shape({
        ...box,
        radius: s.rounded === "1" ? Math.min(20, (Math.min(box.w, box.h) * num(s.arcSize, 15)) / 100) : 0,
        angle: num(s.rotation),
        fill: colour(s.fillColor, box.kind === "text" ? "none" : PAPER),
        stroke: colour(s.strokeColor, box.kind === "text" ? "none" : INK),
        width: Math.min(8, num(s.strokeWidth, 1)),
        dashed: s.dashed === "1",
        label: cell.label,
        size: Math.min(48, Math.max(6, num(s.fontSize, 12))),
        color: colour(s.fontColor, INK),
        bold: (style & 1) === 1 || box.kind === "swimlane",
        align: s.align === "left" ? "start" : s.align === "right" ? "end" : "middle",
        valign: s.verticalAlign === "top" || box.kind === "swimlane" ? "top" : "middle",
        wrap: s.whiteSpace === "wrap" || box.kind !== "text",
      }),
    );
  }

  const pointOf = (el: Element | undefined): Point | null =>
    el ? [num(el.getAttribute("x")), num(el.getAttribute("y"))] : null;
  for (const cell of byId.values()) {
    if (cell.el.getAttribute("edge") !== "1") continue;
    const s = cell.s;
    const source = byId.get(cell.el.getAttribute("source") ?? "");
    const target = byId.get(cell.el.getAttribute("target") ?? "");
    const a = source ? boxOf(source) : null;
    const b = target ? boxOf(target) : null;
    const marks = [...(cell.geo?.children ?? [])];
    const via = (marks.find((m) => m.nodeName === "Array")?.children ?? []) as HTMLCollection;
    const waypoints = [...via].map((p) => pointOf(p)!);
    const loose = (as: string) => pointOf(marks.find((m) => m.getAttribute("as") === as));
    const square = /orthogonal|elbow|entityRelation/.test(s.edgeStyle ?? "");

    let points: Point[] | null = null;
    if (a && b && square && !waypoints.length && s.exitX === undefined && s.entryX === undefined) points = elbow(a, b);
    if (!points) {
      const first = waypoints[0] ?? (b ? centre(b) : loose("targetPoint"));
      const last = waypoints[waypoints.length - 1] ?? (a ? centre(a) : loose("sourcePoint"));
      const start = a && first ? endOn(a, s, "exit", first, square) : loose("sourcePoint");
      const end = b && last ? endOn(b, s, "entry", last, square) : loose("targetPoint");
      if (!start || !end) continue;
      points = square ? orthogonal([start, ...waypoints, end]) : [start, ...waypoints, end];
    }
    // A label may also be a child cell of the edge, placed along it (x from -1 at the start to 1 at the end).
    const child = [...byId.values()].find((c) => c.el.getAttribute("parent") === cell.id && c.label);
    lines.push({
      points,
      stroke: colour(s.strokeColor, INK),
      width: Math.min(8, num(s.strokeWidth, 1)),
      dashed: s.dashed === "1",
      start: (s.startArrow ?? "none") !== "none",
      end: (s.endArrow ?? "classic") !== "none",
      label: cell.label || child?.label || "",
      at: child?.geo ? (num(child.geo.getAttribute("x")) + 1) / 2 : 0.5,
      size: Math.min(48, Math.max(6, num(s.fontSize, 11))),
      color: colour(s.fontColor, INK),
      from: source?.label ?? "",
      to: target?.label ?? "",
    });
  }
  return shapes.length || lines.length ? { kind: "draw.io", shapes, lines } : null;
}

// --- Excalidraw -----------------------------------------------------------------------------------------------

type Element_ = Record<string, unknown>;

export function fromExcalidraw(json: string): Scene | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const all = Array.isArray(data) ? data : (data as { elements?: unknown })?.elements;
  if (!Array.isArray(all) || all.length > MAX_ITEMS) return null;
  const elements = all.filter((e): e is Element_ => !!e && typeof e === "object" && !(e as Element_).isDeleted);
  const inside = new Map<string, string>(); // the text bound to a shape or arrow, by its ID
  for (const e of elements) if (e.type === "text" && typeof e.containerId === "string") inside.set(e.containerId, text(e.text));
  const named = (binding: unknown) => inside.get(String((binding as { elementId?: unknown })?.elementId ?? "")) ?? "";

  const arrows = new Set(elements.filter((e) => e.type === "arrow").map((e) => String(e.id)));

  const shapes: Shape[] = [];
  const lines: Line[] = [];
  const kinds: Record<string, Shape["kind"]> = { rectangle: "rect", frame: "rect", ellipse: "ellipse", diamond: "rhombus" };
  for (const e of elements) {
    if (e.type === "text" && arrows.has(String(e.containerId))) continue; // drawn as its arrow's label
    const [x, y, w, h] = [num(e.x), num(e.y), Math.abs(num(e.width)), Math.abs(num(e.height))];
    const angle = (num(e.angle) * 180) / Math.PI;
    const stroke = colour(e.strokeColor, "#1e1e1e");
    const dashed = e.strokeStyle === "dashed" || e.strokeStyle === "dotted" || e.type === "frame";
    if (typeof e.type === "string" && kinds[e.type]) {
      const radius = e.roundness ? Math.min(32, Math.min(w, h) * 0.25) : 0;
      const fill = colour(e.backgroundColor, "none");
      shapes.push(shape({ kind: kinds[e.type], x, y, w, h, radius, angle, fill, stroke, dashed, width: num(e.strokeWidth, 2) }));
    } else if (e.type === "text") {
      const size = Math.min(96, Math.max(6, num(e.fontSize, 20)));
      const align = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
      const valign = e.containerId ? "middle" : "top";
      const label = text(e.text);
      shapes.push(shape({ kind: "text", x, y, w, h, angle, fill: "none", stroke: "none", label, size, color: stroke, align, valign, wrap: false }));
    } else if (e.type === "arrow" || e.type === "line" || e.type === "freedraw") {
      const points = (Array.isArray(e.points) ? e.points : []).slice(0, 2000).map((p): Point => [x + num(p?.[0]), y + num(p?.[1])]);
      if (points.length < 2) continue;
      const arrow = e.type === "arrow";
      lines.push({
        points,
        stroke,
        width: num(e.strokeWidth, 2),
        dashed,
        start: arrow && !!e.startArrowhead,
        end: arrow && e.endArrowhead !== null,
        label: inside.get(String(e.id)) ?? "",
        at: 0.5,
        size: 16,
        color: stroke,
        from: named(e.startBinding),
        to: named(e.endBinding),
      });
    }
  }
  return shapes.length || lines.length ? { kind: "Excalidraw", shapes, lines } : null;
}

export const sceneOf = (code: string): Scene | null => {
  try {
    return code.trimStart().startsWith("<") ? fromDrawio(code) : fromExcalidraw(code);
  } catch {
    return null;
  }
};
