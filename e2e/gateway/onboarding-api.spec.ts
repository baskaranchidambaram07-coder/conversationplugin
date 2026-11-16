import { type APIRequestContext, expect, test } from "@playwright/test";

// M8's done condition: the onboarding journey through the admin API, end to end. The operator (a platform
// administrator) creates a tenant and its administrator; that administrator sets the tenant's own PF connection
// profile, tests it, creates and publishes a widget; a visitor chats with it on the customer's page; the audit log
// tells the whole story. The stack (backend/devstack.py) signs administrators in through a stand-in company identity
// provider and answers from the fake PF.
const ADMIN = "http://127.0.0.1:8201/admin/v1";
const PAGE = "http://127.0.0.1:4174/hosts/gateway-any.html";
const FAKE_PF = {
  base_url: "http://127.0.0.1:8100",
  tenant: "fake-tenant",
  workspace_id: "fake-workspace",
  agent_version_id: "fake-agent-version",
  api_key: "fake-api-key",
  username: "fake-user",
  password: "fake-password",
};

async function signIn(request: APIRequestContext, subject: string) {
  const reply = await request.get(`http://127.0.0.1:8300/token?sub=${subject}`);
  const headers = { authorization: `Bearer ${(await reply.json()).token}` };
  return async (method: "GET" | "POST" | "PUT", path: string, data?: object) => {
    const response = await request.fetch(`${ADMIN}${path}`, { method, headers, data });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
}

test("an operator onboards a customer through the admin API; a visitor chats on the customer's page", async ({
  page,
  request,
}, info) => {
  const run = `${info.project.name}-${Date.now().toString(36)}`;
  const operator = await signIn(request, "onboarding-operator");
  const { tenant_id: tenant } = await operator("POST", "/tenants", { name: `Riverside ${run}` });
  const manager = `riverside-admin-${run}`;
  await operator("POST", "/administrators", { subject: manager, role: "tenant", tenant_id: tenant });

  const admin = await signIn(request, manager);
  expect(await admin("GET", "/me")).toEqual({ subject: manager, role: "tenant", tenant_id: tenant, gateway: "http://localhost:8200" });
  await admin("PUT", `/tenants/${tenant}/agent-profiles/fake-pf`, FAKE_PF);
  expect(await admin("POST", `/tenants/${tenant}/agent-profiles/fake-pf/test`)).toEqual({ connected: true });
  const title = `Ask Riverside ${run.slice(-4)}`;
  const document = {
    public: {
      title,
      welcome_message: "Hello. Ask me anything about Riverside.",
      suggested_prompts: ["What are your opening hours?"],
      ai_notice: null,
      brand_color: "#1F6F5C",
      logo_url: null,
      color_scheme: "light",
      launcher_position: "bottom-left",
      history_enabled: false,
    },
    allowed_domains: ["http://127.0.0.1:4174"],
    sign_in: "anonymous",
    agent_profile: "fake-pf",
  };
  const { widget_id: widgetId, revision } = await admin("POST", `/tenants/${tenant}/widgets`, { document });
  expect(await admin("POST", `/widgets/${widgetId}/publish`, { revision })).toEqual({ version: 1 });

  await page.goto(`${PAGE}?widget=${widgetId}`);
  const launcher = page.getByRole("button", { name: title });
  await expect(launcher).toBeVisible();
  expect((await launcher.boundingBox())!.x).toBeLessThan(200); // bottom-left, as configured
  await launcher.click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await expect(chat.getByRole("heading", { name: title })).toBeVisible();
  await chat.getByRole("button", { name: "What are your opening hours?" }).click();
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();

  const story = (await admin("GET", `/audit?tenant=${tenant}`)) as { action: string; actor: string }[];
  expect(story.map((entry) => `${entry.actor} ${entry.action}`).reverse()).toEqual([
    "onboarding-operator tenant.create",
    "onboarding-operator administrator.add",
    `${manager} profile.set`,
    `${manager} widget.create`,
    `${manager} publish`,
  ]);
});
