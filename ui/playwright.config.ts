import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  // Journeys run in parallel on CI: every test starts its own app (mkdtemp home,
  // loopback port 0, per-worker runtime build) and spec files hold only
  // constants at module level, so tests share no state. The isolation project
  // stays serial and finishes before any journey starts (dependencies below):
  // one of its tests writes into the checkout that journey preflights scan.
  // Three workers, not four: each test runs an app server plus Chromium, and on
  // the 4-vCPU runner a fourth worker measured slower (12.1m vs 9.1m).
  // Local runs stay serial. CI is set by GitHub itself: an IMA2_* or PW_TEST_*
  // variable would trip the J6 preflight (fixtures/appServer.ts assertJ6Isolation).
  fullyParallel: false,
  workers: process.env.CI ? 3 : 1,
  // Per-test durations in the CI log show where the suite spends its time.
  reporter: process.env.CI ? "list" : "line",
  projects: [
    { name: "isolation", testMatch: "fixture-isolation.spec.ts" },
    { name: "journeys", testIgnore: "fixture-isolation.spec.ts", dependencies: ["isolation"], fullyParallel: true },
  ],
  use: {
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
    trace: "off",
  },
});
