import { expect, type Page, test } from "@playwright/test";

// No layout jump while an answer streams (M3): a block that later words have already followed keeps its place and
// its height, so nothing the visitor is reading moves. A renderer is fetched as its fence opens and draws at once
// when there (registry.tsx); a table's chart keeps its last whole drawing while a row is half there.
// The one exception is the revenue example: its table's chart takes its title from the plotting code further down,
// and gains that caption once, when the code arrives.
const CHAT = "http://localhost:4174/embed/w_chat";
const EXAMPLES = ["[long]", "[gallery:formatting]", "[gallery:code]", "[gallery:tables]", "[gallery:diagrams]", "[gallery:drawings]", "[gallery:charts]", "[gallery:plotted]", "[gallery:mermaid]", "[gallery:maths]"];

/** Watches the answer's blocks as it streams; returns every block, other than the newest, that moved or resized. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const moves: string[] = [];
    const seen = new Map<number, { top: number; h: number; last: boolean }>();
    const look = () => {
      const said = document.querySelector("article.answer .said");
      if (!said) return;
      const parts = [...said.querySelectorAll<HTMLElement>(".md > *")].filter((part) => part.offsetParent);
      const top = said.getBoundingClientRect().top;
      parts.forEach((part, i) => {
        const box = part.getBoundingClientRect();
        const now = { top: Math.round(box.top - top), h: Math.round(box.height), last: i === parts.length - 1 };
        const was = seen.get(i);
        if (was && !was.last && (Math.abs(was.top - now.top) > 1 || Math.abs(was.h - now.h) > 1)) {
          moves.push(`${part.tagName.toLowerCase()}.${part.className} ${i}: top ${was.top} to ${now.top}, height ${was.h} to ${now.h}`);
        }
        seen.set(i, now);
      });
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(look, 40);
    Object.assign(window, { moves });
  });
}

for (const example of EXAMPLES) {
  test(`${example} streams in without moving what came before`, async ({ page }) => {
    await page.goto(CHAT);
    await watch(page);
    const field = page.getByRole("textbox", { name: "Your question" });
    await field.fill(example);
    await field.press("Enter");
    await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300); // anything that would still settle
    expect(await page.evaluate(() => (window as unknown as { moves: string[] }).moves)).toEqual([]);
  });
}
