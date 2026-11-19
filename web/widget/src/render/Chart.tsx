// A chart in an answer (M3-T6), drawn from the data ./chart.ts has checked. Thin marks on a quiet grid, the
// categorical palette in its fixed order (validated for both schemes and colour-blind readers), a legend for two or
// more series, every value readable by pointer or by the arrow keys, and the same numbers as a table.
import { type KeyboardEvent, type PointerEvent, useContext, useId, useMemo, useRef, useState } from "react";

import { CopyButton, Icon, SaveButton } from "../Icon";
import { strings as t } from "../strings";
import { InViewer } from "../frame";
import { FullScreen, Viewer } from "../Viewer";
import { type Chart as Data, chartOf, format, type Kind, pieOf, type Plot, plotOf, rowsOf, share, stacks, summary, tops } from "./plot";
import { Code } from "./Code";
import { specOfCode, specOfMermaidPie, specOfMermaidXy } from "./derive";
import { pictureName, pngOf } from "./image";
import { Source } from "./source";
import type { FenceProps } from "./registry";
import { useRoom } from "./room";
import { RowsTable } from "./Table";

const BAR = 24; // the thickest a bar gets; the rest of its band stays air
const GAP = 2; // the surface gap between touching bars and between slices
const PIE = 200; // a pie's height

const hue = (series: number) => `c${(series % 8) + 1}`;

/** A bar from the baseline to its value: the data end rounded by 4px, the baseline end square. */
function bar(x: number, w: number, base: number, end: number) {
  const r = Math.min(4, w / 2, Math.abs(base - end));
  const d = end <= base ? r : -r;
  return `M${x},${base}V${end + d}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + d}V${base}Z`;
}

/** The runs of a series between its gaps, as [x, y] points. */
function runs(values: (number | null)[], plot: Plot) {
  const all: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((value, i) => {
    if (value === null) return void (run.length && all.push(run), (run = []));
    run.push([plot.x(i), plot.y(value)]);
  });
  if (run.length) all.push(run);
  return all;
}

