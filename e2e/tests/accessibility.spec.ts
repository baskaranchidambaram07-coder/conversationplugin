import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// An automated WCAG 2.2 AA scan of every state of the chat and of the launcher on a host page (M2 accessibility
// tests). It fails on any serious or critical finding. Manual screen-reader passes stay on the release checklist.
const CHAT = "http://localhost:4174/embed/w_chat"; // the chat page on its own, as a full page
const HOST = "http://127.0.0.1:4174/hosts";

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

async function ask(page: Page, question: string) {
  const field = page.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
}

// Every state in both colour schemes: the example widget follows the system's (auto), which each pass emulates.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });

    test("the chat's opening view", async ({ page }) => {
      await page.goto(CHAT);
      await expect(page.getByRole("heading", { name: "Ask the College" })).toBeVisible();

      expect(await serious(page)).toEqual([]);
    });

    test("the chat with a finished answer, and the copy action", async ({ page }) => {
      await page.goto(CHAT);
      await page.getByRole("button", { name: "When does the library open?" }).click();
      await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 }); // a long answer streams for seconds

      expect(await serious(page)).toEqual([]);
    });

    test("the chat while it waits for the first word, with the stop button", async ({ page }) => {
      await page.goto(CHAT);
      await ask(page, "When does the library open on Sunday? [slow]");
      await expect(page.getByRole("img", { name: "Finding an answer" })).toBeVisible();

      expect(await serious(page)).toEqual([]);
    });

    test("the chat showing an error with its reference and retry", async ({ page }) => {
      await page.goto(CHAT);
      await ask(page, "Hello [busy]");
      await expect(page.getByRole("alert")).toBeVisible();

      expect(await serious(page)).toEqual([]);
    });

    test("the chat after an anonymous session has ended", async ({ page }) => {
      await page.goto(CHAT);
      await ask(page, "Hello [expire]");
      await expect(page.getByRole("button", { name: "Start a new chat" })).toBeVisible();

      expect(await serious(page)).toEqual([]);
    });

    // Rendered answers (M3), from the example gallery the unit tests draw.
    for (const example of ["formatting", "code", "tables"]) {
      test(`an answer drawn from the ${example} example`, async ({ page }) => {
        await page.goto(CHAT);
        await ask(page, `[gallery:${example}]`);
        await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 20_000 }); // a long answer streams for seconds

        expect(await serious(page)).toEqual([]);
      });
    }

    test("a long table, unfolded and scrolled", async ({ page }) => {
      await page.goto(CHAT);
      await ask(page, "[gallery:tables]");
      await page.getByRole("button", { name: "Show all 14 rows" }).click();
      await page.getByRole("region", { name: /^Table: House/ }).evaluate((region) => region.scrollBy(80, 120));

      expect(await serious(page)).toEqual([]);
    });

    test("the launcher, closed and open, on a customer's page", async ({ page }) => {
      await page.goto(`${HOST}/chat.html`);
      const launcher = page.getByRole("button", { name: "Ask the College" });
      await expect(launcher).toBeVisible();
      expect(await serious(page)).toEqual([]);

      await launcher.click();
      await expect(page.frameLocator("[data-ucp] iframe").getByRole("heading", { name: "Ask the College" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  });
}
