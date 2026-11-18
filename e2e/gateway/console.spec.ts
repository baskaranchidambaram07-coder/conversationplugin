import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

// The admin console (M9), served by the admin API in the stack under test (backend/devstack.py), signing in through
// the stand-in company identity provider with the authorization-code flow and PKCE, as Cognito or Entra ID would.
const CONSOLE = "http://127.0.0.1:8201";

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await page.bringToFront(); // axe finishes in a page of its own, which can leave this one hidden in WebKit, never still enough to click
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

/** A platform administrator of this test's own, so tests in parallel never share one administrator's limit. */
async function platformAdministrator(page: Page, label: string): Promise<string> {
  const reply = await page.request.get("http://127.0.0.1:8300/token?sub=onboarding-operator");
  const headers = { authorization: `Bearer ${(await reply.json()).token}` };
  const subject = `${label}-${test.info().project.name}-${Date.now().toString(36)}`;
  await page.request.post(`${CONSOLE}/admin/v1/administrators`, { headers, data: { subject, role: "platform" } });
  return subject;
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

  const operator = await platformAdministrator(page, "operator");
  await signIn(page, "/widgets/w_gateway/look", operator);
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway/look`);
  await expect(page.getByRole("heading", { level: 1, name: "Ask the College" })).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click(); // who is signed in, behind the profile button
  await expect(page.getByText(`${operator} · platform administrator`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Account" })).toBeFocused();
  await expect(page.getByRole("button", { name: /Look.*, open/ })).toBeVisible();
  await expect(page.getByLabel("Colour of buttons")).toHaveValue("#5B2A86");
  await expect(page.getByText("Live · version 1").first()).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByRole("button", { name: /Sites/ }).click();
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway/sites`);
  await expect(page.getByText("http://127.0.0.1:4174")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /Look.*, open/ })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
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

// The first three stations (M9-T2): a new widget's journey to its draft, and editing an existing widget.
const FAKE_PF = {
  "Name of the connection": "fake-pf",
  "Purple Fabric address": "http://127.0.0.1:8100",
  "Purple Fabric tenant": "fake-tenant",
  "Workspace ID": "fake-workspace",
  "Agent version ID": "fake-agent-version",
  "API key": "fake-api-key",
  "Service user name": "fake-user",
  "Service user password": "fake-password",
};
const FAKE_PROFILE = {
  base_url: "http://127.0.0.1:8100", tenant: "fake-tenant", workspace_id: "fake-workspace", agent_version_id: "fake-agent-version",
  api_key: "fake-api-key", username: "fake-user", password: "fake-password",
};

/** A draft for a widget anyone may use, on the test server's pages, answered through the fake PF connection. */
function anonymous(title: string) {
  return {
    public: { title, welcome_message: null, suggested_prompts: [], ai_notice: null, brand_color: "#1F6F5C", logo_url: null, color_scheme: "auto", launcher_position: "bottom-right", history_enabled: false },
    allowed_domains: ["http://127.0.0.1:4174"],
    sign_in: "anonymous",
    agent_profile: "fake-pf",
  };
}

async function operatorApi(page: Page) {
  const reply = await page.request.get("http://127.0.0.1:8300/token?sub=onboarding-operator");
  const headers = { authorization: `Bearer ${(await reply.json()).token}` };
  return async (method: "GET" | "POST" | "PUT", path: string, data?: object) =>
    (await page.request.fetch(`${CONSOLE}/admin/v1${path}`, { method, headers, data })).json();
}

