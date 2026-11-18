import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// Pinned answers through the real gateway: a resident pins an answer, finds it on the Pinned page on their next
// visit, and goes back to it in its chat. Public visitors cannot pin.
const PORTAL = "http://127.0.0.1:4174/hosts/gateway-portal.html";
const PUBLIC = "http://127.0.0.1:4174/hosts/gateway.html";
const resident = () => `pins-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function open(page: Page, url: string): Promise<FrameLocator> {
  await page.goto(url);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

async function ask(chat: FrameLocator, question: string) {
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
}

test("a resident pins an answer, finds it on the Pinned page next visit, and goes back to it", async ({ page }) => {
  test.slow(); // two visits, three answers and a scan
  const user = resident();
  let chat = await open(page, `${PORTAL}?user=${user}`);
  await ask(chat, "How does HTTPS work? [long]");
  await ask(chat, "And HTTP/2?");
  await ask(chat, "Thank you");
  const first = chat.getByRole("article").first();
  const pinned = page.waitForResponse((response) => response.url().endsWith("/pin"));
  await first.getByRole("button", { name: "Pin answer" }).click();
  expect((await pinned).status()).toBe(204);
  await expect(first.getByRole("button", { name: "Pin answer" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  chat = await open(page, `${PORTAL}?user=${user}`);
  await chat.getByRole("button", { name: "Your chats" }).click();
  await chat.getByRole("navigation", { name: "Your chats" }).getByRole("button", { name: "Pinned" }).click();
  await expect(chat.getByRole("heading", { name: "Pinned" })).toBeFocused();
  const row = chat.locator(".pins li");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".asked")).toHaveText("How does HTTPS work? [long]");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.filter((found) => found.impact === "serious" || found.impact === "critical")).toEqual([]);

  await row.locator(".pin-open").click();
  const answer = chat.locator(".answer.found");
  await expect(answer).toBeFocused();
  await expect(answer.getByRole("heading", { name: "How HTTPS Works" })).toBeInViewport();
  await expect(answer.getByRole("button", { name: "Pin answer" })).toHaveAttribute("aria-pressed", "true");
});

test("a public visitor sees no pin", async ({ page }) => {
  const chat = await open(page, PUBLIC);
  await ask(chat, "When does the library open?");

  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Pin answer" })).toHaveCount(0);
});
