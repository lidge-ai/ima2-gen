import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { audioHistoryRow } from "../fixtures/mediaModels";
import { openCreateScreen, openStaticApp, type StaticApp, type StaticAppOptions, type StaticLocale } from "../fixtures/staticClassicApp";

// Render capture for audio in the default studio: screen x state x width x locale.
// Not part of the e2e suite (see playwright.audit.config.ts); it only writes screenshots to look at.
//   L11_SHOTS=<dir> npx playwright test -c e2e/audit/playwright.audit.config.ts media-audio

const OUT = process.env.L11_SHOTS ?? join(process.cwd(), "test-results", "l11-shots");
const WIDTHS = (process.env.L11_WIDTHS ?? "1440,390").split(",").map(Number);
const LOCALES = (process.env.L11_LOCALES ?? "ko,en").split(",") as StaticLocale[];
const HEIGHT: Record<number, number> = { 1440: 900, 768: 1024, 390: 844 };
const SCRIPT: Record<string, string> = { ko: "안녕하세요. 오늘의 날씨를 알려 드릴게요.", en: "Welcome aboard. Please keep your seatbelt fastened." };
const SOUND: Record<string, string> = { ko: "양철 지붕에 떨어지는 빗소리, 멀리서 천둥", en: "rain on a tin roof, distant thunder" };

class Stage {
  constructor(readonly app: StaticApp, readonly width: number, readonly locale: string) {}
  get page(): Page { return this.app.page; }
  get mobile(): boolean { return this.width <= 800; }
  get window() { return this.page.locator(".media-dialog"); }
  get card() { return this.page.locator(this.mobile ? "#mobile-generate-sheet .media-card" : "#right-panel-tab-settings .media-card"); }
  name(state: string): string { return join(OUT, "audio-" + state + "__" + this.width + "__" + this.locale + ".png"); }
  async shot(state: string): Promise<void> {
    await this.page.evaluate(async () => { await document.fonts.ready; });
    await this.page.waitForTimeout(150);
    await this.page.screenshot({ path: this.name(state) });
  }
  async crop(state: string, selector = ""): Promise<void> {
    const target = selector ? this.card.locator(selector) : this.card;
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: this.name(state + "-crop") });
  }
  /** The model card lives in the right panel on desktop and in the compose sheet's settings tab on a phone. */
  async showCard(): Promise<void> {
    if (!this.mobile) return;
    const sheet = this.page.locator("#mobile-generate-sheet");
    if ((await sheet.getAttribute("aria-hidden")) !== "false") await this.page.locator("button.mobile-app-bar__generate").click();
    await sheet.locator("[role=tab]").nth(1).click();
    await expect(this.card).toBeVisible();
  }
  async prompt(text: string): Promise<void> {
    if (this.mobile) {
      const sheet = this.page.locator("#mobile-generate-sheet");
      if ((await sheet.getAttribute("aria-hidden")) !== "false") await this.page.locator("button.mobile-app-bar__generate").click();
      await sheet.locator("[role=tab]").nth(0).click();
    }
    await this.page.locator(".composer:visible .composer__textarea").fill(text);
  }
  /** Opens the window on Audio; use 0 is speech, 1 is music and effects. */
  async openAudio(use: 0 | 1): Promise<void> {
    await this.showCard();
    await this.card.locator(".media-picker__open").first().click();
    await expect(this.window).toBeVisible();
    await this.window.locator(".media-tabs").first().locator("button").nth(2).click();
    await this.window.locator(".media-tabs").nth(1).locator("button").nth(use).click();
    await expect(this.window.locator(".media-row[data-model]").first()).toBeVisible();
  }
  async pick(use: 0 | 1, id: string): Promise<void> {
    await this.openAudio(use);
    await this.window.locator('.media-row[data-model="' + id + '"]').first().click();
    await expect(this.window).toHaveCount(0);
    await this.showCard();
  }
}

function capture(title: string, options: StaticAppOptions, body: (stage: Stage) => Promise<void>, prepare?: (app: StaticApp) => void): void {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test("capture audio " + title + " " + locale + " " + width, async ({ browser }) => {
        test.setTimeout(180_000);
        await mkdir(OUT, { recursive: true });
        const app = await openStaticApp(browser, { keys: ["fal", "elevenlabs"], ...options, locale, viewport: { width, height: HEIGHT[width] ?? 900 } });
        prepare?.(app);
        try {
          await openCreateScreen(app.page);
          await body(new Stage(app, width, locale));
          expect(app.errors).toEqual([]);
        } finally { await app.close(); }
      });
    }
  }
}

