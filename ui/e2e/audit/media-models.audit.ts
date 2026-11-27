import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mediaHistoryRow } from "../fixtures/mediaModels";
import { openCreateScreen, openStaticApp, type StaticApp, type StaticLocale } from "../fixtures/staticClassicApp";

// Render capture for the classic media model surfaces: screen x state x width x locale.
// Not part of the e2e suite (see playwright.audit.config.ts); it only writes screenshots to look at.
//   L11_SHOTS=<dir> npx playwright test -c e2e/audit/playwright.audit.config.ts

const OUT = process.env.L11_SHOTS ?? join(process.cwd(), "test-results", "l11-shots");
const WIDTHS = (process.env.L11_WIDTHS ?? "1440,768,390").split(",").map(Number);
const LOCALES = (process.env.L11_LOCALES ?? "ko,en").split(",") as StaticLocale[];
const HEIGHT: Record<number, number> = { 1440: 900, 768: 1024, 390: 844 };
const PROMPT: Record<string, string> = { ko: "비 오는 골목을 떠내려가는 종이배", en: "a paper boat on a rainy street" };

class Stage {
  constructor(readonly app: StaticApp, readonly width: number, readonly locale: string) {}
  get page(): Page { return this.app.page; }
  get mobile(): boolean { return this.width <= 800; }
  get window() { return this.page.locator(".media-dialog"); }
  get card() { return this.page.locator(this.mobile ? "#mobile-generate-sheet .media-card" : "#right-panel-tab-settings .media-card"); }
  async shot(state: string): Promise<void> {
    await this.page.evaluate(async () => { await document.fonts.ready; });
    await this.page.waitForTimeout(150);
    await this.page.screenshot({ path: join(OUT, state + "__" + this.width + "__" + this.locale + ".png") });
  }
  /** The model card lives in the right panel on desktop and in the compose sheet's settings tab on a phone. */
  async showCard(): Promise<void> {
    if (!this.mobile) return;
    const sheet = this.page.locator("#mobile-generate-sheet");
    if ((await sheet.getAttribute("aria-hidden")) !== "false") await this.page.locator("button.mobile-app-bar__generate").click();
    await sheet.locator("[role=tab]").nth(1).click();
    await expect(this.card).toBeVisible();
  }
  async openWindow(): Promise<void> {
    await this.showCard();
    await this.card.locator(".media-picker__open").first().click();
    await expect(this.window).toBeVisible();
  }
  async kind(index: 0 | 1): Promise<void> { await this.window.locator(".media-tabs").first().locator("button").nth(index).click(); }
  async pick(id: string): Promise<void> {
    await this.window.locator('.media-row[data-model="' + id + '"]').first().click();
    await expect(this.window).toHaveCount(0);
  }
  async closeWindow(): Promise<void> { await this.window.locator(".media-dialog__close").click(); await expect(this.window).toHaveCount(0); }
}

async function captureAll(stage: Stage): Promise<void> {
  const { app, page } = stage;
  await stage.showCard();
  await stage.shot("card-idle");

  app.media.catalogMode = "loading";
  await stage.openWindow();
  await stage.shot("window-loading");
  app.media.catalogMode = "error";
  await expect(stage.window.getByRole("alert")).toBeVisible({ timeout: 20_000 });
  await stage.shot("window-error");
  app.media.catalogMode = "ready";
  await stage.window.getByRole("alert").locator("button").click();
  await expect(stage.window.locator(".media-row[data-model]").first()).toBeVisible();
  await stage.shot("window-image");
  await stage.kind(1);
  await stage.shot("window-video");
  await stage.window.locator(".media-tools__search").fill("zzz");
  await stage.shot("window-no-match");
  await stage.window.locator(".media-empty .media-link").click();
  await stage.window.locator(".media-chip").first().click();
  await stage.window.locator(".media-tools__select select").nth(1).selectOption("price");
  await stage.shot("window-my-keys-by-price");
  await stage.window.locator(".media-chip").first().click();
  await stage.window.locator(".media-unsupported summary").click();
  await stage.window.locator(".media-unsupported li").last().scrollIntoViewIfNeeded();
  await stage.shot("window-needs-key-and-unsupported");

  await stage.pick("bytedance/seedance-2.5");
  await stage.showCard();
  await stage.shot("card-selected");
  await stage.card.scrollIntoViewIfNeeded();
  await stage.card.screenshot({ path: join(OUT, "card-selected-crop__" + stage.width + "__" + stage.locale + ".png") });

  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("kling/kling-4.0");
  await stage.showCard();
  await stage.shot("card-needs-key");
  await stage.card.screenshot({ path: join(OUT, "card-needs-key-crop__" + stage.width + "__" + stage.locale + ".png") });

  // A longer, sharper clip on one model, then a model that offers neither: the note says what moved.
  app.media.keys.add("byteplus");
  await page.reload();
  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("bytedance/seedance-2.5");
  await stage.showCard();
  await stage.card.locator("button[data-value='1080p']").click();
  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("kling/kling-4.0-turbo");
  await stage.showCard();
  await stage.shot("card-adjusted");
  await stage.card.screenshot({ path: join(OUT, "card-adjusted-crop__" + stage.width + "__" + stage.locale + ".png") });
  expect(app.errors).toEqual([]);
  void page;
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test("capture " + locale + " " + width, async ({ browser }) => {
      test.setTimeout(180_000);
      await mkdir(OUT, { recursive: true });
      const app = await openStaticApp(browser, { locale, viewport: { width, height: HEIGHT[width] ?? 900 } });
      try {
        await openCreateScreen(app.page);
        const stage = new Stage(app, width, locale);
        if (!stage.mobile) await app.page.locator(".composer:visible .composer__textarea").fill(PROMPT[locale] ?? PROMPT.en!);
        await captureAll(stage);
      } finally { await app.close(); }
    });
  }
}

