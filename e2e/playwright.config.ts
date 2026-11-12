import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The browsers live inside the project folder, so nothing is left elsewhere on the machine.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, "../.tools/ms-playwright");

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Serves the built loader and chat, so run `npm run build` first.
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4174/hosts/plain.html",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
