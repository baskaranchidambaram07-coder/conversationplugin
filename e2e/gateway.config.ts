import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The real chat through the real gateway (backend/devstack.py: the gateway, PostgreSQL and the fake PF), on a host
// page served by the test server. Run `npm run build` first. Locally the database is started for the run; in the
// pipeline it is a service container named by UCP_DATABASE_URL.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, "../.tools/ms-playwright");
const stack = process.env.CI
  ? "uv run python devstack.py"
  : "bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py";

// Voice (M11): Chromium's fake microphone plays this on a loop, a spoken question's stand-in: 1.6 s of a voice-like
// sound (a tone gliding between 220 and 440 Hz, its loudness rising and falling four times a second), then 2.4 s of
// silence, after which the chat knows the visitor has stopped. Written here, before Chromium starts.
const QUESTION = path.resolve(import.meta.dirname, "../node_modules/.cache/ucp-voice-question.wav");
function writeQuestion() {
  const rate = 16_000;
  const samples = new Int16Array(rate * 4);
  let phase = 0;
  for (let i = 0; i < rate * 1.6; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * (330 + 110 * Math.sin(2 * Math.PI * 0.7 * t))) / rate;
    samples[i] = Math.round(Math.sin(phase) * (0.35 + 0.25 * Math.sin(2 * Math.PI * 4 * t)) * 32767);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.byteLength, 40);
  mkdirSync(path.dirname(QUESTION), { recursive: true });
  writeFileSync(QUESTION, Buffer.concat([header, Buffer.from(samples.buffer)]));
}
writeQuestion();
const VOICE = /voice\.spec\.ts/;

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
      env: { FAKE_PF_SPEED: "0.2", UCP_SIGNED_IN_SECONDS: "5", UCP_SPEECH: "fake" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "chromium", testIgnore: VOICE, use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testIgnore: VOICE, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: VOICE, use: { ...devices["Desktop Safari"] } },
    {
      name: "voice",
      testMatch: VOICE,
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-GB",
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${QUESTION}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
});