test("a new widget: a connection added and tested, a site, sign-in, then its draft, with the time left going down", async ({
  page,
}, info) => {
  const api = await operatorApi(page);
  const name = `Riverside ${info.project.name} ${Date.now().toString(36)}`;
  const { tenant_id: tenant } = await api("POST", "/tenants", { name });

  await signIn(page, "/", await platformAdministrator(page, "maker"));
  await page.getByRole("combobox", { name: "Organisation" }).selectOption({ label: name });
  await page.getByRole("link", { name: "New widget" }).click();
  await expect(page.getByText("About 19 minutes to live")).toBeVisible();
  await expect(page.getByRole("button", { name: /Look/ })).toHaveAttribute("aria-disabled", "true");

  await page.getByLabel("Title visitors will see").fill("Ask Riverside");
  await page.getByRole("button", { name: "Add a connection" }).click();
  for (const [label, value] of Object.entries(FAKE_PF)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /fake-pf/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(`${CONSOLE}/widgets/new/sites`);
  await expect(page.getByText("About 14 minutes to live")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Add at least one site.");
  await page.getByLabel("Add a site").fill("http://127.0.0.1:4174");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(`${CONSOLE}/widgets/new/sign-in`);
  await page.getByRole("radio", { name: /^Anyone No sign-in/ }).check();
  expect(await serious(page)).toEqual([]); // the wizard's own form: choices, fields, the track
  await page.getByRole("button", { name: "Create the draft" }).click();

  await expect(page).toHaveURL(new RegExp(`${CONSOLE}/widgets/w_[A-Za-z0-9_-]+/look$`));
  await expect(page.getByRole("heading", { level: 1, name: "Ask Riverside" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ask Riverside Not live yet/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /Look/ })).toHaveAttribute("aria-current", "step"); // not done until saved
  await expect(page.getByText("About 9 minutes to live")).toBeVisible();
  const created = (await api("GET", `/tenants/${tenant}/widgets`)) as { widget_id: string }[];
  expect(created).toHaveLength(1);
});

test("an existing widget's settings are edited and saved; a viewer sees them but changes nothing", async ({ page }, info) => {
  const api = await operatorApi(page);
  const name = `Editing ${info.project.name} ${Date.now().toString(36)}`;
  const { tenant_id: tenant } = await api("POST", "/tenants", { name });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, Object.fromEntries(
    Object.entries(FAKE_PF).slice(1).map(([, value], index) => [["base_url", "tenant", "workspace_id", "agent_version_id", "api_key", "username", "password"][index], value]),
  ));
  const document = {
    public: { title: "Ask Editing", welcome_message: null, suggested_prompts: [], ai_notice: null, brand_color: "#1F6F5C", logo_url: null, color_scheme: "auto", launcher_position: "bottom-right", history_enabled: false },
    allowed_domains: ["https://www.example.org"],
    sign_in: "anonymous",
    agent_profile: "fake-pf",
  };
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document });
  const viewer = `viewer-${info.project.name}-${Date.now().toString(36)}`;
  await api("POST", "/administrators", { subject: viewer, role: "viewer", tenant_id: tenant });

  await signIn(page, `/widgets/${widget}/sites`, await platformAdministrator(page, "editor"));
  await page.getByLabel("Add a site").fill("https://portal.example.org");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();
  await expect(page.getByText("2 sites allowed")).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, `/widgets/${widget}/agent`, viewer);
  await expect(page.getByText("You can look, but not change anything here.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /fake-pf/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a connection" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit fake-pf" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New widget" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New organisation" })).toHaveCount(0);
  await page.getByRole("button", { name: /Go live/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Go live" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete the widget" })).toHaveCount(0);
});

