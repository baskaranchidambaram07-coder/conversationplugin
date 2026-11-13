import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The real chat through the real gateway (backend/devstack.py: the gateway, PostgreSQL and the fake PF), on a host
// page served by the test server. Run `npm run build` first. Locally the database is started for the run; in the
// pipeline it is a service container named by UCP_DATABASE_URL.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, "../.tools/ms-playwright");
const stack = process.env.CI
  ? "uv run python devstack.py"
  : "bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py";

export default defineConfig({
  testDir: "./gateway",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  webServer: [
    { command: "node server.mjs", url: "http://127.0.0.1:4174/hosts/plain.html", reuseExistingServer: !process.env.CI },
    {
      command: stack,
      cwd: "../backend",
      url: "http://127.0.0.1:8200/readyz",
      // Signed-in sessions last 5 seconds here, so a journey can outlive one and see it renewed.
      env: { FAKE_PF_SPEED: "0.2", UCP_SIGNED_IN_SECONDS: "5" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
