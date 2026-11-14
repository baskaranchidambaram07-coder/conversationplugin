import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The admin console (M9), served by the admin API in the stack under test (backend/devstack.py), signing in through
// the stand-in company identity provider with the authorization-code flow and PKCE, as Cognito or Entra ID would.
const CONSOLE = "http://127.0.0.1:8201";

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

async function signIn(page: Page, path: string, as = "onboarding-operator") {
  await page.goto(`${CONSOLE}${path}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Sign in as").fill(as); // the stand-in provider's own page
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an administrator signs in with the company provider and lands where they were going, on the widget's track", async ({
  page,
}) => {
  await page.goto(`${CONSOLE}/widgets/w_gateway/look`);
  await expect(page.getByRole("heading", { name: "Sign in to set up your assistant" })).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await signIn(page, "/widgets/w_gateway/look");
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway/look`);
  await expect(page.getByRole("heading", { level: 1, name: "Ask the College" })).toBeVisible();
  await expect(page.getByText("onboarding-operator · platform administrator")).toBeVisible();
  await expect(page.getByRole("button", { name: /Look/, pressed: true })).toBeVisible();
  await expect(page.getByText("#5B2A86")).toBeVisible();
  await expect(page.getByText("Live · version 1").first()).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByRole("button", { name: /Sites/ }).click();
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway/sites`);
  await expect(page.getByText("http://127.0.0.1:4174")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /Look/, pressed: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to set up your assistant" })).toBeVisible();
});

test("someone the provider knows but who is no administrator is told so, and sees nothing", async ({ page }) => {
  await signIn(page, "/", "a-stranger");

  await expect(page.getByText("Your account is not set up to manage assistants here.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Widgets" })).toHaveCount(0);
});

test("a sign-in this tab did not start signs no one in", async ({ page }) => {
  await page.goto(`${CONSOLE}/signed-in?code=stolen&state=forged`);

  await expect(page.getByText("The sign-in did not complete. Please try again.")).toBeVisible();
  await expect(page).toHaveURL(`${CONSOLE}/`);
});
