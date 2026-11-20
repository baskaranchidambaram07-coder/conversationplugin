// A Markdown table (M3-T5): scrolls sideways inside its own frame with the header row held in place, copies or
// downloads as CSV, and folds rows past the tenth behind "Show all" so one long table cannot swamp the conversation.
// A table of numbers is also a chart (derive.ts): drawn over it when the answer asks for one, else one press away.
import type { Element, ElementContent } from "hast";
import { lazy, type ReactNode, Suspense, useContext, useState } from "react";

import { save } from "../Attachments";
import { CopyButton, Icon } from "../Icon";
import { strings as t } from "../strings";
import { hintsOf, specOfTable } from "./derive";
import { Source } from "./source";

const Chart = lazy(() => import("./Chart"));

const FOLD_AFTER = 10;
const DOWNLOAD = "M12 4v11M7 10l5 5 5-5M5 20h14";
const BARS = "M5 20V10M12 20V4M19 20v-7";
const BOM = String.fromCharCode(0xfeff);

/** A file name from the table's headings: month-year-revenue.csv. */
const fileName = (head: string[] = []) =>
  `${head.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "table"}.csv`;

const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

/** Every row of the table, header first, as plain cell text. */
export function rowsOf(table: Element): string[][] {
  const rows: string[][] = [];
  const walk = (node: ElementContent) => {
    if (node.type !== "element") return;
    if (node.tagName === "tr") rows.push(node.children.filter((cell) => cell.type === "element").map(textOf));
    else node.children.forEach(walk);
  };
  table.children.forEach(walk);
  return rows;
}

/** CSV for a spreadsheet. A cell a spreadsheet would run as a formula is prefixed so it stays text. */
export function toCsv(rows: string[][]) {
  const cell = (value: string) => {
    const safe = /^[=+@\t\r]|^-(?!\d)/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

/** A Markdown table (from its syntax tree), or a table of plain rows given directly, as a chart's data is. */
export function Table({ node, rows: given, children }: { node?: Element; rows?: string[][]; children?: ReactNode }) {
  const [all, setAll] = useState(false);
  const [charted, setCharted] = useState<boolean | null>(null); // null until the visitor chooses
  const answer = useContext(Source);
  const rows = given ?? (node ? rowsOf(node) : []);
  const hidden = Math.max(0, rows.length - 1 - FOLD_AFTER);
  const csv = toCsv(rows);
  const hints = node ? hintsOf(answer) : null; // a chart's own table is not charted again
  const spec = hints && specOfTable(rows, hints);
  const drawn = Boolean(spec) && (charted ?? hints!.wanted);
  return (
    <>
      {drawn && (
        <Suspense fallback={null}>
          <Chart code={JSON.stringify(spec)} language="chart" table={false} />
        </Suspense>
      )}
      <figure className="table">
        <div
          className={!hidden ? "scroll" : all ? "scroll expanded" : "scroll folded"}
          tabIndex={0}
          role="region"
          aria-label={t.table(rows[0] ?? [])}
        >
          <table>{children}</table>
        </div>
        <div className="tools">
          <CopyButton text={csv} label={t.copyCsv} />
          <button
            type="button"
            className="quiet"
            // The byte-order mark makes spreadsheets read the file as UTF-8, so £ and é survive.
            onClick={() => save(new Blob([BOM, csv], { type: "text/csv;charset=utf-8" }), fileName(rows[0]))}
          >
            <Icon path={DOWNLOAD} />
            {t.downloadCsv}
          </button>
          {spec && (
            <button type="button" className="quiet" aria-expanded={drawn} onClick={() => setCharted(!drawn)}>
              <Icon path={BARS} />
              {drawn ? t.hideChart : t.showChart}
            </button>
          )}
          {hidden > 0 && !all && (
            <button type="button" className="quiet" onClick={() => setAll(true)}>
              {t.showRows(rows.length - 1)}
            </button>
          )}
        </div>
      </figure>
    </>
  );
}
