import { defineConfig, devices } from "@playwright/test";

// Screen-level tests run the studio against the kit's fake server, never a real provider.
const FAKE_PORT = 8799;
const APP_PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:" + APP_PORT, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "node ../kit/src/fake/cli.ts",
      env: { PORT: String(FAKE_PORT), FAKE_TIME_SCALE: "2" },
      url: "http://127.0.0.1:" + FAKE_PORT + "/api/media/catalog",
      reuseExistingServer: false,
    },
    {
      command: "npx vite --host 127.0.0.1",
      env: { PORT: String(APP_PORT), IMA2_STUDIO_API: "http://127.0.0.1:" + FAKE_PORT },
      url: "http://127.0.0.1:" + APP_PORT,
      reuseExistingServer: false,
    },
  ],
});
