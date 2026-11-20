// Mermaid sequence diagrams in answers, read into the same scene as flowcharts (scene.ts) and laid out here as Mermaid
// lays them out: the participants across the top and again at the foot, a dashed lifeline down from each, then every
// message, note and block in order down the page. The chat cannot run the Mermaid library (its inline styles are
// refused by the chat's content policy). The source is untrusted: only its words and the kinds of its arrows are used;
// links, colours and styles are skipped. Anything this cannot read is shown as code.

import { ems } from "./mermaid";
import { INK, type Line, type Point, type Scene, type Shape, shape, text } from "./scene";

const MOST = { participants: 40, events: 600 };
const NAME = 14; // px: a participant's name
const SIZE = 13; // px: a message's or note's words
const LEAD = 1.25;
const WIDEST = 260; // px: a message's or note's words wrap past this
const GAP = 48; // px at least between two participants' boxes
const QUIET = "#64748b"; // lifelines and block frames
const NOTE = "#fbf3d5";
const NOTE_EDGE = "#d9c37a";
const TAB = "#f1f5f9"; // a block's name tag, the flowchart's subgraph ground

type Participant = { id: string; label: string; actor: boolean };
type Arrow = { dashed: boolean; end: boolean; start: boolean; cross: boolean };
type Event =
  | { kind: "message"; from: string; to: string; label: string; arrow: Arrow; activate: boolean; deactivate: boolean }
  | { kind: "note"; side: "left" | "right" | "over"; ids: string[]; label: string }
  | { kind: "open"; name: string; label: string }
  | { kind: "else"; label: string }
  | { kind: "close" }
  | { kind: "activate" | "deactivate"; id: string };
export type Sequence = { title: string; numbered: boolean; participants: Participant[]; events: Event[] };

