import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { navigateSound, soundCheckpoint, withSound, type SoundCase } from "./fixtures/videoSoundIntentHarness";
import en from "../src/i18n/en.json" with { type: "json" };
import ko from "../src/i18n/ko.json" with { type: "json" };
import zhHans from "../src/i18n/zh-Hans.json" with { type: "json" };
import zhHant from "../src/i18n/zh-Hant.json" with { type: "json" };

const SOFT = "soft cinematic background music, gentle ambience, no distracting sound effects";
const NO_MUSIC = "no background music; use only natural scene sound and room tone";
const dictionaries = { en, ko, "zh-Hans": zhHans, "zh-Hant": zhHant };
const soundGroup = (page: Page) => page.getByRole("group", { name: en.video.soundIntentTitle, exact: true });
const soft = (page: Page) => soundGroup(page).getByRole("button", { name: en.video.soundIntent.softBgm, exact: true });
const noMusic = (page: Page) => soundGroup(page).getByRole("button", { name: en.video.soundIntent.noMusic, exact: true });
const clear = (page: Page) => soundGroup(page).getByRole("button", { name: en.video.soundIntent.clear, exact: true });
const mainInput = (page: Page) => page.locator(".composer textarea").first();

async function assertPreserved(fixture: SoundCase, count: number) {
  const s = await soundCheckpoint(fixture, `chips-${count}`);
  expect(s.chips.filter((p) => !p.id.startsWith("video-sound-intent:"))).toEqual([
    { id: "ordinary-before", name: "Before", text: "BEFORE", placement: "before" },
    { id: "video-continuity:wp3", name: "Continuity", text: "CONTINUITY", placement: "before" },
    { id: "ordinary-after", name: "After", text: "AFTER", placement: "after" },
  ]);
  expect(s.chips.filter((p) => p.id.startsWith("video-sound-intent:"))).toHaveLength(count);
  expect(s.lineage).toEqual({ lineageId: "wp3", parentFilename: null, sourceFrame: null,
    maxEntries: 4, retention: "keep-start-plus-latest-3", entries: [] });
  expect(s.prompt).toBe("MAIN");
}

test("sound selection replaces, toggles, clears and follows composer removal", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "MAIN", chips: true }, async (f) => {
    await expect(clear(f.page)).toHaveCount(0);
    await soft(f.page).click(); await expect(soft(f.page)).toHaveAttribute("aria-pressed", "true");
    await assertPreserved(f, 1);
    await noMusic(f.page).click(); await expect(soft(f.page)).toHaveAttribute("aria-pressed", "false");
    await expect(noMusic(f.page)).toHaveAttribute("aria-pressed", "true");
    expect((await soundCheckpoint(f, "replaced")).composed).toBe(`BEFORE\n\nCONTINUITY\n\nMAIN\n\nAFTER\n\n${NO_MUSIC}`);
    await assertPreserved(f, 1);
    await noMusic(f.page).click(); await expect(noMusic(f.page)).toHaveAttribute("aria-pressed", "false");
    await assertPreserved(f, 0);
    await soft(f.page).click(); await clear(f.page).click(); await assertPreserved(f, 0);
    await soft(f.page).click();
    const chip = f.page.locator(".composer__prompt-chip").filter({ hasText: en.video.soundIntent.softBgm });
    await expect(chip).toHaveCount(1); await chip.locator(".composer__prompt-chip-remove").click();
    await expect(soft(f.page)).toHaveAttribute("aria-pressed", "false");
    await expect(clear(f.page)).toHaveCount(0); await assertPreserved(f, 0);
  });
});

