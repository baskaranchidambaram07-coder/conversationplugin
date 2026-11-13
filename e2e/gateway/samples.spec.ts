import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// M15: the College's sample pages (examples/college) and our hosted copies of them, filled in as the dev environment
// fills them (e2e/server.mjs), against the real gateway. The hosted portal's sign-in is the function CloudFront runs
// (infra/aws/dev/functions/demo-token.js). Every page keeps its own content policy, and nothing breaks it.
const SITE = "http://127.0.0.1:4174";
const someone = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { violations: string[] }).violations = []);
    document.addEventListener("securitypolicyviolation", (event) =>
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`),
    );
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { violations?: string[] }).violations ?? [])).toEqual([]);
});

async function ask(page: Page, question: string): Promise<FrameLocator> {
  await page.getByRole("button", { name: "Ask the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
  return chat;
}

async function earlierChats(page: Page) {
  await page.getByRole("button", { name: "Ask the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await chat.getByRole("button", { name: "Your chats" }).click();
  return chat.getByRole("navigation", { name: "Your chats" }).getByRole("listitem");
}

test("the public sample answers a visitor who is not signed in", async ({ page }) => {
  await page.goto(`${SITE}/college/public.html`);
  const chat = await ask(page, "When does the library open?");
  await expect(chat.getByRole("button", { name: "Your chats" })).toHaveCount(0); // history is for signed-in residents
});

test("the portal sample signs the resident in through the portal's own backend, so their chats come back", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "resident", value: someone("resident"), url: SITE }]); // signed in to the portal
  await page.goto(`${SITE}/college/portal.html`);
  await ask(page, "How do I book a guest room?");

  await page.reload();
  await expect(await earlierChats(page)).toHaveCount(1);
});

test("on the hosted portal anyone signs in under a name, signs out, and finds their chats under that name", async ({
  page,
}) => {
  const name = someone("try");
  await page.goto(`${SITE}/hosted/portal.html`);
  await expect(page.getByRole("button", { name: "Ask the College" })).toHaveCount(0); // no chat until signed in

  await page.getByRole("textbox", { name: "Sign in as" }).fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`Signed in as ${name}.`)).toBeVisible();
  await ask(page, "When does the library open?");

  await page.getByRole("link", { name: "Sign out" }).click();
  await expect(page.getByRole("textbox", { name: "Sign in as" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask the College" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Sign in as" }).fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(await earlierChats(page)).toHaveCount(1);
});

test("the hosted sign-in signs only names it accepts, and only for the demo widget", async ({ request }) => {
  const refused = await request.get(`${SITE}/demo-token?user=${encodeURIComponent("<script>")}`);
  expect(refused.status()).toBe(400);

  const token = await (await request.get(`${SITE}/demo-token?user=ana`)).text();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  expect(claims).toMatchObject({ aud: "ucp-demo", sub: "ana", iss: "https://demo.ucp.invalid" });
  expect(claims.exp - claims.iat).toBe(300);
});
