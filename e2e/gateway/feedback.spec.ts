import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// Feedback on answers (M2-T5, M4-T10), through the real gateway: a public visitor's rating and comment are stored,
// and a signed-in resident's rating comes back with the chat on their next visit.
const PUBLIC = "http://127.0.0.1:4174/hosts/gateway.html";
const PORTAL = "http://127.0.0.1:4174/hosts/gateway-portal.html";
const resident = () => `rater-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function open(page: Page, url: string): Promise<FrameLocator> {
  await page.goto(url);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

async function ask(chat: FrameLocator) {
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill("When does the library open?");
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 });
}

const saved = (page: Page, method: string) =>
  page.waitForResponse((response) => response.url().endsWith("/feedback") && response.request().method() === method);

test("a public visitor says an answer was not helpful, and why", async ({ page }) => {
  const chat = await open(page, PUBLIC);
  await ask(chat);

  const rated = saved(page, "PUT");
  await chat.getByRole("button", { name: "Not helpful" }).click();
  expect((await rated).status()).toBe(204);
  await expect(chat.getByRole("button", { name: "Not helpful" })).toHaveAttribute("aria-pressed", "true");

  const field = chat.getByRole("textbox", { name: "What could be better?" });
  await expect(field).toBeFocused();
  await field.fill("It did not say when the library closes.");
  const commented = saved(page, "PUT");
  await chat.getByRole("button", { name: "Send feedback" }).click();
  const response = await commented;
  expect(response.status()).toBe(204);
  expect(response.request().postDataJSON()).toEqual({
    rating: "dislike",
    comment: "It did not say when the library closes.",
  });
  await expect(chat.getByRole("article").getByText("Thanks for your feedback.")).toBeVisible();
  await expect(chat.getByRole("status")).toHaveText("Thanks for your feedback."); // spoken too
  await expect(field).toHaveCount(0);

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.filter((found) => found.impact === "serious" || found.impact === "critical")).toEqual([]);
});

test("a resident's rating comes back with the chat on their next visit, and can be taken back", async ({ page }) => {
  const user = resident();
  let chat = await open(page, `${PORTAL}?user=${user}`);
  await ask(chat);
  const rated = saved(page, "PUT");
  await chat.getByRole("button", { name: "Helpful", exact: true }).click();
  await rated;
  await chat.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  chat = await open(page, `${PORTAL}?user=${user}`);
  await chat.getByRole("button", { name: "Your chats" }).click();
  await chat.getByRole("button", { name: /When does the library open\?/ }).click();
  const helpful = chat.getByRole("button", { name: "Helpful", exact: true });
  await expect(helpful).toHaveAttribute("aria-pressed", "true");

  const taken = saved(page, "DELETE");
  await helpful.click();
  expect((await taken).status()).toBe(204);
  await expect(helpful).toHaveAttribute("aria-pressed", "false");
});
