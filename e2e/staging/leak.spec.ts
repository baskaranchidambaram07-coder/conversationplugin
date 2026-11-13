import { expect, test } from "@playwright/test";

// R13 with the real PF (M6; the core of M12-T11). A visitor holds a real conversation answered by PF staging, and
// everything the browser received is searched for PF: network traffic both ways, the console, every frame's page and
// storage, cookies, and inside any token. Failures name the setting and where it was found, never the value.
// The local stack (staging.config.ts), or a deployed one (deployed.config.ts sets UCP_GATEWAY_URL and the widget).
const GATEWAY = process.env.UCP_GATEWAY_URL ?? "http://localhost:8200";
const WIDGET = process.env.UCP_WIDGET ?? "w_gateway";
const TITLE = process.env.UCP_WIDGET_TITLE ?? "Ask the College";
const PAGE = `http://127.0.0.1:4174/hosts/gateway-any.html?gateway=${encodeURIComponent(GATEWAY)}&widget=${WIDGET}`;
const SETTINGS = ["PF_BASE_URL", "PF_TENANT", "PF_WORKSPACE_ID", "PF_AGENT_ID", "PF_API_KEY", "PF_USERNAME", "PF_PASSWORD"];
const QUESTIONS = ["Reply with the single word READY.", "Thank you. Now reply with the single word DONE."];
const PF_ID = /\b[0-9a-f]{24}\b/; // PF's conversation and message IDs; ours are never this shape

type Seen = { where: string; text: string };

test.skip(!SETTINGS.every((name) => process.env[name]), "needs the PF_* settings from .env");

function needles(): [string, string][] {
  const values = SETTINGS.map((name): [string, string] => [name, process.env[name]!]);
  return [...values, ["the PF host", new URL(process.env.PF_BASE_URL!).host]];
}

function contains(text: string, value: string): boolean {
  if (value.length >= 8) return text.includes(value);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // a short value counts only as a whole word
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(text);
}

function withTokensOpened(text: string): string {
  const payloads = [...text.matchAll(/eyJ[\w-]+\.([\w-]+)\.[\w-]*/g)].map(([, payload]) =>
    Buffer.from(payload, "base64url").toString(),
  );
  return [text, ...payloads].join("\n");
}

function place(where: string): string {
  const named = needles().reduce((text, [name, value]) => text.replaceAll(value, `<${name}>`), where);
  return named.replace(new RegExp(PF_ID, "g"), "<id>");
}

test("a real conversation on PF staging leaves nothing of PF anywhere in the browser", async ({ page, context }) => {
  const seen: Seen[] = [];
  const bodies: Promise<unknown>[] = [];
  page.on("request", (request) => {
    const text = [request.url(), JSON.stringify(request.headers()), request.postData() ?? ""].join("\n");
    seen.push({ where: `request to ${request.url()}`, text });
  });
  page.on("response", (response) =>
    bodies.push(
      Promise.all([response.allHeaders(), response.text().catch(() => "")]).then(([headers, body]) =>
        seen.push({ where: `response from ${response.url()}`, text: [JSON.stringify(headers), body].join("\n") }),
      ),
    ),
  );
  page.on("console", (message) => seen.push({ where: "the console", text: message.text() }));
  page.on("pageerror", (error) => seen.push({ where: "a page error", text: String(error) }));

  await page.goto(PAGE);
  await page.getByRole("button", { name: TITLE }).click();
  const chat = page.frameLocator("[data-ucp] iframe");
  const field = chat.getByRole("textbox", { name: "Your question" });
  for (const [asked, question] of QUESTIONS.entries()) {
    await field.fill(question);
    await field.press("Enter");
    await expect(chat.getByRole("button", { name: "Copy answer" })).toHaveCount(asked + 1, { timeout: 120_000 });
  }
  await expect(chat.getByRole("alert")).toHaveCount(0);

  await Promise.all(bodies);
  for (const frame of page.frames()) {
    seen.push({ where: `the page ${frame.url()}`, text: await frame.content() });
    const storage = await frame.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    seen.push({ where: `the storage of ${frame.url()}`, text: storage });
  }
  seen.push({ where: "the cookies", text: JSON.stringify(await context.cookies()) });
  // The search covers the streamed answers themselves, not just the pages around them.
  const answers = seen.filter(({ where }) => /^response from .*\/messages$/.test(where));
  expect(answers.filter(({ text }) => text.includes('"message.completed"'))).toHaveLength(QUESTIONS.length);

  const leaks = seen.flatMap(({ where, text }) => {
    const opened = withTokensOpened(text);
    const found = needles().filter(([, value]) => contains(opened, value)).map(([name]) => name);
    if (PF_ID.test(opened)) found.push("a PF-shaped ID");
    return found.map((name) => `${name} in ${place(where)}`);
  });
  expect(leaks).toEqual([]);

  // Production builds publish no source maps.
  const scripts = seen.filter(({ where }) => /^response from .*\.(js|mjs)(\?|$)/.test(where));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter(({ text }) => text.includes("sourceMappingURL")).map(({ where }) => place(where))).toEqual([]);
  expect(seen.filter(({ where }) => /\.map(\?|$)/.test(where))).toEqual([]);
});
