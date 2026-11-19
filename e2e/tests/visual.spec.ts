import path from "node:path";

import { expect, test } from "@playwright/test";

// Screenshot comparison per block (M3): every block of every example, at a phone's width in the light scheme and a
// wide frame in the dark one, against baselines drawn on the pipeline's Linux machines (fonts render differently
// elsewhere, so these run only there, in Chromium). A block that changes by more than 1% of its pixels fails; when a
// change is meant, the pipeline's "screenshots" artifact holds the new pictures to commit.
const CHAT = "http://localhost:4174/embed/w_chat";
const STYLE = path.join(import.meta.dirname, "visual.css"); // hides what floats over the block
const EXAMPLES = ["formatting", "code", "tables", "diagrams", "drawings", "charts", "mermaid", "maths"];
const LOOKS = [
  { width: 360, scheme: "light" },
  { width: 760, scheme: "dark" },
] as const;

test.skip(process.platform !== "linux", "baselines are drawn on the pipeline's Linux machines");
// The chat page refuses inline styles; Playwright adds visual.css as one, so here (and only here) its policy is set aside.
test.use({ bypassCSP: true });
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one engine's pictures are enough");

for (const example of EXAMPLES) {
  for (const { width, scheme } of LOOKS) {
    test(`${example} at ${width}px in the ${scheme} scheme looks as it did`, async ({ page }) => {
      await page.setViewportSize({ width, height: 3000 }); // tall enough that no answer scrolls inside the chat
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); // charts drawn whole, not drawing in
      await page.goto(CHAT);
      const field = page.getByRole("textbox", { name: "Your question" });
      await field.fill(`[gallery:${example}]`);
      await field.press("Enter");
      await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const answer = page.locator("article.answer .md");
      const blocks = answer.locator(":scope > figure, :scope > .maths");
      // Text-only examples are one picture of the whole answer; the rest, one picture a block.
      const parts = (await blocks.count()) ? await blocks.all() : [answer];
      for (const [i, part] of parts.entries()) {
        await part.scrollIntoViewIfNeeded();
        await expect(part).toHaveScreenshot(`${example}-${i}-${width}-${scheme}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.01,
          stylePath: STYLE,
        });
      }
    });
  }
}
