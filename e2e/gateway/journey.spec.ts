import { expect, type Page, test } from "@playwright/test";

// M4 end-to-end: a visitor on a customer's page, the loader and chat from the gateway, answers from the fake PF.
const ALLOWED = "http://127.0.0.1:4174/hosts/gateway.html"; // on the widget's list of sites
const ELSEWHERE = "http://localhost:4174/hosts/gateway.html"; // the same page on a site that is not

async function open(page: Page, url = ALLOWED) {
  await page.goto(url);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

test("a suggested question is answered from PF, streamed through the gateway, and can be copied", async ({ page }) => {
  const chat = await open(page);
  await chat.getByRole("button", { name: "When does the library open?" }).click();

  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible();
});

test("a long answer streams in and draws its headings, table and code", async ({ page }) => {
  const chat = await open(page);
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill("How does HTTPS work? [long]");
  await field.press("Enter");

  await expect(chat.getByRole("button", { name: "Stop the answer" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 });
  await expect(chat.getByRole("heading", { name: "How HTTPS Works" })).toBeVisible();
  await expect(chat.locator(".md figure.table")).toHaveCount(1);
  await expect(chat.locator(".md figure.code")).toHaveCount(2);
});

test("a second question in the same chat continues the conversation", async ({ page }) => {
  const chat = await open(page);
  const field = chat.getByRole("textbox", { name: "Your question" });
  for (const question of ["First question", "Second question"]) {
    await field.fill(question);
    await field.press("Enter");
    await expect(chat.getByRole("button", { name: "Send" })).toBeVisible();
  }

  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toHaveCount(2);
});

test("on a site not on the widget's list, the browser refuses to show the chat", async ({ page }) => {
  const refused: string[] = [];
  page.on("console", (message) => refused.push(message.text()));
  await open(page, ELSEWHERE);

  // The chat never greets the loader over the bridge: the browser would not load it inside this site.
  await expect.poll(() => refused.some((text) => text.includes("did not connect")), { timeout: 15_000 }).toBe(true);
});
