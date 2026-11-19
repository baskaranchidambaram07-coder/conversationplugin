// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { SentChip } from "../../src/Attachments";
import FileView from "../../src/files/FileView";
import { zip } from "./fixtures";

afterEach(cleanup);
beforeEach(() => {
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:file-${++n}`), revokeObjectURL: vi.fn() });
});

const W = 'xmlns:w="w" xmlns:r="r"';
const blob = async (files: Record<string, string>) => new Blob([await zip(files)]);
const show = (name: string, file: Blob) => render(<FileView name={name} load={() => Promise.resolve(file)} />);

test("a Word document shows as a page: headings under the viewer's title, nested lists, links only to the web", async () => {
  show(
    "Welcome.docx",
    await blob({
      "word/document.xml": `<w:document ${W}><w:body>
        <w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>Arriving</w:t></w:r></w:p>
        <w:p><w:hyperlink r:id="good"><w:r><w:t>the map</w:t></w:r></w:hyperlink><w:hyperlink r:id="bad"><w:r><w:t> a trick</w:t></w:r></w:hyperlink></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Keys</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Front door</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Room</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Studio</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="good" Target="https://example.org/map" TargetMode="External"/><Relationship Id="bad" Target="javascript:alert(1)" TargetMode="External"/></Relationships>',
      "word/styles.xml": `<w:styles ${W}><w:style w:styleId="H1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    }),
  );

  expect(await screen.findByRole("heading", { level: 3, name: "Arriving" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "the map" }).getAttribute("href")).toBe("https://example.org/map");
  expect(screen.queryByRole("link", { name: "a trick" })).toBeNull();
  expect(screen.getByText("a trick")).toBeTruthy(); // kept as words
  const [outer, inner] = screen.getAllByRole("list");
  expect(outer!.tagName).toBe("UL"); // no numbering in this file, so bullets
  expect(inner!.tagName).toBe("UL");
  expect(outer!.contains(inner!)).toBe(true);
  expect(inner!.textContent).toBe("Front door");
  expect(screen.getByRole("cell", { name: "Studio" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download CSV" })).toBeTruthy();
});

test("an Excel workbook shows a sheet at a time, chosen by name", async () => {
  const sheet = (word: string) => `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${word}</t></is></c></row><row r="2"><c r="A2"><v>3</v></c></row></sheetData></worksheet>`;
  show(
    "Rooms.xlsx",
    await blob({
      "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="North" r:id="a"/><sheet name="South" r:id="b"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="a" Target="worksheets/1.xml"/><Relationship Id="b" Target="worksheets/2.xml"/></Relationships>',
      "xl/worksheets/1.xml": sheet("North house"),
      "xl/worksheets/2.xml": sheet("South house"),
    }),
  );
  const sheets = await screen.findByRole("group", { name: "Sheets" });
  expect(screen.getByRole("columnheader", { name: "North house" })).toBeTruthy();
  fireEvent.click(within(sheets).getByRole("button", { name: "South" }));
  expect(within(sheets).getByRole("button", { name: "South" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("columnheader", { name: "South house" })).toBeTruthy();
});

test("a PowerPoint deck shows each slide numbered, with its title and lines", async () => {
  show(
    "Induction.pptx",
    await blob({
      "ppt/presentation.xml": '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="s1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p" xmlns:a="a"><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Welcome week</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Meet your warden</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
    }),
  );
  const slide = await screen.findByRole("region", { name: "Slide 1 of 1" });
  expect(within(slide).getByRole("heading", { name: "Welcome week" })).toBeTruthy();
  expect(within(slide).getByRole("listitem").textContent).toBe("Meet your warden");
});

test("a CSV file shows as a table; an old Office file, any other file, or one that cannot be read says what to do", async () => {
  show("rates.csv", new Blob(["Room,Rate\nSingle,295\n"]));
  expect(await screen.findByRole("cell", { name: "295" })).toBeTruthy();
  cleanup();

  show("old.doc", new Blob(["x"]));
  expect(screen.getByText(/older Office format that browsers cannot show/)).toBeTruthy();
  cleanup();

  show("tool.exe", new Blob(["x"]));
  expect(screen.getByText("This kind of file cannot be shown here. Save it to open it on your device.")).toBeTruthy();
  cleanup();

  show("broken.docx", new Blob(["not a zip at all"]));
  expect(await screen.findByText("This file could not be read here. Save it to open it on your device.")).toBeTruthy();
});

test("a PDF opens in the browser's own viewer from a local copy, or, where there is none, says to save it", async () => {
  Object.defineProperty(navigator, "pdfViewerEnabled", { value: true, configurable: true });
  show("Guide.pdf", new Blob(["%PDF-1.7"]));
  const frame = await screen.findByTitle("Guide.pdf");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.getAttribute("src")).toMatch(/^blob:/);
  expect((vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob).type).toBe("application/pdf");
  cleanup();

  Object.defineProperty(navigator, "pdfViewerEnabled", { value: false, configurable: true });
  show("Guide.pdf", new Blob(["%PDF-1.7"]));
  expect(screen.getByText("This browser cannot show PDF files here. Save it to open it on your device.")).toBeTruthy();
});

test("a sent file opens in the viewer, fetched once, and saves from its bar", async () => {
  const docx = await blob({
    "word/document.xml": `<w:document ${W}><w:body><w:p><w:r><w:t>Bring your passport</w:t></w:r></w:p></w:body></w:document>`,
  });
  const fetchFile = vi.fn(() => Promise.resolve(docx));
  const saved = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
  render(
    <ul>
      <SentChip block={{ type: "file", id: "f_1", name: "Arrival.docx", size: 2048, content_type: type }} fetchFile={fetchFile} />
    </ul>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open Arrival.docx" }));
  const viewer = await screen.findByRole("dialog", { name: "Arrival.docx" });
  expect(await within(viewer).findByText("Bring your passport")).toBeTruthy();
  fireEvent.click(within(viewer).getByRole("button", { name: "Save Arrival.docx" }));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetchFile).toHaveBeenCalledOnce();
  saved.mockRestore();
});
