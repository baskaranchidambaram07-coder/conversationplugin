import { expect, test } from "@playwright/test";

test("the built widget page loads and shows its heading", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
});
