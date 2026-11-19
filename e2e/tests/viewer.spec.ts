import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The full-screen viewer (M3-T9) and the downloads (M3-T1, T4, T6, T7), on every engine and the phone profile.
const PAGE = "http://127.0.0.1:4174/hosts/chat.html"; // the floating panel on a customer's page
const CHAT = "http://localhost:4174/embed/w_chat"; // the chat page on its own, as a full page
const box = (page: Page) => page.locator("[data-ucp] iframe").boundingBox();

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function ask(page: Page, question: string) {
  await page.goto(CHAT);
  await page.getByRole("textbox", { name: "Your question" }).fill(question);
  await page.getByRole("textbox", { name: "Your question" }).press("Enter");
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 });
}

test("on a desktop a table opens whole over the window, zooms, and Escape gives back the panel, the chat and focus", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a phone's chat already fills the screen");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Ask the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await chat.getByRole("textbox", { name: "Your question" }).fill("[gallery:tables]");
  await chat.getByRole("textbox", { name: "Your question" }).press("Enter");
  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 });

  const laundry = chat.locator("figure.table").nth(1);
  await laundry.getByRole("button", { name: "Full screen", exact: true }).click();
  const viewer = chat.getByRole("dialog", { name: /^Table: House, Room/ });
  await expect(viewer).toBeVisible();
  await expect.poll(() => box(page)).toMatchObject({ width: 1280, height: 800 }); // the panel fills the window
  await expect(viewer.getByRole("row")).toHaveCount(15);
  await expect(viewer.getByRole("row").last()).toContainText("House 14"); // no fold in here

  const cell = viewer.getByRole("cell", { name: "House 1", exact: true });
  const before = (await cell.boundingBox())!.height; // a full-width table keeps its width; its words and rows grow
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByRole("button", { name: /^Zoom 150%/ })).toBeVisible();
  expect((await cell.boundingBox())!.height).toBeGreaterThan(before * 1.3);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("button", { name: "Ask the College" })).toHaveAttribute("aria-expanded", "true"); // still open
  await expect.poll(async () => (await box(page))?.width).toBeLessThan(420); // back to its panel
  await expect(laundry.getByRole("button", { name: "Full screen", exact: true })).toBeFocused();
});

test("a wide diagram opens fitted to the screen, then zooms in to read; the viewer passes the accessibility scan", async ({
  page,
}) => {
  await ask(page, "[gallery:diagrams]");
  const figure = page.locator("figure.diagram").first();
  await figure.getByRole("button", { name: "Full screen", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Diagram from draw.io" });
  await expect(viewer).toBeVisible();

  const drawing = viewer.getByRole("img", { name: /^Diagram: / });
  const fitted = (await drawing.boundingBox())!;
  const room = (await viewer.boundingBox())!;
  expect([room.width, room.height]).toEqual([page.viewportSize()!.width, page.viewportSize()!.height]); // the whole screen, on a phone too
  expect(fitted.width).toBeLessThanOrEqual(room.width); // the whole drawing at once
  expect(await serious(page)).toEqual([]);

  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => (await drawing.boundingBox())!.width).toBeGreaterThan(fitted.width * 1.2);
  await viewer.getByRole("button", { name: "Close full screen" }).click();
  await expect(viewer).toBeHidden();
  await expect(figure.getByRole("button", { name: "Full screen", exact: true })).toBeFocused();
});

test("code saves as a file named for its language", async ({ page }) => {
  await ask(page, "[gallery:code]");
  const code = page.locator("figure.code").first();
  const [download] = await Promise.all([page.waitForEvent("download"), code.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("code.py");
  expect(await readFile((await download.path())!, "utf8")).toContain("def online(");
});

test("a chart and a diagram save as pictures", async ({ page }) => {
  await ask(page, "[gallery:charts]");
  const chart = page.locator("figure.chart").first();
  const [picture] = await Promise.all([page.waitForEvent("download"), chart.getByRole("button", { name: "Download image" }).click()]);
  expect(picture.suggestedFilename()).toBe("library-visits-by-month.png");
  const png = await readFile((await picture.path())!);
  expect([...png.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBeGreaterThan(400); // drawn at twice its size, title and legend above it

  await ask(page, "[gallery:diagrams]");
  const diagram = page.locator("figure.diagram").first();
  const [drawn] = await Promise.all([page.waitForEvent("download"), diagram.getByRole("button", { name: "Download image" }).click()]);
  expect(drawn.suggestedFilename()).toBe("diagram.png");
  expect((await readFile((await drawn.path())!)).subarray(1, 4).toString()).toBe("PNG");
});
