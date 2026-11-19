// Mermaid's Gantt charts and timelines (M3-T7), drawn on the diagram's sheet from their dates and words. A Gantt chart
// is a row a task, its bar from start to end on a dated scale, grouped by section; a timeline is a column a period,
// its events under it. Each says what it shows to screen readers as sentences, not as a list of shapes.
import { ems } from "./mermaid";
import { INK, type Line, type Point, type Scene, type Shape, shape } from "./scene";

const MAX_ROWS = 120;
const DAY = 86_400_000;
const SIZE = 13;
const LEAD = 1.25;
const MUTED = "#6b6a68";
const RULE = "#e6e4e0";
const BAND = "#f6efe6"; // a section's ground, as a subgraph's

const text = (fields: Partial<Shape> & Pick<Shape, "x" | "y" | "w" | "h" | "label">) =>
  shape({ kind: "text", size: SIZE, wrap: false, align: "start", ...fields });
const rule = (points: Point[], stroke = RULE): Line => ({
  points,
  stroke,
  width: 1,
  dashed: false,
  start: false,
  end: false,
  label: "",
  at: 0,
  size: SIZE,
  color: INK,
  from: "",
  to: "",
});

function linesOf(code: string): string[] {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
}

// --- Gantt ---------------------------------------------------------------------------------------------------------

type Task = { section: string; name: string; id: string; start: number; end: number; tags: Set<string> };

