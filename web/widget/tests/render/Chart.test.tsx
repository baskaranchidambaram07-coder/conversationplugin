// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import Chart from "../../src/render/Chart";
import gallery from "../../src/render/gallery/charts.md?raw";
import Markdown from "../../src/render/Markdown";
import { chartOf, plotOf, rowsOf, ticks } from "../../src/render/plot";

afterEach(cleanup);

const [bars = "", lines = "", , pie = ""] = [...gallery.matchAll(/```chart\n([\s\S]*?)```/g)].map((m) => m[1]!);
const spec = (fields: object) => JSON.stringify({ type: "bar", x: "m", data: [{ m: "Jan", a: 1 }], ...fields });

test("every chart in an answer is drawn from its data, and one that does not hold together shows as code", async () => {
  render(<Markdown text={gallery} />);

  for (const name of [
    "Bar chart: Library visits by month",
    "Line chart: Average room temperature (°C)",
    "Area chart: Guest room nights booked",
    "Pie chart: Residents by region",
    "Scatter chart: Weekly study hours against coursework mark",
  ]) {
    expect(await screen.findByRole("group", { name })).toBeTruthy();
  }
  expect(screen.getByText(/"data": "not a list"/).closest("figure")?.className).toBe("code");
});

test("bars grow from one baseline, square there and rounded at their value; a legend names two series", () => {
  const figure = render(<Chart code={bars} language="chart" />).container;

  const marks = [...figure.querySelectorAll(".c1 .bar, .c2 .bar")];
  expect(marks).toHaveLength(12);
  const bases = marks.map((mark) => mark.getAttribute("d")!.match(/^M[\d.]+,([\d.]+)V/)![1]);
  expect(new Set(bases).size).toBe(1);
  expect([...figure.querySelectorAll(".legend li")].map((li) => li.textContent)).toEqual(["Day", "Evening"]);
});

test("a line breaks where a value is missing, and a single series needs no legend", () => {
  const figure = render(<Chart code={lines} language="chart" />).container;
  expect(figure.querySelectorAll(".c2 .line")).toHaveLength(2);

  cleanup();
  const one = render(<Chart code={spec({ type: "area" })} language="chart" />).container;
  expect(one.querySelector(".legend")).toBeNull();
});

test("the arrow keys read each value, aloud and in a tip over the chart, values first; Escape stops", () => {
  render(<Chart code={bars} language="chart" />);
  const plot = screen.getByRole("group", { name: "Bar chart: Library visits by month" });
  const spoken = plot.parentElement!.querySelector("[aria-live=polite]")!;
  const tip = () => plot.querySelector(".tip")?.textContent;

  fireEvent.keyDown(plot, { key: "ArrowRight" });
  expect(spoken.textContent).toBe("Sep: 1,240 Day; 610 Evening");
  expect(tip()).toBe("Sep1,240 Day610 Evening");
  fireEvent.keyDown(plot, { key: "End" });
  expect(spoken.textContent).toBe("Feb: 1,490 Day; 760 Evening");
  fireEvent.keyDown(plot, { key: "ArrowRight" });
  expect(spoken.textContent).toContain("Feb");
  fireEvent.keyDown(plot, { key: "Escape" });
  expect([spoken.textContent, tip()]).toEqual(["", undefined]);
});