async function requestAndSettle(f: SoundCase, expected: string, count: number) {
  await f.page.getByRole("button", { name: en.generate.button, exact: true }).click();
  await expect.poll(() => f.page.evaluate(() => window.wp3Sound.snapshot().requests.length)).toBe(count);
  const submitted = await soundCheckpoint(f, "submitted");
  expect(submitted.requests[count - 1].prompt).toBe(expected);
  expect(submitted.requests[count - 1].prompt.split(SOFT)).toHaveLength(2);
  expect(submitted.requests[count - 1]).not.toHaveProperty("referenceAudios");
  const done = await f.page.evaluate(() => window.wp3Sound.settle());
  expect(done.inFlight).toEqual([]); expect(done.storedFlights).toEqual([]);
  expect(done.activeGenerations).toBe(0); expect(done.videoProgress).toBeNull();
  expect(done.pending).toBe(0); expect(done.work).toBe(0); expect(done.timerAbsent).toBe(true);
  expect(done.pollingCalls).toBe(count * 2); expect(done.controllerChecks).toEqual(Array(count).fill(true));
  f.checkpoints.push({ name: "generation-finally", value: done });
}

test("node mode hides composer sound controls and restores selection in classic mode", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "MAIN", chips: true }, async (f) => {
    await soft(f.page).click();
    const before = await soundCheckpoint(f, "classic-sound-selection");
    await f.page.evaluate(() => window.wp3Sound.uiMode("node"));
    await expect.poll(() => f.page.evaluate(() => window.wp3Sound.snapshot().uiMode)).toBe("node");
    await expect(f.page.locator(".video-controls")).toBeVisible();
    await f.page.screenshot({ path: info.outputPath("sound-node-mode.png") });
    await expect(soundGroup(f.page)).toHaveCount(0);
    const node = await soundCheckpoint(f, "node-sound-hidden");
    expect(node.chips).toEqual(before.chips); expect(node.lineage).toEqual(before.lineage);
    expect(node.prompt).toBe(before.prompt); expect(node.composed).toBe(before.composed); expect(node.requests).toEqual([]);
    await f.page.evaluate(() => window.wp3Sound.uiMode("classic"));
    await expect(soft(f.page)).toHaveAttribute("aria-pressed", "true");
    const restored = await soundCheckpoint(f, "classic-sound-restored");
    expect(restored.uiMode).toBe("classic"); expect(restored.chips).toEqual(before.chips);
    expect(restored.prompt).toBe(before.prompt); expect(restored.lineage).toEqual(before.lineage); expect(restored.composed).toBe(before.composed);
    expect(restored.requests).toEqual([]);
    await f.page.screenshot({ path: info.outputPath("sound-classic-restored.png") });
  });
});

test("actual video request construction includes sound exactly once after blank/custom/edited main", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "", chips: true }, async (f) => {
    await noMusic(f.page).click(); await soft(f.page).click();
    await requestAndSettle(f, `BEFORE\n\nCONTINUITY\n\nAFTER\n\n${SOFT}`, 1);
    await mainInput(f.page).fill("A calm harbor");
    await requestAndSettle(f, `BEFORE\n\nCONTINUITY\n\nA calm harbor\n\nAFTER\n\n${SOFT}`, 2);
    await mainInput(f.page).fill("An edited harbor scene");
    await requestAndSettle(f, `BEFORE\n\nCONTINUITY\n\nAn edited harbor scene\n\nAFTER\n\n${SOFT}`, 3);
    await clear(f.page).click();
    expect((await soundCheckpoint(f, "cleared-after-edit")).composed)
      .toBe("BEFORE\n\nCONTINUITY\n\nAn edited harbor scene\n\nAFTER");
  });
});

test("a sound-only empty composer submits once and clearing it restores empty admission", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "", chips: false }, async (f) => {
    await soft(f.page).click();
    await requestAndSettle(f, SOFT, 1);
    await clear(f.page).click();
    await f.page.getByRole("button", { name: en.generate.button, exact: true }).click();
    const state = await f.page.evaluate(() => window.wp3Sound.settle());
    expect(state.composed).toBe(""); expect(state.requests).toHaveLength(1);
    expect(state.inFlight).toEqual([]); expect(state.activeGenerations).toBe(0);
    f.checkpoints.push({ name: "empty-after-clear", value: state });
  });
});

