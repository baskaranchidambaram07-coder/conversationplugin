import { expect, type Page, test } from "@playwright/test";

// Full screen: on a desktop the floating chat can fill the window, laid out as a conversation app, and go back to
// its panel. On a phone it already fills the screen, so it offers nothing more.
const PAGE = "http://127.0.0.1:4174/hosts/chat.html";
const chat = (page: Page) => page.frameLocator("[data-ucp] iframe");
const box = (page: Page) => page.locator("[data-ucp] iframe").boundingBox();

test("on a desktop the chat fills the window and goes back to its panel; the page scrolls only while it is a panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Ask the College" }).click();
  const frame = chat(page);

  await frame.getByRole("button", { name: "Open full screen" }).click();
  await expect.poll(() => box(page)).toMatchObject({ width: 1280, height: 800 }); // once the opening animation ends
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  // Laid out as a conversation app: the composer and the suggested questions in the middle, no answer cards.
  await expect(frame.locator(".chat.page.empty footer .prompts")).toBeVisible();

  await frame.getByRole("textbox", { name: "Your question" }).fill("When does the library open?");
  await frame.getByRole("textbox", { name: "Your question" }).press("Enter");
  await expect(frame.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 });
  expect(await frame.getByRole("article").evaluate((answer) => getComputedStyle(answer).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );

  await frame.getByRole("button", { name: "Exit full screen" }).click();
  await expect.poll(async () => (await box(page))?.width).toBeLessThan(420);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await expect(frame.getByText("When does the library open?").first()).toBeVisible(); // the same chat, carried on

  await frame.getByRole("button", { name: "Open full screen" }).click();
  await frame.getByRole("button", { name: "Close chat" }).click();
  await page.getByRole("button", { name: "Ask the College" }).click();
  await expect.poll(async () => (await box(page))?.width).toBeLessThan(420); // a closed chat opens as a panel again
});

test("on a phone the open chat already fills the screen, so it offers no full screen button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Ask the College" }).click();

  await expect(chat(page).getByRole("button", { name: "Close chat" })).toBeVisible();
  await expect(chat(page).getByRole("button", { name: /full screen/ })).toHaveCount(0);
});

const corner = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector("[data-ucp]")?.shadowRoot?.querySelector(".panel");
    return panel ? getComputedStyle(panel).borderTopLeftRadius : null;
  });

test("a page that is the assistant shows it edge to edge as a conversation app; a narrow one keeps the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://127.0.0.1:4174/hosts/fullpage.html");
  const frame = chat(page);

  await expect(frame.locator(".chat.page.empty")).toBeVisible();
  expect(await corner(page)).toBe("0px");
  expect((await box(page))?.width).toBe(1280);
  await expect(page.getByRole("button", { name: "Ask the College" })).toHaveCount(0); // no launcher
  await expect(frame.getByRole("button", { name: /full screen|Close chat/ })).toHaveCount(0);

  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(() => corner(page)).toBe("24px");
});
