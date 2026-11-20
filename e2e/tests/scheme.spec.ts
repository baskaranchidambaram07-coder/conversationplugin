import { expect, type Frame, type Page, test } from "@playwright/test";

// The widget's colour scheme: auto follows the visitor's system, light and dark are fixed. The chat paints in it from
// the first frame, the loader's panel matches it, and a diagram keeps its own light sheet.
const CHAT = "http://localhost:4174/embed";
const LIGHT = "rgb(255, 255, 255)";
const SHEET = "rgb(255, 255, 255)"; // the diagram's light sheet, as in the light scheme
const DARK = "rgb(18, 27, 45)";

const ground = (page: Page | Frame) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
// The brand colour is on what can be pressed: the send button.
const pill = (page: Page) =>
  page
    .getByRole("button", { name: "Send" })
    .evaluate((button) => [getComputedStyle(button).backgroundColor, getComputedStyle(button).color]);

test("auto follows the visitor's system; a brand that would not stand out on the dark composer gives way", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${CHAT}/w_chat`);
  expect(await ground(page)).toBe(DARK);
  expect(await pill(page)).toEqual(["rgb(241, 245, 249)", "rgb(0, 0, 0)"]); // the purple is 1.6:1 there

  await page.emulateMedia({ colorScheme: "light" });
  expect(await ground(page)).toBe(LIGHT);
});

test("dark and light are fixed whatever the system; a near-black brand gives way to the light ink on the dark ground", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${CHAT}/w_dark`);
  expect(await ground(page)).toBe(DARK);
  expect(await pill(page)).toEqual(["rgb(241, 245, 249)", "rgb(0, 0, 0)"]);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${CHAT}/w_light`);
  expect(await ground(page)).toBe(LIGHT);
});

test("the visitor's own words keep the widget's colour in the dark, with the ink that reads on it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${CHAT}/w_chat`);
  const field = page.getByRole("textbox", { name: "Your question" });
  await field.fill("When does the library open?");
  await field.press("Enter");
  const bubble = page.locator(".mine").first();
  await expect(bubble).toBeVisible();
  // Unlike the send button, the bubble is not a control: the purple stays, under white.
  expect(await bubble.evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color])).toEqual([
    "rgb(91, 42, 134)",
    "rgb(255, 255, 255)",
  ]);
});

test("the chat is dark from its first paint, before any script runs", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${CHAT}/w_dark`);
  expect(await page.locator("html").getAttribute("data-scheme")).toBe("dark");
  expect(await ground(page)).toBe(DARK);
  await context.close();
});

test("on a dark system the loader's panel is dark too, under the chat", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("http://127.0.0.1:4174/hosts/chat.html");
  await page.getByRole("button", { name: "Ask the College" }).click();
  const panel = await page.evaluate(() => {
    const element = document.querySelector("[data-ucp]")?.shadowRoot?.querySelector(".panel");
    return element ? getComputedStyle(element).backgroundColor : null;
  });
  expect(panel).toBe(DARK);
  await expect(page.frameLocator("[data-ucp] iframe").getByRole("textbox", { name: "Your question" })).toBeVisible();
  const chat = page.frames().find((frame) => frame.url().includes("/embed/"));
  expect(chat && (await ground(chat))).toBe(DARK);
});

test("in the dark a diagram keeps its own light sheet", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${CHAT}/w_chat`);
  const field = page.getByRole("textbox", { name: "Your question" });
  await field.fill("[gallery:diagrams]");
  await field.press("Enter");
  const sheet = page.locator("figure.diagram .scroll").first();
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  expect(await sheet.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(SHEET);
  expect(await ground(page)).toBe(DARK);
});
