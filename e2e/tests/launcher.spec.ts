import { expect, type Page, test } from "@playwright/test";

// Host pages on one origin, our side on another (see e2e/server.mjs). The sample widget is titled "Ask the College".
const HOST = "http://127.0.0.1:4174/hosts";
const OURS = "http://localhost:4174";

const launcher = (page: Page) => page.getByRole("button", { name: "Ask the College" });
const panel = (page: Page) => page.locator("[data-ucp] .panel");
// Whole pixels, read once the panel's open animation has finished.
async function box(page: Page, selector: string) {
  await panel(page).evaluateAll((panels) => Promise.all(panels.flatMap((p) => p.getAnimations()).map((a) => a.finished)));
  const { x, y, width, height } = (await page.locator(selector).boundingBox())!;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

async function gaps(page: Page) {
  const button = (await launcher(page).boundingBox())!;
  const { width, height } = page.viewportSize()!;
  return { left: button.x, right: width - button.x - button.width, bottom: height - button.y - button.height, button };
}

test("the launcher is 56 px and sits 24 px from the corner the configuration names", async ({ page }) => {
  await page.goto(`${HOST}/plain.html`);
  const right = await gaps(page);
  expect([right.button.width, right.button.height]).toEqual([56, 56]);
  expect(Math.abs(right.right - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs(right.bottom - 24)).toBeLessThanOrEqual(1);

  await page.goto(`${HOST}/left.html`);
  expect(Math.abs((await gaps(page)).left - 24)).toBeLessThanOrEqual(1);
});

test("a closed widget runs no animation on the host page, and the chat's loading mark runs only once opened", async ({
  page,
}) => {
  const running = () => panel(page).evaluate((element) => element.getAnimations({ subtree: true }).length);
  await page.route("**/embed/**", () => {}); // hold the chat page, so the loading mark stays up
  await page.goto(`${HOST}/plain.html`);
  await expect(launcher(page)).toBeVisible();
  expect(await running()).toBe(0);

  await launcher(page).click();
  await expect.poll(running).toBeGreaterThan(0);
});

test("a right-to-left page keeps the launcher in its configured corner", async ({ page }) => {
  await page.goto(`${HOST}/rtl.html`);
  expect(Math.abs((await gaps(page)).right - 24)).toBeLessThanOrEqual(1);
});

test("the chat opens beside the launcher on a large screen, or over the whole screen on a phone", async ({
  page,
  isMobile,
}) => {
  const chatRequests: string[] = [];
  page.on("request", (request) => request.url().includes("/embed/") && chatRequests.push(request.url()));
  await page.goto(`${HOST}/plain.html`);
  await launcher(page).click();

  await expect(page.frameLocator("[data-ucp] iframe").getByRole("heading", { name: "Chat stand-in" })).toBeVisible();
  expect(chatRequests).toEqual([`${OURS}/embed/w_test`]);
  const { width, height } = page.viewportSize()!;
  const open = await box(page, "[data-ucp] .panel");
  if (isMobile) {
    expect(open).toEqual({ x: 0, y: 0, width, height });
    await expect(launcher(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
    // The launcher is covered, so the chat's own close button is the way out, once the bridge is connected.
    await expect(page.frameLocator("[data-ucp] iframe").getByText("Anonymous")).toBeVisible();
    await page.frameLocator("[data-ucp] iframe").getByRole("button", { name: "Close chat" }).click();
    await expect(launcher(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  } else {
    expect(open.width).toBe(400);
    expect(open.height).toBe(Math.min(640, height - 120));
    await page.mouse.move(0, 0); // off the launcher, so its hover lift settles back
    await launcher(page).evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
    const button = (await launcher(page).boundingBox())!;
    expect(Math.round(button.y - (open.y + open.height))).toBe(16);
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");
    await launcher(page).click();
  }
  await expect(panel(page)).toBeHidden();

  await page.evaluate(() => (window as unknown as { UCP: (command: string) => void }).UCP("open"));
  await expect(panel(page)).toBeVisible();
  expect(chatRequests).toHaveLength(1); // reopening keeps the same chat page
});

test("by keyboard, Enter opens the chat and moves focus into it, and Escape inside it closes it", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a phone has no keyboard focus path to the covered launcher");
  const focused = () => page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.tagName);
  await page.goto(`${HOST}/plain.html`);
  await launcher(page).focus();
  await page.keyboard.press("Enter");
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");
  expect(await focused()).toBe("IFRAME");

  // Wait until the bridge is connected, then press Escape with focus inside the chat.
  await expect(page.frameLocator("[data-ucp] iframe").getByText("Anonymous")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
  expect(await focused()).toBe("BUTTON");

  await page.keyboard.press("Enter");
  await launcher(page).focus();
  await page.keyboard.press("Escape");
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
});

test("a close request from the host page itself, not from our chat, is ignored", async ({ page }) => {
  await page.goto(`${HOST}/plain.html`);
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await page.evaluate(() => window.postMessage({ ucp: 1, type: "close" }, "*"));
  await page.waitForTimeout(200);

  await expect(panel(page)).toBeVisible();
});

test("with reduced motion the panel only fades; it never slides", async ({ page }) => {
  const resting = () => panel(page).evaluate((element) => getComputedStyle(element).transform);
  await page.goto(`${HOST}/plain.html`);
  await expect(launcher(page)).toBeVisible();
  expect(await resting()).toBe("matrix(1, 0, 0, 1, 0, 12)");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await resting()).toBe("none");
});

test("at 200% zoom on a laptop the open chat takes the whole window", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto(`${HOST}/plain.html`);
  await launcher(page).click();

  expect(await box(page, "[data-ucp] .panel")).toEqual({ x: 0, y: 0, width: 640, height: 360 });
});

test("inline placement fills the element the page names, with no launcher", async ({ page }) => {
  await page.goto(`${HOST}/inline.html`);
  await expect(page.frameLocator("#help iframe").getByRole("heading", { name: "Chat stand-in" })).toBeVisible();

  const help = await box(page, "#help");
  // The panel's 1 px border sits inside the element, around the chat.
  expect(await box(page, "#help iframe")).toEqual({ x: help.x + 1, y: help.y + 1, width: help.width - 2, height: help.height - 2 });
  expect(await page.getByRole("button").count()).toBe(0);
});
