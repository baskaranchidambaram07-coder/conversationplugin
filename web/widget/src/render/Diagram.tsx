// A diagram in an answer (M3): draw.io or Excalidraw source drawn as SVG on paper, in its own frame, which scrolls
// sideways when the diagram is too wide to read at the card's width. Its code stays one press away, to copy into
// draw.io or Excalidraw. Loaded only when an answer holds a diagram; anything it cannot read is shown as code.
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CopyButton, Icon } from "../Icon";
import { strings as t } from "../strings";
import { Code } from "./Code";
import { type Line, type Point, sceneOf, type Shape } from "./scene";
import type { FenceProps } from "./registry";

const PAD = 12;
const READABLE = 10; // px: a diagram's usual label is never drawn smaller; the frame scrolls instead
const LEADING = 1.25;
const CHAR = 0.55; // an average character's width, in ems, for wrapping and label backgrounds

function wrapped(label: string, width: number, size: number, wrap: boolean): string[] {
  const paragraphs = label.split("\n");
  if (!wrap || width <= 0) return paragraphs;
  const fits = Math.max(4, Math.floor((width - 8) / (size * CHAR)));
  return paragraphs.flatMap((paragraph) => {
    const out: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > fits) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    return [...out, line];
  });
}

/** Lines of text whose first line is centred on y, each further line one leading below. */
function Words(props: { lines: string[]; x: number; y: number; size: number; color: string; bold?: boolean; align: Shape["align"] }) {
  const { lines, x, y, size, color, bold, align } = props;
  return (
    <text x={x} fontSize={size} fill={color === "none" ? "#2b241f" : color} fontWeight={bold ? 700 : 400} textAnchor={align} dominantBaseline="central">
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={y + i * size * LEADING}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function Outline({ s }: { s: Shape }) {
  const paint = { fill: s.fill, stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dashed ? "6 4" : undefined };
  const { x, y, w, h } = s;
  const cx = x + w / 2;
  if (s.kind === "text") return null;
  if (s.kind === "ellipse") return <ellipse cx={cx} cy={y + h / 2} rx={w / 2} ry={h / 2} {...paint} />;
  if (s.kind === "rhombus") return <polygon points={`${cx},${y} ${x + w},${y + h / 2} ${cx},${y + h} ${x},${y + h / 2}`} {...paint} />;
  if (s.kind === "cylinder") {
    const r = Math.min(h * 0.15, 12);
    const side = `M${x},${y + r}a${w / 2},${r} 0 0,0 ${w},0v${h - 2 * r}a${w / 2},${r} 0 0,1 ${-w},0z`;
    return <path d={`${side}M${x},${y + r}a${w / 2},${r} 0 0,1 ${w},0`} {...paint} />;
  }
  if (s.kind === "actor") {
    const r = Math.min(w, h) / 6;
    const figure = `M${cx},${y + 2 * r}V${y + h * 0.65}M${x},${y + h * 0.35}H${x + w}M${x},${y + h}L${cx},${y + h * 0.65}L${x + w},${y + h}`;
    return (
      <g {...paint}>
        <circle cx={cx} cy={y + r} r={r} />
        <path d={figure} fill="none" />
      </g>
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={s.radius} {...paint} />
      {s.kind === "swimlane" && <path d={`M${x},${y + 26}H${x + w}`} stroke={s.stroke} strokeWidth={s.width} />}
    </g>
  );
}

function ShapeView({ s }: { s: Shape }) {
  const lines = s.label ? wrapped(s.label, s.w, s.size, s.wrap) : [];
  const lead = s.size * LEADING;
  const pad = s.kind === "text" ? 0 : 4;
  const x = s.align === "start" ? s.x + pad : s.align === "end" ? s.x + s.w - pad : s.x + s.w / 2;
  const y =
    s.kind === "actor"
      ? s.y + s.h + lead / 2 + 2 // a person's name sits under them
      : s.valign === "top"
        ? s.y + (s.kind === "swimlane" ? 13 : pad + lead / 2)
        : s.y + s.h / 2 - ((lines.length - 1) * lead) / 2 + (s.kind === "cylinder" ? Math.min(s.h * 0.15, 12) / 2 : 0);
  return (
    <g transform={s.angle ? `rotate(${s.angle} ${s.x + s.w / 2} ${s.y + s.h / 2})` : undefined}>
      <Outline s={s} />
      {lines.length > 0 && <Words lines={lines} x={x} y={y} size={s.size} color={s.color} bold={s.bold} align={s.align} />}
    </g>
  );
}

/** The point a fraction of the way along a path. */
function along(points: Point[], at: number): Point {
  const steps = points.slice(1).map((b, i) => [points[i]!, b] as const);
  let left = steps.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) * Math.min(1, Math.max(0, at));
  for (const [a, b] of steps) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= length && length > 0) return [a[0] + ((b[0] - a[0]) * left) / length, a[1] + ((b[1] - a[1]) * left) / length];
    left -= length;
  }
  return points[points.length - 1]!;
}

