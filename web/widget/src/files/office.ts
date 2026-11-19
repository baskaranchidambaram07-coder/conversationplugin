// Word, Excel and PowerPoint files read in the chat (M3-T8), from their XML, into plain data the viewer draws with
// its own elements: nothing from the file is ever put into the page as markup, so nothing in it can run or style the
// chat. Pictures inside become local addresses (blob:) only when their bytes are PNG, JPEG, GIF or WebP.
import { text, type Zip } from "./zip";

export type Run = { text: string; bold: boolean; italic: boolean; underline: boolean; link: string };
export type Paragraph = { kind: "paragraph"; heading: number; list: { level: number; ordered: boolean } | null; runs: Run[] };
export type Picture = { src: string; alt: string };
export type Part = Paragraph | { kind: "table"; rows: string[][] } | ({ kind: "picture" } & Picture);
export type Sheet = { name: string; rows: string[][]; more: boolean };
export type Slide = { title: string; lines: { text: string; level: number }[]; pictures: Picture[] };

const ROWS = 1_000; // rows of a sheet shown; the file keeps the rest
const COLUMNS = 50;
const SHEETS = 20;

const parse = (source: string) => new DOMParser().parseFromString(source || "<x/>", "application/xml");
/** Elements by local name, whatever prefix the file gives its namespace. */
const all = (node: Element | Document, name: string) => [...node.getElementsByTagNameNS("*", name)];
const kids = (node: Element | undefined, name: string) => (node ? [...node.children].filter((child) => child.localName === name) : []);
const kid = (node: Element | undefined, name: string) => kids(node, name)[0];
const attr = (node: Element | undefined, name: string) => (node ? ([...node.attributes].find((a) => a.localName === name)?.value ?? "") : "");

const folder = (part: string) => part.slice(0, part.lastIndexOf("/") + 1);

/** A part's relationships: id to the part, or address, it points at. */
async function relations(zip: Zip, part: string): Promise<Map<string, string>> {
  const doc = parse(await text(zip, `${folder(part)}_rels/${part.slice(folder(part).length)}.rels`));
  const out = new Map<string, string>();
  for (const r of all(doc, "Relationship")) {
    const target = attr(r, "Target");
    if (attr(r, "TargetMode") === "External") out.set(attr(r, "Id"), target);
    else out.set(attr(r, "Id"), resolve(folder(part), target));
  }
  return out;
}

function resolve(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const out: string[] = [];
  for (const part of parts) part === ".." ? out.pop() : part !== "." && out.push(part);
  return out.join("/");
}

const KINDS: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
];

/** A picture inside the file as a local address, or "" when it is missing or not a kind of picture we show. */
async function picture(zip: Zip, name: string, made: string[]): Promise<string> {
  const read = zip.get(name);
  if (!read) return "";
  const bytes = await read();
  const webp = String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF";
  const type = webp ? "image/webp" : KINDS.find(([sign]) => sign.every((byte, i) => bytes[i] === byte))?.[1];
  if (!type) return "";
  const src = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  made.push(src);
  return src;
}

/** A Word document's paragraphs, headings, lists, tables and pictures, in order. `made` collects picture addresses. */
export async function readDocx(zip: Zip, made: string[]): Promise<Part[]> {
  const main = "word/document.xml";
  const body = kid(parse(await text(zip, main)).documentElement, "body");
  if (!body) throw new Error("not a Word document");
  const links = await relations(zip, main);

  // Heading styles by their names, so a Word set to another language (whose style IDs differ) still has headings.
  const headings = new Map<string, number>();
  for (const style of all(parse(await text(zip, "word/styles.xml")), "style")) {
    const name = attr(kid(style, "name"), "val").toLowerCase();
    const level = name === "title" ? 1 : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0);
    if (level) headings.set(attr(style, "styleId"), level);
  }
  // Which numbered lists count (1, 2, 3) and which are bullets, by list and level.
  const numbering = parse(await text(zip, "word/numbering.xml"));
  const formats = new Map<string, Map<string, string>>();
  for (const abstract of all(numbering, "abstractNum")) {
    formats.set(attr(abstract, "abstractNumId"), new Map(kids(abstract, "lvl").map((l) => [attr(l, "ilvl"), attr(kid(l, "numFmt"), "val")])));
  }
  const lists = new Map(all(numbering, "num").map((n) => [attr(n, "numId"), formats.get(attr(kid(n, "abstractNumId"), "val"))]));

  const runsOf = (node: Element, link = ""): Run[] =>
    [...node.children].flatMap((child): Run[] => {
      if (child.localName === "hyperlink") return runsOf(child, links.get(attr(child, "id")) ?? "");
      if (child.localName === "ins" || child.localName === "smartTag") return runsOf(child, link);
      if (child.localName !== "r") return [];
      const look = kid(child, "rPr");
      const on = (name: string) => Boolean(kid(look, name)) && !["0", "false", "none"].includes(attr(kid(look, name), "val"));
      const words = [...child.children]
        .map((part) => (part.localName === "t" ? (part.textContent ?? "") : part.localName === "tab" ? "\t" : part.localName === "br" ? "\n" : ""))
        .join("");
      return words ? [{ text: words, bold: on("b"), italic: on("i"), underline: on("u"), link }] : [];
    });

  const parts: Part[] = [];
  for (const node of body.children) {
    if (node.localName === "tbl") {
      const rows = kids(node, "tr").map((row) =>
        kids(row, "tc").map((cell) => kids(cell, "p").map((p) => runsOf(p).map((r) => r.text).join("")).join("\n")),
      );
      parts.push({ kind: "table", rows });
      continue;
    }
    if (node.localName !== "p") continue;
    const look = kid(node, "pPr");
    const number = kid(look, "numPr");
    const level = Number(attr(kid(number, "ilvl"), "val") || 0);
    const list = number ? { level, ordered: (lists.get(attr(kid(number, "numId"), "val"))?.get(String(level)) ?? "bullet") !== "bullet" } : null;
    const runs = runsOf(node);
    if (runs.length) parts.push({ kind: "paragraph", heading: headings.get(attr(kid(look, "pStyle"), "val")) ?? 0, list, runs });
    for (const drawing of all(node, "drawing")) {
      const src = await picture(zip, links.get(attr(all(drawing, "blip")[0], "embed")) ?? "", made);
      if (src) parts.push({ kind: "picture", src, alt: attr(all(drawing, "docPr")[0], "descr") });
    }
  }
  return parts;
}

