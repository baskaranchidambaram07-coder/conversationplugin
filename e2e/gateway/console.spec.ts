import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The admin console (M9), served by the admin API in the stack under test (backend/devstack.py), signing in through
// the stand-in company identity provider with the authorization-code flow and PKCE, as Cognito or Entra ID would.
const CONSOLE = "http://127.0.0.1:8201";

async function serious(page: Page) {
  // The automated Firefox on the Windows build machine crashes in axe scans of the console's forms (found on 14
  // November 2026; typing, or a scan of a plain page, does not crash it). Linux Firefox in the pipeline scans them all.
  if (test.info().project.name === "firefox" && process.platform === "win32") return [];
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
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
  await expect(page.getByText(`${operator} · platform administrator`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Look/, pressed: true })).toBeVisible();
  await expect(page.getByLabel("Colour of buttons")).toHaveValue("#5B2A86");
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

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, `/widgets/${widget}/agent`, viewer);
  await expect(page.getByText("You can look, but not change anything here.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /fake-pf/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a connection" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New widget" })).toHaveCount(0);
});

// Look (M9-T3): the form beside the chat itself, drawn with the draft's settings as they are typed.
test("the look is edited beside the chat itself, which shows each change at once and sends nothing", async ({ page }, info) => {
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

  await page.getByLabel("Title", { exact: true }).fill("Ask the Riverside desk");
  await expect(chat.getByRole("heading", { name: "Ask the Riverside desk" })).toBeVisible();
  await page.getByLabel("Suggested question 2").fill("Where do I park?");
  await expect(chat.getByRole("button", { name: "Where do I park?" })).toBeVisible();
  await page.getByLabel("Colour of buttons").fill("#2B241F");
  await expect(page.getByText("On dark screens this colour gives way to cream, so the buttons stay visible.")).toBeVisible();
  await page.getByLabel("Colour of buttons").fill("#5B2A86");
  await expect(page.getByText("Text on it: white, 9.9 : 1")).toBeVisible();
  const pill = chat.getByRole("button", { name: "Where do I park?" });
  await expect.poll(() => pill.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgb(91, 42, 134)");

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect.poll(() => chat.locator("html").getAttribute("data-scheme")).toBe("dark");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Visitors see it once you publish.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ask the Riverside desk/ })).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

// Install (M9-T5): the code to add, filled in for the widget, and a check of a page of the customer's site.
test("the install code is filled in for the widget, and a page of the site is checked for it", async ({ page }) => {
  await signIn(page, "/widgets/w_gateway/install", await platformAdministrator(page, "installer"));
  await expect(page.getByText('<script async src="http://localhost:8200/loader.js" data-widget-id="w_gateway"></script>')).toBeVisible();
  await expect(page.getByText("script-src http://localhost:8200")).toBeVisible();

  const address = page.getByLabel("Page address");
  await address.fill("http://127.0.0.1:4174/hosts/gateway.html");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Yes: the chat's script tag is there")).toBeVisible();
  await expect(page.getByText("Yes: the page answers")).toBeVisible();

  await address.fill("http://127.0.0.1:4174/hosts/plain.html");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("No: the chat's script tag is there: add the script tag for this widget")).toBeVisible();

  await address.fill("https://elsewhere.example/");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("No: the page answers: the page is not on one of this widget's allowed sites")).toBeVisible();
  expect(await serious(page)).toEqual([]);
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

  await page.getByRole("button", { name: /Install/ }).click();
  await expect(page.getByText(`data-widget-id="${widget}"`)).toBeVisible();
  await page.getByRole("button", { name: /Go live/ }).click();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published. Version 1 is live")).toBeVisible();
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  info.annotations.push({ type: "onboarding time", description: `${minutes} minutes in the console, typed by a robot` });

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
