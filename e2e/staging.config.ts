import { execFileSync } from "node:child_process";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The real chat through the real gateway, answering from PF staging (backend/devstack.py --pf staging), so the leak
// search sees real PF identifiers pass through. This machine only: the PF_* settings come from .env, which is never
// printed, and each run costs real answers. Run `npm run build` first, then `npm run e2e:staging`.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, "../.tools/ms-playwright");
const backend = path.resolve(import.meta.dirname, "../backend");
// .env is read the way the gateway reads it (uv), not with Node's parser, which reads some values differently.
const read = "import json, os; print(json.dumps({k: v for k, v in os.environ.items() if k.startswith('PF_')}))";
const settings = execFileSync("uv", ["run", "--env-file", "../.env", "python", "-c", read], { cwd: backend });
Object.assign(process.env, JSON.parse(settings.toString()));

export default defineConfig({
  testDir: "./staging",
  timeout: 240_000,
  reporter: "list",
  webServer: [
    { command: "node server.mjs", url: "http://127.0.0.1:4174/hosts/plain.html", reuseExistingServer: true },
    {
      command: "bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py --pf staging",
      cwd: "../backend",
      url: "http://127.0.0.1:8200/readyz",
      reuseExistingServer: false, // never a gateway already running, which may answer from the fake PF
      timeout: 120_000,
    },
  ],
  // One engine: what the gateway sends does not depend on the browser, and each run costs real answers.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
