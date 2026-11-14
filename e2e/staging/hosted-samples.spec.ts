import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// M15: our hosted copies of the College's samples, on their own CloudFront site, against the deployed gateway
// answering from PF staging (infra/aws/dev/samples.tf). deployed.config.ts names the site; elsewhere this is skipped.
const SAMPLES = process.env.UCP_SAMPLES_URL;

test.skip(!SAMPLES, "needs the deployed environment: npm run e2e:deployed");

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

async function ask(page: Page): Promise<FrameLocator> {
  await page.getByRole("button", { name: "Ask the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill("Reply with the single word READY.");
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 120_000 });
  await expect(chat.getByRole("article").last()).toContainText("READY");
  await expect(chat.getByRole("alert")).toHaveCount(0);
  return chat;
}

test("the hosted public page is answered from PF staging", async ({ page }) => {
  await page.goto(`${SAMPLES}/`);
  await expect(page.getByText("Sample page.")).toBeVisible();
  await ask(page);
});

test("on the hosted portal a name signs in, and its chat is there after signing out and in again", async ({ page }) => {
  const name = `deployed-${Date.now()}`;
  const signIn = async () => {
    await page.getByRole("textbox", { name: "Sign in as" }).fill(name);
    await page.getByRole("button", { name: "Sign in" }).click();
  };
  await page.goto(`${SAMPLES}/portal.html`);
  await signIn();
  await ask(page);

  await page.getByRole("link", { name: "Sign out" }).click();
  await signIn();
  await page.getByRole("button", { name: "Ask the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await chat.getByRole("button", { name: "Your chats" }).click();
  await expect(chat.getByRole("navigation", { name: "Your chats" }).getByRole("listitem")).toHaveCount(1);
});

test("the hosted sign-in refuses a name it does not accept", async ({ request }) => {
  expect((await request.get(`${SAMPLES}/demo-token?user=${encodeURIComponent("<script>")}`)).status()).toBe(400);
});
