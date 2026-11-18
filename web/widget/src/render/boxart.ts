// Flowcharts an agent draws in plain text with box-drawing characters (┌─┐ │ └─┘, joined by │ ─ and ▼ ►) instead of
// Mermaid. Agents rarely line the characters up, so where things sit in the text is not trusted: only the boxes, their
// words and which boxes each line joins. Those are laid out afresh, as a Mermaid flowchart is (mermaid.ts), and drawn
// in the same scene. A drawing this cannot read with confidence stays text.

import { type Chart, type Edge, layout, type Node } from "./mermaid";
import type { Scene } from "./scene";

const [U, D, L, R] = [1, 2, 4, 8];
const BACK: Record<number, number> = { [U]: D, [D]: U, [L]: R, [R]: L };
const MOVE: Record<number, [number, number]> = { [U]: [-1, 0], [D]: [1, 0], [L]: [0, -1], [R]: [0, 1] };

/** The directions each line character joins. */
const LINKS = new Map<string, number>();
/** The way each arrowhead points. */
const HEADS = new Map<string, number>();
for (const [chars, ways] of [
  ["│┃║╎┆┊", U | D],
  ["─━═╌┄┈", L | R],
  ["┌╭┏╔", D | R],
  ["┐╮┓╗", D | L],
  ["└╰┗╚", U | R],
  ["┘╯┛╝", U | L],
  ["├┣╠", U | D | R],
  ["┤┫╣", U | D | L],
  ["┬┳╦", D | L | R],
  ["┴┻╩", U | L | R],
  ["┼╋╬", U | D | L | R],
] as const)
  for (const ch of chars) LINKS.set(ch, ways);
for (const [chars, way] of [["▼↓", D], ["▲↑", U], ["►▶→", R], ["◄◀←", L]] as const)
  for (const ch of chars) {
    HEADS.set(ch, way);
    LINKS.set(ch, way & (U | D) ? U | D : L | R);
  }

const TOP_LEFT = "┌╭┏╔";
const TOP_RIGHT = "┐╮┓╗";
const BOTTOM_LEFT = "└╰┗╚";
const BOTTOM_RIGHT = "┘╯┛╝";
const WALL = "│┃║├┤┣┫╠╣";
const RULE = "─━═┬┴┼┳┻╋╦╩╬▼▲"; // what a box's top and bottom are drawn with
const WORD = /[\p{L}\p{N}?!.,:;'"()&/%+#-]/u;
const MARKER = /^(?:[•●◦▪‣*-]|\d{1,2}[.)])\s+/u;
const FREE = -1;
const INSIDE = -2;
const MAX_LINES = 400;
const MAX_WIDTH = 300;
const MAX_BOXES = 100;

type Box = { top: number; bottom: number; x0: number; x1: number; foot: [number, number]; title: string; rows: Row[] };
type Row = { y: number; l: number; r: number; wall: boolean; text: string };
type Step = { y: number; x: number; to?: number; label?: string };

/** The box's words: a heading (its first lines when centred over the rest, or in capitals over words that are not)
 *  over a body whose wrapped lines are joined again, each list item and paragraph on a line of its own. */
