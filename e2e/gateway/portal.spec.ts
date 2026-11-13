import { expect, type Page, test } from "@playwright/test";

// M5 end-to-end: a signed-in resident on the College portal. The portal's backend (a stand-in in e2e/server.mjs)
// signs each token with the Node snippet customers copy; the real gateway checks it. Sessions last 5 seconds here.
const PORTAL = "http://127.0.0.1:4174/hosts/gateway-portal.html";

async function open(page: Page, user = "resident-42") {
  await page.goto(`${PORTAL}?user=${user}`);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

async function ask(chat: ReturnType<Page["frameLocator"]>, question: string) {
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
}

const calls = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => fetch("/portal/calls").then((reply) => reply.json()));

test("a signed-in resident asks on the portal and is answered as themselves", async ({ page }) => {
  const chat = await open(page);
  await ask(chat, "When does the library open?");

  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
  expect((await calls(page))["resident-42"]).toBeGreaterThanOrEqual(1);
});

test("a session that ends mid-conversation is renewed without the resident noticing", async ({ page }) => {
  const chat = await open(page, "resident-renewal");
  await ask(chat, "First question");
  const before = (await calls(page))["resident-renewal"];

  await page.waitForTimeout(11_000); // past the 5-second session and its 5 seconds of clock tolerance
  await ask(chat, "Second question");

  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toHaveCount(2);
  await expect(chat.getByRole("alert")).toHaveCount(0);
  expect((await calls(page))["resident-renewal"]).toBeGreaterThan(before);
});

test("signing out of the portal removes the chat and its session; the next resident starts afresh", async ({
  page,
}) => {
  const chat = await open(page, "resident-leaving");
  await ask(chat, "Something private");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("[data-ucp]")).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { signIn: (user: string) => void }).signIn("resident-arriving"));
  await page.getByRole("button", { name: "Ask the College" }).click();
  const fresh = page.frameLocator("[data-ucp] iframe");
  await expect(fresh.getByRole("button", { name: "When does the library open?" })).toBeVisible();
  await expect(fresh.getByText("Something private")).toHaveCount(0);
  await ask(fresh, "Hello"); // the chat asks the portal for a token when the first question needs a session
  expect((await calls(page))["resident-arriving"]).toBeGreaterThanOrEqual(1);
});
