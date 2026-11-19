import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Rendered answers (M3) on every engine: the example gallery, the injection corpus under the chat's content policy,
// copying, keyboard scrolling, and a wide table in a narrow panel. The fake gateway in e2e/server.mjs answers with
// the same files the unit tests draw (web/widget/src/render/gallery).
const CHAT = "http://localhost:4174/embed/w_chat"; // the chat page on its own, as a full page

// Notes anything the content policy refuses, before the chat's own code runs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const refused: string[] = [];
    Object.assign(window, { refused });
    document.addEventListener("securitypolicyviolation", (event) =>
      refused.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
});

async function ask(page: Page, question: string) {
  await page.goto(CHAT);
  const field = page.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 }); // a long answer streams for seconds
}

const refused = (page: Page) => page.evaluate(() => (window as unknown as { refused: string[] }).refused);

const EXAMPLES = [
  { name: "formatting", question: "[gallery:formatting]", parts: ":is(h2, h3, h4, h5, h6)", count: 6 },
  { name: "code", question: "[gallery:code]", parts: "figure.code", count: 5 }, // its sequence diagram is drawn
  { name: "tables", question: "[gallery:tables]", parts: "figure.table", count: 2 },
  { name: "diagrams", question: "[gallery:diagrams]", parts: "figure.diagram svg[role=img]", count: 3 },
  { name: "drawings", question: "[gallery:drawings]", parts: "figure.diagram svg[role=img]", count: 2 },
  { name: "charts", question: "[gallery:charts]", parts: "figure.chart .plot svg", count: 6 },
  { name: "revenue", question: "[gallery:revenue]", parts: "figure.chart .plot svg", count: 1 },
  { name: "plotted", question: "[gallery:plotted]", parts: "figure.chart .plot svg", count: 2 },
  { name: "mermaid", question: "[gallery:mermaid]", parts: ":is(figure.diagram svg[role=img], figure.chart .plot svg)", count: 3 },
  { name: "maths", question: "[gallery:maths]", parts: ".maths math", count: 14 },
  { name: "Purple Fabric's recorded long", question: "[long]", parts: "figure", count: 3 },
];

for (const { name, question, parts, count } of EXAMPLES) {
  test(`the ${name} example draws in full, with nothing thrown or refused`, async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));
    await ask(page, question);

    await expect(page.locator(`.md ${parts}`)).toHaveCount(count);
    expect(thrown).toEqual([]);
    expect(await refused(page)).toEqual([]);
  });
}

test("the injection corpus runs, loads and styles nothing, and the content policy never had to step in", async ({
  page,
}) => {
  const elsewhere: string[] = []; // anything but our origin and the widget's own logo
  page.on("request", (request) => {
    if (!/^(http:\/\/localhost:4174\/|https:\/\/example\.org\/logo\.svg$)/.test(request.url())) {
      elsewhere.push(request.url());
    }
  });
  await ask(page, "[injection]");

  await expect(page.locator(".md")).toHaveCount(1);
  await expect(page.locator(".md :is(script, iframe, style, img, object, embed, link, meta)")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { hacked?: number }).hacked)).toBeUndefined();
  expect(await refused(page)).toEqual([]);
  expect(elsewhere).toEqual([]);
});

test("a table copies as CSV, and code copies exactly", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test read the clipboard back");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:4174" });
  await ask(page, "[gallery:tables]");
  await page.getByRole("button", { name: "Copy as CSV" }).first().click();

  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).split("\r\n")).toEqual([
    "Room,Size (m²),Weekly rate,Notes",
    "Single,11.5,£295.00,Shared kitchen",
    '"Single, en suite",14,£340.50,Wi-Fi included',
    "Studio,22.25,£465.00,Floor plans",
    "Family flat,48,£720.00,",
    "Pipe in a cell,0,—,a | b",
  ]);

  await ask(page, "[gallery:code]");
  await page.getByRole("button", { name: "Copy code" }).first().click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const code = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"); // Windows' line ends
  expect(code).toMatch(/^import socket\n[\s\S]*return False$/);
});