// Look (M9-T3): the form beside the chat itself, drawn with the draft's settings as they are typed.
test("the look is edited beside the chat itself, which shows each change at once and sends nothing; saved, it goes on to Install", async ({ page }, info) => {
  const api = await operatorApi(page);
  const name = `Look ${info.project.name} ${Date.now().toString(36)}`;
  const { tenant_id: tenant } = await api("POST", "/tenants", { name });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, {
    base_url: "http://127.0.0.1:8100", tenant: "fake-tenant", workspace_id: "fake-workspace", agent_version_id: "fake-agent-version",
    api_key: "fake-api-key", username: "fake-user", password: "fake-password",
  });
  const document = {
    public: { title: "Ask Riverside", welcome_message: "Hello.", suggested_prompts: ["When is lunch?"], ai_notice: null, brand_color: "#1F6F5C", logo_url: null, color_scheme: "light", launcher_position: "bottom-right", history_enabled: false },
    allowed_domains: ["https://www.example.org"],
    sign_in: "anonymous",
    agent_profile: "fake-pf",
  };
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document });

  await signIn(page, `/widgets/${widget}/look`, await platformAdministrator(page, "designer"));
  const chat = page.frameLocator(".preview iframe");
  await expect(chat.getByRole("heading", { name: "Ask Riverside" })).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "Your question" })).toBeDisabled();
  await expect(chat.getByRole("button", { name: "When is lunch?" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue to Install" })).toBeVisible(); // nothing to save yet

  await page.getByLabel("Title", { exact: true }).fill("Ask the Riverside desk");
  await expect(chat.getByRole("heading", { name: "Ask the Riverside desk" })).toBeVisible();
  await page.getByLabel("Suggested question 2").fill("Where do I park?");
  await expect(chat.getByRole("button", { name: "Where do I park?" })).toBeVisible();
  // The assistant's picture: even an SVG with only a viewBox goes up as a 256 px square of plain pixels, and the
  // preview shows it at once.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1F6F5C"/></svg>';
  await page.getByLabel("Assistant picture").setInputFiles({ name: "eva.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  const picture = chat.locator(".head .mark img");
  await expect(picture).toHaveAttribute("src", /^\/v1\/images\/[0-9a-f]{64}$/);
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(256);
  await page.getByLabel("Greeting").fill("Hi, I'm Riverside. Ask me anything.");
  await page.getByLabel("Colour of buttons").fill("#2B241F");
  await expect(page.getByText("On dark screens this colour gives way to a light grey, so the buttons stay visible.")).toBeVisible();
  await page.getByLabel("Colour of buttons").fill("#5B2A86");
  await expect(page.getByText("Text on it: white, 9.9 : 1")).toBeVisible();
  const send = chat.getByRole("button", { name: "Send" }); // the brand colour is on what visitors press
  await expect.poll(() => send.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgb(91, 42, 134)");

  await expect(chat.getByRole("button", { name: "Attach files" })).toHaveCount(0);
  await page.getByLabel(/Visitors can attach files/).check(); // the paperclip appears in the preview, sending nothing
  await expect(chat.getByRole("button", { name: "Attach files" })).toBeDisabled();

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect.poll(() => chat.locator("html").getAttribute("data-scheme")).toBe("dark");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ask the Riverside desk/ })).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue to Install" }).click();
  await expect(page).toHaveURL(`${CONSOLE}/widgets/${widget}/install`);
  await expect(page.getByRole("heading", { level: 2, name: "Install" })).toBeFocused();
});

// Install (M9-T5): the code to add, filled in for the widget, and a check of a page of the customer's site.
test("the install code is filled in for the widget, a page of the site is checked for it, then on to Go live", async ({ page }) => {
  await signIn(page, "/widgets/w_gateway/install", await platformAdministrator(page, "installer"));
  await expect(page.getByText('<script async src="http://localhost:8200/loader.js" data-widget-id="w_gateway"></script>')).toBeVisible();
  await expect(page.getByText("script-src http://localhost:8200")).toBeVisible();

  const address = page.getByLabel("Page address");
  await address.fill("http://127.0.0.1:4174/hosts/gateway.html");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Is the chat's script tag on it? Yes")).toBeVisible();
  await expect(page.getByText("Does the page answer? Yes")).toBeVisible();

  await address.fill("http://127.0.0.1:4174/hosts/plain.html");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Is the chat's script tag on it? No — add the script tag for this widget")).toBeVisible();

  await address.fill("https://elsewhere.example/");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Does the page answer? No — the page is not on one of this widget's allowed sites")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue to Go live" }).click();
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway/live`);
  await expect(page.getByRole("heading", { level: 2, name: "Go live" })).toBeFocused();
});

test("a signed-in widget's install shows its portal endpoint's settings and code in six languages", async ({ page }, info) => {
  const api = await operatorApi(page);
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Portal ${info.project.name} ${Date.now().toString(36)}` });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, {
    base_url: "http://127.0.0.1:8100", tenant: "fake-tenant", workspace_id: "fake-workspace", agent_version_id: "fake-agent-version",
    api_key: "fake-api-key", username: "fake-user", password: "fake-password",
  });
  await api("POST", `/tenants/${tenant}/host-secrets/portal`);
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, {
    document: {
      public: { title: "Residents", welcome_message: null, suggested_prompts: [], ai_notice: null, brand_color: "#1F6F5C", logo_url: null, color_scheme: "auto", launcher_position: "bottom-right", history_enabled: true },
      allowed_domains: ["https://portal.example.org"],
      sign_in: "signed_in",
      agent_profile: "fake-pf",
      identity: { provider: "portal", issuer: "riverside-portal", secret: "portal" },
    },
  });

  await signIn(page, `/widgets/${widget}/install`, await platformAdministrator(page, "porter"));
  await expect(page.getByRole("heading", { name: "Your portal's token endpoint" })).toBeVisible();
  await expect(page.getByText(`UCP_ISSUER=riverside-portal`)).toBeVisible();
  await expect(page.getByText(`UCP_WIDGET_ID=${widget}`)).toBeVisible();
  await page.getByRole("tab", { name: "Python" }).click();
  await expect(page.getByRole("tab", { name: "Python" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("The endpoint's code in Python")).toBeVisible();
  await expect(page.getByText('fetch("/widget-token", { credentials: "same-origin" })').first()).toBeVisible();
});