test("a screen reader hears what the chart shows: each series' lowest and highest point", () => {
  render(<Chart code={bars} language="chart" />);
  const plot = screen.getByRole("group", { name: "Bar chart: Library visits by month" });

  expect(document.getElementById(plot.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Bar chart: Library visits by month. Day from 960 (Dec) to 1,710 (Nov); Evening from 380 (Dec) to 905 (Nov). " +
      "Use the arrow keys to read each value.",
  );
});

test("the same numbers show as a table, which copies as CSV", () => {
  render(<Chart code={bars} language="chart" />);
  fireEvent.click(screen.getByRole("button", { name: "Show as table" }));

  const table = screen.getByRole("region", { name: "Table: Month, Day, Evening" });
  expect(within(table).getAllByRole("row")).toHaveLength(7);
  expect(within(table).getAllByRole("row")[1]?.textContent).toBe("Sep1240610");
  expect(screen.getByRole("button", { name: "Copy as CSV" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide table" }));
  expect(screen.queryByRole("region", { name: /^Table/ })).toBeNull();
});

test("a pie shows its largest slices first and folds the smallest into Other, with each share", () => {
  const chart = chartOf(pie)!;

  expect(chart.xs).toEqual(["Europe", "East Asia", "South Asia", "North America", "Africa", "Latin America", "Middle East", "Other"]);
  expect(chart.values[0]?.[7]).toBe(18);
  expect(rowsOf(chart)[1]).toEqual(["Europe", "182", "25.5%"]);
});

test.each([
  ["not JSON", "{ \"type\": \"bar\","],
  ["an unknown type", spec({ type: "radar" })],
  ["no x", spec({ x: "" })],
  ["rows that are not objects", spec({ data: [1, 2] })],
  ["no numbers at all", spec({ data: [{ m: "Jan", a: "1" }] })],
  ["nine series", spec({ y: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] })],
  ["four scatter series", spec({ type: "scatter", data: [{ m: 1, a: 1 }], y: ["a", "b", "c", "d"] })],
  ["a scatter with words for x", spec({ type: "scatter" })],
  ["two pie series", spec({ type: "pie", y: ["a", "b"] })],
  ["a negative slice", spec({ type: "pie", data: [{ m: "Jan", a: -1 }] })],
  ["more than 5,000 points", spec({ data: Array.from({ length: 5001 }, (_, i) => ({ m: `p${i}`, a: i })) })],
])("a chart with %s is not drawn", (_, code) => {
  expect(chartOf(code)).toBeNull();
});

test("only data is read: anything that looks like code or configuration is ignored, and words are kept short", () => {
  const chart = chartOf(spec({ title: `${"x".repeat(200)}`, formatter: "function () { alert(1) }", labels: { a: " A\n  b " } }))!;

  expect(Object.keys(chart).sort()).toEqual(["kind", "names", "stacked", "title", "values", "xName", "xs"]);
  expect(chart.title).toHaveLength(120);
  expect(chart.names).toEqual(["A b"]);
});

test("axis values are round numbers that cover the data", () => {
  expect(ticks(0, 1710)).toEqual([0, 500, 1000, 1500, 2000]);
  expect(ticks(18.9, 21.2, 4)).toEqual([18.5, 19, 19.5, 20, 20.5, 21, 21.5]);
  expect(ticks(-35, 80)).toEqual([-40, -20, 0, 20, 40, 60, 80]);
  expect(ticks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test("in a narrow panel the axis names only every few categories, and large values go compact", () => {
  const data = Array.from({ length: 30 }, (_, i) => ({ day: `Day ${i + 1}`, orders: 12_000 + i * 500 }));
  const plot = plotOf(chartOf(JSON.stringify({ type: "line", x: "day", data }))!, 340);

  expect(plot.xTicks.length).toBeLessThan(10);
  expect(plot.xTicks[0]?.label).toBe("Day 1");
  expect(plot.yTicks.map((tick) => tick.label)).toContain("20K");
});

test("a stacked bar chart draws one bar a category, its parts summing to the top of the scale; as lines it is unstacked", async () => {
  const stacked = JSON.stringify({
    type: "bar",
    title: "Nights booked",
    x: "month",
    stacked: true,
    data: [
      { month: "Sep", single: 120, double: 80 },
      { month: "Oct", single: 150, double: 0 },
    ],
  });
  const data = chartOf(stacked)!;
  expect(data.stacked).toBe(true);
  const plot = plotOf(data, 400);
  expect(plot.yTicks[plot.yTicks.length - 1]!.value).toBeGreaterThanOrEqual(200); // the tallest bar is 120 + 80, not 150

  render(<Chart code={stacked} language="chart" />);
  const chart = screen.getByRole("group", { name: "Stacked bar chart: Nights booked" });
  const bars = [...chart.querySelectorAll("path.bar")];
  expect(bars).toHaveLength(3); // Oct's empty double draws nothing
  const lefts = new Set(bars.map((path) => path.getAttribute("d")!.match(/^M([\d.]+)/)![1]));
  expect(lefts.size).toBe(2); // one bar a month, its parts on one another

  fireEvent.click(screen.getByRole("button", { name: "Line" }));
  expect(screen.getByRole("group", { name: "Line chart: Nights booked" })).toBeTruthy();
});

test("a chart is stacked only when asked, with two or more series and none below 0", () => {
  const rows = [{ m: "Jan", a: 1, b: 2 }];
  expect(chartOf(JSON.stringify({ type: "area", x: "m", stacked: true, data: rows }))!.stacked).toBe(true);
  expect(chartOf(JSON.stringify({ type: "area", x: "m", data: rows }))!.stacked).toBe(false);
  expect(chartOf(JSON.stringify({ type: "bar", x: "m", y: ["a"], stacked: true, data: rows }))!.stacked).toBe(false);
  expect(chartOf(JSON.stringify({ type: "bar", x: "m", stacked: true, data: [{ m: "Jan", a: -1, b: 2 }] }))!.stacked).toBe(false);
});

test("a stacked area chart fills each series between the running totals", () => {
  const code = JSON.stringify({ type: "area", x: "m", stacked: true, data: [{ m: "A", x: 1, y: 2 }, { m: "B", x: 3, y: 1 }] });
  render(<Chart code={code} language="chart" />);
  const washes = [...document.querySelectorAll("figure.chart path.wash")];
  expect(washes).toHaveLength(2);
  expect(washes[1]!.getAttribute("d")!.match(/L/g)!.length).toBeGreaterThanOrEqual(3); // along the top, back along the one under it
});

test("a Mermaid XY chart is drawn as a chart, its bars and lines over its x-axis", async () => {
  const xy = [
    "```mermaid",
    "xychart-beta",
    '    title "Laundry use by day"',
    "    x-axis [Mon, Tue, Wed]",
    '    y-axis "Loads" 0 --> 60',
    "    bar [32, 41, 28]",
    "```",
  ].join("\n");
  render(<Markdown text={xy} />);
  const chart = await screen.findByRole("group", { name: "Bar chart: Laundry use by day" });
  expect(chart.querySelectorAll("path.bar")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Copy for Mermaid" })).toBeTruthy();
});
