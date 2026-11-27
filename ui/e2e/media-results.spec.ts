import { test, expect, type Browser, type Page } from "@playwright/test";
import { openCreateScreen, openStaticApp } from "./fixtures/staticClassicApp";
import { mediaHistoryRow, type MediaFixture } from "./fixtures/mediaModels";

// Results made with media models: what the result says about how it was made, and making it again.
// The built UI runs on a synthetic origin with fixture answers only: no app server, no provider.

const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const composer = (page: Page) => page.locator(".composer:visible .composer__textarea");
const actions = (page: Page) => page.locator(".result-actions:visible").first();

function run(rows: Record<string, unknown>[], body: (page: Page, media: MediaFixture) => Promise<void>) {
  return async ({ browser }: { browser: Browser }) => {
    const app = await openStaticApp(browser, { storage: { "ima2.selectedFilename": String(rows[0]!.filename) } });
    app.media.history.push(...rows);
    try {
      await openCreateScreen(app.page);
      await body(app.page, app.media);
      expect(app.unexpected).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.close(); }
  };
}

test("L11-R1 a media result shows its route, settings and cost, and Make again restores them without sending anything", run([mediaHistoryRow()], async (page, media) => {
  // Showing a result asks for no media data; opening its details is what loads the catalog names.
  await expect(actions(page).getByRole("button", { name: "Info", exact: true })).toBeVisible();
  expect(media.mediaReads()).toBe(0);
  await actions(page).getByRole("button", { name: "Info", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Generation Details" });
  await expect(details).toContainText("fal");
  await expect(details.locator(".metadata-modal__summary")).not.toContainText("media:");
  for (const text of ["Route", "Aggregator", "Resolution", "2K", "Aspect ratio", "16:9", "Seed", "Billed (reported by the provider)", "$0.07"]) await expect(details).toContainText(text);
  await page.keyboard.press("Escape");

  await actions(page).getByRole("button", { name: "Make again", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Model, settings and prompt restored. Check the estimate, then press Generate.");
  await expect(card(page)).toContainText("FLUX.2 Pro");
  await expect(card(page).getByRole("radio", { name: /^fal/ })).toBeChecked();
  await expect(card(page).getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).getByLabel("Seed")).toHaveValue("7");
  await expect(card(page).locator(".media-estimate")).toContainText("$0.07");
  await expect(composer(page)).toHaveValue("a lighthouse at dusk, film grain");
  expect(media.submissions).toEqual([]);
}));

test("L11-R2 a result whose model left the catalog says so instead of restoring something else", run([mediaHistoryRow({ model: "acme/retired", filename: "l11-retired.png", url: "/generated/l11-retired.png" })], async (page, media) => {
  await actions(page).getByRole("button", { name: "Make again", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("This model is no longer in the catalog, so it cannot be made again here.");
  await expect(card(page).getByRole("button", { name: "Browse models" })).toBeVisible();
  expect(media.submissions).toEqual([]);
}));

test("L11-R4 a result made at a chosen quality shows it and Make again restores it", run([mediaHistoryRow({ model: "openai/gpt-image-2", media: { task: "text-to-image", durationSec: null, resolution: "1K", quality: "high", aspectRatio: null, seed: null, audio: null, inputRoles: [] }, billed: null, estimate: { usd: 0.2108, basis: "exact" } })], async (page, media) => {
  await actions(page).getByRole("button", { name: "Info", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Generation Details" });
  for (const text of ["GPT Image 2", "Quality", "High"]) await expect(details).toContainText(text);
  await expect(details).not.toContainText("deprecated");
  await page.keyboard.press("Escape");
  await actions(page).getByRole("button", { name: "Make again", exact: true }).click();
  await expect(card(page).locator(".option-group", { has: page.getByText("Quality", { exact: true }) }).getByRole("button", { name: "High", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).locator(".media-estimate .price")).toHaveText("$0.211");
  expect(media.submissions).toEqual([]);
}));

test("L11-R3 a result from a built-in provider has no Make again and no media lines", run([mediaHistoryRow({ provider: "oauth", model: "gpt-6-luna", adapter: null, route: null, media: null, billed: null, estimate: null })], async (page) => {
  await expect(actions(page).getByRole("button", { name: "Info", exact: true })).toBeVisible();
  await expect(actions(page).getByRole("button", { name: "Make again", exact: true })).toHaveCount(0);
  await actions(page).getByRole("button", { name: "Info", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Generation Details" });
  await expect(details).not.toContainText("Billed (reported by the provider)");
  await expect(details).not.toContainText("Route");
}));
