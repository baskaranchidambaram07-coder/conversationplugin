import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// Projects through the real gateway: a resident keeps chats in a project, finds them there on their next visit,
// files another chat into it, and deletes it without losing a chat. Public visitors have no projects.
const PORTAL = "http://127.0.0.1:4174/hosts/gateway-portal.html";
const PUBLIC = "http://127.0.0.1:4174/hosts/gateway.html";
const resident = () => `projects-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function open(page: Page, url: string): Promise<FrameLocator> {
  await page.goto(url);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

async function ask(chat: FrameLocator, question: string) {
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill(question);
  await field.press("Enter");
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
}

async function projectsPage(chat: FrameLocator) {
  await chat.getByRole("button", { name: "Your chats" }).click();
  await chat.getByRole("navigation", { name: "Your chats" }).getByRole("button", { name: "Projects" }).click();
  await expect(chat.getByRole("heading", { name: "Projects" })).toBeFocused();
}

test("a resident keeps chats in a project, finds them there next visit, and deletes it without losing one", async ({
  page,
}) => {
  test.slow(); // two visits, several answers and a scan
  const user = resident();
  let chat = await open(page, `${PORTAL}?user=${user}`);
  await projectsPage(chat);
  await chat.getByRole("button", { name: "New project" }).click();
  await chat.getByRole("textbox", { name: "Project name" }).fill("Moving in");
  await chat.getByRole("button", { name: "Create" }).click();
  await expect(chat.getByRole("heading", { name: "Moving in" })).toBeFocused();
  await expect(chat.getByRole("textbox", { name: "Your question" })).toHaveAttribute(
    "placeholder",
    "Start a chat in Moving in",
  );
  await ask(chat, "Where do I collect my keys?");
  await expect(chat.getByRole("button", { name: "Moving in", expanded: false })).toBeVisible();

  await chat.getByRole("button", { name: "New chat" }).click();
  await ask(chat, "Is there a laundry?");
  await chat.getByRole("button", { name: "Add to project" }).click();
  await chat.getByRole("group", { name: "Project for this chat" }).getByRole("button", { name: "Moving in" }).click();
  await expect(chat.getByRole("button", { name: "Moving in", expanded: false })).toBeFocused();

  await page.reload(); // a new visit, a new session for the same resident
  chat = await open(page, `${PORTAL}?user=${user}`);
  await projectsPage(chat);
  await chat.getByRole("button", { name: /Moving in/ }).click();
  const rows = chat.locator(".view .chats .topic");
  await expect(rows).toHaveText(["Is there a laundry?", "Where do I collect my keys?"]);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.filter((found) => found.impact === "serious" || found.impact === "critical")).toEqual([]);

  await chat.getByRole("button", { name: "Delete project" }).click();
  await chat.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(chat.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(chat.getByText("Keep related chats together.", { exact: false })).toBeVisible();
  await chat.getByRole("button", { name: "Your chats" }).click();
  await expect(chat.getByRole("navigation", { name: "Your chats" }).locator(".chats .topic")).toHaveCount(2);
});

test("a public visitor has no projects", async ({ page }) => {
  const chat = await open(page, PUBLIC);
  await ask(chat, "When does the library open?");

  await expect(chat.getByRole("button", { name: "Add to project" })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Your chats" })).toHaveCount(0);
});