// Number formats that show a date or a time: Excel's own (14 to 22, 45 to 47) and any written with day, month, year
// or hour letters outside quoted text and [colour] tags.
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateCode = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^general$/i.test(code);

const DAY = 86_400_000;
const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const times = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** A spreadsheet's date serial as a date people read: 45615 is 19 Nov 2024. */
export function dateOf(serial: number, from1904 = false) {
  const when = new Date((serial - 25569 + (from1904 ? 1462 : 0)) * DAY);
  return Number.isInteger(serial) ? dates.format(when) : times.format(when);
}

const columnOf = (reference: string) => [...(/^[A-Z]+/.exec(reference)?.[0] ?? "A")].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;

/** An Excel workbook's sheets, each as rows of the values shown in its cells (the first 1,000 rows of 50 columns). */
export async function readXlsx(zip: Zip): Promise<Sheet[]> {
  const book = "xl/workbook.xml";
  const workbook = parse(await text(zip, book));
  const from1904 = ["1", "true"].includes(attr(all(workbook, "workbookPr")[0], "date1904"));
  const targets = await relations(zip, book);
  const shared = all(parse(await text(zip, "xl/sharedStrings.xml")), "si").map((item) => all(item, "t").map((t) => t.textContent).join(""));
  const styles = parse(await text(zip, "xl/styles.xml"));
  const codes = new Map(all(styles, "numFmt").map((f) => [Number(attr(f, "numFmtId")), attr(f, "formatCode")]));
  const looks = kids(all(styles, "cellXfs")[0], "xf").map((xf) => {
    const id = Number(attr(xf, "numFmtId"));
    return DATE_FORMATS.has(id) || isDateCode(codes.get(id) ?? "");
  });

  const sheets: Sheet[] = [];
  for (const entry of all(workbook, "sheet").slice(0, SHEETS)) {
    const doc = parse(await text(zip, targets.get(attr(entry, "id")) ?? ""));
    const rows: string[][] = [];
    let more = false;
    for (const row of all(doc, "row")) {
      const at = Number(attr(row, "r") || rows.length + 1) - 1;
      if (at >= ROWS) {
        more = true;
        break;
      }
      const cells: string[] = [];
      for (const cell of kids(row, "c")) {
        const column = attr(cell, "r") ? columnOf(attr(cell, "r")) : cells.length;
        if (column >= COLUMNS) {
          more = true;
          continue;
        }
        const raw = kid(cell, "v")?.textContent ?? "";
        const kind = attr(cell, "t");
        cells[column] =
          kind === "s" ? (shared[Number(raw)] ?? "")
          : kind === "inlineStr" ? all(cell, "t").map((t) => t.textContent).join("")
          : kind === "b" ? (raw === "1" ? "TRUE" : "FALSE")
          : kind === "str" || kind === "e" || raw === "" ? raw
          : looks[Number(attr(cell, "s") || 0)] ? dateOf(Number(raw), from1904)
          : String(Number(Number(raw).toPrecision(15)));
      }
      while (rows.length < at) rows.push([]);
      rows[at] = Array.from(cells, (value) => value ?? "");
    }
    const width = Math.max(1, ...rows.map((row) => row.length));
    sheets.push({ name: attr(entry, "name"), rows: rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "")), more });
  }
  if (!sheets.length) throw new Error("not an Excel workbook");
  return sheets;
}

/** A PowerPoint deck's slides in order: each one's title, its lines of text with their levels, and its pictures. */
export async function readPptx(zip: Zip, made: string[]): Promise<Slide[]> {
  const deck = "ppt/presentation.xml";
  const presentation = parse(await text(zip, deck));
  const targets = await relations(zip, deck);
  const slides: Slide[] = [];
  for (const id of all(presentation, "sldId")) {
    const part = targets.get(attr(id, "id")) ?? "";
    const doc = parse(await text(zip, part));
    const links = await relations(zip, part);
    const slide: Slide = { title: "", lines: [], pictures: [] };
    for (const shape of all(doc, "sp")) {
      const kind = attr(all(shape, "ph")[0], "type");
      for (const p of all(shape, "p").filter((node) => node.parentElement?.localName === "txBody")) {
        const words = [...p.children].filter((c) => c.localName === "r" || c.localName === "fld").map((c) => all(c, "t").map((t) => t.textContent).join("")).join("");
        if (!words.trim()) continue;
        if ((kind === "title" || kind === "ctrTitle") && !slide.title) slide.title = words;
        else slide.lines.push({ text: words, level: Number(attr(kid(p, "pPr"), "lvl") || 0) });
      }
    }
    for (const pic of all(doc, "pic")) {
      const src = await picture(zip, links.get(attr(all(pic, "blip")[0], "embed")) ?? "", made);
      if (src) slide.pictures.push({ src, alt: attr(all(pic, "cNvPr")[0], "descr") });
    }
    slides.push(slide);
  }
  if (!slides.length) throw new Error("not a PowerPoint deck");
  return slides;
}