function Head({ tip, from, line }: { tip: Point; from: Point; line: Line }) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const length = 7 + line.width * 2;
  const side = (turn: number): Point => [tip[0] - length * Math.cos(angle + turn), tip[1] - length * Math.sin(angle + turn)];
  const [a, b] = [side(0.42), side(-0.42)];
  return <polygon points={`${tip} ${a} ${b}`} fill={line.stroke} stroke={line.stroke} strokeWidth={1} strokeLinejoin="round" />;
}

function labelBox(line: Line) {
  const lines = line.label.split("\n");
  const [x, y] = along(line.points, line.at);
  const w = Math.max(...lines.map((l) => l.length)) * line.size * CHAR + 8;
  const h = lines.length * line.size * LEADING + 2;
  return { lines, x, y, w, h };
}

function LineView({ line }: { line: Line }) {
  const p = line.points;
  const box = line.label ? labelBox(line) : null;
  return (
    <g>
      <polyline
        points={p.join(" ")}
        fill="none"
        stroke={line.stroke}
        strokeWidth={line.width}
        strokeDasharray={line.dashed ? "6 4" : undefined}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {line.end && <Head tip={p[p.length - 1]!} from={p[p.length - 2]!} line={line} />}
      {line.start && <Head tip={p[0]!} from={p[1]!} line={line} />}
      {box && (
        <g>
          <rect x={box.x - box.w / 2} y={box.y - box.h / 2} width={box.w} height={box.h} rx={4} fill="#ffffff" />
          <Words lines={box.lines} x={box.x} y={box.y - ((box.lines.length - 1) * line.size * LEADING) / 2} size={line.size} color={line.color} align="middle" />
        </g>
      )}
    </g>
  );
}

export default function Diagram({ code, language }: FenceProps) {
  const scene = useMemo(() => sceneOf(code), [code]);
  const [showCode, setShowCode] = useState(false);
  const described = useId();
  // The frame's width, measured, because the chat's content policy allows no inline style to size the drawing by.
  const frame = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    setRoom(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setRoom(element.clientWidth));
    watch.observe(element);
    return () => watch.disconnect();
  }, [scene]);
  if (!scene) return <Code code={code} language={language} />;

  // The drawing's extent: every shape (with a person's name under them), every line and every line's label.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of scene.shapes) {
    xs.push(s.x, s.x + s.w);
    ys.push(s.y, s.y + s.h + (s.kind === "actor" && s.label ? s.size * LEADING * 2 : 0));
    if (s.kind === "text") xs.push(s.x + Math.max(...s.label.split("\n").map((l) => l.length)) * s.size * CHAR);
  }
  for (const line of scene.lines) {
    for (const [x, y] of line.points) xs.push(x), ys.push(y);
    if (line.label) {
      const box = labelBox(line);
      xs.push(box.x - box.w / 2, box.x + box.w / 2);
      ys.push(box.y - box.h / 2, box.y + box.h / 2);
    }
  }
  const [left, top] = [Math.min(...xs) - PAD, Math.min(...ys) - PAD];
  const width = Math.max(...xs) + PAD - left;
  const height = Math.max(...ys) + PAD - top;
  // As wide as the frame, never larger than drawn, and never so small its words cannot be read: then it scrolls.
  const sizes = [...scene.shapes, ...scene.lines].filter((part) => part.label).map((part) => part.size).sort((a, b) => a - b);
  const smallest = Math.min(1, READABLE / (sizes[Math.floor(sizes.length / 2)] ?? 12));
  const shown = Math.max(width * smallest, Math.min(width, room || width));

  const shapes = scene.shapes.filter((s) => s.kind !== "text");
  const flat = (words: string) => words.replace(/\s+/g, " ").trim();
  const description = [
    ...scene.shapes.map((s) => flat(s.label)).filter(Boolean),
    ...scene.lines.map((l) => t.diagramLine(flat(l.from), flat(l.to), flat(l.label))),
  ]
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`))
    .join(" ");

  return (
    <figure className="diagram">
      <div className="scroll" ref={frame} tabIndex={0} role="region" aria-label={t.diagram(scene.kind)}>
        <svg
          viewBox={`${left} ${top} ${width} ${height}`}
          role="img"
          aria-label={t.diagramParts(shapes.length, scene.lines.length)}
          aria-describedby={described}
          width={Math.round(shown)}
          height={Math.round((shown * height) / width)}
        >
          <desc id={described}>{description}</desc>
          {scene.shapes.map((s, i) => (
            <ShapeView key={`s${i}`} s={s} />
          ))}
          {scene.lines.map((line, i) => (
            <LineView key={`l${i}`} line={line} />
          ))}
        </svg>
      </div>
      {showCode && (
        <pre tabIndex={0} role="region" aria-label={t.diagramSource}>
          <code>{code}</code>
        </pre>
      )}
      <div className="tools">
        <CopyButton text={code} label={t.copyFor(scene.kind)} />
        <button type="button" className="quiet" aria-expanded={showCode} onClick={() => setShowCode(!showCode)}>
          <Icon path="M8 7l-5 5 5 5M16 7l5 5-5 5" />
          {showCode ? t.hideCode : t.showCode}
        </button>
      </div>
    </figure>
  );
}
