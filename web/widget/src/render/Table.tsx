// A Markdown table (M3-T5): scrolls sideways inside its own frame with the header row held in place, copies as
// CSV, and folds rows past the tenth behind "Show all" so one long table cannot swamp the conversation.
import type { Element, ElementContent } from "hast";
import { type ReactNode, useState } from "react";

import { CopyButton } from "../Icon";
import { strings as t } from "../strings";

const FOLD_AFTER = 10;

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

export function Table({ node, children }: { node?: Element; children?: ReactNode }) {
  const [all, setAll] = useState(false);
  const rows = node ? rowsOf(node) : [];
  const hidden = Math.max(0, rows.length - 1 - FOLD_AFTER);
  return (
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
        <CopyButton text={toCsv(rows)} label={t.copyCsv} />
        {hidden > 0 && !all && (
          <button type="button" className="quiet" onClick={() => setAll(true)}>
            {t.showRows(rows.length - 1)}
          </button>
        )}
      </div>
    </figure>
  );
}
