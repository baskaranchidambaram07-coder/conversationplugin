// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { hintsOf, numberOf, specOfCode, specOfTable } from "../../src/render/derive";
import plotted from "../../src/render/gallery/plotted.md?raw";
import revenue from "../../src/render/gallery/revenue.md?raw";
import Markdown from "../../src/render/Markdown";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The first Markdown table in an answer, as rows of cell text. */
const tableOf = (answer: string) =>
  answer
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|[\s:|-]+\|$/.test(line.trim()))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
const python = (answer: string) => [...answer.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]!);
const plain = { kind: null, title: "", wanted: false };

test("numbers are read as people write them, and nothing else is a number", () => {
  expect(["45,200", "$1,250.50", "−3.5%", "(1,200)", "+7", "2023", "£ 12"].map(numberOf)).toEqual([45200, 1250.5, -3.5, -1200, 7, 2023, 12]);
  expect(["1.2M", "12,34", "Jan", "3 apples", "(5", ""].map(numberOf)).toEqual([null, null, null, null, null, null]);
});

test("the answer's plotting code names the chart's kind and title, and says a chart is wanted", () => {
  expect(hintsOf(revenue)).toEqual({ kind: "area", title: "Synthetic Monthly Revenue (2023-2024)", wanted: true }); // plot + fill_between
  expect(hintsOf('df.plot(x="a", kind="bar")').kind).toBe("bar");
  expect(hintsOf("px.pie(df, names='Region', values='Sales')").kind).toBe("pie");
  expect(hintsOf("Here is the table you asked for.")).toEqual(plain);
  expect(hintsOf("A graph would show the trend.").wanted).toBe(true);
});

test("the revenue table becomes 24 points named by month and year, drawn as the code would draw it", () => {
  const spec = specOfTable(tableOf(revenue), hintsOf(revenue))!;

  expect(spec).toMatchObject({ type: "area", title: "Synthetic Monthly Revenue (2023-2024)", x: "Month Year", y: ["Revenue ($)"] });
  expect(spec.data).toHaveLength(24);
  expect(spec.data[0]).toEqual({ "Month Year": "Jan 2023", "Revenue ($)": 45200 });
  expect(spec.data[23]).toEqual({ "Month Year": "Dec 2024", "Revenue ($)": 112500 });
});

test("a table names its points by words before numbers, and only a table of numbers is a chart", () => {
  const ranked = specOfTable([["Rank", "Team", "Score"], ["1", "Kestrels", "91"], ["2", "Otters", "84"]], plain)!;
  expect(ranked).toMatchObject({ type: "bar", x: "Team", y: ["Score"] });
  expect(ranked.data[1]).toEqual({ Team: "Otters", Score: 84 });

  const dated = specOfTable([["Year", "Quarter", "Sales"], ["2024", "Q1", "10"], ["2024", "Q2", "12"], ["2024", "Q3", "9"], ["2024", "Q4", "15"]], plain)!;
  expect(dated).toMatchObject({ type: "line", x: "Quarter Year" });
  expect(dated.data[0]).toEqual({ "Quarter Year": "Q1 2024", Sales: 10 });

  expect(specOfTable([["Stage", "Owner"], ["Letter", "Legal"], ["Reply", "Firm"]], plain)).toBeNull(); // no numbers
  expect(specOfTable([["Item", "Price"], ["Tea", "£2"]], plain)).toBeNull(); // one row
  expect(specOfTable([["Price", "Stock"], ["2", "5"], ["3", "7"]], plain)).toBeNull(); // nothing names the points
  expect(specOfTable([["Item", "Change"], ["A", "-2"], ["B", "3"]], { ...plain, kind: "pie" })!.type).toBe("bar"); // no pie below 0
});

test("plotting code with its values written in is a chart; computed values, or an answer with a table, are not", () => {
  const [bars = "", lines = "", computed = ""] = python(plotted);

  const sales = specOfCode(bars)!;
  expect(sales).toMatchObject({ type: "bar", title: "Sales by region, Q3", x: "Region", y: ["Sales (£)"] });
  expect(sales.data[0]).toEqual({ Region: "North", "Sales (£)": 48200 });

  const visitors = specOfCode(lines)!;
  expect(visitors).toMatchObject({ type: "line", title: "Visitors by channel", y: ["Web", "Mobile"] });
  expect(visitors.data[5]).toMatchObject({ Web: 1780, Mobile: 1530 });

  expect(specOfCode(computed)).toBeNull();
  expect(specOfCode(bars, revenue)).toBeNull(); // the table is drawn instead
  expect(specOfCode("plt.pie([30, 70], labels=['Yes', 'No'])")).toMatchObject({ type: "pie", data: [{ x: "Yes" }, { x: "No" }] });
});

test("an answer about a chart draws its table as one, which the visitor can redraw as another kind", async () => {
  render(<Markdown text={revenue} />);

  const chart = await screen.findByRole("group", { name: "Area chart: Synthetic Monthly Revenue (2023-2024)" });
  const figure = chart.closest("figure")!;
  const kinds = within(figure).getByRole("group", { name: "Chart type" });
  expect(within(kinds).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
    ["Bar", "false"],
    ["Line", "false"],
    ["Area", "true"],
  ]); // no pie of 24 months
  expect(within(figure).queryByRole("button", { name: "Show as table" })).toBeNull(); // the table is just below

  fireEvent.click(within(kinds).getByRole("button", { name: "Bar" }));
  expect(within(figure).getByRole("group", { name: "Bar chart: Synthetic Monthly Revenue (2023-2024)" })).toBeTruthy();
  expect(figure.querySelectorAll("path.bar")).toHaveLength(24);

  const table = screen.getByRole("region", { name: "Table: Month, Year, Revenue ($)" }).closest("figure")!;
  fireEvent.click(within(table).getByRole("button", { name: "Hide chart" }));
  expect(screen.queryByRole("group", { name: /chart:/ })).toBeNull();
});

test("a table in an answer that asks for no chart offers one, and every table downloads as a CSV file", async () => {
  const made: Blob[] = [];
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (made.push(blob), "blob:table")), revokeObjectURL: vi.fn() });
  const saved = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("region-sales.csv");
  });
  render(<Markdown text={"| Region | Sales |\n|---|---|\n| North | £1,200 |\n| South | 980 |"} />);

  expect(screen.queryByRole("group", { name: /chart/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show as chart" }));
  expect(await screen.findByRole("group", { name: "Bar chart" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Pie" })); // two parts, none below 0
  expect(screen.getByRole("group", { name: "Pie chart" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  expect(saved).toHaveBeenCalledOnce();
  expect([...new Uint8Array(await made[0]!.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the mark, for spreadsheets
  expect(await made[0]!.text()).toBe("Region,Sales\r\nNorth,\"£1,200\"\r\nSouth,980"); // which reading drops
  expect(made[0]!.type).toBe("text/csv;charset=utf-8");
});

test("plotting code with its values written in is drawn over the code, which stays", async () => {
  render(<Markdown text={plotted} />);

  expect(await screen.findByRole("group", { name: "Bar chart: Sales by region, Q3" })).toBeTruthy();
  expect(await screen.findByRole("group", { name: "Line chart: Visitors by channel" })).toBeTruthy();
  expect(screen.getAllByRole("region", { name: "python" })).toHaveLength(3); // each code block, the computed one alone
  expect(screen.getAllByRole("group", { name: /chart:/ })).toHaveLength(2);
});
