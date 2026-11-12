import { expect, type Page, test } from "@playwright/test";

// Host pages that make life hard for a widget: a strict content policy, hostile global CSS, a clashing global.
const HOST = "http://127.0.0.1:4174/hosts";

const launcher = (page: Page) => page.getByRole("button", { name: "Ask the College" });
const chat = (page: Page) => page.frameLocator("[data-ucp] iframe");

function errors(page: Page) {
  const seen: string[] = [];
  page.on("pageerror", (error) => seen.push(error.message));
  return seen;
}

async function opensAndConnects(page: Page) {
  const button = (await launcher(page).boundingBox())!;
  expect([button.width, button.height]).toEqual([56, 56]);
  expect(await launcher(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(91, 42, 134)",
  );
  await launcher(page).click(); // fails if anything on the page covers the launcher
  await expect(chat(page).getByText("Anonymous")).toBeVisible();
}

test("a site with a strict content policy and Trusted Types needs only our one origin, with no violation", async ({
  page,
}) => {
  const seen = errors(page);
  await page.goto(`${HOST}/strict-csp.html`);
  await opensAndConnects(page);

  expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
  expect(seen).toEqual([]);
});

test("hostile global CSS and a high z-index banner cannot hide, restyle or cover the widget", async ({ page }) => {
  const seen = errors(page);
  await page.goto(`${HOST}/hostile.html`);
  await opensAndConnects(page);

  await expect(page.locator("[data-ucp] iframe")).toBeVisible();
  expect(seen).toEqual([]);
});

test("a page that already uses the name UCP keeps it, and nothing breaks", async ({ page }) => {
  const seen = errors(page);
  await page.goto(`${HOST}/existing-global.html`);
  await page.waitForLoadState("networkidle");

  expect(await page.evaluate(() => (window as unknown as { UCP: unknown }).UCP)).toEqual({ version: "theirs" });
  expect(await page.locator("[data-ucp]").count()).toBe(0);
  expect(seen).toEqual([]);
});
