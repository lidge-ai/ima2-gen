import { test, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the audio screen (speech, music and sound, sound for video) on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts sound.audit.ts --project=studio

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; keyed?: boolean; setup?: Act; act?: Act }

const named = (name: RegExp): Act => async (page) => {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};
const script: Act = async (page) => {
  await page.locator("#audio-text").fill("Welcome aboard the night train to Busan. Doors close in two minutes; please keep your ticket with you until the end of the journey.");
};

const CELLS: Cell[] = [
  { id: "audio__speech-nokey", hash: "/audio?tool=speech" },
  { id: "audio__speech-empty", hash: "/audio?tool=speech", keyed: true },
  { id: "audio__speech-voices", hash: "/audio?tool=speech", keyed: true, act: async (page) => { await script(page); await named(/^(Voice|목소리): /)(page); } },
  {
    id: "audio__speech-ready", hash: "/audio?tool=speech", keyed: true,
    act: async (page) => { await script(page); await named(/^(Voice|목소리): /)(page); await named(/^Yeji/)(page); },
  },
  {
    id: "audio__speech-voices-search-empty", hash: "/audio?tool=speech", keyed: true,
    act: async (page) => { await named(/^(Voice|목소리): /)(page); await page.getByRole("searchbox").last().fill("zzzz"); await page.waitForTimeout(200); },
  },
  {
    id: "audio__speech-voices-loading", hash: "/audio?tool=speech", keyed: true,
    setup: async (page) => { await page.route("**/api/media/voices*", () => undefined); },
    act: named(/^(Voice|목소리): /),
  },
  {
    id: "audio__speech-voices-error", hash: "/audio?tool=speech", keyed: true,
    setup: async (page) => { await page.route("**/api/media/voices*", (route) => route.fulfill({ status: 401, json: { ok: false, code: "ELEVENLABS_AUTH", error: "ElevenLabs voices failed (401)", status: 401, category: "auth" } })); },
    act: named(/^(Voice|목소리): /),
  },
  { id: "audio__sound-empty", hash: "/audio?tool=sound" },
  {
    id: "audio__sound-range-error", hash: "/audio?tool=sound&model=elevenlabs%2Felevenlabs-music-2.5",
    act: async (page) => { await page.locator("#audio-text").fill("Warm lo-fi piano with soft rain"); await page.getByLabel(/^(Length in seconds|길이\(초\))/).fill("2"); },
  },
  {
    id: "audio__sound-ready", hash: "/audio?tool=sound&model=elevenlabs%2Felevenlabs-music-2.5",
    act: async (page) => { await page.locator("#audio-text").fill("Warm lo-fi piano with soft rain"); await page.getByLabel(/^(Length in seconds|길이\(초\))/).fill("45"); await named(/^(Instrumental only|연주곡만)$/)(page); },
  },
  { id: "audio__video-empty", hash: "/audio?tool=video" },
  { id: "audio__video-ready", hash: "/audio?tool=video", act: async (page) => { await page.getByLabel(/^(Video|영상)$/).setInputFiles(CLIP); await page.waitForTimeout(1200); } },
  { id: "audio__picker", hash: "/audio?tool=sound", act: named(/^(Model|모델): /) },
  { id: "audio__loading", hash: "/audio", setup: async (page) => { await page.route("**/api/media/catalog*", () => undefined); } },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("audio screen states", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of CELLS) {
      try {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.request.fetch("/api/keys/elevenlabs", c.keyed ? { method: "PUT", data: { apiKey: "audit-key" } } : { method: "DELETE" });
        if (c.setup) await c.setup(page);
        await page.goto("about:blank");
        await page.goto("/#" + c.hash);
        await page.waitForTimeout(700);
        if (c.act) await c.act(page);
        await shoot(page, c.id, locale);
      } catch (err) {
        record({ cell: c.id, locale, unreachable: String(err).slice(0, 300) });
      }
    }
    await page.request.fetch("/api/keys/elevenlabs", { method: "DELETE" });
    await page.context().close();
  }
});

