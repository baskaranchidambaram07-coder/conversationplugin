// A chart in an answer (M3-T6): a fenced block tagged `chart` holding plain JSON data, never configuration or code.
// It is checked whole here, so the renderer only ever draws numbers it has validated; anything else shows as code.
//
//   {"type": "bar", "title": "Deliveries by month", "x": "month", "y": ["on_time", "late"],
//    "labels": {"on_time": "On time", "late": "Late"}, "data": [{"month": "Jan", "on_time": 120, "late": 8}]}
//
// type is bar, line, area, pie or scatter. y names the series (all numeric fields but x when left out); labels are
// optional display names. Scatter takes numbers for x and at most three series; pie takes one series.
import { strings as t } from "../strings";

export type Kind = "bar" | "line" | "area" | "pie" | "scatter";

export type Chart = {
  kind: Kind;
  title: string;
  xName: string;
  /** Series names, in the palette's order. */
  names: string[];
  /** Category labels, or numbers for a scatter. */
  xs: (string | number)[];
  /** values[series][point]; null where a point has no value. */
  values: (number | null)[][];
};

const KINDS: Kind[] = ["bar", "line", "area", "pie", "scatter"];
// Past eight series no palette stays distinguishable; past three, a scatter's dots cannot (every pair is in play).
const MOST = { series: 8, scatter: 3, slices: 8, points: 5000 };

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 80) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function chartOf(code: string): Chart | null {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return null; // not finished arriving, or not JSON
  }
  if (!isFields(raw)) return null;
  const kind = KINDS.find((k) => k === raw.type);
  const x = text(raw.x);
  const rows = Array.isArray(raw.data) ? raw.data : [];
  if (!kind || !x || !rows.length || !rows.every(isFields)) return null;
  const keys: unknown[] = Array.isArray(raw.y)
    ? raw.y
    : typeof raw.y === "string"
      ? [raw.y]
      : Object.keys(rows[0] as Fields).filter((key) => key !== x && num((rows[0] as Fields)[key]) !== null);
  const most = kind === "scatter" ? MOST.scatter : kind === "pie" ? 1 : MOST.series;
  if (!keys.length || keys.length > most || rows.length * keys.length > MOST.points) return null;
  if (!keys.every((key): key is string => typeof key === "string" && key !== x)) return null;

  const xs = (rows as Fields[]).map((row) =>
    kind === "scatter" ? num(row[x]) : typeof row[x] === "number" ? String(row[x]) : text(row[x]),
  );
  if (xs.some((value) => value === null || value === "")) return null;
  const values = keys.map((key) => (rows as Fields[]).map((row) => num(row[key])));
  if (values.every((series) => series.every((value) => value === null))) return null;
  const labels = isFields(raw.labels) ? raw.labels : {};
  const chart: Chart = {
    kind,
    title: text(raw.title, 120),
    xName: text(labels[x]) || x,
    names: keys.map((key) => text(labels[key]) || text(key)),
    xs: xs as (string | number)[],
    values,
  };
  return kind === "pie" ? pieOf(chart) : chart;
}

/** Slices largest first; past eight, the smallest fold into one "Other". No negative slices, and not all empty. */
function pieOf(chart: Chart): Chart | null {
  const slices = chart.xs.map((x, i) => [x, chart.values[0]?.[i] ?? 0] as [string | number, number]);
  if (slices.some(([, value]) => value < 0) || !slices.some(([, value]) => value > 0)) return null;
  slices.sort((a, b) => b[1] - a[1]);
  const rest = slices.splice(MOST.slices - 1);
  if (rest.length === 1) slices.push(...rest);
  else if (rest.length) slices.push([t.other, rest.reduce((sum, [, value]) => sum + value, 0)]);
  return { ...chart, xs: slices.map(([x]) => x), values: [slices.map(([, value]) => value)] };
}

/** Round values covering [low, high]: steps of 1, 2 or 5 times a power of ten, about `count` of them. */
export function ticks(low: number, high: number, count = 5): number[] {
  if (low === high) [low, high] = low === 0 ? [0, 1] : [Math.min(0, low), Math.max(0, high)];
  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const error = rough / power; // the nearest of 1, 2, 5 and 10, judged on a log scale
  const step = (error >= 7.07 ? 10 : error >= 3.16 ? 5 : error >= 1.41 ? 2 : 1) * power;
  const first = Math.floor(low / step);
  const last = Math.ceil(high / step);
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
}

/** A number as people read it: in full, or compact (12K) on an axis that reaches ten thousand. */
export const format = (value: number, compact = false) =>
  new Intl.NumberFormat(
    undefined,
    compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 },
  ).format(value);

export const share = (value: number, total: number) =>
  new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(total ? value / total : 0);

