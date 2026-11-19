// A fenced CSV or TSV block in an answer (M3-T8) drawn as the chat's own table, with its tools; until its fence has
// closed, and if it holds fewer than two rows, it stays code.
import { useMemo } from "react";

import { readCsv } from "../files/csv";
import { Code } from "./Code";
import type { FenceProps } from "./registry";
import { RowsTable } from "./Table";

export default function Csv({ code, language }: FenceProps) {
  const rows = useMemo(() => readCsv(code, language.toLowerCase() === "tsv" ? "	" : ","), [code, language]);
  return rows.length > 1 ? <RowsTable rows={rows} /> : <Code code={code} language={language} />;
}
