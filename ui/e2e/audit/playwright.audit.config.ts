import { defineConfig } from "@playwright/test";

// Screenshot capture only; kept out of the e2e run (playwright.config.ts matches *.spec.ts).
export default defineConfig({
  testDir: ".",
  testMatch: "*.audit.ts",
  timeout: 180_000,
  workers: 2,
  reporter: "line",
  use: { serviceWorkers: "block", trace: "off" },
});
