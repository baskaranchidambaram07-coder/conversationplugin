import { expect, type Page, test } from "@playwright/test";

// Host pages live on one origin; the loader and our server on another (see e2e/server.mjs).
const HOST = "http://127.0.0.1:4174/hosts";
const OURS = "http://localhost:4174";

function watch(page: Page) {
  const seen = { errors: [] as string[], ours: [] as string[] };
  page.on("pageerror", (error) => seen.errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().startsWith(OURS)) seen.ours.push(request.url().slice(OURS.length));
  });
  return seen;
}

function checklistLine(page: Page) {
  return page.waitForEvent("console", (message) => message.text().startsWith("UCP:")).then((m) => m.text());
}

test("the script tag loads from our origin, reads the configuration, and adds one global and nothing else", async ({
  page,
  context,
}) => {
  const seen = watch(page);
  await page.goto(`${HOST}/plain.html`);
  await expect(page.locator("[data-ucp]")).toBeAttached();

  const added = await page.evaluate(() => {
    const before = (window as unknown as { globalsBeforeLoader: string[] }).globalsBeforeLoader;
    return Object.keys(window).filter((name) => name !== "globalsBeforeLoader" && !before.includes(name));
  });
  expect(added).toEqual(["UCP"]);
  expect(seen.ours).toEqual(["/loader.js", "/v1/widgets/w_test/config"]);
  expect(await page.locator("iframe").count()).toBe(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);
  expect(await context.cookies()).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("calls made before the loader arrived are carried out once it does", async ({ page }) => {
  const line = checklistLine(page);
  await page.goto(`${HOST}/queued.html`);

  expect(await line).toBe("UCP: ✓ configuration loaded");
  await expect(page.locator("[data-ucp]")).toBeAttached();
});

test("an unknown widget draws nothing and throws nothing, and debug mode says why", async ({ page }) => {
  const seen = watch(page);
  const line = checklistLine(page);
  await page.goto(`${HOST}/unknown-widget.html`);

  expect(await line).toBe(`UCP: ✗ configuration not loaded from ${OURS}/v1/widgets/w_missing/config (HTTP 404)`);
  expect(await page.locator("[data-ucp]").count()).toBe(0);
  expect(seen.errors).toEqual([]);
});
