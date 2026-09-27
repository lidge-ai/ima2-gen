import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  // Spec files spread across workers on CI; tests inside a file keep their order.
  // Every app gets its own mkdtemp home, loopback port 0 and per-worker runtime
  // build, so files do not share state. The isolation project still finishes
  // before any journey starts (dependencies below). Local runs stay serial.
  // CI is set by GitHub itself: an IMA2_* or PW_TEST_* variable would trip the
  // J6 preflight (fixtures/appServer.ts assertJ6Isolation).
  fullyParallel: false,
  workers: process.env.CI ? 4 : 1,
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