test("a table downloads as a CSV file, and the chart drawn from it redraws as another kind", async ({ page }) => {
  await ask(page, "[gallery:revenue]");
  const chart = page.getByRole("group", { name: "Area chart: Synthetic Monthly Revenue (2023-2024)" });
  await expect(chart).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("month-year-revenue.csv");
  const lines = (await readFile((await download.path())!, "utf8")).split("\r\n");
  expect(lines.slice(0, 2)).toEqual([`${String.fromCharCode(0xfeff)}Month,Year,Revenue ($)`, 'Jan,2023,"45,200"']); // the mark, for spreadsheets
  expect(lines).toHaveLength(25);

  await page.getByRole("button", { name: "Bar", exact: true }).click();
  await expect(page.getByRole("group", { name: "Bar chart: Synthetic Monthly Revenue (2023-2024)" })).toBeVisible();
  await expect(page.locator("figure.chart path.bar")).toHaveCount(24);
  // The first series' blue, not the ink of the chat's avatar, which once shared the bars' class name.
  expect(await page.locator("figure.chart path.bar").first().evaluate((bar) => getComputedStyle(bar).fill)).toBe("rgb(42, 120, 214)");
  await page.getByRole("button", { name: "Hide chart" }).click();
  await expect(page.locator("figure.chart")).toHaveCount(0);
});

test("code is coloured in the palette, copies as written, and a formula is drawn by the browser itself", async ({ page }) => {
  await ask(page, "[gallery:code]");
  const python = page.getByRole("region", { name: "python" });
  const keyword = python.locator(".hljs-keyword").first();
  await expect(keyword).toBeVisible();
  expect(await keyword.evaluate((token) => getComputedStyle(token).color)).toBe("rgb(161, 48, 111)");
  expect(await python.textContent()).toMatch(/^import socket\n/);

  await ask(page, "[gallery:maths]");
  const formula = page.locator(".maths.block math").first();
  await expect(formula).toBeVisible();
  expect((await formula.boundingBox())!.height).toBeGreaterThan(20); // laid out as maths, not a line of TeX
  await expect(page.locator(".md").getByText(/Rents are \$650 a month and fees \$1,200 a year/)).toBeVisible(); // money, not maths
});

test("wide code scrolls sideways from the keyboard", async ({ page }) => {
  await ask(page, "[gallery:code]");
  const region = page.getByRole("region", { name: "javascript" });
  await region.focus();
  for (let press = 0; press < 5; press++) await page.keyboard.press("ArrowRight");

  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("in a 280px panel a wide table scrolls inside its frame, the chat never scrolls sideways, and rows unfold", async ({
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 620 });
  await ask(page, "[gallery:tables]");
  const laundry = page.getByRole("region", { name: /^Table: House/ });

  expect(await laundry.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("cell", { name: "House 14" })).toBeHidden();
  await page.getByRole("button", { name: "Show all 14 rows" }).click();
  await expect(page.getByRole("cell", { name: "House 14" })).toBeVisible();
});

test("in a 400px panel a wide diagram keeps its words readable, scrolls inside its frame, and shows its code", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 640 });
  await ask(page, "[gallery:diagrams]");
  const frame = page.getByRole("region", { name: "Diagram from draw.io" });
  const drawing = frame.getByRole("img");

  const [shown, natural] = await drawing.evaluate((svg) => [svg.getBoundingClientRect().width, (svg as SVGSVGElement).viewBox.baseVal.width]);
  expect(shown / natural).toBeGreaterThanOrEqual(0.8); // its 11 to 12px labels stay at 10px or more
  expect(await frame.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await frame.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => frame.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Show code" }).first().click();
  await expect(page.getByRole("region", { name: "Diagram source" }).first()).toContainText("<mxGraphModel");
});

test("charts fit the narrowest chat, and their values read by pointer, by keyboard and as a table", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 620 });
  await ask(page, "[gallery:charts]");
  const bars = page.getByRole("group", { name: "Bar chart: Library visits by month" });
  const readout = page.locator("figure.chart [aria-live]").first();

  for (const svg of await page.locator("figure.chart svg").all()) {
    const [inside, room] = await svg.evaluate((element) => [element.getBoundingClientRect().right, element.closest("figure")!.getBoundingClientRect().right]);
    expect(inside).toBeLessThanOrEqual(room + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await bars.scrollIntoViewIfNeeded();
  const box = (await bars.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await expect(readout).toContainText("Feb");
  await bars.focus();
  await page.keyboard.press("Home");
  await expect(readout).toHaveText("Sep: 1,240 Day; 610 Evening");

  await page.getByRole("button", { name: "Show as table" }).first().click();
  await expect(page.getByRole("region", { name: "Table: Month, Day, Evening" })).toBeVisible();
});
