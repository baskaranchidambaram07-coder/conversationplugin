import { expect, type Page, test } from "@playwright/test";

// The loader's half of the bridge against the stand-in chat (e2e/chat-stub.html), which speaks the chat's half.
const HOST = "http://127.0.0.1:4174/hosts";
const TOKEN = "host-signed-token-for-tests";

const launcher = (page: Page) => page.getByRole("button", { name: "Ask the College" });
const chat = (page: Page) => page.frameLocator("[data-ucp] iframe");
const chatFrame = (page: Page) => page.frames().find((frame) => frame.url().includes("/embed/"));
const checklist = (page: Page, start: string) =>
  page.waitForEvent("console", (message) => message.text().startsWith(start)).then((m) => m.text());

test("the chat connects through the bridge, even though it speaks a later release", async ({ page }) => {
  const connected = checklist(page, "UCP: ✓ chat");
  await page.goto(`${HOST}/queued.html`);
  await launcher(page).click();

  expect(await connected).toBe("UCP: ✓ chat connected");
  await expect(chat(page).getByText("Anonymous")).toBeVisible();
  await expect(chat(page).locator("body")).toHaveAttribute("data-mode", "floating");
});

test("on opening, the chat holds focus and is told it is shown, so it can focus its own input", async ({
  page,
  browserName,
}) => {
  await page.goto(`${HOST}/plain.html`);
  await launcher(page).click();

  expect(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.tagName)).toBe("IFRAME");
  await expect.poll(async () => chatFrame(page)?.evaluate(() => (window as { shownCount?: number }).shownCount)).toBe(1);
  if (browserName === "webkit") {
    // Playwright's WebKit on Windows ignores focus() called inside the cross-origin chat. Real Safari is unverified;
    // module M2 and the real-device pass must check that the chat's input gets focus there.
    test.info().annotations.push({ type: "known gap", description: "chat's own focus() not honoured in WebKit" });
    return;
  }
  await expect.poll(async () => chatFrame(page)?.evaluate(() => document.activeElement?.id)).toBe("close");
});

test("a signed-in host's token reaches the chat, and no URL, page, storage or request", async ({ page, context }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
  await page.goto(`${HOST}/signed-in.html`);
  await launcher(page).click();
  await expect(chat(page).getByText("Signed in", { exact: true })).toBeVisible();

  const frame = chatFrame(page)!;
  expect(await frame.evaluate(() => (window as unknown as { receivedToken: string }).receivedToken)).toBe(TOKEN);
  expect(await page.evaluate(() => (window as unknown as { tokenCalls: number }).tokenCalls)).toBe(1);
  const everywhere = [
    ...requests,
    frame.url(),
    await frame.content(),
    await page.evaluate(() => {
      const shadow = document.querySelector("[data-ucp]")?.shadowRoot?.innerHTML ?? "";
      return document.documentElement.outerHTML + shadow + location.href;
    }),
    ...(await Promise.all(
      [page.mainFrame(), frame].map((f) =>
        f.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])),
      ),
    )),
    JSON.stringify(await context.cookies()),
  ].join("\n");
  expect(everywhere).not.toContain(TOKEN);
});

test("a token request forged by the host page is ignored", async ({ page }) => {
  await page.goto(`${HOST}/signed-in.html`);
  await launcher(page).click();
  await expect(chat(page).getByText("Signed in", { exact: true })).toBeVisible();

  await page.evaluate(() => window.postMessage({ ucp: 1, type: "get-token", id: 9 }, "*"));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { tokenCalls: number }).tokenCalls)).toBe(1);
});

test("a chat that never connects is reported after 10 seconds in debug mode", async ({ page }) => {
  await page.clock.install();
  await page.route("**/embed/**", (route) => route.abort());
  const report = checklist(page, "UCP: ✗ chat");
  await page.goto(`${HOST}/queued.html`);
  await launcher(page).click();
  await page.clock.fastForward(10_000);

  expect(await report).toBe(
    "UCP: ✗ chat did not connect within 10 s: check that this site is on the widget's allowed domains, " +
      "and that the page's content policy allows http://localhost:4174 in frame-src",
  );
});

test("an inline chat is told it is inline", async ({ page }) => {
  await page.goto(`${HOST}/inline.html`);

  await expect(chat(page).locator("body")).toHaveAttribute("data-mode", "inline");
});
