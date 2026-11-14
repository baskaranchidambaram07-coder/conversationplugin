import { execFileSync } from "node:child_process";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The browser leak search (e2e/staging/leak.spec.ts) against a deployed gateway answering from PF staging: the host
// page comes from this machine's test server, the loader, chat and answers from AWS. The widget is the dev
// environment's smoke widget, allowed on http://127.0.0.1:4174 (backend/deploy/widgets.dev.json). Then the College's
// samples as we host them, on their own site (e2e/staging/hosted-samples.spec.ts).
//   npm run e2e:deployed        (with the environment awake: python infra/aws/dev.py wake)
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, "../.tools/ms-playwright");
const backend = path.resolve(import.meta.dirname, "../backend");
// The PF settings to search for, read the way the gateway reads them (uv), never printed.
const read = "import json, os; print(json.dumps({k: v for k, v in os.environ.items() if k.startswith('PF_')}))";
const settings = execFileSync("uv", ["run", "--env-file", "../.env", "python", "-c", read], { cwd: backend });
Object.assign(process.env, JSON.parse(settings.toString()));
// The address browsers use, as the newest release tells the gateway: it changes only when the environment is rebuilt.
process.env.UCP_GATEWAY_URL ??= execFileSync("python", ["../infra/aws/deploy.py", "--url"], { cwd: backend }).toString().trim();
process.env.UCP_SAMPLES_URL ??= execFileSync("python", ["../infra/aws/deploy.py", "--samples-url"], { cwd: backend })
  .toString()
  .trim();
process.env.UCP_WIDGET ??= "w_smoke";
process.env.UCP_WIDGET_TITLE ??= "UCP smoke test";

export default defineConfig({
  testDir: "./staging",
  timeout: 240_000,
  reporter: "list",
  webServer: [
    { command: "node server.mjs", url: "http://127.0.0.1:4174/hosts/plain.html", reuseExistingServer: true },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