/** A date in one of the formats Mermaid's dateFormat names most often, as milliseconds; NaN when it is not one. */
function dateIn(format: string, value: string): number {
  const parts = value.match(/\d+/g)?.map(Number) ?? [];
  const order = { "YYYY-MM-DD": [0, 1, 2], "YYYY/MM/DD": [0, 1, 2], "DD-MM-YYYY": [2, 1, 0], "DD/MM/YYYY": [2, 1, 0], "MM/DD/YYYY": [2, 0, 1] }[format];
  if (!order || parts.length !== 3 || !/^\d+[-/]\d+[-/]\d+$/.test(value)) return NaN;
  const [y, m, d] = order.map((i) => parts[i]!);
  const when = Date.UTC(y!, m! - 1, d!);
  return new Date(when).getUTCDate() === d ? when : NaN;
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(w|d|h)$/;
const length = (value: string) => {
  const [, n, unit] = DURATION.exec(value) ?? [];
  return n ? Number(n) * { w: 7, d: 1, h: 1 / 24 }[unit as "w" | "d" | "h"] * DAY : NaN;
};

/** A Gantt chart's tasks with their start and end, or null when it is not one this can read. */
export function readGantt(code: string): { title: string; tasks: Task[] } | null {
  const lines = linesOf(code);
  if (lines[0] !== "gantt") return null;
  let title = "";
  let format = "YYYY-MM-DD";
  let section = "";
  const tasks: Task[] = [];
  for (const line of lines.slice(1)) {
    const setting = /^(title|dateFormat|section)\s+(.+)$/.exec(line);
    if (setting) {
      if (setting[1] === "title") title = setting[2]!.trim();
      else if (setting[1] === "dateFormat") format = setting[2]!.trim();
      else section = setting[2]!.trim();
      continue;
    }
    if (/^(axisFormat|tickInterval|excludes|includes|todayMarker|weekday|weekend|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr|click)\b/.test(line)) continue;
    const task = /^(.+?)\s*:\s*(.+)$/.exec(line);
    if (!task) return null;
    const parts = task[2]!.split(",").map((part) => part.trim());
    const tags = new Set<string>();
    while (["done", "active", "crit", "milestone"].includes(parts[0] ?? "")) tags.add(parts.shift()!);
    const startLike = (part = "") => /^after\s/.test(part) || !Number.isNaN(dateIn(format, part));
    const [id, from, to] = parts.length >= 3 ? parts : parts.length === 2 ? (startLike(parts[0]) ? ["", ...parts] : [parts[0], "", parts[1]]) : ["", "", parts[0]];
    const previous = tasks[tasks.length - 1]?.end ?? NaN;
    const after = /^after\s+(.+)$/.exec(from ?? "");
    const start = after
      ? Math.max(...after[1]!.split(/\s+/).map((name) => tasks.find((t) => t.id === name)?.end ?? NaN))
      : from
        ? dateIn(format, from)
        : previous;
    const until = /^until\s+(\S+)$/.exec(to ?? "");
    const end = until ? (tasks.find((t) => t.id === until[1])?.start ?? NaN) : DURATION.test(to ?? "") ? start + length(to!) : dateIn(format, to ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    tasks.push({ section, name: task[1]!.trim(), id: id ?? "", start, end, tags });
    if (tasks.length > MAX_ROWS) return null;
  }
  return tasks.length ? { title, tasks } : null;
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Ticks along a span: days, weeks, months or quarters, whichever gives a readable handful. */
function ticksOf(start: number, end: number): { at: number; label: string }[] {
  const days = (end - start) / DAY;
  if (days <= 60) {
    const step = days <= 14 ? 1 : 7;
    const out = [];
    for (let at = start; at <= end; at += step * DAY) out.push({ at, label: dayMonth.format(at) });
    return out;
  }
  const months = days <= 400 ? 1 : 3;
  const first = new Date(start);
  const out = [];
  for (let m = first.getUTCMonth() + (first.getUTCDate() > 1 ? 1 : 0); ; m += months) {
    const at = Date.UTC(first.getUTCFullYear(), m, 1);
    if (at > end) break;
    out.push({ at, label: monthYear.format(at) });
  }
  return out;
}

const COLOURS = {
  plain: { fill: "#dbe8f8", stroke: "#2a78d6" },
  done: { fill: "#ecebe7", stroke: "#a8a49c" },
  crit: { fill: "#fbe0df", stroke: "#e34948" },
};

export function fromGantt(code: string): Scene | null {
  const read = readGantt(code);
  if (!read) return null;
  const { title, tasks } = read;
  const first = Math.min(...tasks.map((t) => t.start));
  const last = Math.max(...tasks.map((t) => t.end), first + DAY);
  const span = (last - first) / DAY;
  const perDay = Math.max(4, Math.min(48, 560 / span));
  const names = Math.min(220, Math.max(...tasks.map((t) => ems(t.name) * SIZE), ...tasks.map((t) => ems(t.section, true) * SIZE)) + 16);
  const x = (when: number) => names + ((when - first) / DAY) * perDay;
  const right = x(last);
  const shapes: Shape[] = [];
  const lines: Line[] = [];
  let y = 0;
  if (title) {
    shapes.push(text({ x: 0, y, w: right, h: 22, label: title, size: 15, bold: true }));
    y += 30;
  }
  const ticks = ticksOf(first, last);
  for (const tick of ticks) shapes.push(text({ x: x(tick.at) - 30, y, w: 60, h: 18, label: tick.label, size: 12, color: MUTED, align: "middle" }));
  y += 24;
  const top = y;
  let section: string | null = null;
  const sentences: string[] = title ? [`${title}.`] : [];
  for (const task of tasks) {
    if (task.section && task.section !== section) {
      section = task.section;
      shapes.push(shape({ x: 0, y, w: right, h: 26, fill: BAND, stroke: "none", radius: 4 }));
      shapes.push(text({ x: 8, y: y + 4, w: names, h: 18, label: section, bold: true }));
      sentences.push(`${section}:`);
      y += 30;
    }
    shapes.push(text({ x: 8, y: y + 4, w: names - 12, h: 18, label: task.name }));
    const colour = COLOURS[task.tags.has("crit") ? "crit" : task.tags.has("done") ? "done" : "plain"];
    if (task.tags.has("milestone")) {
      const mid = x(task.start);
      shapes.push(shape({ kind: "rhombus", x: mid - 8, y: y + 5, w: 16, h: 16, fill: colour.stroke, stroke: colour.stroke }));
      sentences.push(`${task.name}, ${fullDate.format(task.start)} (milestone).`);
    } else {
      const w = Math.max(4, x(task.end) - x(task.start));
      shapes.push(shape({ x: x(task.start), y: y + 4, w, h: 18, radius: 4, ...colour, width: task.tags.has("active") ? 2 : 1 }));
      const ends = `${fullDate.format(task.start)} to ${fullDate.format(task.end - (task.end > task.start ? 1 : 0))}`;
      const state = task.tags.has("done") ? ", done" : task.tags.has("active") ? ", under way" : "";
      sentences.push(`${task.name}, ${ends}${task.tags.has("crit") ? ", critical" : ""}${state}.`);
    }
    y += 28;
  }
  // The scale's lines, under everything: a hairline at each tick from the top of the rows to their foot.
  lines.push(...ticks.map((tick) => rule([[x(tick.at), top - 4], [x(tick.at), y]])));
  return { kind: "Mermaid", shapes, lines, description: sentences.join(" ") };
}

// --- timeline ------------------------------------------------------------------------------------------------------

const GROUNDS = ["#f6efe6", "#e8f0fb", "#eaf6ef", "#fbf3d5", "#f9e8ef", "#efeafb"];
const COLUMN = 168;
const GAP = 16;

/** How tall a box is for words wrapped to its width. */
const tall = (words: string, width: number, size = SIZE) => Math.max(1, Math.ceil((ems(words) * size) / (width - 20))) * size * LEAD + 16;

export function fromTimeline(code: string): Scene | null {
  const lines = linesOf(code);
  if (lines[0] !== "timeline") return null;
  let title = "";
  let section = "";
  const periods: { section: string; name: string; events: string[] }[] = [];
  for (const line of lines.slice(1)) {
    const setting = /^(title|section)\s+(.+)$/.exec(line);
    if (setting) {
      if (setting[1] === "title") title = setting[2]!.trim();
      else section = setting[2]!.trim();
      continue;
    }
    if (/^(accTitle|accDescr)\b/.test(line)) continue;
    const [name, ...events] = line.split(/\s+:\s+|\s*:\s+|^:\s*/).map((part) => part.trim());
    if (line.startsWith(":")) {
      const last = periods[periods.length - 1];
      if (!last) return null;
      last.events.push(...events.filter(Boolean));
      continue;
    }
    if (!name) return null;
    periods.push({ section, name, events: events.filter(Boolean) });
    if (periods.length > 40) return null;
  }
  if (!periods.length) return null;

  const shapes: Shape[] = [];
  const out: Line[] = [];
  let y = 0;
  if (title) {
    shapes.push(text({ x: 0, y, w: periods.length * (COLUMN + GAP), h: 22, label: title, size: 15, bold: true }));
    y += 32;
  }
  const sections = [...new Set(periods.map((p) => p.section))];
  if (sections.some(Boolean)) {
    // Each section's name over its periods, on a band of its ground.
    for (const name of sections) {
      const at = periods.map((p, i) => (p.section === name ? i : -1)).filter((i) => i >= 0);
      const [from, to] = [at[0]! * (COLUMN + GAP), at[at.length - 1]! * (COLUMN + GAP) + COLUMN];
      if (name) shapes.push(text({ x: from, y, w: to - from, h: 20, label: name, bold: true, align: "middle" }));
    }
    y += 26;
  }
  const head = Math.max(...periods.map((p) => tall(p.name, COLUMN, 14)));
  const axis = y + head + 18;
  out.push(rule([[0, axis], [periods.length * (COLUMN + GAP) - GAP, axis]], INK));
  const sentences: string[] = title ? [`${title}.`] : [];
  periods.forEach((period, i) => {
    const left = i * (COLUMN + GAP);
    const ground = GROUNDS[sections.indexOf(period.section) % GROUNDS.length]!;
    shapes.push(shape({ x: left, y, w: COLUMN, h: head, radius: 8, fill: ground, stroke: INK, width: 1.5, label: period.name, size: 14, bold: true, wrap: true }));
    out.push(rule([[left + COLUMN / 2, y + head], [left + COLUMN / 2, axis + 12 + (period.events.length ? 0 : -12)]], INK));
    let below = axis + 12;
    for (const event of period.events) {
      const h = tall(event, COLUMN);
      shapes.push(shape({ x: left, y: below, w: COLUMN, h, radius: 8, fill: "#ffffff", stroke: INK, width: 1, label: event, size: SIZE, wrap: true }));
      below += h + 8;
    }
    sentences.push(`${period.name}: ${period.events.join("; ") || "no events"}.`);
  });
  return { kind: "Mermaid", shapes, lines: out, description: sentences.join(" ") };
}

/** A Gantt chart or a timeline as a scene, or null when the source is neither, or one this cannot read. */
export const fromTimelines = (code: string): Scene | null => fromGantt(code) ?? fromTimeline(code);
