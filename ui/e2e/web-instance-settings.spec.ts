import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStaticApp, STATIC_ORIGIN, type StaticApp } from "./fixtures/staticClassicApp";

// Settings on the shared web instance against Settings on a person's own computer. The web
// instance's sign-in gate (lib/webAccess) leaves a readable ima2_web_user cookie; with it, the
// sections that drive this computer (subscription sign-in, MCP providers, ComfyUI) are not shown,
// because the server refuses their calls there. Without it nothing changes.

const SHOTS = process.env.L9_SHOTS;
const SUBSCRIPTION_CARDS = ["GPT OAuth", "Grok", "Gemini (agy)"];

async function openSettings(app: StaticApp): Promise<Page> {
  await app.page.goto(STATIC_ORIGIN + "/#settings");
  await expect(app.page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible();
  return app.page;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name + ".png") });
}

test("on a person's own computer, Settings shows subscription sign-in, MCP providers and ComfyUI", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 1440, height: 900 } });
  try {
    const page = await openSettings(app);
    for (const name of SUBSCRIPTION_CARDS) await expect(page.locator(".provider-card h4", { hasText: name }).first()).toBeVisible();
    await expect(page.locator("#mcp-provider-connections-title")).toBeVisible();
    await expect(page.locator("#comfy-workflow-manager-title")).toBeVisible();
    await expect(page.locator("#web-instance-settings-note")).toHaveCount(0);
    await shot(page, "settings-local");
  } finally { await app.close(); }
});

test("on the shared web instance, Settings leaves out what only works on the host and says so", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 1440, height: 900 } });
  try {
    await app.context.addCookies([
      { name: "ima2_web_user", value: encodeURIComponent("person@example.com"), url: STATIC_ORIGIN },
      { name: "ima2_web_auth", value: "google", url: STATIC_ORIGIN },
    ]);
    const page = await openSettings(app);
    await expect(page.locator("#web-instance-settings-note")).toBeVisible();
    await expect(page.locator("#web-instance-settings-note")).toContainText("shared web instance");
    for (const name of SUBSCRIPTION_CARDS) await expect(page.locator(".provider-card h4", { hasText: name })).toHaveCount(0);
    await expect(page.locator("#mcp-provider-connections-title")).toHaveCount(0);
    await expect(page.locator("#comfy-workflow-manager-title")).toHaveCount(0);
    await expect(page.getByText("ComfyUI address")).toHaveCount(0);
    // The rest of the Providers section stays.
    await expect(page.getByRole("button", { name: "Check readiness" })).toBeVisible();
    await shot(page, "settings-web-instance");
  } finally { await app.close(); }
});
