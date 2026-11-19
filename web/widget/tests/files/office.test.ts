// @vitest-environment jsdom
import { expect, test } from "vitest";

import { readCsv } from "../../src/files/csv";
import { dateOf, readDocx, readPptx, readXlsx } from "../../src/files/office";
import { kindOf, zooms } from "../../src/files/FileView";
import { unzip } from "../../src/files/zip";
import { zip } from "./fixtures";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const rels = (items: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;

test("a zip archive's files are read stored or deflated; anything else is not an archive", async () => {
  for (const deflate of [false, true]) {
    const files = unzip(await zip({ "a/b.txt": "hello", "c.txt": "world" }, deflate))!;
    expect([...files.keys()]).toEqual(["a/b.txt", "c.txt"]);
    expect(new TextDecoder().decode(await files.get("c.txt")!())).toBe("world");
  }
  expect(unzip(new TextEncoder().encode("%PDF-1.7 not a zip").buffer)).toBeNull();
});

test("a file that would inflate past 20 MB stops at the limit, even when the archive lies about its size", async () => {
  const bomb = await zip({ "word/document.xml": new Uint8Array(21 * 1024 * 1024) }, true);
  const view = new DataView(bomb);
  const central = new Uint8Array(bomb).findIndex((_, i) => i + 4 <= bomb.byteLength && view.getUint32(i, true) === 0x02014b50);
  view.setUint32(central + 24, 1000, true); // declared tiny
  await expect(unzip(bomb)!.get("word/document.xml")!()).rejects.toThrow("too large");
});

test("a Word document reads as headings, styled and linked words, nested lists, tables and pictures", async () => {
  const document = `<w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Berschrift1"/></w:pPr><w:r><w:t>Welcome pack</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bring</w:t></w:r><w:r><w:t xml:space="preserve"> your </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>passport</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Arrive</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Collect keys</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Unpack</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Room</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Floor</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Single</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:drawing><wp:docPr xmlns:wp="wp" descr="The front gate"/><a:blip xmlns:a="a" r:embed="rPic"/></w:drawing></w:r></w:p>
  </w:body></w:document>`;
  const archive = unzip(
    await zip({
      "word/document.xml": document,
      "word/_rels/document.xml.rels": rels(
        '<Relationship Id="rLink" Target="https://example.org/arrive" TargetMode="External"/><Relationship Id="rPic" Target="media/gate.png"/>',
      ),
      "word/styles.xml": `<w:styles ${W}><w:style w:styleId="Berschrift1"><w:name w:val="heading 1"/></w:style></w:styles>`,
      "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num></w:numbering>`,
      "word/media/gate.png": PNG,
    }),
  )!;
  const made: string[] = [];
  const parts = await readDocx(archive, made);

  expect(parts[0]).toMatchObject({ kind: "paragraph", heading: 1, runs: [{ text: "Welcome pack" }] });
  expect(parts[1]).toMatchObject({
    runs: [{ text: "Bring", bold: true }, { text: " your ", bold: false }, { text: "passport", link: "https://example.org/arrive" }],
  });
  expect(parts.slice(2, 5).map((p) => p.kind === "paragraph" && p.list)).toEqual([
    { level: 0, ordered: true },
    { level: 1, ordered: false },
    { level: 0, ordered: true },
  ]);
  expect(parts[5]).toEqual({ kind: "table", rows: [["Room", "Floor"], ["Single", "2"]] });
  expect(parts[6]).toMatchObject({ kind: "picture", alt: "The front gate" });
  expect(made).toHaveLength(1);
});

test("a picture inside a document is shown only when its bytes are a picture", async () => {
  const archive = unzip(
    await zip({
      "word/document.xml": `<w:document ${W}><w:body><w:p><w:r><w:drawing><a:blip xmlns:a="a" r:embed="r1"/></w:drawing></w:r></w:p></w:body></w:document>`,
      "word/_rels/document.xml.rels": rels('<Relationship Id="r1" Target="media/evil.png"/>'),
      "word/media/evil.png": "<svg onload=alert(1)>",
    }),
  )!;
  expect(await readDocx(archive, [])).toEqual([]);
});

test("an Excel workbook reads sheet by sheet: shared words, numbers, true and false, and dates as dates", async () => {
  const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const archive = unzip(
    await zip({
      "xl/workbook.xml": `<workbook ${X}><sheets><sheet name="Rooms" r:id="rId1"/><sheet name="Empty" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": rels('<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/>'),
      "xl/sharedStrings.xml": `<sst ${X}><si><t>Room</t></si><si><t>Opens</t></si><si><r><t>Sin</t></r><r><t>gle</t></r></si></sst>`,
      "xl/styles.xml": `<styleSheet ${X}><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${X}><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Lift</t></is></c></row>
        <row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><v>45615</v></c><c r="C3"><v>0.30000000000000004</v></c><c r="D3" t="b"><v>1</v></c></row>
      </sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet ${X}><sheetData/></worksheet>`,
    }),
  )!;
  const [rooms, empty] = await readXlsx(archive);
  expect(rooms).toEqual({
    name: "Rooms",
    more: false,
    rows: [
      ["Room", "Opens", "", "Lift"],
      ["", "", "", ""],
      ["Single", "19 Nov 2024", "0.3", "TRUE"],
    ],
  });
  expect(empty!.rows).toEqual([]);
  expect(dateOf(45615.5)).toBe("19 Nov 2024, 12:00");
  expect(dateOf(44153, true)).toBe("19 Nov 2024"); // a workbook counting from 1904
});

test("a PowerPoint deck reads slide by slide, in the deck's order: title, lines with their levels, pictures", async () => {
  const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (title: string, lines: string) =>
    `<p:sld ${P}><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody>${lines}</p:txBody></p:sp>
      <p:pic><p:nvPicPr><p:cNvPr descr="Map"/></p:nvPicPr><p:blipFill><a:blip r:embed="rImg"/></p:blipFill></p:pic>
    </p:spTree></p:cSld></p:sld>`;
  const archive = unzip(
    await zip({
      "ppt/presentation.xml": `<p:presentation ${P}><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": rels('<Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/>'),
      "ppt/slides/slide1.xml": slide("Second", "<a:p><a:r><a:t>Later</a:t></a:r></a:p>"),
      "ppt/slides/slide2.xml": slide("First", '<a:p><a:r><a:t>Welcome</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>to the </a:t></a:r><a:r><a:t>College</a:t></a:r></a:p>'),
      "ppt/slides/_rels/slide2.xml.rels": rels('<Relationship Id="rImg" Target="../media/map.png"/>'),
      "ppt/media/map.png": PNG,
    }),
  )!;
  const [first, second] = await readPptx(archive, []);
  expect(first).toMatchObject({ title: "First", lines: [{ text: "Welcome", level: 0 }, { text: "to the College", level: 1 }] });
  expect(first!.pictures).toEqual([{ src: expect.stringMatching(/^blob:/), alt: "Map" }]);
  expect(second).toMatchObject({ title: "Second", lines: [{ text: "Later", level: 0 }], pictures: [] });
});

test("CSV reads with quoted commas, doubled quotes and line breaks in a field; a tab makes it TSV", () => {
  expect(readCsv('﻿Room,Note\r\nSingle,"Shared, quiet"\r\nStudio,"Says ""hi""\nthen leaves"\n')).toEqual([
    ["Room", "Note"],
    ["Single", "Shared, quiet"],
    ["Studio", 'Says "hi"\nthen leaves'],
  ]);
  expect(readCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  expect(readCsv("a,b,c\n1")).toEqual([["a", "b", "c"], ["1", "", ""]]);
});

test("each kind of file is known by its extension, and only what is drawn here zooms", () => {
  expect(["a.PDF", "b.jpeg", "c.docx", "d.xlsx", "e.pptx", "f.tsv", "g.doc", "h.xls", "i.ppt", "j.exe", "k"].map(kindOf)).toEqual([
    "pdf", "picture", "docx", "xlsx", "pptx", "csv", "legacy", "legacy", "legacy", "other", "other",
  ]);
  expect(zooms("pdf")).toBe(false);
  expect(zooms("docx")).toBe(true);
  expect(zooms("legacy")).toBe(false);
});