const path = (points: [number, number][]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");

/** One part of a stacked bar, from `low` up to `high`; the top part rounded like a bar's end, the rest square. */
function part(x: number, w: number, low: number, high: number, top: boolean) {
  return top ? bar(x, w, low, high) : `M${x},${low}V${high}H${x + w}V${low}Z`;
}

function Cartesian({ data, plot, at }: { data: Data; plot: Plot; at: number | null }) {
  const { kind, values } = data;
  const { width, height, left, right, base, band } = plot;
  const series = values.length;
  // Stacked, each category is one bar of its series' parts, split by the surface; else its series side by side.
  const stacked = stacks(data) ? tops(data) : null;
  const thick = stacked ? Math.max(1, Math.min(BAR * 1.5, band * 0.6)) : Math.max(1, Math.min(BAR, (band * 0.7 - (series - 1) * GAP) / series));
  const group = series * thick + (series - 1) * GAP;
  const highest = (i: number) => values.reduce((last, points, s) => ((points[i] ?? 0) > 0 ? s : last), -1);
  const lowOf = (s: number, i: number) => (s ? stacked![s - 1]![i]! : 0);
  const point = kind === "scatter" && at !== null ? stopsOf(data)[at] : null;
  return (
    <svg width={width} height={height} aria-hidden="true">
      {kind === "bar" && at !== null && (
        <rect className="hover" x={plot.x(at) - band / 2} y={plot.top} width={band} height={height - plot.top - plot.bottom} />
      )}
      {plot.yTicks.map(({ at: y, label, value }) => (
        <g key={value}>
          <line className={value === 0 ? "base" : "grid"} x1={left} x2={width - right} y1={y} y2={y} />
          <text className="tick" x={left - 8} y={y} dy="0.32em" textAnchor="end">
            {label}
          </text>
        </g>
      ))}
      {plot.xTicks.map(({ at: x, label }) => (
        <text key={`${x}`} className="tick" x={x} y={height - 8} textAnchor="middle">
          {label}
        </text>
      ))}
      {values.map((points, s) => (
        <g key={s} className={hue(s)}>
          {kind === "bar" &&
            stacked &&
            points.map((value, i) => {
              if (!value) return null;
              const top = highest(i) === s;
              const [low, high] = [plot.y(lowOf(s, i)) - (s ? GAP / 2 : 0), plot.y(stacked[s]![i]!) + (top ? 0 : GAP / 2)];
              return low - high < 0.5 ? null : <path key={i} className="bar" d={part(plot.x(i) - thick / 2, thick, low, high, top)} />;
            })}
          {kind === "bar" &&
            !stacked &&
            points.map((value, i) =>
              value === null ? null : (
                <path key={i} className={value < 0 ? "bar below" : "bar"} d={bar(plot.x(i) - group / 2 + s * (thick + GAP), thick, base, plot.y(value))} />
              ),
            )}
          {kind === "area" && stacked && (
            <g>
              <path
                className="wash"
                d={`${path(points.map((_, i) => [plot.x(i), plot.y(stacked[s]![i]!)]))}${points
                  .map((_, i) => `L${plot.x(points.length - 1 - i)},${plot.y(lowOf(s, points.length - 1 - i))}`)
                  .join("")}Z`}
              />
              <path className="line" pathLength={1} d={path(points.map((_, i) => [plot.x(i), plot.y(stacked[s]![i]!)]))} />
            </g>
          )}
          {(kind === "line" || (kind === "area" && !stacked)) &&
            runs(points, plot).map((run, r) => (
              <g key={r}>
                {kind === "area" && <path className="wash" d={`${path(run)}V${base}H${run[0]?.[0]}Z`} />}
                <path className="line" pathLength={1} d={path(run)} />
              </g>
            ))}
          {(kind === "line" || kind === "area") &&
            [at ?? points.reduce<number>((last, value, i) => (value === null ? last : i), -1)].map((i) => {
              const value = points[i];
              if (value === null || value === undefined) return null;
              return <circle key={i} className="dot" cx={plot.x(i)} cy={plot.y(stacked ? stacked[s]![i]! : value)} r={4} />;
            })}
          {kind === "scatter" &&
            points.map((value, i) =>
              value === null ? null : <circle key={i} className="dot" cx={plot.x(i)} cy={plot.y(value)} r={point?.[0] === s && point[1] === i ? 6 : 4} />,
            )}
        </g>
      ))}
      {(kind === "line" || kind === "area") && at !== null && (
        <line className="cross" x1={plot.x(at)} x2={plot.x(at)} y1={plot.top} y2={height - plot.bottom} />
      )}
    </svg>
  );
}

function Pie({ data, width, size, at }: { data: Data; width: number; size: number; at: number | null }) {
  const slices = data.values[0] ?? [];
  const total = slices.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const [cx, cy, outer] = [width / 2, size / 2, size / 2 - 8];
  let angle = 0;
  return (
    <svg width={width} height={size} aria-hidden="true">
      {slices.map((value, i) => {
        const turn = ((value ?? 0) / total) * 2 * Math.PI;
        const [a0, a1] = [angle, (angle += turn)];
        const r1 = outer + (at === i ? 4 : 0);
        const r0 = outer * 0.6;
        const p = (r: number, a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
        const large = turn > Math.PI ? 1 : 0;
        // A whole circle cannot be one arc: it is drawn as a ring.
        const d =
          turn >= 2 * Math.PI - 1e-9
            ? `M${cx},${cy - r1}A${r1},${r1} 0 1 1 ${cx},${cy + r1}A${r1},${r1} 0 1 1 ${cx},${cy - r1}M${cx},${cy - r0}A${r0},${r0} 0 1 0 ${cx},${cy + r0}A${r0},${r0} 0 1 0 ${cx},${cy - r0}Z`
            : `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
        return turn > 0 ? <path key={i} className={`slice ${hue(i)}`} d={d} fillRule="evenodd" /> : null;
      })}
    </svg>
  );
}

/** The chart as drawn, with its title and legend, as PNG on its own card's colour. */
function picture(plot: HTMLElement, title: string) {
  const figure = plot.closest("figure")!;
  const svg = plot.querySelector("svg")!;
  const legend = [...figure.querySelectorAll(".legend li")].map((item) => {
    const key = getComputedStyle(item.querySelector(".key")!);
    const filled = key.backgroundColor !== "rgba(0, 0, 0, 0)" && key.backgroundColor !== "transparent";
    return { name: item.textContent ?? "", colour: filled ? key.backgroundColor : key.borderTopColor };
  });
  const ground = getComputedStyle(figure).backgroundColor;
  return pngOf({ svg, width: svg.width.baseVal.value, height: svg.height.baseVal.value, ground, title, legend });
}

/** The points the arrow keys step through: categories, slices, or a scatter's dots from left to right. */
function stopsOf(data: Data): [number, number][] {
  if (data.kind !== "scatter") return data.xs.map((_, i) => [0, i]);
  return data.values
    .flatMap((points, s) => points.flatMap((value, i) => (value === null ? [] : [[s, i] as [number, number]])))
    .sort((a, b) => (data.xs[a[1]] as number) - (data.xs[b[1]] as number) || a[0] - b[0]);
}

/** The kinds a chart may be redrawn as: any of bar, line and area, and a pie for one series of eight or fewer
 *  parts, none below 0. */
function kindsOf(chart: Data): Kind[] {
  if (chart.kind === "scatter") return [];
  const one = chart.values.length === 1 && chart.xs.length <= 8 ? chart.values[0]! : []; // a pie of many slices misleads
  const pie = one.every((value) => value === null || value >= 0) && one.some((value) => value !== null && value > 0);
  return pie ? ["bar", "line", "area", "pie"] : ["bar", "line", "area"];
}

/** A chart block; a Mermaid pie; Python plotting code whose values are written into it (drawn over the code); or a
 *  table's numbers (given as a chart block, without a second table under it). */
export default function Chart({ code, language, table: tabled = true, start = null }: FenceProps & { table?: boolean; start?: Kind | null }) {
  const answer = useContext(Source);
  const base = useMemo(
    () =>
      chartOf(
        language === "chart"
          ? code
          : JSON.stringify(language === "mermaid" ? (specOfMermaidPie(code) ?? specOfMermaidXy(code)) : specOfCode(code, answer)),
      ),
    [code, language, answer],
  );
  const [kind, setKind] = useState<Kind | null>(start); // null until the visitor picks another
  const data = base && kind && kind !== base.kind ? (kind === "pie" ? pieOf({ ...base, kind }) : { ...base, kind }) : base;
  const [at, setAt] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [viewing, setViewing] = useState(false);
  const whole = useContext(InViewer);
  const frame = useRef<HTMLDivElement>(null);
  const room = useRoom(frame, data);
  const described = useId();
  if (!data || !base) return <Code code={code} language={language} />;
  const kinds = kindsOf(base);

  const width = room || 320;
  // In the full-screen viewer a chart is drawn taller, as the window allows.
  const tall = whole ? Math.max(260, Math.min(560, window.innerHeight - 240)) : 0;
  const pie = tall ? Math.min(tall, 360) : PIE;
  const plot = data.kind === "pie" ? null : plotOf(data, width, tall);
  const stops = stopsOf(data);
  const total = data.kind === "pie" ? (data.values[0] ?? []).reduce<number>((sum, value) => sum + (value ?? 0), 0) : 0;
  const many = data.values.length > 1 || data.kind === "pie";
  const key = data.kind === "line" ? "line" : data.kind === "scatter" ? "dot" : "box";

  // The pointer picks the nearest category, slice or dot; the same reading as the arrow keys give.
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const [px, py] = [event.clientX - box.left, event.clientY - box.top];
    if (data.kind === "pie") {
      const [dx, dy] = [px - width / 2, py - pie / 2];
      if (Math.hypot(dx, dy) > pie / 2) return setAt(null);
      const turn = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
      let angle = 0;
      const slice = (data.values[0] ?? []).findIndex((value) => (angle += ((value ?? 0) / total) * 2 * Math.PI) >= turn);
      return setAt(slice < 0 ? null : slice);
    }
    if (!plot) return;
    if (data.kind !== "scatter") {
      return setAt(Math.min(data.xs.length - 1, Math.max(0, Math.floor((px - plot.left) / plot.band))));
    }
    let [best, nearest] = [Infinity, 0];
    stops.forEach(([s, i], n) => {
      const value = data.values[s]?.[i];
      const far = value === null || value === undefined ? Infinity : Math.hypot(plot.x(i) - px, plot.y(value) - py);
      if (far < best) [best, nearest] = [far, n];
    });
    setAt(best <= 24 ? nearest : null); // a dot is easy to miss: anything within 24px of it counts
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = stops.length - 1;
    const next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (next) setAt(at === null ? (next > 0 ? 0 : last) : Math.min(last, Math.max(0, at + next)));
    else if (event.key === "Home") setAt(0);
    else if (event.key === "End") setAt(last);
    else if (event.key === "Escape" && at !== null) setAt(null);
    else return;
    event.preventDefault();
  };

  // The reading: values lead, names follow, each beside its series' key.
  type Item = [series: number, value: string, name: string];
  const reading = ((): [string, Item[]] | null => {
    if (at === null) return null;
    const [s, i] = stops[at] ?? [0, 0];
    if (data.kind === "pie") {
      const value = data.values[0]?.[i] ?? 0;
      return [String(data.xs[i]), [[i, `${format(value)} · ${share(value, total)}`, ""]]];
    }
    if (data.kind === "scatter") {
      return [`${data.xName} ${format(data.xs[i] as number)}`, [[s, format(data.values[s]?.[i] ?? 0), data.names[s] ?? ""]]];
    }
    return [
      String(data.xs[i]),
      data.values.map((points, n): Item => {
        const value = points[i];
        return [n, value === null || value === undefined ? "–" : format(value), many ? (data.names[n] ?? "") : ""];
      }),
    ];
  })();
  const rows = rowsOf(data);
  const [, point = 0] = at === null ? [] : (stops[at] ?? []);
  const before = (data.values[0] ?? []).slice(0, point).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const middle = (((before + (data.values[0]?.[point] ?? 0) / 2) / (total || 1)) * 2 * Math.PI) % (2 * Math.PI);
  const side = (plot ? plot.x(point) < width / 2 : middle > Math.PI) ? "right" : "left";

  return (
    <>
      <figure className="chart">
        {data.title && <figcaption>{data.title}</figcaption>}
        {many && (
          <ul className="legend">
            {(data.kind === "pie" ? data.xs.map(String) : data.names).map((name, n) => (
              <li key={n}>
                <span className={`key ${key} ${hue(n)}`} />
                {name}
              </li>
            ))}
          </ul>
        )}
        <div
          className="plot"
          ref={frame}
          tabIndex={0}
          role="group"
          aria-label={t.chart(data.kind, data.title, stacks(data))}
          aria-describedby={described}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setAt(null)}
          onKeyDown={step}
          onBlur={() => setAt(null)}
        >
          <p id={described} className="hidden">
            {summary(data)} {t.chartKeys}
          </p>
          {plot ? <Cartesian data={data} plot={plot} at={at} /> : <Pie data={data} width={width} size={pie} at={at} />}
          {/* Over the chart, in the top corner away from the reading, so it never moves anything. */}
          {reading && (
            <div className={`tip ${side}`} aria-hidden="true">
              <span>{reading[0]}</span>
              {reading[1].map(([n, value, name]) => (
                <span key={n}>
                  <span className={`key ${key} ${hue(n)}`} />
                  <strong>{value}</strong> {name}
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="hidden" aria-live="polite">
          {reading && `${reading[0]}: ${reading[1].map(([, value, name]) => `${value} ${name}`.trim()).join("; ")}`}
        </p>
        <div className="tools">
          {kinds.length > 0 && (
            <div className="kinds" role="group" aria-label={t.chartType}>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={data.kind === k}
                  onClick={() => {
                    setKind(k);
                    setAt(null);
                  }}
                >
                  {t.kinds[k]}
                </button>
              ))}
            </div>
          )}
          {language === "mermaid" && <CopyButton text={code} label={t.copyFor("Mermaid")} />}
          {tabled && (
            <button type="button" className="quiet" aria-expanded={table} onClick={() => setTable(!table)}>
              <Icon path="M3 5h18v14H3zM3 10h18M9 10v9" />
              {table ? t.hideTable : t.showTable}
            </button>
          )}
          <SaveButton label={t.downloadImage} name={pictureName(data.title, "chart")} make={() => picture(frame.current!, data.title)} />
          <FullScreen onOpen={() => setViewing(true)} />
        </div>
      </figure>
      {viewing && (
        <Viewer title={t.chart(data.kind, data.title, stacks(data))} zoomable={false} onClose={() => setViewing(false)}>
          <Chart code={code} language={language} table={tabled} start={kind} />
        </Viewer>
      )}
      {language !== "chart" && language !== "mermaid" && <Code code={code} language={language} />}
      {tabled && table && <RowsTable rows={rows} />}
    </>
  );
}
