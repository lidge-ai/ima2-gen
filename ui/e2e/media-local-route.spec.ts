import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MODEL_CONTROL, openCreateScreen, openStaticApp, type StaticLocale } from "./fixtures/staticClassicApp";

// A model that runs on the user's own machine (route "local"): the classic studio says where it runs,
// that it needs no key and that no provider charges for it, instead of "no published price".
// The built UI runs on a synthetic origin with fixture answers only.

const MODEL = "comfy/flux2-klein";
const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const SHOTS = process.env.L13_SHOTS;

async function pickLocal(page: Page): Promise<void> {
  await page.locator(MODEL_CONTROL).click();
  // "All models…" in the page's language: the one option that opens the model window.
  await page.getByRole("option").filter({ hasText: "…" }).first().click();
  const row = dialog(page).locator('.media-row[data-model="' + MODEL + '"]');
  // The output tabs are named in the page's language; the image tab is the one that lists this model.
  const tabs = dialog(page).locator(".media-tabs").first().locator("button");
  for (let index = 0; index < await tabs.count() && await row.count() === 0; index += 1) await tabs.nth(index).click();
  await row.first().click();
  await expect(dialog(page)).toHaveCount(0);
}

async function open(browser: Browser, locale: StaticLocale, viewport: { width: number; height: number }) {
  const app = await openStaticApp(browser, { locale, viewport, localRoute: true });
  await openCreateScreen(app.page);
  return app;
}

test("a local model says it runs on this computer, needs no key and has no provider charge", async ({ browser }) => {
  const app = await open(browser, "en", { width: 1440, height: 900 });
  try {
    await app.page.locator(".composer:visible .composer__textarea").fill("a paper boat on a rainy street");
    await pickLocal(app.page);
    const route = card(app.page).locator(".media-route");
    await expect(route).toContainText("ComfyUI (this computer)");
    await expect(route.locator(".media-route__key")).toHaveText("No key needed");
    await expect(route.locator("small")).toHaveText("This computer · No provider charge");
    const estimate = card(app.page).locator(".media-estimate");
    await expect(estimate.locator(".price")).toHaveText("No provider charge");
    await expect(estimate.locator("small")).toHaveText("Runs on your own machine through ComfyUI (this computer). No provider bills this.");
    await expect(estimate).not.toContainText("No published price");
    await expect(app.page.locator(".generate-row__media:visible")).toHaveText("FLUX.2 klein (my workflow) · runs on this computer");
    await expect(app.page.locator(".generate-btn:visible")).toBeEnabled();
    expect(app.unexpected).toEqual([]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

for (const locale of ["en", "ko"] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test("local model settings render at " + String(viewport.width) + " in " + locale, async ({ browser }, info) => {
      const app = await open(browser, locale, viewport);
      try {
        await pickLocal(app.page);
        // The model control is on every width; the settings card and the line beside Generate are on wide screens only.
        await expect(app.page.locator(MODEL_CONTROL)).toContainText("FLUX.2 klein");
        if (viewport.width >= 1024) {
          await expect(app.page.locator(".generate-row__media:visible")).toContainText("FLUX.2 klein (my workflow)");
          const estimate = card(app.page).locator(".media-estimate");
          await expect(estimate).toBeVisible();
          await estimate.scrollIntoViewIfNeeded();
        }
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no sideways scroll").toBe(true);
        const name = "local-route-" + locale + "-" + String(viewport.width) + ".png";
        await app.page.screenshot({ path: info.outputPath(name) });
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await app.page.screenshot({ path: join(SHOTS, name) }); }
        expect(app.errors).toEqual([]);
      } finally {
        await app.close();
      }
    });
  }
}
