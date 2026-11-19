// A file shown in the full-screen viewer (M3-T8): a PDF in the browser's own viewer; a Word document, an Excel
// workbook, a PowerPoint deck or a CSV file read here and drawn as the chat's own text and tables; a picture as
// itself. Anything else (and the older binary Office formats, which no browser can read) says so and offers to save.
// Loaded only when a file is opened.
import { type ReactNode, useEffect, useState } from "react";

import { RowsTable } from "../render/Table";
import { safeHref } from "../render/links";
import { strings as t } from "../strings";
import { readCsv } from "./csv";
import { type Paragraph, type Part, readDocx, readPptx, readXlsx, type Sheet, type Slide } from "./office";
import { unzip } from "./zip";

export type Kind = "pdf" | "picture" | "docx" | "xlsx" | "pptx" | "csv" | "legacy" | "other";

/** What a file is, by its extension. */
export function kindOf(name: string): Kind {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) return "picture";
  if (extension === "docx" || extension === "xlsx" || extension === "pptx") return extension;
  if (extension === "csv" || extension === "tsv") return "csv";
  if (["doc", "xls", "ppt"].includes(extension)) return "legacy";
  return "other";
}

/** Whether the viewer's zoom applies: the browser's PDF viewer has its own, and a note needs none. */
export const zooms = (kind: Kind) => kind !== "pdf" && kind !== "legacy" && kind !== "other";

type Shown =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "address"; src: string }
  | { kind: "document"; parts: Part[] }
  | { kind: "sheets"; sheets: Sheet[] }
  | { kind: "slides"; slides: Slide[] }
  | { kind: "rows"; rows: string[][] };

export default function FileView({ name, load }: { name: string; load: () => Promise<Blob> }) {
  const kind = kindOf(name);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });

  useEffect(() => {
    if (kind === "legacy" || kind === "other" || (kind === "pdf" && !navigator.pdfViewerEnabled)) return;
    const made: string[] = []; // local addresses, freed when the viewer closes
    let gone = false;
    (async (): Promise<Shown> => {
      const blob = await load();
      if (kind === "pdf" || kind === "picture") {
        const type = kind === "pdf" ? "application/pdf" : blob.type;
        made.push(URL.createObjectURL(new Blob([blob], { type })));
        return { kind: "address", src: made[0]! };
      }
      if (kind === "csv") return { kind: "rows", rows: readCsv(await blob.text()) };
      const zip = unzip(await blob.arrayBuffer());
      if (!zip) throw new Error("not a zip archive");
      if (kind === "docx") return { kind: "document", parts: await readDocx(zip, made) };
      if (kind === "xlsx") return { kind: "sheets", sheets: await readXlsx(zip) };
      return { kind: "slides", slides: await readPptx(zip, made) };
    })().then(
      (next) => !gone && setShown(next),
      () => !gone && setShown({ kind: "failed" }),
    );
    return () => {
      gone = true;
      made.forEach((src) => URL.revokeObjectURL(src));
    };
  }, [name]);

  if (kind === "legacy") return <p className="file-note">{t.fileOld(name)}</p>;
  if (kind === "other") return <p className="file-note">{t.fileCannotShow}</p>;
  if (kind === "pdf" && !navigator.pdfViewerEnabled) return <p className="file-note">{t.pdfCannotShow}</p>;
  if (shown.kind === "loading") return <p className="file-note" role="status">{t.fileOpening}</p>;
  if (shown.kind === "failed") return <p className="file-note">{t.fileUnreadable}</p>;
  if (shown.kind === "address") {
    return kind === "pdf" ? <iframe className="pdf" src={shown.src} title={name} /> : <img className="file-picture" src={shown.src} alt={name} />;
  }
  if (shown.kind === "document") return <article className="file-page">{wordParts(shown.parts)}</article>;
  if (shown.kind === "rows") return <RowsTable rows={shown.rows} />;
  if (shown.kind === "sheets") return <Sheets sheets={shown.sheets} />;
  return (
    <div className="slides">
      {shown.slides.map((slide, i) => (
        <section key={i} className="slide" aria-label={t.slide(i + 1, shown.slides.length)}>
          <p className="slide-number">{t.slide(i + 1, shown.slides.length)}</p>
          {slide.title && <h3 dir="auto">{slide.title}</h3>}
          {slide.lines.length > 0 && (
            <ul>
              {slide.lines.map((line, n) => (
                <li key={n} className={`level-${Math.min(line.level, 4)}`} dir="auto">
                  {line.text}
                </li>
              ))}
            </ul>
          )}
          {slide.pictures.map((p, n) => (
            <img key={n} src={p.src} alt={p.alt} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Sheets({ sheets }: { sheets: Sheet[] }) {
  const [at, setAt] = useState(0);
  const sheet = sheets[at]!;
  return (
    <div className="sheets">
      {sheets.length > 1 && (
        <div className="kinds" role="group" aria-label={t.sheets}>
          {sheets.map((s, i) => (
            <button key={i} type="button" aria-pressed={i === at} onClick={() => setAt(i)}>
              {s.name || t.sheet(i + 1)}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length ? <RowsTable key={at} rows={sheet.rows} /> : <p className="file-note">{t.sheetEmpty}</p>}
      {sheet.more && <p className="file-note">{t.sheetMore}</p>}
    </div>
  );
}

function runs(paragraph: Paragraph): ReactNode[] {
  return paragraph.runs.map((run, i) => {
    let out: ReactNode = run.text;
    if (run.bold) out = <strong>{out}</strong>;
    if (run.italic) out = <em>{out}</em>;
    if (run.underline && !run.link) out = <u>{out}</u>;
    const href = safeHref(run.link);
    if (href) {
      out = (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {out}
        </a>
      );
    }
    return <span key={i}>{out}</span>;
  });
}

/** A Word document's parts, with its list items gathered into nested lists. Its headings start at h3, under the
 *  viewer's own title. */
function wordParts(parts: Part[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.kind === "paragraph" && part.list) {
      const items: Paragraph[] = [];
      while (parts[i]?.kind === "paragraph" && (parts[i] as Paragraph).list) items.push(parts[i++] as Paragraph);
      i--;
      out.push(<List key={i} items={items} level={items[0]!.list!.level} />);
    } else if (part.kind === "paragraph") {
      const Heading = (["p", "h3", "h4", "h5", "h6", "h6", "h6"] as const)[part.heading] ?? "p";
      out.push(
        <Heading key={i} dir="auto">
          {runs(part)}
        </Heading>,
      );
    } else if (part.kind === "table") {
      out.push(<RowsTable key={i} rows={part.rows} />);
    } else {
      out.push(<img key={i} src={part.src} alt={part.alt} />);
    }
  }
  return out;
}

function List({ items, level }: { items: Paragraph[]; level: number }) {
  const Tag = items[0]!.list!.ordered ? "ol" : "ul";
  const out: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const deeper: Paragraph[] = [];
    while (items[i + 1] && items[i + 1]!.list!.level > level) deeper.push(items[++i]!);
    out.push(
      <li key={i} dir="auto">
        {runs(items[i - deeper.length]!)}
        {deeper.length > 0 && <List items={deeper} level={deeper[0]!.list!.level} />}
      </li>,
    );
  }
  return <Tag>{out}</Tag>;
}
