import { defineConfig, devices } from "@playwright/test";

// Design audit captures (L7). Runs the studio against the kit's fake server, like the e2e suite,
// with slower jobs so in-progress states stay on screen long enough to capture at every width.
// The classic project needs a running ima2 server: CLASSIC_URL=http://127.0.0.1:3333.
const FAKE_PORT = 8798;
const APP_PORT = 5198;

export default defineConfig({
  testDir: ".",
  testMatch: "*.audit.ts",
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // The live-updates stream keeps a request open, so never wait for network idle; bounded
  // action and navigation timeouts make a stuck cell fail (and get recorded) instead of hanging.
  use: {
    baseURL: "http://127.0.0.1:" + APP_PORT,
    trace: "off",
    reducedMotion: "reduce",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Journeys create jobs, so they run in their own invocation and never before the pristine studio cells.
    { name: "studio", testIgnore: ["classic.audit.ts", "journeys.audit.ts"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "journeys", testMatch: "journeys.audit.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "classic", testMatch: "classic.audit.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "node ../kit/src/fake/cli.ts",
      cwd: "..",
      env: { PORT: String(FAKE_PORT), FAKE_TIME_SCALE: process.env.FAKE_TIME_SCALE ?? "16" },
      url: "http://127.0.0.1:" + FAKE_PORT + "/api/media/catalog",
      reuseExistingServer: false,
    },
    {
      cwd: "..",
      command: "npx vite --host 127.0.0.1 --port " + APP_PORT + " --strictPort",
      env: { PORT: String(APP_PORT), IMA2_STUDIO_API: "http://127.0.0.1:" + FAKE_PORT },
      url: "http://127.0.0.1:" + APP_PORT,
      reuseExistingServer: false,
    },
  ],
});