test("real model actions and reload preserve prompt chips without reseeding", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "MAIN", chips: true }, async (f) => {
    await soft(f.page).click();
    await f.page.getByRole("button", { name: "Grok V Fast", exact: true }).click();
    const before = await soundCheckpoint(f, "base-model");
    expect(before.model).toBe("grok-imagine-video");
    await navigateSound(f, false);
    const reloaded = await soundCheckpoint(f, "reload-base");
    expect(reloaded.model).toBe(before.model); expect(reloaded.chips).toEqual(before.chips);
    expect(reloaded.prompt).toBe("MAIN"); expect(reloaded.composed).toBe(before.composed);
    await expect(soft(f.page)).toHaveAttribute("aria-pressed", "true");
    await f.page.evaluate(() => window.wp3Sound.imageMode());
    expect((await soundCheckpoint(f, "image-model")).chips).toEqual(before.chips);
    await navigateSound(f, false);
    const imageReload = await soundCheckpoint(f, "reload-image");
    expect(imageReload.model).toBe(false); expect(imageReload.chips).toEqual(before.chips);
    expect(imageReload.composed).toBe(before.composed);
    await f.page.evaluate(() => window.wp3Sound.videoMode());
    await expect(soft(f.page)).toHaveAttribute("aria-pressed", "true");
    // Runtime lineage and locale persistence intentionally are not asserted after reload.
  });
});

async function dropFiles(page: Page, kinds: Array<"audio" | "image" | "video">) {
  const transfer = await page.evaluateHandle((types) => {
    const data = new DataTransfer();
    for (const type of types) {
      if (type === "image") {
        const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#357c95"; ctx.fillRect(0, 0, 8, 8);
        const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], "fixture.png", { type: "image/png" }));
      } else data.items.add(new File([new Uint8Array([1, 2, 3])], type === "audio" ? "fixture.mp3" : "fixture.mp4",
        { type: type === "audio" ? "audio/mpeg" : "video/mp4" }));
    }
    return data;
  }, kinds);
  try { await page.locator(".composer").dispatchEvent("drop", { dataTransfer: transfer }); }
  finally { await transfer.dispose(); }
}