// Go live (M9-T6): publish, what changed, the versions, compare, and the rollback journey.
test("a widget is published, changed and published again, compared, and rolled back; visitors get the old one", async ({ page }, info) => {
  const api = await operatorApi(page);
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Go live ${info.project.name} ${Date.now().toString(36)}` });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, {
    base_url: "http://127.0.0.1:8100", tenant: "fake-tenant", workspace_id: "fake-workspace", agent_version_id: "fake-agent-version",
    api_key: "fake-api-key", username: "fake-user", password: "fake-password",
  });
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, {
    document: {
      public: { title: "First title", welcome_message: null, suggested_prompts: [], ai_notice: null, brand_color: "#1F6F5C", logo_url: null, color_scheme: "auto", launcher_position: "bottom-right", history_enabled: false },
      allowed_domains: ["http://127.0.0.1:4174"],
      sign_in: "anonymous",
      agent_profile: "fake-pf",
    },
  });

  await signIn(page, `/widgets/${widget}/live`, await platformAdministrator(page, "publisher"));
  await expect(page.getByRole("heading", { name: "Not live yet" })).toBeVisible();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published. Version 1 is live; visitors see it within half a minute.")).toBeVisible();
  await expect(page.getByText("Live · version 1").first()).toBeVisible();

  await page.getByRole("button", { name: /Look/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Second title");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();
  await page.getByRole("button", { name: /Go live/ }).click();
  const waiting = page.getByRole("table");
  await expect(waiting.getByRole("row", { name: "Title First title Second title" })).toBeVisible();
  await page.getByRole("button", { name: "Publish version 2" }).click();
  await expect(page.getByText("Published. Version 2 is live")).toBeVisible();

  await page.getByRole("button", { name: "Compare with live" }).click();
  await expect(page.getByRole("row", { name: "Title Second title First title" })).toBeVisible();
  await page.getByRole("button", { name: "Make this live again" }).click();
  await page.getByRole("button", { name: "Yes, make version 1 live again" }).click();
  await expect(page.getByText("Version 1 is live again, as version 3.")).toBeVisible();
  const config = await page.request.get(`http://localhost:8200/v1/widgets/${widget}/config`);
  expect((await config.json()).title).toBe("First title"); // the gateway serves the rolled-back version
  expect(await serious(page)).toEqual([]);
});

