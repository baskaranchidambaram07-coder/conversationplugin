// CSV in an answer or a file (M3-T8), read into rows for the chat's own table. At most the first 1,000 rows: the
// file keeps the rest.
const ROWS = 1_000;

/** CSV (or, with a tab, TSV) as rows: quoted fields may hold the separator, quotes doubled, and line breaks. */
export function readCsv(source: string, separator = source.split("\n", 1)[0]!.includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = source.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === separator) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
      if (rows.length > ROWS) break;
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.slice(0, ROWS + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}
