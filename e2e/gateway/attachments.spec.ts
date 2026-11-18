import AxeBuilder from "@axe-core/playwright";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

// Attachments (M10) through the real gateway: chosen in the composer, uploaded, sent with a question to the fake PF,
// which names them in its answer, then saved back from the question. A file PF does not take is refused in words.
const PUBLIC = "http://127.0.0.1:4174/hosts/gateway.html";
const PDF = { name: "Tenancy agreement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF\n") };
const PNG = {
  name: "meter.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function open(page: Page): Promise<FrameLocator> {
  await page.goto(PUBLIC);
  await page.getByRole("button", { name: "Ask the College" }).click();
  return page.frameLocator("[data-ucp] iframe");
}

test("a visitor attaches a document and a picture, asks about them, and saves one back", async ({ page }) => {
  const chat = await open(page);
  await expect(chat.getByRole("button", { name: "Attach files" })).toBeVisible();
  await chat.locator('input[type="file"]').setInputFiles([PDF, PNG]);

  const composer = chat.getByRole("list", { name: "2 files attached" });
  await expect(composer.getByText("Tenancy agreement.pdf")).toBeVisible();
  await expect(composer.locator("img")).toHaveAttribute("src", /^blob:/); // the picture shows itself
  await expect(composer.getByRole("progressbar")).toHaveCount(0, { timeout: 10_000 }); // both uploaded
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill("What do these say?");
  await field.press("Enter");

  await expect(chat.getByRole("article").getByText("I read Tenancy agreement.pdf, meter.png.")).toBeVisible({
    timeout: 20_000,
  });
  const sent = chat.locator(".turn").getByRole("list", { name: "2 files attached" });
  await expect(sent.getByRole("button", { name: "Save Tenancy agreement.pdf" })).toBeVisible();
  await expect(sent.locator("img")).toHaveAttribute("src", /^blob:/); // fetched with the session, never by address
  await expect(chat.getByRole("list", { name: "2 files attached" })).toHaveCount(1); // the composer is empty again

  const saving = page.waitForEvent("download");
  await sent.getByRole("button", { name: "Save Tenancy agreement.pdf" }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe("Tenancy agreement.pdf");

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.filter((found) => found.impact === "serious" || found.impact === "critical")).toEqual([]);
});

test("a file PF does not take, or a sixth file, is refused in plain words and never sent", async ({ page }) => {
  const chat = await open(page);
  const picker = chat.locator('input[type="file"]');

  await picker.setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(chat.getByRole("alert")).toHaveText(
    "setup.exe cannot be attached. Attach a PDF, a Word document, or a JPG or PNG picture.",
  );
  await expect(chat.getByRole("list", { name: /attached/ })).toHaveCount(0);

  // Named .pdf but not a PDF: the browser lets it through, the gateway refuses it from its bytes.
  await picker.setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") });
  await expect(chat.getByRole("alert")).toHaveText(
    "invoice.pdf could not be attached. Check it is a PDF, a Word document, or a JPG or PNG picture.",
  );
  await expect(chat.getByText("Not attached")).toBeVisible();
  await chat.getByRole("button", { name: "Remove invoice.pdf" }).click();

  const six = Array.from({ length: 6 }, (_, n) => ({ ...PDF, name: `page ${n + 1}.pdf` }));
  await picker.setInputFiles(six);
  await expect(chat.getByRole("alert")).toHaveText("You can attach up to 5 files to one question.");
  await expect(chat.getByRole("list", { name: "5 files attached" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the paperclip and the files fit the full-screen chat", async ({ page }) => {
    const chat = await open(page);
    await chat.locator('input[type="file"]').setInputFiles([PDF, PNG]);
    const files = chat.getByRole("list", { name: "2 files attached" });
    await expect(files.getByRole("progressbar")).toHaveCount(0, { timeout: 10_000 });

    const composer = await chat.locator(".compose").boundingBox();
    const box = await files.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(composer!.width); // the files wrap inside the composer, never past it
    await expect(chat.getByRole("button", { name: "Attach files" })).toBeInViewport();
  });
});