// M9's done condition: a new administrator completes onboarding from the console alone, timed. Only their account
// is made beforehand (by a platform administrator); everything they do is in the console, then a visitor chats.
test("a new administrator onboards a widget from the console alone, and a visitor chats with it", async ({ page }, info) => {
  test.slow();
  const api = await operatorApi(page);
  const run = `${info.project.name}-${Date.now().toString(36)}`;
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Riverside ${run}` });
  const newcomer = `riverside-admin-${run}`;
  await api("POST", "/administrators", { subject: newcomer, role: "tenant", tenant_id: tenant });
  const started = Date.now();

  await signIn(page, "/", newcomer);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText(`${newcomer} · administrator`)).toBeVisible();
  await page.getByRole("link", { name: "New widget" }).click();
  await page.getByLabel("Title visitors will see").fill(`Ask Riverside ${run.slice(-4)}`);
  await page.getByRole("button", { name: "Add a connection" }).click();
  for (const [label, value] of Object.entries(FAKE_PF)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Add a site").fill("http://127.0.0.1:4174");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /^Anyone No sign-in/ }).check();
  await page.getByRole("button", { name: "Create the draft" }).click();

  await expect(page).toHaveURL(new RegExp(`${CONSOLE}/widgets/w_[A-Za-z0-9_-]+/look$`));
  const widget = page.url().split("/").at(-2)!;
  await page.getByLabel("Welcome text").fill("Hello. Ask me anything about Riverside.");
  await page.getByLabel("Suggested question 1").fill("What are your opening hours?");
  await page.getByLabel("Colour of buttons").fill("#1F6F5C");
  await page.getByRole("radio", { name: "Bottom left" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();

  await page.getByRole("button", { name: "Continue to Install" }).click();
  await expect(page.getByText(`data-widget-id="${widget}"`)).toBeVisible();
  await page.getByRole("button", { name: "Continue to Go live" }).click();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published. Version 1 is live")).toBeVisible();
  const seconds = Math.round((Date.now() - started) / 1000);
  info.annotations.push({ type: "onboarding time", description: `${seconds} seconds in the console, typed by a robot` });

  const visitor = await page.context().newPage();
  await visitor.goto(`http://127.0.0.1:4174/hosts/gateway-any.html?widget=${widget}`);
  const launcher = visitor.getByRole("button", { name: `Ask Riverside ${run.slice(-4)}` });
  await expect(launcher).toBeVisible();
  expect((await launcher.boundingBox())!.x).toBeLessThan(200); // bottom left, as chosen in the console
  await launcher.click();
  const chat = visitor.frameLocator("[data-ucp] iframe");
  await chat.getByRole("button", { name: "What are your opening hours?" }).click();
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();
});

/** Presses Tab (or Shift+Tab) until the element has the focus, as a keyboard user reaches it; fails if it never does. */
async function tabTo(page: Page, target: Locator, key = "Tab") {
  for (let presses = 0; presses < 80; presses++) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab never reaches ${target}`);
}

test("the keyboard alone moves along the track, edits, saves and publishes", async ({ page }, info) => {
  const api = await operatorApi(page);
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Keys ${info.project.name} ${Date.now().toString(36)}` });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, FAKE_PROFILE);
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document: anonymous("Ask Keys") });

  await signIn(page, `/widgets/${widget}/agent`, await platformAdministrator(page, "keys"));
  await expect(page.getByRole("button", { name: /Agent.*, open/ })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: /Look/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${CONSOLE}/widgets/${widget}/look`);
  await tabTo(page, page.getByLabel("Title", { exact: true }));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Ask Keys Again");
  await tabTo(page, page.getByRole("radio", { name: "Bottom right" })); // Tab reaches a group's chosen option; arrows change it
  await page.keyboard.press("ArrowDown");
  await tabTo(page, page.getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();

  await tabTo(page, page.getByRole("button", { name: /Go live/ }), "Shift+Tab"); // back up to the track
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Publish version 1" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Published. Version 1 is live")).toBeVisible();
  const config = await page.request.get(`http://localhost:8200/v1/widgets/${widget}/config`);
  expect(await config.json()).toMatchObject({ title: "Ask Keys Again", launcher_position: "bottom-left" });
});

