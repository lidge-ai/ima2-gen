import { test, expect, type Page } from "@playwright/test";
import { openStaticApp, STATIC_ORIGIN } from "./fixtures/staticClassicApp";

// Every destination of the navigation makes its reads when it is left to finish mounting, and each
// of those reads has a fixture (ui/e2e/fixtures/j6Catalog.ts). A journey that clicks through the
// destinations quickly usually leaves before the later reads start; when it does not, a read without
// a fixture is refused and fails that journey. This spec waits for the late reads on purpose.
// The built UI runs on a synthetic origin with fixture answers only: no app server.

const LATE_READS: Record<string, string[]> = {
  // The quota card asks 1.5 s after Settings opens.
  Settings: ["/api/quota"],
  Assets: ["/api/assets/folders", "/api/assets/tags"],
  "Asset Gen": ["/api/assets/folders"],
};

async function visit(page: Page, label: string): Promise<void> {
  const reads = (LATE_READS[label] ?? []).map((path) => page.waitForRequest((request) => new URL(request.url()).pathname === path, { timeout: 15_000 }));
  await page.locator(".nav-rail--mobile").getByRole("button", { name: label, exact: true }).click();
  await Promise.all(reads);
  await page.waitForLoadState("networkidle");
}

test("every destination's reads have a fixture, also the ones that start late", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 320, height: 844 } });
  try {
    await app.page.goto(STATIC_ORIGIN + "/");
    await expect(app.page.locator(".nav-rail--mobile").getByRole("button")).toHaveCount(7);
    // Agent is left out: opened without a session it creates one, which is a write, so it needs a
    // journey and fixtures of its own (none of the J6 journeys opens it).
    for (const label of ["Settings", "Home", "Create", "Node graph", "Assets", "Asset Gen", "Home"]) await visit(app.page, label);
    expect(app.unexpected).toEqual([]);
    expect(app.errors).toEqual([]);
  } finally { await app.close(); }
});
