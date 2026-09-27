import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  // Spec files spread across three workers on CI; tests inside a file keep
  // their order. Every app gets its own mkdtemp home, loopback port 0 and
  // per-worker runtime build, so files share no state. The isolation project
  // stays serial and finishes before any journey starts (dependencies below):
  // one of its tests writes into the checkout that journey preflights scan.
  // Measured on the 4-vCPU runner (PR #334): serial 17.3m, three workers 9.1m,
  // four workers 12.1m, three workers with fully parallel journeys 12.4m (each
  // test runs an app server plus Chromium, and per-file beforeAll preflights
  // repeat on every worker). More speed needs more runners, not more workers.
  // Local runs stay serial. CI is set by GitHub itself: an IMA2_* or PW_TEST_*
  // variable would trip the J6 preflight (fixtures/appServer.ts assertJ6Isolation).
  fullyParallel: false,
  workers: process.env.CI ? 3 : 1,
  // Per-test durations in the CI log show where the suite spends its time.
  reporter: process.env.CI ? "list" : "line",
  projects: [
    { name: "isolation", testMatch: "fixture-isolation.spec.ts" },
    { name: "journeys", testIgnore: "fixture-isolation.spec.ts", dependencies: ["isolation"] },
  ],
  use: {
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
    trace: "off",
  },
});
