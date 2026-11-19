import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// Voice (M11) end to end, in Chromium with a fake microphone that plays a spoken question's stand-in (gateway.config.ts)
// through the real gateway, whose fake speech service hears a fixed question in it and speaks silence; answers come
// from the fake PF. The browser's own recogniser is a stand-in too: Playwright's Chromium has no Google speech keys.
const HOST = "http://127.0.0.1:4174/hosts/gateway-voice.html"; // the widget w_voice

async function open(page: Page): Promise<FrameLocator> {
  await page.goto(HOST);
  await page.getByRole("button", { name: "Speak to the College" }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await expect(chat.getByRole("textbox", { name: "Your question" })).toBeVisible();
  return chat;
}

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("dictation: the question is heard into the box, which the visitor checks and sends", async ({ page }) => {
  const chat = await open(page);
  await chat.getByRole("button", { name: "Speak your question" }).click();

  await expect(chat.getByText("Use your voice?")).toBeVisible(); // consent before anything is recorded
  await expect(chat.getByText("Our speech service turns your voice into words. The recording is not kept.")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await chat.getByRole("button", { name: "Continue" }).click();

  const box = chat.getByRole("textbox", { name: "Your question" });
  await expect(box).toHaveValue("When does the library open?", { timeout: 15_000 });
  await expect(chat.getByRole("group", { name: "Voice" })).toHaveCount(0); // it stopped by itself when the visitor did
  await expect(box).toBeFocused();
  await box.press("Enter"); // sent only now, by the visitor
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
});

test("a voice conversation: asked when the visitor stops, read aloud with pause and stop, then listening again", async ({
  page,
}) => {
  const chat = await open(page);
  await chat.getByRole("button", { name: "Start a voice conversation" }).click();
  await chat.getByRole("button", { name: "Continue" }).click();
  const bar = chat.getByRole("group", { name: "Voice" });
  await expect(bar.getByRole("status")).toHaveText("Listening");

  // Another language from the widget's list: heard in American English, it asks for the long recorded answer.
  await bar.getByRole("button", { name: /^Language: British English/ }).click();
  await bar.getByRole("button", { name: "American English" }).click();
  await expect(chat.locator(".mine").last()).toContainText("Tell me how HTTPS works. [long]", { timeout: 15_000 });
  await expect(chat.getByRole("heading", { name: "How HTTPS Works" })).toBeVisible({ timeout: 20_000 }); // the text, as ever

  await expect(bar.getByRole("status")).toHaveText("Reading the answer aloud", { timeout: 20_000 });
  // Scanned once the answer is whole, as every journey is: mid-stream, a long first answer scrolls before it holds
  // anything to focus, an older gap in the conversation's frame that voice does not change.
  await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 30_000 });
  expect(await serious(page)).toEqual([]);
  await bar.getByRole("button", { name: "Pause reading" }).click();
  await expect(bar.getByRole("status")).toHaveText("Paused");
  await bar.getByRole("button", { name: "Resume reading" }).click();
  await expect(bar.getByRole("status")).toHaveText("Reading the answer aloud");
  await bar.getByRole("button", { name: "Stop reading" }).click();
  await expect(bar.getByRole("status")).toHaveText("Listening", { timeout: 20_000 }); // and round again

  await bar.getByRole("button", { name: "End voice conversation" }).click();
  await expect(chat.getByRole("textbox", { name: "Your question" })).toBeFocused();
});

test("a blocked microphone, or none, is explained in plain words, and typing still works", async ({ page }) => {
  await page.addInitScript(() => {
    const kind = sessionStorage.getItem("refuse") ?? "NotAllowedError";
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("refused", kind));
  });
  const chat = await open(page);
  await chat.getByRole("button", { name: "Speak your question" }).click();
  await chat.getByRole("button", { name: "Continue" }).click();
  const said = chat.getByRole("group", { name: "Voice" }).getByRole("status");
  await expect(said).toHaveText("The microphone is blocked. Allow it for this site in your browser's settings, then try again.");
  await chat.getByRole("button", { name: "Cancel" }).click();

  const box = chat.getByRole("textbox", { name: "Your question" });
  await box.fill("When does the library open?");
  await box.press("Enter");
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
});

test("the browser's own recogniser, on the device: no audio leaves it, and listening stops when the page is hidden", async ({
  page,
}) => {
  // A stand-in for Chrome's on-device recogniser (Chrome 139 and later), reporting the language as installed.
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      interimResults = false;
      continuous = false;
      processLocally = false;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      static available = async (options: { processLocally: boolean }) => (options.processLocally ? "available" : "unavailable");
      start() {
        (window as unknown as { heardLocally: boolean }).heardLocally = this.processLocally;
        setTimeout(() => this.onresult?.({ results: [[{ transcript: "Where is the gym" }]] }), 300);
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  const chat = await open(page);
  await chat.getByRole("button", { name: "Speak your question" }).click();
  await expect(chat.getByText("Your device turns your voice into words. The recording does not leave it.")).toBeVisible();
  await chat.getByRole("button", { name: "Continue" }).click();

  const box = chat.getByRole("textbox", { name: "Your question" });
  await expect(box).toHaveValue("Where is the gym");
  const frame = page.frames().find((candidate) => candidate.url().includes("/embed/"))!;
  expect(await frame.evaluate(() => (window as unknown as { heardLocally: boolean }).heardLocally)).toBe(true);
  await frame.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(chat.getByRole("group", { name: "Voice" })).toHaveCount(0); // stopped, keeping what it heard
  await expect(box).toHaveValue("Where is the gym");
});
