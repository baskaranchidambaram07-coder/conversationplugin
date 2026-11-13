import { expect, type Page, test } from "@playwright/test";

// The real chat (web/widget) in the real loader, against the fake gateway in e2e/server.mjs.
const HOST = "http://127.0.0.1:4174/hosts";

const launcher = (page: Page) => page.getByRole("button", { name: "Ask the College" });
const chat = (page: Page) => page.frameLocator("[data-ucp] iframe");
const chatFrame = (page: Page) => page.frames().find((frame) => frame.url().includes("/embed/"));

async function openChat(page: Page) {
  await page.goto(`${HOST}/chat.html`);
  await launcher(page).click();
  await expect(chat(page).getByRole("heading", { name: "Ask the College" })).toBeVisible();
}

test("the chat opens with the College's title, the AI notice, the welcome, its suggestions and the credit", async ({
  page,
}) => {
  await openChat(page);
  const frame = chat(page);

  await expect(frame.getByText("You are chatting with an AI assistant. It can make mistakes.")).toBeVisible();
  await expect(frame.getByText("Hello. Ask me about accommodation, events or the library.")).toBeVisible();
  await expect(frame.getByRole("button", { name: "When does the library open?" })).toBeVisible();
  await expect(frame.getByText("Powered by Purple Fabric")).toBeVisible();
});

test("a suggested question gets an answer that streams in, then can be copied", async ({ page }) => {
  await openChat(page);
  const frame = chat(page);
  await frame.getByRole("button", { name: "When does the library open?" }).click();

  await expect(frame.getByText("When does the library open?")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Stop the answer" })).toBeVisible();
  await expect(frame.getByRole("article").getByText(/stays open until 22:00\.$/)).toBeVisible();
  await expect(frame.getByRole("button", { name: "Copy answer" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "How do I book a guest room?" })).toHaveCount(0);
});

test("a typed question is sent with Enter, and Shift+Enter adds a line instead", async ({ page }) => {
  await openChat(page);
  const field = chat(page).getByRole("textbox", { name: "Your question" });
  await field.click();
  await field.pressSequentially("Is there a gym?");
  await field.press("Shift+Enter");
  await field.pressSequentially("And a pool?");
  await expect(field).toHaveValue("Is there a gym?\nAnd a pool?");

  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(chat(page).getByRole("article").getByText(/stays open until 22:00\.$/)).toBeVisible();
});

test("while the first word is on its way, the answer shows that it is working and the send button stops it", async ({
  page,
}) => {
  await openChat(page);
  const field = chat(page).getByRole("textbox", { name: "Your question" });
  await field.fill("When does the library open on Sunday? [slow]");
  await field.press("Enter");

  await expect(chat(page).getByRole("img", { name: "Finding an answer" })).toBeVisible();
  await chat(page).getByRole("button", { name: "Stop the answer" }).click();
  await expect(chat(page).getByText("You stopped this answer.")).toBeVisible();
  await expect(chat(page).getByRole("img", { name: "Finding an answer" })).toHaveCount(0);
});

test("the chat's own close button closes it, on a phone too where it covers the launcher", async ({ page }) => {
  await openChat(page);
  await chat(page).getByRole("button", { name: "Close chat" }).click();

  await expect(page.locator("[data-ucp] .panel")).toBeHidden();
  await expect(launcher(page)).toBeVisible();
});

test("on opening, the question box takes focus", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit ignores focus() inside a cross-origin frame (see M1 notes)");
  await openChat(page);

  await expect.poll(async () => chatFrame(page)?.evaluate(() => document.activeElement?.id)).toBe("question");
});

test("too many messages is explained in plain words, with a reference and a retry", async ({ page }) => {
  await openChat(page);
  const field = chat(page).getByRole("textbox", { name: "Your question" });
  await field.fill("Hello [busy]");
  await field.press("Enter");

  const alert = chat(page).getByRole("alert");
  await expect(alert).toContainText("Too many messages at once. Please wait a moment, then try again.");
  await expect(alert).toContainText("Reference: r_");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an answer that fails part-way keeps what arrived and offers a retry", async ({ page }) => {
  await openChat(page);
  const field = chat(page).getByRole("textbox", { name: "Your question" });
  await field.fill("Hello [fail]");
  await field.press("Enter");

  await expect(chat(page).getByRole("alert")).toContainText("The assistant is not available right now.");
  await expect(chat(page).getByRole("article").getByText(/^The library is open from 10:00/)).toBeVisible();
});

test("at 280 px wide nothing in the chat spills sideways", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 640 });
  await openChat(page);
  await chat(page).getByRole("button", { name: "When does the library open?" }).click();
  await expect(chat(page).getByRole("button", { name: "Copy answer" })).toBeVisible();

  const overflow = await chatFrame(page)!.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

async function ask(page: Page, question: string) {
  const field = chat(page).getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
}

test("a stream cut off part-way is recovered: the finished answer is fetched and shown, with no error", async ({
  page,
}) => {
  await openChat(page);
  await ask(page, "When does the library open on Sunday? [drop]");

  await expect(chat(page).getByRole("article").getByText(/stays open until 22:00\.$/)).toBeVisible();
  await expect(chat(page).getByRole("button", { name: "Copy answer" })).toBeVisible();
  await expect(chat(page).getByRole("alert")).toHaveCount(0);
});

test("a signed-in resident whose session ends mid-conversation never notices: it is renewed with a fresh token", async ({
  page,
}) => {
  await page.goto(`${HOST}/chat-signed-in.html`);
  await launcher(page).click();
  await ask(page, "When does the library open on Sunday? [expire]");

  await expect(chat(page).getByRole("article").getByText(/stays open until 22:00\.$/)).toBeVisible();
  await expect(chat(page).getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { tokenCalls: number }).tokenCalls)).toBe(2);
});

test("while a long answer streams, a visitor who scrolls up to read is not pulled down, and can jump back", async ({
  page,
}) => {
  await openChat(page);
  await ask(page, "How does HTTPS work? [long]");
  await expect(chat(page).getByRole("heading", { name: "How HTTPS Works" })).toBeVisible();
  const frame = chatFrame(page)!;
  const position = () => frame.evaluate(() => document.querySelector(".log")!.scrollTop);
  // Scroll up only once the answer is well past the bottom of the view, as a reader would.
  await expect
    .poll(() => frame.evaluate(() => {
      const log = document.querySelector(".log")!;
      return log.scrollHeight - log.clientHeight;
    }))
    .toBeGreaterThan(300);
  await frame.evaluate(() => {
    const log = document.querySelector(".log")!;
    log.scrollTop = 0;
    log.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(1000); // the answer keeps growing meanwhile

  expect(await position()).toBe(0);
  await chat(page).getByRole("button", { name: "Go to the latest message" }).click();
  await expect
    .poll(() => frame.evaluate(() => {
      const log = document.querySelector(".log")!;
      return log.scrollHeight - log.scrollTop - log.clientHeight;
    }))
    .toBeLessThan(48);
});

test("closing the chat while it waits for an answer pauses its animation", async ({ page }) => {
  await openChat(page);
  await ask(page, "When does the library open on Sunday? [slow]");
  await expect(chat(page).getByRole("img", { name: "Finding an answer" })).toBeVisible();
  await chat(page).getByRole("button", { name: "Close chat" }).click();

  const frame = chatFrame(page)!;
  await expect
    .poll(() => frame.evaluate(() => document.getAnimations().every((animation) => animation.playState === "paused")))
    .toBe(true);
  expect(await frame.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
});
