import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// M8's onboarding journey, end to end: an operator creates a widget, configures it in a file, publishes it with the
// command (python -m ucp.widgets), embeds it on a customer's page with one script tag, and a visitor chats. The
// stack under test (backend/devstack.py) answers from the fake PF.
const BACKEND = path.resolve(import.meta.dirname, "../../backend");
const PAGE = "http://127.0.0.1:4174/hosts/gateway-any.html";

let database: string | undefined;

/** The database the stack under test uses: the pipeline names it; on this machine it is the test database. */
function databaseUrl(): string {
  const read = "import os; print(os.environ['TEST_DATABASE_URL'], end='')"; // kept in memory, never printed
  database ??=
    process.env.UCP_DATABASE_URL ??
    execFileSync("uv", ["run", "--env-file", "../.env", "python", "-c", read], { cwd: BACKEND, encoding: "utf8" });
  return database;
}

/** The operator's command, run as a person would run it. */
function widgets(...args: string[]): string {
  const env = { ...process.env, UCP_DATABASE_URL: databaseUrl() };
  return execFileSync("uv", ["run", "python", "-m", "ucp.widgets", ...args], { cwd: BACKEND, env, encoding: "utf8" });
}

test("an operator creates, configures and publishes a widget; a visitor chats with it on the customer's page", async ({
  page,
}, info) => {
  test.slow(); // four runs of the operator's command, each starting Python
  const widgetId = widgets("new-id").trim();
  const title = `Ask Riverside ${widgetId.slice(-4)}`;
  const file = info.outputPath("widgets.json");
  const configuration = {
    widgets: {
      [widgetId]: {
        tenant_id: "t_riverside",
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
      },
    },
  };
  writeFileSync(file, JSON.stringify(configuration, null, 2));

  expect(widgets("seed", file, "--by", "onboarding-journey").trim()).toBe(`${widgetId}: version 1`);

  await page.goto(`${PAGE}?widget=${widgetId}`);
  const launcher = page.getByRole("button", { name: title });
  await expect(launcher).toBeVisible();
  expect((await launcher.boundingBox())!.x).toBeLessThan(200); // bottom-left, as configured
  await launcher.click();
  const chat = page.frameLocator("[data-ucp] iframe");
  await expect(chat.getByRole("heading", { name: title })).toBeVisible();
  await chat.getByRole("button", { name: "What are your opening hours?" }).click();
  await expect(chat.getByRole("article").getByText("READY", { exact: true })).toBeVisible();

  expect(widgets("versions", widgetId)).toMatch(/^1 {2}\S+ \S+ UTC {2}onboarding-journey$/m);
  expect(widgets("audit", "--widget", widgetId)).toContain(`onboarding-journey  publish  ${widgetId} version 1`);
});
