import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
  await stage.window.locator(".media-dialog__list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await stage.window.locator(".media-unsupported summary").click();
  await stage.window.locator(".media-dialog__list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await stage.shot("window-needs-key-and-unsupported");
  await stage.window.locator(".media-dialog__list").evaluate((list) => { list.scrollTop = 0; });

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
