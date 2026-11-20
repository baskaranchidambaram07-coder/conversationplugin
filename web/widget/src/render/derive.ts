// Charts an answer implies but never sends. Purple Fabric's agents answer "show me a revenue graph" with a Markdown
// table and Python plotting code, never a `chart` block. Here the table's numbers, or the literal lists in the code,
// become the plain data a `chart` block holds, checked by plot.ts like any other; the code only suggests the kind of
// chart and its title. Code is read for its literal values, never run.

import type { Kind } from "./plot";

export type Spec = { type: Kind; title: string; x: string; y: string[]; data: Record<string, string | number | null>[] };
export type Hints = { kind: Kind | null; title: string; wanted: boolean };

// --- the answer's hints ------------------------------------------------------------------------------------------

const CALL =
  /\b(?:plt|ax\w*|axes\w*(?:\[[^\]\n]*\])?|df\w*)\.(plot|bar|barh|scatter|pie|fill_between|stackplot|step|hist)\s*\(|\b(?:px|go|sns)\.(line|bar|area|scatter|pie|histogram|Bar|Scatter|Pie|barplot|lineplot|scatterplot|countplot|histplot)\s*\(/g;
const KINDS: Record<string, Kind> = {
  plot: "line", step: "line", line: "line", lineplot: "line", Scatter: "line",
  bar: "bar", barh: "bar", hist: "bar", histogram: "bar", Bar: "bar", barplot: "bar", countplot: "bar", histplot: "bar",
  fill_between: "area", stackplot: "area", area: "area",
  scatter: "scatter", scatterplot: "scatter",
  pie: "pie", Pie: "pie",
};
const TITLE = /(?:\.title|\.set_title|\.suptitle|\btitle\s*=)\s*\(?\s*[rf]?(["'])([^"'\n{}]{1,120})\1/;

/** What the answer says about a chart: the kind its plotting code draws, its title, and whether it wants one. */
export function hintsOf(answer: string): Hints {
  const said = /\bkind\s*=\s*["'](line|bar|barh|area|pie|scatter)["']/.exec(answer)?.[1];
  const calls = [...answer.matchAll(CALL)].map((m) => KINDS[m[1] ?? m[2] ?? ""]).filter((k): k is Kind => Boolean(k));
  const kind = said ? KINDS[said]! : calls.includes("area") ? "area" : (calls[0] ?? null);
  const title = TITLE.exec(answer)?.[2]?.trim() ?? "";
  return { kind, title, wanted: kind !== null || /\b(?:charts?|graphs?|plot(?:s|ted)?|visuali[sz]\w*)\b/i.test(answer) };
}

// --- tables ------------------------------------------------------------------------------------------------------

const EMPTY = /^(?:|-|–|—|n\/?a|null|none)$/i;
const NUMBER = /^(\()?([-+−])?\s*[$£€¥₹]?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*%?\)?$/;
const TIME = /\b(?:year|yr|fy|date|month|quarter|qtr|week|wk|day|period|time)s?\b/i;
const NAME = /\b(?:id|no|code|rank|zip|postcode|phone|ref)\b|#/i;
const MEASURE = /revenue|sales|income|profit|loss|cost|price|amount|total|count|units|value|spend|budget|growth|rate|score|%|\$|£|€/i;
const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+'?\d{2,4})?$|^q[1-4](?:\s+'?\d{2,4})?$/i;

/** A cell's number: 45,200 · $1,250.50 · −3.5% · (1,200) for a loss. Null when it holds anything else. */
export function numberOf(cell: string): number | null {
  const m = NUMBER.exec(cell.trim());
  if (!m || (m[1] && !cell.trim().endsWith(")"))) return null;
  const n = Number(m[3]!.replace(/,/g, "") + (m[4] ?? ""));
  return m[1] || (m[2] && m[2] !== "+") ? -n : n;
}

/** A key not yet taken, for a column whose name another already has. */
const unique = (name: string, taken: Set<string>) => {
  let key = name;
  for (let n = 2; taken.has(key); n++) key = `${name} (${n})`;
  taken.add(key);
  return key;
};

/** A table (header first) as chart data: its first naming column, with any dates beside it, names the points; its
 *  number columns are the series. Null when it has no numbers to draw, or nothing to name them by. */
export function specOfTable(rows: string[][], hints: Hints): Spec | null {
  const [head, ...body] = rows;
  if (!head || head.length < 2 || body.length < 2 || body.length > 500) return null;
  const columns = head.map((given, c) => {
    const name = given.trim() || `Column ${c + 1}`;
    const cells = body.map((row) => (row[c] ?? "").trim());
    const values = cells.map((cell) => (EMPTY.test(cell) ? null : numberOf(cell)));
    const numeric = cells.every((cell, r) => EMPTY.test(cell) || values[r] !== null) && values.filter((v) => v !== null).length >= 2;
    const years = numeric && values.every((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= 2100));
    const time = TIME.test(name) || years || cells.every((cell) => MONTH.test(cell));
    return { name, cells, values, numeric, time, label: !numeric || (!MEASURE.test(name) && (time || NAME.test(name))) };
  });
  // The points are named by words before numbers (a name before its rank), with any dates beside them: Jan 2023.
  const words = columns.findIndex((column) => column.label && !column.numeric);
  const first = words >= 0 ? words : columns.findIndex((column) => column.label);
  const series = columns.filter((column) => !column.label);
  if (first < 0 || !series.length || series.length > 8) return null;
  const naming = [columns[first]!, ...columns.filter((column, c) => c !== first && column.label && column.time)];

  const taken = new Set<string>();
  const x = unique(naming.map((column) => column.name).join(" "), taken);
  const keys = series.map((column) => unique(column.name, taken));
  const temporal = naming.some((column) => column.time);
  let type: Kind = hints.kind === "scatter" ? "line" : (hints.kind ?? (temporal && body.length >= 4 ? "line" : "bar"));
  if (type === "pie" && (series.length > 1 || series[0]!.values.some((v) => v !== null && v < 0))) type = "bar";
  return {
    type,
    title: hints.title,
    x,
    y: keys,
    data: body.map((_, r) => ({
      [x]: naming.map((column) => column.cells[r]).join(" "),
      ...Object.fromEntries(series.map((column, s) => [keys[s]!, column.values[r] ?? null])),
    })),
  };
}

// --- Mermaid pie charts ------------------------------------------------------------------------------------------

/** A Mermaid pie chart as chart data, so it is drawn and read like any other chart:
 *      pie showData
 *          title Pets adopted
 *          "Dogs" : 386
 *  Null when it holds no slice to draw. A slice below 0, which Mermaid refuses, is refused here too. */
export function specOfMermaidPie(code: string): Spec | null {
  const lines = code.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = /^pie(?:\s+showData)?(?:\s+title\s+(.+))?$/i.exec(lines[0] ?? "");
  if (!header) return null;
  let title = header[1]?.trim() ?? "";
  const data: Spec["data"] = [];
  for (const line of lines.slice(1)) {
    const named = /^title\s+(.+)$/i.exec(line);
    const slice = /^(["'])(.+)\1\s*:\s*([-+]?\d[\d_]*(?:\.\d+)?)$/.exec(line);
    if (named) title = named[1]!.trim();
    else if (slice && Number(slice[3]) >= 0) data.push({ Label: slice[2]!, Value: Number(slice[3]) });
    else if (!/^(?:showData|accTitle|accDescr)\b/i.test(line)) return null; // not a pie Mermaid would draw
  }
  return data.length ? { type: "pie", title, x: "Label", y: ["Value"], data } : null;
}

// --- plotting code -----------------------------------------------------------------------------------------------

type Value = string | number;

/** The items of a list literal holding only quoted strings and numbers, such as ["Jan", "Feb"] or [45_200, 42800]. */
function listOf(text: string): Value[] | null {
  const inner = text.trim().replace(/^\[([\s\S]*)\]$/, "$1").replace(/#[^\n]*/g, "");
  const items = inner.match(/"[^"\n]*"|'[^'\n]*'|[^,]+/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
  const values = items.map((item): Value | null => {
    if (/^(["']).*\1$/.test(item)) return item.slice(1, -1);
    return /^[-+]?\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(item) ? Number(item.replace(/_/g, "")) : null;
  });
  return values.length && values.every((v) => v !== null) ? (values as Value[]) : null;
}

/** The text between the bracket at `open` and the one that closes it, quotes respected. */
function inside(code: string, open: number): string | null {
  let depth = 0;
  let quote = "";
  for (let i = open; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch) && --depth === 0) return code.slice(open + 1, i);
  }
  return null;
}

/** A call's arguments, split at its top-level commas: the positional ones, and the named ones by name. */
function argsOf(text: string): { at: string[]; named: Record<string, string> } {
  const parts: string[] = [];
  let [depth, quote, part] = [0, "", ""];
  for (const ch of text) {
    if (quote) quote = ch === quote ? "" : quote;
    else if (ch === '"' || ch === "'") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && !depth && !quote) {
      parts.push(part);
      part = "";
    } else part += ch;
  }
  parts.push(part);
  const at: string[] = [];
  const named: Record<string, string> = {};
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(raw);
    if (kw) named[kw[1]!] = kw[2]!.trim();
    else at.push(raw);
  }
  return { at, named };
}

const quoted = (text = "") => /^[rf]?(["'])([^"'\n]*)\1$/.exec(text.trim())?.[2] ?? "";
const PLOT = /\b(?:plt|ax\w*)\.(plot|bar|barh|scatter|step|pie)\s*\(|\bpx\.(line|bar|area|scatter|pie)\s*\(/g;

/** A chart from plotting code whose values are written into it: lists, or a dict of lists, named and then plotted.
 *  Null when the values come from anything the code computes, or when the answer has a table to draw instead. */
export function specOfCode(code: string, answer = ""): Spec | null {
  if (/^\s*\|.*\|\s*\n\s*\|[\s:|-]+\|/m.test(answer)) return null;
  const lists = new Map<string, Value[]>();
  const columns = new Map<string, Value[]>();
  for (const m of code.matchAll(/^[ \t]*([A-Za-z_]\w*)\s*=\s*([[{])/gm)) {
    const body = inside(code, m.index! + m[0].length - 1);
    if (body === null) continue;
    if (m[2] === "[") {
      const list = listOf(body);
      if (list) lists.set(m[1]!, list);
    } else
      for (const entry of body.matchAll(/(["'])([^"'\n]+)\1\s*:\s*\[/g)) {
        const list = listOf(inside(body, entry.index! + entry[0].length - 1) ?? "");
        if (list) columns.set(entry[2]!, list);
      }
  }
  const valuesOf = (expr = ""): Value[] | null => {
    const e = expr.trim();
    if (e.startsWith("[")) return listOf(inside(e, 0) ?? "");
    const column = /^[A-Za-z_]\w*\s*(?:\[\s*(["'])([^"'\n]+)\1\s*\]|\.([A-Za-z_]\w*))$/.exec(e);
    if (column) return columns.get(column[2] ?? column[3]!) ?? null;
    return lists.get(e) ?? columns.get(quoted(e)) ?? null;
  };

  const found: { kind: Kind; xs: Value[]; ys: number[]; name: string }[] = [];
  for (const m of code.matchAll(PLOT)) {
    const body = inside(code, m.index! + m[0].length - 1);
    if (body === null) continue;
    const { at, named } = argsOf(body);
    const kind = KINDS[m[1] ?? m[2] ?? ""]!;
    let pairs: [xs: Value[] | null, ys: Value[] | null, name: string][];
    if (kind === "pie") {
      pairs = [[valuesOf(named.labels ?? named.names), valuesOf(named.values) ?? valuesOf(at[0]), ""]];
    } else if (m[2]) {
      // Plotly names its axes, x=... and y=...; a list of column names gives a series each.
      const names = named.y?.startsWith("[") ? listOf(inside(named.y, 0) ?? "") : null;
      pairs = names?.every((v) => typeof v === "string")
        ? names.map((col) => [valuesOf(named.x), columns.get(String(col)) ?? null, String(col)])
        : [[valuesOf(named.x), valuesOf(named.y), quoted(named.y)]];
    } else {
      pairs = [at.length >= 2 ? [valuesOf(at[0]), valuesOf(at[1]), quoted(named.label)] : [null, valuesOf(at[0]), quoted(named.label)]];
    }
    for (const [given, ys, name] of pairs) {
      if (!ys?.length || !ys.every((v) => typeof v === "number")) continue;
      const xs = given ?? ys.map((_, i) => i + 1);
      if (xs.length === ys.length) found.push({ kind, xs, ys: ys as number[], name });
    }
  }
  const [lead] = found;
  if (!lead) return null;
  const series = found.filter((s) => s.xs.length === lead.xs.length).slice(0, 8);
  const hints = hintsOf(code);
  const x = quoted(/\b(?:plt\.xlabel|\.set_xlabel)\s*\(\s*([rf]?(["'])[^"'\n]*\2)/.exec(code)?.[1]) || "x";
  const ylabel = quoted(/\b(?:plt\.ylabel|\.set_ylabel)\s*\(\s*([rf]?(["'])[^"'\n]*\2)/.exec(code)?.[1]);
  const taken = new Set([x]);
  const keys = series.map((s, n) => unique(s.name || (series.length === 1 && ylabel) || `Series ${n + 1}`, taken));
  const numeric = lead.xs.every((v) => typeof v === "number");
  const kind = hints.kind ?? lead.kind;
  return {
    type: kind === "scatter" && !numeric ? "line" : kind === "pie" && series.length > 1 ? "bar" : kind,
    title: hints.title,
    x,
    y: keys,
    data: lead.xs.map((value, i) => ({ [x]: value, ...Object.fromEntries(series.map((s, n) => [keys[n]!, s.ys[i] ?? null])) })),
  };
}