function wordsOf(box: Box): Pick<Node, "label" | "body" | "list"> {
  const lines = box.rows.map((row) => row.text.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const indent = (line: string) => line.length - line.trimStart().length;
  const plain = (line: string) => Boolean(line) && !MARKER.test(line.trim());
  const run = (test: (line: string, k: number) => boolean) => {
    let n = 0;
    while (n < lines.length - 1 && plain(lines[n]!) && test(lines[n]!, n)) n++;
    return n;
  };
  const centred = run((line, k) => indent(line) >= Math.min(...lines.slice(k + 1).filter(Boolean).map(indent)) + 3);
  const capitals = /\p{Ll}/u.test(lines.join("")) ? run((line) => /\p{Lu}/u.test(line) && !/\p{Ll}/u.test(line)) : 0;
  const n = box.title ? 0 : centred || capitals;
  const heading = [box.title, ...lines.slice(0, n).map((line) => line.trim())].filter(Boolean).join(" ");

  const paragraphs: string[] = [];
  let list = false;
  let item = -1; // the indent of the list item being read, which its further lines are under
  let gap = true;
  for (const line of lines.slice(n)) {
    const words = line.trim();
    const marked = MARKER.exec(words);
    if (!words) gap = true;
    else if (marked) {
      list = true;
      item = indent(line);
      paragraphs.push(words.replace(MARKER, /^[*-]/.test(marked[0]) ? "• " : `${marked[0].trim()} `));
      gap = false;
    } else if (!gap && (item < 0 || indent(line) > item)) paragraphs[paragraphs.length - 1] += ` ${words}`;
    else {
      paragraphs.push(words);
      item = -1;
      gap = false;
    }
  }
  return heading && paragraphs.length ? { label: heading, body: paragraphs.join("\n"), list } : { label: heading || paragraphs.join("\n") };
}

/** The boxes in a drawing and the lines between them, as a flowchart; null when it is not a drawing of one. */
export function readBoxArt(code: string): Chart | null {
  const grid = code.split("\n").map((line) => Array.from(line.replace(/\r$/, "").replace(/\t/g, "    ")));
  if (grid.length > MAX_LINES || grid.some((row) => row.length > MAX_WIDTH)) return null;
  const claim = grid.map((row) => new Array<number>(row.length).fill(FREE));
  const at = (y: number, x: number) => grid[y]?.[x] ?? " ";
  const owner = (y: number, x: number) => claim[y]?.[x] ?? FREE;
  const is = (set: string, y: number, x: number) => set.includes(at(y, x)) && at(y, x) !== " ";
  const boxes: Box[] = [];

  // Boxes, top to bottom. Each wall is looked for near where the line above had it, so walls may drift a little.
  const nearest = (set: string, y: number, x: number, reach: number, after = -1) => {
    for (let d = 0; d <= reach; d++)
      for (const c of d ? [x - d, x + d] : [x]) if (c > after && is(set, y, c) && owner(y, c) === FREE) return c;
    return -1;
  };
  for (let y0 = 0; y0 < grid.length; y0++) {
    for (let x0 = 0; x0 < grid[y0]!.length; x0++) {
      if (!is(TOP_LEFT, y0, x0) || owner(y0, x0) !== FREE) continue;
      let [x1, rules, title] = [-1, 0, ""];
      for (let x = x0 + 1; x < grid[y0]!.length; x++) {
        if (is(TOP_RIGHT, y0, x)) {
          if (rules >= 2) x1 = x;
          break;
        }
        if (is(RULE, y0, x)) rules++;
        else if (is(TOP_LEFT + BOTTOM_LEFT + BOTTOM_RIGHT + WALL, y0, x)) break;
        else title += at(y0, x);
      }
      if (x1 < 0) continue;
      const rows: Row[] = [];
      let foot: [number, number] | null = null;
      let [l, r] = [x0, x1];
      for (let y = y0 + 1; y < grid.length && !foot; y++) {
        const corner = nearest(BOTTOM_LEFT, y, l, 3);
        if (corner >= 0) {
          let end = corner + 1;
          while (is(RULE, y, end)) end++;
          foot = [corner, is(BOTTOM_RIGHT, y, end) ? end : end - 1];
          break;
        }
        const left = nearest(WALL, y, l, 3);
        if (left < 0) break;
        const right = nearest(WALL, y, r, 4, left);
        rows.push({ y, l: left, r: right < 0 ? r : right, wall: right >= 0, text: grid[y]!.slice(left + 1, right < 0 ? r : right).join("") });
        [l, r] = [left, right < 0 ? r : right];
      }
      title = title.trim();
      if (!foot && !title) continue; // a rule that splits one line into several, not a box
      if (boxes.length >= MAX_BOXES) return null;
      const box: Box = foot
        ? { top: y0, bottom: y0 + rows.length + 1, x0, x1, foot, title, rows }
        : { top: y0, bottom: y0, x0, x1, foot: [x0, x1], title, rows: [] }; // a name on a rule: "┌── Done ──┐"
      const i = boxes.push(box) - 1;
      for (let x = x0; x <= x1; x++) claim[y0]![x] = i;
      for (let x = box.foot[0]; x <= box.foot[1]; x++) claim[box.bottom]![x] = i;
      for (const row of box.rows) {
        if (Array.from(row.text).some((ch, k) => owner(row.y, row.l + 1 + k) !== FREE || TOP_LEFT.includes(ch))) return null; // nested
        for (let x = row.l + 1; x < row.r; x++) claim[row.y]![x] = INSIDE;
        claim[row.y]![row.l] = i;
        if (row.wall) claim[row.y]![row.r] = i;
      }
      x0 = x1;
    }
  }
  if (boxes.length < 2) return null;

  const links = (y: number, x: number) => (owner(y, x) === FREE ? (LINKS.get(at(y, x)) ?? 0) : 0);
  const free = (y: number, x: number) => owner(y, x) === FREE && WORD.test(at(y, x));
  /** The words on one line around x, single spaces between them. */
  const wordAt = (y: number, x: number): [number, number] => {
    let [a, b] = [x, x];
    while (free(y, a - 1) || (at(y, a - 1) === " " && free(y, a - 2))) a--;
    while (free(y, b + 1) || (at(y, b + 1) === " " && free(y, b + 2))) b++;
    return [a, b];
  };
  const said = (y: number, [a, b]: [number, number]) => grid[y]!.slice(a, b + 1).join("").trim().slice(0, 60);

  /** Where a line going `way` from (y, x) goes next: the box it reaches, the next piece of line, or nowhere. */
  function next(y: number, x: number, way: number): Step | null {
    const [dy, dx] = MOVE[way]!;
    const [ny, nx] = [y + dy, x + dx];
    const reached = (yy: number, xx: number, edgeOnly: boolean): Step | null => {
      const o = owner(yy, xx);
      return o >= 0 && (!edgeOnly || boxes[o]!.top === yy || boxes[o]!.bottom === yy) ? { y: yy, x: xx, to: o } : null;
    };
    const onward = (yy: number, xx: number, edgeOnly = false) =>
      reached(yy, xx, edgeOnly) ?? (links(yy, xx) & BACK[way]! ? { y: yy, x: xx } : null);
    if (owner(ny, nx) === INSIDE) return null;
    const direct = onward(ny, nx);
    if (direct) return direct;
    if (dy) {
      // a line drawn a column off from the piece before it
      for (const sx of [nx - 1, nx + 1]) {
        const off = reached(ny, sx, true) ?? (links(ny, sx) === (U | D) ? { y: ny, x: sx } : null);
        if (off) return off;
      }
    }
    let wx = nx;
    if (dx && at(ny, nx) === " ") {
      const hop = onward(ny, nx + dx); // a space before the box or the arrowhead
      if (hop) return hop;
      wx += dx;
    }
    if (!free(ny, wx)) return null;
    // words written into the line, as in ── Yes ──►, or a word on a line going down
    const span = wordAt(ny, wx);
    const label = said(ny, span);
    const resume = dx
      ? [[ny, (dx > 0 ? span[1] : span[0]) + dx], [ny, (dx > 0 ? span[1] : span[0]) + 2 * dx]]
      : [[ny + dy, nx], [ny + dy, nx - 1], [ny + dy, nx + 1]];
    for (const [ry, rx] of resume) {
      const step = onward(ry!, rx!, Boolean(dy));
      if (step) return { ...step, label };
    }
    return null;
  }

  /** Words just beside a line going down or up, on its side away from any other line. */
  const beside = (y: number, x: number) => {
    for (const side of [1, -1]) if (at(y, x + side) === " " && free(y, x + 2 * side)) return said(y, wordAt(y, x + 2 * side));
    return "";
  };

  const found = new Map<string, Edge>();
  const join = (from: number, to: number, label: string) => {
    const known = found.get(`${from}>${to}`);
    if (known) known.label ||= label;
    else found.set(`${from}>${to}`, { from: `b${from}`, to: `b${to}`, label, dashed: false, thick: false, start: false, end: true, hidden: false });
  };

  /** Follows every line leaving a box, through its turns and branches, to the boxes it reaches. A line joins its
   *  boxes the way its arrowheads point; one with none runs down or rightwards, the way the text reads. */
  function trace(from: number, y: number, x: number, first: number) {
    const seen = new Set<string>();
    const walks = [{ y, x, way: first, along: false, split: false, label: "" }];
    while (walks.length) {
      const walk = walks.pop()!;
      if (seen.has(`${walk.y},${walk.x}`)) continue;
      seen.add(`${walk.y},${walk.x}`);
      const ch = at(walk.y, walk.x);
      const head = HEADS.get(ch);
      if (head === BACK[walk.way]) continue; // against an arrowhead: the line runs the other way
      const along = walk.along || head === walk.way;
      const label = walk.label || (walk.split && walk.way & (U | D) ? beside(walk.y, walk.x) : "");
      const ways = /[┼╋╬]/.test(ch) ? [walk.way] : [U, D, L, R].filter((d) => (LINKS.get(ch) ?? 0) & d && d !== BACK[walk.way]);
      for (const way of ways) {
        const step = next(walk.y, walk.x, way);
        if (!step) continue;
        const words = step.label ?? label;
        if (step.to === undefined) {
          walks.push({ y: step.y, x: step.x, way, along, split: walk.split || ways.length > 1, label: words });
          continue;
        }
        const end = HEADS.get(at(step.y, step.x)); // an arrowhead drawn on the box's edge
        if (step.to === from || end === BACK[way]) continue;
        if (along || end === way || first === D || first === R) join(from, step.to, words);
      }
    }
  }

  boxes.forEach((box, i) => {
    const start = (y: number, x: number, way: number, hop = 0) => {
      if (hop && at(y, x) === " ") x += hop; // a space between the box and its line
      if (links(y, x) & BACK[way]!) trace(i, y, x, way);
    };
    for (let x = box.x0; x <= box.x1; x++) start(box.top - 1, x, U);
    for (let x = box.foot[0]; x <= box.foot[1]; x++) start(box.bottom + 1, x, D);
    for (const row of box.rows) {
      start(row.y, row.l - 1, L, -1);
      if (row.wall) start(row.y, row.r + 1, R, 1);
    }
  });
  const edges = [...found.values()];
  if (!edges.length) return null;

  const box = (id: string) => boxes[Number(id.slice(1))]!;
  const sideways = edges.filter((e) => box(e.to).top <= box(e.from).bottom && box(e.from).top <= box(e.to).bottom).length;
  const nodes = new Map(boxes.map((b, i) => [`b${i}`, { ...wordsOf(b), kind: "rect", round: "soft", group: null } as Node]));
  return { direction: sideways > edges.length / 2 ? "LR" : "TB", nodes, edges, groups: [] };
}

/** How wide a box drawn from text may be in a frame `room` wide. Its boxes hold sentences, so they are as wide as two
 *  side by side allow, at the smallest size the drawing takes, in steps so that a small resize draws nothing new. */
export const widestFor = (room: number) => (room ? Math.min(320, Math.max(180, Math.floor((room * 0.64 - 18) / 20) * 20)) : 240);

/** A flowchart drawn in text, drawn as a scene; null when the text is not one this reads. */
export function fromBoxArt(code: string, widest = 240): Scene | null {
  const chart = readBoxArt(code);
  const drawn = chart && layout(chart, widest);
  return drawn && { kind: "text", ...drawn };
}