async function assertAudioDrop(f: SoundCase, mixed: boolean) {
  const before = await soundCheckpoint(f, "before-drop");
  await dropFiles(f.page, mixed ? ["audio", "audio", "image"] : ["audio", "audio"]);
  await expect(f.page.getByRole("alert").filter({ hasText: en.prompt.rejectAudioUploadUnsupported })).toBeVisible();
  await expect.poll(() => f.page.evaluate(() => window.wp3Sound.snapshot().tray.length)).toBe(mixed ? 1 : 0);
  const after = await soundCheckpoint(f, "after-drop");
  expect(after.requests).toEqual(before.requests);
  expect(after.toasts.filter((t) => t.message === en.prompt.rejectAudioUploadUnsupported)).toHaveLength(1);
  expect(after.references).toHaveLength(mixed ? 1 : 0);
  if (mixed) {
    expect(after.metadata).toEqual([{ filename: "fixture.png", png: true }]);
    expect(after.tray[0].kind).toBe("attachment");
    expect(after.references[0]).toMatch(/^data:image\//);
  }
}

for (const mode of ["image", "base", "1.5"] as const) {
  for (const mixed of [false, true]) test(`audio ${mixed ? "mixed PNG" : "only"} drop in ${mode} mode`, async ({ browser }, info) => {
    await withSound(browser, info, { locale: "en", prompt: "MAIN", chips: false }, async (f) => {
      if (mode === "image") await f.page.evaluate(() => window.wp3Sound.imageMode());
      if (mode === "base") await f.page.getByRole("button", { name: "Grok V Fast", exact: true }).click();
      await expect(f.page.locator('.composer input[type="file"]')).toHaveAttribute("accept", mode === "base" ? "image/*,video/mp4" : "image/*");
      await assertAudioDrop(f, mixed);
    });
  });
}

test("base video drop retains CLI guidance and never submits or attaches", async ({ browser }, info) => {
  await withSound(browser, info, { locale: "en", prompt: "MAIN", chips: false }, async (f) => {
    await f.page.getByRole("button", { name: "Grok V Fast", exact: true }).click();
    await dropFiles(f.page, ["video"]);
    await expect(f.page.getByRole("alert").filter({ hasText: en.prompt.videoUseCliForEdit })).toBeVisible();
    const state = await soundCheckpoint(f, "video-guidance");
    expect(state.tray).toEqual([]); expect(state.requests).toEqual([]);
  });
});

async function captureLayout(f: SoundCase, info: TestInfo, title: string, width: number) {
  await f.page.setViewportSize({ width, height: 1100 });
  const group = f.page.getByRole("group", { name: title, exact: true });
  await group.scrollIntoViewIfNeeded();
  const metrics = await group.evaluate((element) => Array.from(element.querySelectorAll("button")).map((button) => {
    const rect = button.getBoundingClientRect();
    return { label: button.textContent?.trim(), client: button.clientWidth, scroll: button.scrollWidth,
      left: rect.left, right: rect.right, width: window.innerWidth };
  }));
  f.checkpoints.push({ name: `layout-${width}`, value: metrics });
  await f.page.screenshot({ path: info.outputPath(`sound-${f.seed.locale}-${width}.png`) });
  await writeFile(info.outputPath(`layout-${width}.json`), JSON.stringify(metrics, null, 2));
  for (const metric of metrics) {
    expect(metric.scroll, `${metric.label} text clipped at ${width}`).toBeLessThanOrEqual(metric.client);
    expect(metric.left).toBeGreaterThanOrEqual(0); expect(metric.right).toBeLessThanOrEqual(width);
  }
}

for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"] as const) {
  test(`sound labels, keyboard and unclipped layouts in ${locale}`, async ({ browser }, info) => {
    const d = dictionaries[locale];
    await withSound(browser, info, { locale, prompt: "MAIN", chips: false }, async (f) => {
      const group = f.page.getByRole("group", { name: d.video.soundIntentTitle, exact: true });
      for (const key of ["noMusic", "softBgm", "tenseMusic", "roomTone", "sfx", "noDialogue"] as const) {
        await expect(group.getByRole("button", { name: d.video.soundIntent[key], exact: true })).toBeVisible();
      }
      const voice = f.page.getByRole("group", { name: d.video.voiceSection, exact: true });
      await expect(voice).toBeVisible();
      expect(await voice.evaluate((e) => !!(e.compareDocumentPosition(document.querySelector('.sound-intent-picker')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      const button = group.getByRole("button", { name: d.video.soundIntent.softBgm, exact: true });
      await button.focus(); await f.page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true"); await expect(button).toBeFocused();
      expect(await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.matches(":focus-visible") && (parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none");
      })).toBe(true);
      expect((await soundCheckpoint(f, "localized-name")).chips[0].name).toBe(d.video.soundIntent.softBgm);
      await f.page.keyboard.press("Space"); await expect(button).toHaveAttribute("aria-pressed", "false");
      await f.page.keyboard.press("Space"); await expect(button).toHaveAttribute("aria-pressed", "true");
      for (const width of [1280, 390, 320]) await captureLayout(f, info, d.video.soundIntentTitle, width);
      await dropFiles(f.page, ["audio"]);
      await expect(f.page.getByRole("alert").filter({ hasText: d.prompt.rejectAudioUploadUnsupported })).toBeVisible();
      expect((await soundCheckpoint(f, "localized-rejection")).requests).toEqual([]);
    });
  });
}