/** What the chart shows, in words, for a screen reader: each series' lowest and highest point, or each slice's share. */
export function summary(chart: Chart): string {
  const { kind, title, names, xs, values } = chart;
  const head = t.chart(kind, title);
  if (kind === "pie") {
    const total = (values[0] ?? []).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return `${head}. ${xs.map((x, i) => `${x} ${share(values[0]?.[i] ?? 0, total)}`).join(", ")}.`;
  }
  const ranges = names.map((name, s) => {
    const points = (values[s] ?? []).flatMap((value, i) => (value === null ? [] : [[value, i] as const]));
    const [low] = points.reduce((a, b) => (b[0] < a[0] ? b : a));
    const [high] = points.reduce((a, b) => (b[0] > a[0] ? b : a));
    const lowAt = points.find(([value]) => value === low)?.[1] ?? 0;
    const highAt = points.find(([value]) => value === high)?.[1] ?? 0;
    return t.chartRange(name, format(low), String(xs[lowAt]), format(high), String(xs[highAt]));
  });
  return `${head}. ${ranges.join("; ")}.`;
}

/** The table view and CSV: header first, values as given. */
export function rowsOf(chart: Chart): string[][] {
  const { kind, xName, names, xs, values } = chart;
  if (kind === "pie") {
    const total = (values[0] ?? []).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return [[xName, names[0] ?? "", t.share], ...xs.map((x, i) => [String(x), String(values[0]?.[i] ?? 0), share(values[0]?.[i] ?? 0, total)])];
  }
  return [[xName, ...names], ...xs.map((x, i) => [String(x), ...values.map((series) => (series[i] === null ? "" : String(series[i])))])];
}

const CHAR = 7; // a 12px label's average width per character
const LONGEST = 14; // characters of a category label before it is cut short

export const clip = (label: string) => (label.length > LONGEST ? `${label.slice(0, LONGEST - 1)}…` : label);

export type Plot = {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The x of point i; the y of a value. */
  x: (i: number) => number;
  y: (value: number) => number;
  /** The y of the baseline the bars and areas grow from. */
  base: number;
  /** The width of one category's band (0 for a scatter). */
  band: number;
  yTicks: { at: number; label: string; value: number }[];
  xTicks: { at: number; label: string }[];
};

/** Where everything goes on a bar, line, area or scatter chart this wide. */
export function plotOf(chart: Chart, width: number): Plot {
  const { kind, xs, values } = chart;
  const height = width < 480 ? 200 : 260;
  const all = values.flat().filter((value): value is number => value !== null);
  let [low, high] = [Math.min(...all), Math.max(...all)];
  if (kind === "bar" || kind === "area") [low, high] = [Math.min(low, 0), Math.max(high, 0)];
  const ys = ticks(low, high, height < 240 ? 4 : 5);
  const [y0, y1] = [ys[0] ?? 0, ys[ys.length - 1] ?? 1];
  const compact = Math.max(Math.abs(y0), Math.abs(y1)) >= 10_000;
  const yLabels = ys.map((value) => format(value, compact));
  const left = Math.max(...yLabels.map((label) => label.length)) * CHAR + 14;
  const [top, right, bottom] = [10, 14, 26];
  const [plotW, plotH] = [Math.max(1, width - left - right), height - top - bottom];
  const y = (value: number) => top + plotH * (1 - (value - y0) / (y1 - y0));
  const yTicks = ys.map((value, i) => ({ at: y(value), label: yLabels[i] ?? "", value }));

  if (kind === "scatter") {
    const numbers = xs as number[];
    const xt = ticks(Math.min(...numbers), Math.max(...numbers), plotW < 300 ? 4 : 6);
    const [x0, x1] = [xt[0] ?? 0, xt[xt.length - 1] ?? 1];
    const xCompact = Math.max(Math.abs(x0), Math.abs(x1)) >= 10_000;
    const at = (value: number) => left + (plotW * (value - x0)) / (x1 - x0);
    return {
      width, height, left, top, right, bottom, y, band: 0, yTicks,
      base: y(Math.min(Math.max(0, y0), y1)),
      x: (i) => at(numbers[i] ?? 0),
      xTicks: xt.map((value) => ({ at: at(value), label: format(value, xCompact) })),
    };
  }
  const band = plotW / xs.length;
  const x = (i: number) => left + band * (i + 0.5);
  // Labels never overlap: past what fits, only every second (third...) category is named on the axis.
  const widest = Math.max(...xs.map((label) => clip(String(label)).length)) * CHAR + 10;
  const every = Math.max(1, Math.ceil(widest / band));
  return {
    width, height, left, top, right, bottom, x, y, band, yTicks,
    base: y(Math.min(Math.max(0, y0), y1)),
    xTicks: xs.flatMap((label, i) => (i % every ? [] : [{ at: x(i), label: clip(String(label)) }])),
  };
}