test("a connection's keys and a shared secret are never shown again once saved", async ({ page }, info) => {
  const api = await operatorApi(page);
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Secrets ${info.project.name} ${Date.now().toString(36)}` });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, FAKE_PROFILE);
  await api("POST", `/tenants/${tenant}/host-secrets/portal`);
  const document = { ...anonymous("Residents"), sign_in: "signed_in", identity: { provider: "portal", issuer: "riverside-portal", secret: "portal" } };
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document });
  const typed = async () => page.locator("input, textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value).join("\n"));

  await signIn(page, `/widgets/${widget}/agent`, await platformAdministrator(page, "keeper"));
  await page.getByRole("button", { name: "Add a connection" }).click();
  const second = { ...FAKE_PF, "Name of the connection": "second", "API key": "second-api-key", "Service user password": "second-password" };
  for (const [label, value] of Object.entries(second)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByRole("radio", { name: /second/ })).toBeVisible();
  expect(await typed()).not.toMatch(/second-api-key|second-password/);
  await expect(page.locator("body")).not.toContainText(/second-api-key|second-password/);

  await page.getByRole("button", { name: /Sign-in/ }).click();
  await page.getByRole("button", { name: "Make a new secret" }).click();
  await expect(page.getByText("Copy this now: it will not be shown again.")).toBeVisible();
  const made = (await page.locator(".once code").textContent())!.trim();
  expect(made).toMatch(/^\S+:\S{20,}$/);
  await page.getByRole("button", { name: /Agent/ }).click();
  await page.getByRole("button", { name: /Sign-in/ }).click();
  await expect(page.getByText(/The secret “portal” exists/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(made.split(":")[1]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Make a new secret" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(made.split(":")[1]);
});

test("a saved connection's settings are shown but not its secrets; a wrong agent version is put right alone", async ({ page }, info) => {
  const api = await operatorApi(page);
  const { tenant_id: tenant } = await api("POST", "/tenants", { name: `Fix ${info.project.name} ${Date.now().toString(36)}` });
  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, { ...FAKE_PROFILE, agent_version_id: "the-agent-not-its-version" });
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document: anonymous("Ask Fix") });

  await signIn(page, `/widgets/${widget}/agent`, await platformAdministrator(page, "fixer"));
  await page.getByRole("button", { name: "Edit fake-pf" }).click();
  await expect(page.getByRole("heading", { name: "Change “fake-pf”" })).toBeVisible();
  await expect(page.getByLabel("Name of the connection")).toHaveCount(0);
  await expect(page.getByLabel("Agent version ID")).toHaveValue("the-agent-not-its-version"); // the settings, shown
  await expect(page.getByLabel("Workspace ID")).toHaveValue("fake-workspace");
  await expect(page.getByLabel("API key")).toHaveValue(""); // the secrets, never
  await expect(page.getByLabel("Service user password")).toHaveValue("");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByRole("alert")).toContainText("Change at least one field first.");

  await page.getByLabel("Agent version ID").fill("fake-agent-version");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible(); // PF still signs in: key and password kept
  await expect(page.getByRole("heading", { name: "Change “fake-pf”" })).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
});

// Organisations made and deleted in the console, and a widget deleted: its visitors' chat goes, its history stays.
test("an organisation is made in the console; its widget and then the organisation are deleted, each asked twice", async ({
  page,
}, info) => {
  test.slow();
  const api = await operatorApi(page);
  const name = `Northfield ${info.project.name} ${Date.now().toString(36)}`;
  await signIn(page, "/", await platformAdministrator(page, "founder"));
  await page.getByRole("link", { name: "New organisation" }).click();
  await page.getByRole("button", { name: "Create the organisation" }).click();
  await expect(page.getByRole("alert")).toContainText("Give the organisation a name.");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create the organisation" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("No widgets yet.")).toBeVisible();
  const tenant = await page.getByRole("combobox", { name: "Organisation" }).inputValue();
  expect(tenant).toMatch(/^t_/);

  await api("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, FAKE_PROFILE);
  const { widget_id: widget } = await api("POST", `/tenants/${tenant}/widgets`, { document: anonymous(`Ask ${name}`) });
  await api("POST", `/widgets/${widget}/publish`, { revision: 1 });
  const config = () => page.request.get(`http://localhost:8200/v1/widgets/${widget}/config`).then((reply) => reply.status());
  expect(await config()).toBe(200);

  await page.reload();
  await expect(page.getByText("1 widget · ID")).toBeVisible();
  await expect(page.getByText("To delete this organisation, first delete its widget, each from its Go live step.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete the organisation" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Widgets" }).getByRole("link", { name: new RegExp(`Ask ${name}`) }).click();
  await page.getByRole("button", { name: /Go live/ }).click();
  await page.getByRole("button", { name: "Delete the widget" }).click();
  const confirm = page.getByRole("button", { name: `Yes, delete “Ask ${name}”` });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Type “Ask ${name}” to confirm`).fill(`Ask ${name}`);
  expect(await serious(page)).toEqual([]);
  await confirm.click();
  await expect(page.getByText(`“Ask ${name}” is deleted.`)).toBeVisible();
  await expect(page.getByText("0 widgets · ID")).toBeVisible();
  await expect.poll(config, { timeout: 45_000 }).toBe(404); // within the gateway's half a minute
  expect((await api("GET", `/tenants/${tenant}/widgets`)) as unknown[]).toHaveLength(0);

  await page.getByRole("button", { name: "Delete the organisation" }).click();
  await page.getByLabel(`Type “${name}” to confirm`).fill(name);
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: `Yes, delete “${name}”` }).click();
  await expect(page.getByText(`“${name}” is deleted.`)).toBeVisible();
  await expect(page.getByRole("option", { name })).toHaveCount(0);
  const kept = (await api("GET", "/tenants")) as { tenant_id: string }[];
  expect(kept.map((one) => one.tenant_id)).not.toContain(tenant);
});

test("home shows where things stand: the figures, an organisation's widgets, and every organisation by state", async ({ page }) => {
  await signIn(page, "/", await platformAdministrator(page, "overview"));
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("At a glance")).toContainText("Organisations");

  const organisations = page.locator(".panel", { has: page.getByRole("heading", { name: "Organisations" }) });
  await expect(organisations.getByRole("link", { name: "New organisation" })).toBeVisible();
  await page.getByRole("combobox", { name: "Organisation" }).selectOption({ label: "t_e2e" }); // the open one always shows
  await expect(page.getByRole("heading", { level: 1, name: "t_e2e" })).toBeVisible();
  await expect(organisations.getByRole("button", { name: /^t_e2e/ })).toHaveAttribute("aria-current", "true");
  await expect(organisations.getByRole("button", { name: /^t_e2e/ })).toContainText(/\d+ live/);
  const widgets = page.locator(".panel", { has: page.getByRole("heading", { name: "Widgets in t_e2e" }) });
  await widgets.getByRole("link", { name: /Ask the College/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask the College" })).toBeVisible();
  await page.getByRole("link", { name: "UCP Console" }).click(); // the name in the bar goes home too
  await expect(page.getByRole("heading", { level: 1, name: "t_e2e" })).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

// Feedback (M10): a visitor's rating and comment, read under the widget's own Feedback tab.
test("a visitor's rating and comment show under the widget's Feedback, with the question it was about", async ({
  page,
  browser,
}, info) => {
  const comment = `It left out the opening hours (${info.project.name} ${Date.now().toString(36)})`;
  const visitor = await browser.newPage();
  await visitor.goto("http://127.0.0.1:4174/hosts/gateway.html");
  await visitor.getByRole("button", { name: "Ask the College" }).click();
  const chat = visitor.frameLocator("[data-ucp] iframe");
  const field = chat.getByRole("textbox", { name: "Your question" });
  await field.fill("When is the gym open?");
  await field.press("Enter");
  await chat.getByRole("button", { name: "Not helpful" }).click({ timeout: 20_000 });
  await chat.getByRole("textbox", { name: "What could be better?" }).fill(comment);
  await chat.getByRole("button", { name: "Send feedback" }).click();
  await expect(chat.getByRole("article").getByText("Thanks for your feedback.")).toBeVisible();
  await visitor.close();

  await signIn(page, "/widgets/w_gateway/feedback", await platformAdministrator(page, "reader"));
  await expect(page.getByRole("heading", { level: 2, name: "Feedback" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "This widget" }).getByRole("link", { name: "Feedback" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const entry = page.getByRole("listitem").filter({ hasText: comment });
  await expect(entry).toContainText("Not helpful");
  await expect(entry).toContainText("Public visitor");
  await expect(entry).toContainText("When is the gym open?");
  await entry.getByText("Show the answer").click();
  await expect(entry.locator(".answer")).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(page.getByText(comment)).toHaveCount(0); // only the helpful ones now
  await page.getByRole("navigation", { name: "This widget" }).getByRole("link", { name: "Set up" }).click();
  await expect(page).toHaveURL(`${CONSOLE}/widgets/w_gateway`);
});