async function captureKeysAndFailures(stage: Stage): Promise<void> {
  const { app, page } = stage;
  // Key entry for a model the saved key cannot run, with a rejected key, then the estimate and the Generate hint.
  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("kling/kling-4.0");
  await stage.showCard();
  app.media.keyVerdict = "reject";
  await stage.card.locator(".media-key .api-key-input").first().fill("kling-key-0000");
  await stage.card.locator(".media-key__actions .modal__btn").first().click();
  await expect(stage.card.locator(".media-key [role=alert]")).toBeVisible();
  await stage.card.locator(".media-key").scrollIntoViewIfNeeded();
  await stage.shot("key-rejected");
  await stage.card.locator(".media-key").screenshot({ path: join(OUT, "key-rejected-crop__" + stage.width + "__" + stage.locale + ".png") });
  if (!stage.mobile) { await page.locator(".generate-row:visible").screenshot({ path: join(OUT, "generate-blocked-crop__" + stage.width + "__" + stage.locale + ".png") }); }

  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("bytedance/seedance-2.5");
  await stage.showCard();
  await expect(stage.card.locator(".media-estimate .price")).toContainText("$");
  await stage.card.locator(".media-estimate").scrollIntoViewIfNeeded();
  await stage.shot("estimate");
  await stage.card.locator(".media-estimate").screenshot({ path: join(OUT, "estimate-crop__" + stage.width + "__" + stage.locale + ".png") });
  await stage.card.locator(".media-estimate details summary").click();
  await stage.card.locator(".media-estimate").screenshot({ path: join(OUT, "estimate-basis-crop__" + stage.width + "__" + stage.locale + ".png") });
  await stage.card.locator(".media-estimate details summary").click();
  // A model priced by quality: the retiring badge in the window, then the quality setting and its one price.
  await stage.openWindow();
  await stage.kind(0);
  await page.locator('.media-dialog .media-row[data-model="openai/gpt-image-2"]').first().scrollIntoViewIfNeeded();
  await stage.shot("window-retiring");
  await stage.pick("openai/gpt-image-2");
  await stage.showCard();
  await expect(stage.card.locator(".media-estimate .price")).toContainText("$");
  await stage.card.locator(".media-estimate").scrollIntoViewIfNeeded();
  await stage.shot("quality");
  await stage.card.screenshot({ path: join(OUT, "quality-crop__" + stage.width + "__" + stage.locale + ".png") });
  // A speed tier is the same kind of setting; a price per megapixel says it is billed by usage.
  for (const [id, name] of [["ideogram/ideogram-v3", "speed-tier"], ["alibaba/z-image", "usage-billed"]] as const) {
    await stage.openWindow();
    await stage.kind(0);
    await stage.pick(id);
    await stage.showCard();
    await stage.card.locator(".media-estimate").scrollIntoViewIfNeeded();
    await stage.shot(name);
    await stage.card.screenshot({ path: join(OUT, name + "-crop__" + stage.width + "__" + stage.locale + ".png") });
  }
  await stage.openWindow();
  await stage.kind(1);
  await stage.pick("bytedance/seedance-2.5");
  await stage.showCard();
  if (stage.mobile) await page.locator("#mobile-generate-sheet [role=tab]").nth(0).click();
  await page.locator(".generate-row:visible").screenshot({ path: join(OUT, "generate-estimate-crop__" + stage.width + "__" + stage.locale + ".png") });

  await page.locator(".composer:visible .composer__textarea").fill(PROMPT[stage.locale] ?? PROMPT.en!);
  await page.locator(".generate-btn:visible").click();
  await expect.poll(() => app.media.submissions.length).toBeGreaterThan(0);
  await app.media.emit(page, "progress", String(app.media.submissions[0]!.requestId), { status: "running", progress: 0.4 });
  await stage.shot("running");
  await app.media.emit(page, "error", String(app.media.submissions[0]!.requestId), { code: "FAL_INSUFFICIENT_CREDIT", error: "Exhausted balance. Top up at fal.ai/dashboard/billing.", status: 402, category: "quota", retryable: false, adapter: "fal" });
  await stage.showCard();
  await expect(stage.card.locator(".media-failure")).toBeVisible();
  await stage.card.locator(".media-failure").scrollIntoViewIfNeeded();
  await stage.shot("failure-quota");
  await stage.card.locator(".media-failure summary").click();
  await stage.shot("failure-details");
  await stage.card.locator(".media-failure summary").click();
  await stage.card.locator(".media-failure").screenshot({ path: join(OUT, "failure-quota-crop__" + stage.width + "__" + stage.locale + ".png") });
  expect(app.errors).toEqual([]);
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test("capture keys and failures " + locale + " " + width, async ({ browser }) => {
      test.setTimeout(180_000);
      await mkdir(OUT, { recursive: true });
      const app = await openStaticApp(browser, { locale, viewport: { width, height: HEIGHT[width] ?? 900 } });
      try {
        await openCreateScreen(app.page);
        await captureKeysAndFailures(new Stage(app, width, locale));
      } finally { await app.close(); }
    });
  }
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test("capture results " + locale + " " + width, async ({ browser }) => {
      test.setTimeout(120_000);
      await mkdir(OUT, { recursive: true });
      const app = await openStaticApp(browser, { locale, viewport: { width, height: HEIGHT[width] ?? 900 }, storage: { "ima2.selectedFilename": "l11-flux.png" } });
      app.media.history.push(mediaHistoryRow());
      try {
        await openCreateScreen(app.page);
        const stage = new Stage(app, width, locale);
        const actions = app.page.locator(".result-actions:visible").first();
        await expect(actions).toBeVisible();
        await stage.shot("result");
        if (stage.mobile) {
          await app.page.locator(".result-actions__toggle:visible").first().click();
          await stage.shot("result-more");
        }
        await actions.locator(".action-btn", { hasText: /Info|정보/ }).first().click();
        await expect(app.page.locator("[aria-labelledby=metadata-modal-title]")).toBeVisible();
        await stage.shot("result-details");
        await app.page.keyboard.press("Escape");
        await actions.locator(".action-btn", { hasText: /Make again|다시 만들기/ }).first().click();
        await expect(app.page.locator(".toast").first()).toBeVisible();
        await stage.shot("result-make-again");
        if (!stage.mobile) await stage.card.screenshot({ path: join(OUT, "result-make-again-crop__" + width + "__" + locale + ".png") });
        expect(app.errors).toEqual([]);
      } finally { await app.close(); }
    });
  }
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test("capture no key " + locale + " " + width, async ({ browser }) => {
      test.setTimeout(120_000);
      await mkdir(OUT, { recursive: true });
      const app = await openStaticApp(browser, { locale, viewport: { width, height: HEIGHT[width] ?? 900 }, keys: [] });
      try {
        await openCreateScreen(app.page);
        const stage = new Stage(app, width, locale);
        await stage.openWindow();
        await stage.kind(1);
        await stage.pick("bytedance/seedance-2.5");
        await stage.showCard();
        await stage.card.locator(".media-routes").scrollIntoViewIfNeeded();
        await stage.shot("no-key");
        await stage.card.locator(".media-key").scrollIntoViewIfNeeded();
        await stage.card.locator(".media-key").screenshot({ path: join(OUT, "key-fields-crop__" + width + "__" + locale + ".png") });
        expect(app.errors).toEqual([]);
      } finally { await app.close(); }
    });
  }
}