const words = (raw: string) =>
  text(raw.replace(/<br\s*\/?>/gi, "\n").replace(/#59;/g, ";").replace(/#quot;/g, '"').trim().replace(/^"(.*)"$/s, "$1"));
const ARROWS: Record<string, Arrow> = {
  "->>": { dashed: false, end: true, start: false, cross: false },
  "-->>": { dashed: true, end: true, start: false, cross: false },
  "->": { dashed: false, end: false, start: false, cross: false },
  "-->": { dashed: true, end: false, start: false, cross: false },
  "-x": { dashed: false, end: false, start: false, cross: true },
  "--x": { dashed: true, end: false, start: false, cross: true },
  "-)": { dashed: false, end: true, start: false, cross: false },
  "--)": { dashed: true, end: true, start: false, cross: false },
  "<<->>": { dashed: false, end: true, start: true, cross: false },
  "<<-->>": { dashed: true, end: true, start: true, cross: false },
};
const MESSAGE = /^([^:]+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*:(.*)$/;
const BLOCKS = /^(loop|alt|opt|par|critical|break|rect|box)\b\s*(.*)$/;

/** The diagram's participants, messages, notes and blocks, or null when it is not a sequence diagram. */
export function readSequence(code: string): Sequence | null {
  let lines = code.split("\n").map((line) => line.trim());
  if (lines[0] === "---") lines = lines.slice(lines.slice(1).findIndex((l) => l === "---") + 2); // settings
  lines = lines.filter((line) => line && !line.startsWith("%%"));
  if (lines[0] !== "sequenceDiagram") return null;
  const seq: Sequence = { title: "", numbered: false, participants: [], events: [] };
  const known = new Map<string, Participant>();
  const meet = (id: string, label = id, actor = false) => {
    const found = known.get(id);
    if (found) {
      if (label !== id) found.label = label;
      found.actor ||= actor;
      return;
    }
    const made = { id, label: words(label), actor };
    known.set(id, made);
    seq.participants.push(made);
  };
  const open: string[] = []; // blocks being read, innermost last
  for (const line of lines.slice(1)) {
    const declared = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(line);
    const message = MESSAGE.exec(line);
    const note = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i.exec(line);
    const block = BLOCKS.exec(line);
    const turn = /^(else|and|option)\b\s*(.*)$/.exec(line);
    const switched = /^(activate|deactivate)\s+(.+)$/.exec(line);
    if (line === "autonumber" || line.startsWith("autonumber ")) seq.numbered = true;
    else if (line.startsWith("title")) seq.title = words(line.replace(/^title:?\s*/, ""));
    else if (declared) meet(declared[2]!.trim(), declared[3]?.trim() ?? declared[2]!.trim(), declared[1] === "actor");
    else if (note) {
      const ids = note[2]!.split(",").map((id) => id.trim()).filter(Boolean);
      ids.forEach((id) => meet(id));
      const side = note[1]!.toLowerCase().startsWith("left") ? "left" : note[1]!.toLowerCase().startsWith("right") ? "right" : "over";
      seq.events.push({ kind: "note", side, ids: ids.slice(0, 2), label: words(note[3]!) });
    } else if (message) {
      const [, from, kind, sign, to, said] = message;
      meet(from!.trim());
      meet(to!.trim());
      seq.events.push({
        kind: "message", from: from!.trim(), to: to!.trim(), label: words(said!), arrow: ARROWS[kind!]!,
        activate: sign === "+", deactivate: sign === "-",
      });
    } else if (block) {
      open.push(block[1]!);
      // A box groups participants and a rect only shades; neither is drawn, but each closes with "end".
      if (block[1] !== "box" && block[1] !== "rect") seq.events.push({ kind: "open", name: block[1]!, label: words(block[2]!) });
    } else if (turn && open.length) seq.events.push({ kind: "else", label: words(turn[2]!) });
    else if (line === "end" && open.length) {
      const name = open.pop()!;
      if (name !== "box" && name !== "rect") seq.events.push({ kind: "close" });
    } else if (switched) {
      meet(switched[2]!.trim());
      seq.events.push({ kind: switched[1] as "activate" | "deactivate", id: switched[2]!.trim() });
    }
    // anything else (links, styles, destroy, a line Mermaid would refuse) is skipped
    if (seq.participants.length > MOST.participants || seq.events.length > MOST.events) return null;
  }
  while (open.pop()) seq.events.push({ kind: "close" });
  return seq.participants.length ? seq : null;
}

/** Words wrapped to `widest`, as lines. */
function wrap(label: string, size: number, widest = WIDEST): string[] {
  return label.split("\n").flatMap((paragraph) => {
    const out: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ems(next) * size > widest) {
        out.push(line);
        line = word;
      } else line = next;
    }
    return [...out, line];
  });
}

const widthOf = (lines: string[], size: number, bold = false) => Math.max(0, ...lines.map((l) => ems(l, bold) * size));
const heightOf = (lines: string[], size: number) => lines.length * size * LEAD;

/** A sequence diagram drawn as a scene, or null when the source is not one this reads. */
export function fromSequence(code: string): Scene | null {
  const seq = readSequence(code);
  if (!seq) return null;
  const { participants, events } = seq;
  const index = new Map(participants.map((p, i) => [p.id, i]));
  const heads = participants.map((p) => wrap(p.label, NAME, 180));
  const width = participants.map((p, i) => Math.max(p.actor ? 60 : 90, widthOf(heads[i]!, NAME, true) + 24));
  const boxH = Math.max(40, ...heads.map((lines) => heightOf(lines, NAME) + 18));

  // Across: each participant at least GAP beyond the last, then further apart wherever a message, a note or a
  // message to itself needs the room.
  const x: number[] = [];
  participants.forEach((_, i) => x.push(i ? x[i - 1]! + (width[i - 1]! + width[i]!) / 2 + GAP : width[0]! / 2));
  const room = (a: number, b: number, need: number) => {
    const short = need - (x[b]! - x[a]!);
    if (short > 0) for (let i = b; i < x.length; i++) x[i]! += short;
  };
  let n = 0;
  const said = (label: string) => (seq.numbered ? `${++n}. ${label}` : label);
  const labels = events.map((e) => (e.kind === "message" ? wrap(said(e.label), SIZE) : e.kind === "note" ? wrap(e.label, SIZE, 200) : []));
  events.forEach((e, k) => {
    const lines = labels[k]!;
    if (e.kind === "message") {
      const [a, b] = [index.get(e.from)!, index.get(e.to)!].sort((p, q) => p - q) as [number, number];
      if (a !== b) room(a, b, widthOf(lines, SIZE) + 32);
      else if (a + 1 < x.length) room(a, a + 1, widthOf(lines, SIZE) + 60); // a message to itself loops out right
    } else if (e.kind === "note" && e.side !== "over") {
      const i = index.get(e.ids[0]!)!;
      const need = widthOf(lines, SIZE) + 40;
      if (e.side === "right" && i + 1 < x.length) room(i, i + 1, need + width[i + 1]! / 2);
      if (e.side === "left" && i > 0) room(i - 1, i, need + width[i - 1]! / 2);
    }
  });

  // Down: the title, the boxes, then each event in turn.
  const shapes: Shape[] = [];
  const lines: Line[] = [];
  let y = 0;
  if (seq.title) {
    shapes.push(shape({ kind: "text", x: x[0]! - width[0]! / 2, y: 0, w: 1, h: 20, label: seq.title, size: 15, bold: true, align: "start", valign: "top", wrap: false }));
    y = 32;
  }
  const top = y;
  y += boxH + 24;
  const active: number[][] = participants.map(() => []); // where each open activation began
  const bars: Shape[] = [];
  type Frame = { name: string; label: string; top: number; dividers: [number, string][]; ids: Set<number>; depth: number };
  const frames: Frame[] = [];
  const done: (Frame & { bottom: number })[] = [];
  const line = (points: Point[], fields: Partial<Line> = {}): Line => ({
    points, stroke: INK, width: 1.5, dashed: false, start: false, end: false, label: "", at: 0.5, size: SIZE, color: INK, from: "", to: "", ...fields,
  });
  const touch = (...ids: number[]) => frames.forEach((f) => ids.forEach((i) => f.ids.add(i)));
  // An arrow meets a participant at the side of its topmost activation bar, if one is open; each bar sits 4px right
  // of the one under it.
  const edge = (i: number, towards: number) => {
    const open = active[i]!.length;
    return open ? x[i]! + 4 * (open - 1) + (towards >= x[i]! ? 5 : -5) : x[i]!;
  };
  const begin = (i: number) => active[i]!.push(y);
  const finish = (i: number) => {
    const from = active[i]!.pop();
    if (from === undefined) return;
    const depth = active[i]!.length;
    bars.push(shape({ x: x[i]! - 5 + depth * 4, y: from, w: 10, h: Math.max(8, y - from), fill: "#ffffff", stroke: INK, width: 1.25 }));
  };

  events.forEach((e, k) => {
    const words = labels[k]!;
    if (e.kind === "message") {
      const [a, b] = [index.get(e.from)!, index.get(e.to)!];
      const textH = heightOf(words, SIZE);
      touch(a, b);
      if (a === b) {
        y += textH + 4;
        const x0 = edge(a, Infinity);
        lines.push(line([[x0, y], [x0 + 36, y], [x0 + 36, y + 22], [x0, y + 22]], {
          dashed: e.arrow.dashed, end: e.arrow.end, start: e.arrow.start, label: words.join("\n"), at: 0.18, shift: -(textH / 2 + 4),
          from: participants[a]!.label, to: participants[b]!.label,
        }));
        y += 22;
      } else {
        y += textH + 6;
        if (e.activate) begin(b);
        const [x0, x1] = [edge(a, x[b]!), edge(b, x[a]!)];
        lines.push(line([[x0, y], [x1, y]], {
          dashed: e.arrow.dashed, end: e.arrow.end, start: e.arrow.start, label: words.join("\n"), shift: -(textH / 2 + 4),
          from: participants[a]!.label, to: participants[b]!.label,
        }));
        if (e.arrow.cross) {
          const d = Math.sign(x1 - x0) * 5;
          lines.push(line([[x1 - d - 5, y - 5], [x1 - d + 5, y + 5]]), line([[x1 - d - 5, y + 5], [x1 - d + 5, y - 5]]));
        }
      }
      if (e.deactivate) finish(a);
      y += 16;
    } else if (e.kind === "note") {
      const ids = e.ids.map((id) => index.get(id)!);
      touch(...ids);
      const w = widthOf(words, SIZE) + 20;
      const h = heightOf(words, SIZE) + 14;
      const [l, r] = [Math.min(...ids.map((i) => x[i]!)), Math.max(...ids.map((i) => x[i]!))];
      const left = e.side === "left" ? l - 14 - w : e.side === "right" ? l + 14 : Math.min((l + r) / 2 - w / 2, l - 40);
      const right = e.side === "over" ? Math.max(left + w, r + 40) : left + w;
      shapes.push(shape({ x: left, y: y + 4, w: right - left, h, radius: 4, fill: NOTE, stroke: NOTE_EDGE, width: 1, label: words.join("\n"), size: SIZE, wrap: false }));
      y += h + 18;
    } else if (e.kind === "open") {
      y += 6;
      frames.push({ name: e.name, label: e.label, top: y, dividers: [], ids: new Set(), depth: frames.length });
      y += 34;
    } else if (e.kind === "else") {
      y += 4;
      frames[frames.length - 1]?.dividers.push([y, e.label]);
      y += 26;
    } else if (e.kind === "close") {
      const frame = frames.pop();
      if (frame) {
        y += 4;
        done.push({ ...frame, bottom: y });
        y += 14;
      }
    } else {
      const i = index.get(e.id)!;
      if (e.kind === "activate") begin(i);
      else finish(i);
    }
  });
  participants.forEach((_, i) => {
    while (active[i]!.length) finish(i);
  });
  const foot = y + 8;

  // The frames, widest first so a nested one sits on top: round the participants their messages touch, all if none.
  const span = (ids: Set<number>) => (ids.size ? [Math.min(...ids), Math.max(...ids)] : [0, participants.length - 1]) as [number, number];
  const inner = (f: (typeof done)[number]) => done.filter((g) => g.depth > f.depth && g.top > f.top && g.bottom < f.bottom).length;
  const frameShapes: Shape[] = [];
  for (const f of [...done].sort((a, b) => a.depth - b.depth)) {
    const [a, b] = span(f.ids);
    const pad = 14 + 8 * inner(f);
    const tag = f.name;
    const left = x[a]! - width[a]! / 2 - pad;
    const right = Math.max(x[b]! + width[b]! / 2 + pad, left + ems(`${tag} [${f.label}]`) * SIZE + 40);
    const tagW = ems(tag, true) * 12 + 16;
    frameShapes.push(
      shape({ x: left, y: f.top, w: right - left, h: f.bottom - f.top, radius: 4, fill: "none", stroke: QUIET, width: 1 }),
      shape({ x: left, y: f.top, w: tagW, h: 20, radius: 4, fill: TAB, stroke: QUIET, width: 1, label: tag, size: 12, bold: true, wrap: false }),
    );
    if (f.label) shapes.push(shape({ kind: "text", x: left + tagW + 8, y: f.top + 3, w: 1, h: 16, label: `[${f.label}]`, size: 12, align: "start", valign: "top", wrap: false, color: INK }));
    for (const [at, label] of f.dividers) {
      lines.push(line([[left, at], [right, at]], { stroke: QUIET, width: 1, dashed: true }));
      if (label) shapes.push(shape({ kind: "text", x: left + 10, y: at + 4, w: 1, h: 16, label: `[${label}]`, size: 12, align: "start", valign: "top", wrap: false }));
    }
  }

  // The participants, at the top and again at the foot, and the lifelines between.
  const boxes: Shape[] = [];
  participants.forEach((p, i) => {
    const label = heads[i]!.join("\n");
    for (const at of [top, foot]) {
      if (p.actor) boxes.push(shape({ kind: "actor", x: x[i]! - 14, y: at, w: 28, h: boxH - 16, fill: "none", stroke: INK, width: 1.5, label, size: NAME, bold: true, wrap: false }));
      else boxes.push(shape({ x: x[i]! - width[i]! / 2, y: at, w: width[i]!, h: boxH, radius: 6, fill: "#ffffff", stroke: INK, width: 1.5, label, size: NAME, bold: true, wrap: false }));
    }
    const from = p.actor ? top + boxH + 4 : top + boxH;
    lines.unshift(line([[x[i]!, from], [x[i]!, foot]], { stroke: QUIET, width: 1, dashed: true }));
  });
  // Lifelines first, then frames, bars and boxes; words and arrows over them.
  return { kind: "Mermaid", shapes: [...frameShapes, ...bars, ...boxes, ...shapes], lines };
}
