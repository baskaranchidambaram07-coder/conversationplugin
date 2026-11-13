import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// M7 end to end, with the history panel (M2-T8): a signed-in resident's chats are kept, come back on their next
// visit, reopen exactly as they were drawn, and carry on. The portal's backend signs each visit's token, so every
// page load is a new session for the same resident. Answers come from the fake PF through the real gateway.
const PORTAL = "http://127.0.0.1:4174/hosts/gateway-portal.html";
const WIDE = "http://127.0.0.1:4174/hosts/gateway-portal-wide.html"; // the chat placed in the page, 960px wide
const resident = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function open(page: Page, user: string): Promise<FrameLocator> {
  await page.goto(`${PORTAL}?user=${user}`);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

async function ask(chat: FrameLocator, question: string) {
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
}

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test("a resident's chat comes back on their next visit, reopens exactly as it was drawn, and carries on", async ({
  page,
}) => {
  const user = resident("returning");
  let chat = await open(page, user);
  await ask(chat, "How does HTTPS work? [long]");
  const streamed = await chat.getByRole("article").first().innerHTML();

  await page.reload(); // a new visit: a new session, signed by the portal for the same resident
  chat = await open(page, user);
  await chat.getByRole("button", { name: "Your chats" }).click();
  await chat.getByRole("button", { name: /How does HTTPS work\?/ }).click();

  await expect(chat.getByRole("heading", { name: "How HTTPS Works" })).toBeVisible();
  expect(await chat.getByRole("article").first().innerHTML()).toBe(streamed); // drawn from storage as it streamed
  await ask(chat, "Thank you. And HTTP/2?");
  await expect(chat.getByRole("article")).toHaveCount(2);

  await chat.getByRole("button", { name: "Your chats" }).click();
  const rows = chat.getByRole("navigation", { name: "Your chats" }).getByRole("listitem");
  await expect(rows).toHaveCount(1); // the follow-up went into the same chat
  await expect(rows.getByRole("button")).toHaveAttribute("aria-current", "true");
});

test("another resident never sees someone else's chats", async ({ page, browser }) => {
  const first = await open(page, resident("first"));
  await ask(first, "Something private");

  const other = await browser.newPage();
  const chat = await open(other, resident("second"));
  await chat.getByRole("button", { name: "Your chats" }).click();

  await expect(chat.getByText("Chats you start will appear here.")).toBeVisible();
  await expect(chat.getByText("Something private")).toHaveCount(0);
  await other.close();
});

test("a new chat starts afresh and joins the list beside the first", async ({ page }) => {
  const chat = await open(page, resident("two-chats"));
  await ask(chat, "First chat");
  await chat.getByRole("button", { name: "New chat" }).click();

  await expect(chat.getByRole("article")).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "When does the library open?" })).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "Your question" })).toBeFocused();
  await ask(chat, "Second chat");
  await chat.getByRole("button", { name: "Your chats" }).click();

  const list = chat.getByRole("navigation", { name: "Your chats" });
  await expect(list.locator(".topic")).toHaveText(["Second chat", "First chat"]);
  expect(await serious(page)).toEqual([]);
});

test("in a wide frame the list stands beside the conversation and opens a chat in place", async ({ page }) => {
  test.slow(); // two visits and a scan of nested frames; WebKit once took past the 30 s limit on the scan
  const user = resident("wide");
  const chat = await open(page, user);
  await ask(chat, "A question asked in the floating panel");

  await page.goto(`${WIDE}?user=${user}`);
  const wide = page.frameLocator("[data-ucp] iframe");
  const list = wide.getByRole("navigation", { name: "Your chats" });
  await list.getByRole("button", { name: /asked in the floating panel/ }).click();

  await expect(wide.getByRole("article")).toHaveCount(1);
  await expect(list).toBeVisible(); // still beside it
  await expect(wide.getByRole("textbox", { name: "Your question" })).toBeVisible();
  await expect(wide.getByRole("button", { name: "Your chats" })).toHaveCount(0); // no button needed for the list
  expect(await serious(page)).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the list covers the whole chat, Escape brings the conversation back, and nothing fails the scan", async ({
    page,
  }) => {
    const chat = await open(page, resident("phone"));
    await ask(chat, "Asked on a phone");
    await chat.getByRole("button", { name: "Your chats" }).click();

    await expect(chat.getByRole("textbox", { name: "Your question" })).toHaveCount(0);
    await expect(chat.getByRole("heading", { name: "Your chats" })).toBeFocused();
    expect(await serious(page)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(chat.getByRole("textbox", { name: "Your question" })).toBeVisible();
    await expect(chat.getByRole("button", { name: "Your chats" })).toBeFocused();
  });
});

test.describe("at 280px, the narrowest frame", () => {
  test.use({ viewport: { width: 280, height: 600 } });

  test("the header keeps room for the title: New chat moves into the list", async ({ page }) => {
    const chat = await open(page, resident("narrowest"));
    await ask(chat, "Asked in a narrow frame");

    await expect(chat.getByRole("banner").getByRole("button", { name: "New chat" })).toBeHidden();
    await chat.getByRole("button", { name: "Your chats" }).click();
    await chat.getByRole("navigation", { name: "Your chats" }).getByRole("button", { name: "New chat" }).click();
    await expect(chat.getByRole("article")).toHaveCount(0);
  });
});