capture("window and speech", {}, async (stage) => {
  await stage.prompt(SCRIPT[stage.locale] ?? SCRIPT.en!);
  await stage.openAudio(0);
  await stage.shot("window-speech");
  await stage.window.locator(".media-tabs").nth(1).locator("button").nth(1).click();
  await stage.window.locator(".media-unsupported summary").click();
  await stage.shot("window-sound");
  await stage.window.locator(".media-dialog__close").click();

  await stage.pick(0, "elevenlabs/eleven-v4");
  await expect(stage.card.locator(".media-voice__pick").first()).toBeVisible();
  await stage.card.locator(".media-voice").scrollIntoViewIfNeeded();
  await stage.shot("voice-open");
  await stage.crop("voice-open", ".media-voice");
  await stage.card.locator(".media-voice__play").first().click();
  await stage.card.locator(".media-tools__search").fill("ko");
  await stage.crop("voice-search-playing", ".media-voice");
  await stage.card.locator('.media-voice__pick[data-voice="v-jiho"]').click();
  await expect(stage.card.locator(".media-estimate small").first()).toBeVisible();
  await stage.shot("voice-chosen");
  await stage.crop("voice-chosen");
  if (stage.mobile) await stage.page.locator("#mobile-generate-sheet [role=tab]").nth(0).click();
  await stage.page.locator(".generate-row:visible").screenshot({ path: stage.name("generate-speech-crop") });
});

capture("sound and length", {}, async (stage) => {
  await stage.prompt(SOUND[stage.locale] ?? SOUND.en!);
  await stage.pick(1, "mirelo/mirelo-sfx-2.0");
  await expect(stage.card.locator(".media-estimate .price")).toContainText("$");
  await stage.shot("sound-length");
  await stage.crop("sound-length");
  await stage.card.locator(".media-length input").fill("700");
  await expect(stage.card.locator(".media-field-error")).toBeVisible();
  await stage.crop("length-error", ".media-parameter:has(.media-length)");
  if (!stage.mobile) await stage.page.locator(".generate-row:visible").screenshot({ path: stage.name("generate-length-blocked-crop") });
  await stage.pick(1, "elevenlabs/elevenlabs-music-2.5");
  await expect(stage.card.locator(".media-estimate small").first()).toBeVisible();
  await stage.shot("music");
  await stage.crop("music");
});

capture("no key and voice error", { keys: ["fal"] }, async (stage) => {
  await stage.pick(0, "elevenlabs/eleven-v4");
  await expect(stage.card.locator(".media-key")).toBeVisible();
  await stage.card.locator(".media-voice").scrollIntoViewIfNeeded();
  await stage.shot("no-key");
  await stage.crop("no-key");
  stage.app.media.keys.add("elevenlabs");
  stage.app.media.voiceMode = "error";
  await stage.page.reload();
  await stage.showCard();
  await expect(stage.card.locator(".media-voice [role=alert]")).toBeVisible();
  await stage.crop("voice-error", ".media-voice");
  stage.app.media.voiceMode = "empty";
  await stage.card.locator(".media-voice [role=alert] button").click();
  await expect(stage.card.locator(".media-voice__panel")).toBeVisible();
  await stage.crop("voice-empty", ".media-voice");
});

capture("result", { storage: { "ima2.selectedFilename": "l11-music.mp3" } }, async (stage) => {
  const actions = stage.page.locator(".result-actions:visible").first();
  await expect(stage.page.locator(".result-audio:visible audio")).toBeVisible();
  await stage.shot("result");
  if (stage.mobile) { await stage.page.locator(".result-actions__toggle:visible").first().click(); await stage.shot("result-more"); }
  await actions.locator(".action-btn", { hasText: /Info|정보/ }).first().click();
  await expect(stage.page.locator("[aria-labelledby=metadata-modal-title]")).toBeVisible();
  await stage.shot("result-details");
  await stage.page.keyboard.press("Escape");
  await actions.locator(".action-btn", { hasText: /Make again|다시 만들기/ }).first().click();
  await expect(stage.page.locator(".toast").first()).toBeVisible();
  await stage.shot("result-make-again");
}, (app) => { app.media.history.push(audioHistoryRow(), audioHistoryRow({ filename: "l11-older.mp3", url: "/generated/l11-older.mp3", createdAt: 1_795_600_000_000, requestId: "media_fixture_audio_2" })); });

capture("local workflow", { localRoute: true }, async (stage) => {
  await stage.openAudio(1);
  await stage.window.locator('.media-row[data-model="comfy/ace-step"]').scrollIntoViewIfNeeded();
  await stage.shot("window-local");
  await stage.window.locator('.media-row[data-model="comfy/ace-step"]').click();
  await stage.showCard();
  await expect(stage.card.locator(".media-estimate small").first()).toBeVisible();
  await stage.shot("local");
  await stage.crop("local");
});
