import { test, expect, type Browser, type Page } from "@playwright/test";
import { MODEL_CONTROL, openCreateScreen, openStaticApp, type StaticAppOptions } from "./fixtures/staticClassicApp";
import type { MediaFixture } from "./fixtures/mediaModels";

// The classic studio's media models: choosing one in the model window, its settings, and what is sent.
// The built UI runs on a synthetic origin with fixture answers only: no app server, no provider.

const MODEL_TRIGGER = MODEL_CONTROL;
const PROMPT = "a paper boat on a rainy street";
const dialog = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });
const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const composer = (page: Page) => page.locator(".composer:visible .composer__textarea");
const count = (page: Page) => dialog(page).locator(".media-count");
const row = (page: Page, id: string) => dialog(page).locator('.media-row[data-model="' + id + '"]').first();

async function openWindow(page: Page): Promise<void> {
  await page.locator(MODEL_TRIGGER).click();
  await page.getByRole("option", { name: "All models…", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

async function pick(page: Page, kind: "Image" | "Video", id: string): Promise<void> {
  await dialog(page).getByRole("group", { name: "Output" }).getByRole("button", { name: kind, exact: true }).click();
  await row(page, id).click();
  await expect(dialog(page)).toHaveCount(0);
}

function run(options: StaticAppOptions, body: (page: Page, media: MediaFixture) => Promise<void>) {
  return async ({ browser }: { browser: Browser }) => {
    const app = await openStaticApp(browser, options);
    try {
      await openCreateScreen(app.page);
      await body(app.page, app.media);
      // Nothing outside the fixtures was asked for, and nothing threw in the page.
      expect(app.unexpected).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.close(); }
  };
}

test("L11-M1 no media request before the model window opens; picking a model keeps the prompt", run({}, async (page, media) => {
  await composer(page).fill(PROMPT);
  await expect(card(page).getByRole("button", { name: "Browse models" })).toBeVisible();
  expect(media.mediaReads()).toBe(0);

  await openWindow(page);
  await expect.poll(() => media.mediaReads()).toBe(1);
  // Opened with no reference image: image from text, models the saved key can run first.
  await expect(dialog(page).getByRole("group", { name: "Task" }).getByRole("button", { name: "From text" })).toHaveAttribute("aria-pressed", "true");
  const ready = dialog(page).getByRole("region", { name: "Ready with your keys" });
  await expect(ready.locator('[data-model="black-forest-labs/flux-2-pro"]')).toBeVisible();
  const needsKey = dialog(page).getByRole("region", { name: "Needs a key (add it after picking)" });
  await expect(needsKey.locator('[data-model="openai/gpt-image-2.5"]')).toBeVisible();
  await expect(needsKey.locator('[data-model="black-forest-labs/flux-2-pro"]')).toHaveCount(0);
  // Each row carries the same comparable facts.
  await expect(ready.locator('[data-model="google/nano-banana-pro"]')).toContainText("from $0.15/image");
  await expect(ready.locator('[data-model="google/nano-banana-pro"]')).toContainText("1K–4K");

  await pick(page, "Video", "bytedance/seedance-2.5");
  await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("Seedance 2.5");
  await expect(composer(page)).toHaveValue(PROMPT);
  await expect(card(page)).toContainText("Seedance 2.5");
  // Only the saved fal key exists, so Automatic runs fal and says so.
  await expect(card(page).getByRole("radio", { name: /^Automatic/ })).toBeChecked();
  await expect(card(page)).toContainText("Now: fal (BytePlus ModelArk direct needs a key)");
  // Settings list only what the fal route publishes: 480p and 720p, no 1080p.
  await expect(card(page).getByRole("button", { name: "720p", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).getByRole("button", { name: "1080p", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("Seedance 2.5");
  await expect(card(page)).toContainText("Now: fal");
}));

test("L11-M2 search, feature chips and sorting narrow the list; suggestions say why", run({}, async (page, media) => {
  await openWindow(page);
  await dialog(page).getByRole("group", { name: "Output" }).getByRole("button", { name: "Video", exact: true }).click();
  await expect(count(page)).toHaveText("6 of 6");
  const suggested = dialog(page).getByRole("region", { name: "Suggested" });
  await expect(suggested.locator('[data-model="kling/kling-4.0-turbo"]')).toContainText("Lowest price your keys can run");
  // A suggested model is listed once: six models, six rows.
  await expect(dialog(page).locator(".media-row[data-model]")).toHaveCount(6);
  // Every row starts with the same square mark, symbol or monogram.
  const marks = await dialog(page).locator(".media-row .media-mark").evaluateAll((items) => [...new Set(items.map((item) => item.clientWidth + "x" + item.clientHeight))]);
  expect(marks).toEqual(["32x32"]);
  await dialog(page).getByRole("searchbox", { name: "Search models" }).fill("kling");
  await expect(count(page)).toHaveText("2 of 6");
  await expect(suggested).toHaveCount(0);
  await dialog(page).getByRole("searchbox", { name: "Search models" }).fill("zzz");
  await expect(dialog(page)).toContainText("No model matches.");
  await dialog(page).getByRole("button", { name: "Clear search and filters" }).click();
  await dialog(page).getByRole("group", { name: "Show only" }).getByRole("button", { name: "Runs with my keys" }).click();
  await expect(count(page)).toHaveText("4 of 6");
  await expect(dialog(page).getByRole("region", { name: "Needs a key (add it after picking)" })).toHaveCount(0);
  await dialog(page).getByLabel("Sort").selectOption("price");
  await expect(dialog(page).locator(".media-row[data-model]").first()).toHaveAttribute("data-model", "kling/kling-4.0-turbo");
  // Models this composer cannot feed are listed with the reason instead of vanishing.
  await dialog(page).getByRole("group", { name: "Show only" }).getByRole("button", { name: "Runs with my keys" }).click();
  await dialog(page).getByText("Not available in this composer (2)").click();
  await expect(dialog(page).locator(".media-unsupported")).toContainText("Lipsync 3");
  expect(media.submissions).toEqual([]);
}));

test("L11-M3 switching model keeps what fits, names what moved, and a pinned route stays pinned", run({}, async (page, media) => {
  media.keys.add("byteplus");
  await composer(page).fill(PROMPT);
  await openWindow(page);
  await pick(page, "Video", "bytedance/seedance-2.5");
  // With a direct key, Automatic prefers the direct route over the aggregator.
  await expect(card(page)).toContainText("Now: BytePlus ModelArk");
  await card(page).getByRole("button", { name: "1080p", exact: true }).click();
  await card(page).getByRole("radio", { name: /^Sume/ }).check();
  await expect(card(page)).toContainText("Sume needs an API key before this can run.");
  await expect(card(page).getByRole("button", { name: "1080p", exact: true })).toHaveAttribute("aria-pressed", "true");
  await card(page).getByRole("button", { name: "Change model" }).click();
  await pick(page, "Video", "kling/kling-4.0-turbo");
  await expect(card(page)).toContainText("Changed to fit this model");
  await expect(card(page)).toContainText("Resolution: 1080p → 720p");
  await expect(composer(page)).toHaveValue(PROMPT);
  await card(page).getByRole("button", { name: "Back to built-in" }).click();
  await expect(card(page).getByRole("button", { name: "Browse models" })).toBeVisible();
  await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("6l");
}));

test("L11-M4 generate sends the shown route and only listed settings", run({}, async (page, media) => {
  await composer(page).fill(PROMPT);
  await openWindow(page);
  await pick(page, "Video", "bytedance/seedance-2.5");
  await card(page).getByRole("button", { name: "480p", exact: true }).click();
  await page.locator(".generate-btn:visible").click();
  await expect.poll(() => media.submissions.length).toBe(1);
  const sent = media.submissions[0]!;
  expect(sent).toMatchObject({ model: "bytedance/seedance-2.5", adapter: "fal", task: "text-to-video", prompt: PROMPT, durationSec: 5, resolution: "480p", inputs: [] });
  expect(Object.keys(sent)).not.toContain("aspectRatio");
  expect(Object.keys(sent)).not.toContain("routeMode");
  await media.emit(page, "done", String(sent.requestId), { outputs: [{ filename: "l11-clip.png", url: "/generated/l11-clip.png", mediaType: "image" }] });
  await expect(page.locator(".in-flight-item, .in-flight-rich-item")).toHaveCount(0);
}));

test("L11-M5 a catalog that fails to load says so and recovers; Escape returns focus to the model control", run({}, async (page, media) => {
  media.catalogMode = "error";
  await openWindow(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Could not load media models.");
  await expect(dialog(page).getByRole("alert")).toContainText("The built-in providers still work.");
  media.catalogMode = "ready";
  await dialog(page).getByRole("button", { name: "Try again" }).click();
  await expect(dialog(page).getByRole("region", { name: "Ready with your keys" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(MODEL_TRIGGER)).toBeFocused();
}));

test("L11-M6 at 390 wide the model window is a full sheet with no sideways scroll", run({ viewport: { width: 390, height: 844 } }, async (page) => {
  await openWindow(page);
  const box = await dialog(page).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const overflow = await dialog(page).locator(".media-row[data-model]").evaluateAll((rows) => rows.filter((item) => item.scrollWidth > item.clientWidth + 1).length);
  expect(overflow).toBe(0);
  const close = await dialog(page).getByRole("button", { name: "Close" }).boundingBox();
  expect(close!.width).toBeGreaterThanOrEqual(44);
  expect(close!.height).toBeGreaterThanOrEqual(44);
  await pick(page, "Image", "black-forest-labs/flux-2-pro");
  await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("FLUX.2 Pro");
}));
