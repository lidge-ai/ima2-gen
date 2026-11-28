import { test, type Browser, type Page } from "@playwright/test";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of search, filters and order on Assets, on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts shelf.audit.ts --project=studio

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }

const SEED = [
  { model: "openai/gpt-image-2", task: "text-to-image", prompt: "A red fox crossing a frozen harbor at dawn", inputs: [] },
  { model: "openai/gpt-image-2.6", task: "text-to-image", prompt: "Blue whale breaching beside a small fishing boat", inputs: [] },
  { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "The fox runs along the pier, handheld camera", inputs: [] },
  { model: "elevenlabs/elevenlabs-music-2.5", task: "text-to-audio", prompt: "Slow piano with distant gulls", durationSec: 5, inputs: [] },
];
/** Results to search through, made once through the same API the forms use. */
async function seed(page: Page) {
  const have = (await (await page.request.get("/api/history?includeAudio=1&limit=1")).json()) as { matched?: number };
  if ((have.matched ?? 0) >= SEED.length) return;
  await page.request.put("/api/keys/elevenlabs", { data: { apiKey: "audit-key" } });
  for (const data of SEED) await page.request.post("/api/media", { data });
  for (let i = 0; i < 120; i += 1) {
    const now = (await (await page.request.get("/api/history?includeAudio=1&limit=1")).json()) as { matched?: number };
    if ((now.matched ?? 0) >= SEED.length) return;
    await page.waitForTimeout(1000);
  }
}
const search = (text: string): Act => async (page) => { await page.getByRole("searchbox").fill(text); await page.waitForTimeout(900); };
const pick = (button: RegExp, option: RegExp): Act => async (page) => {
  await page.getByRole("button", { name: button }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};

const CELLS: Cell[] = [
  { id: "shelf__all", hash: "/assets/all", setup: seed },
  { id: "shelf__search", hash: "/assets/all", setup: seed, act: search("fox") },
  { id: "shelf__search-none", hash: "/assets/all", setup: seed, act: search("a lighthouse nobody made") },
  { id: "shelf__audio", hash: "/assets/audio", setup: seed },
  { id: "shelf__period-menu", hash: "/assets/all", setup: seed, act: pick(/^(Made|만든 때)$/, /./) },
  { id: "shelf__order-menu", hash: "/assets/videos", setup: seed, act: pick(/^(Order|정렬)$/, /./) },
  { id: "shelf__model-menu", hash: "/assets/images", setup: seed, act: pick(/^(Filter by model|모델별 필터)$/, /./) },
  { id: "shelf__loading", hash: "/assets/all", setup: async (page) => { await page.route("**/api/history?*", () => undefined); } },
  { id: "shelf__load-error", hash: "/assets/all", setup: async (page) => { await page.route("**/api/history?*", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "History unavailable" } } })); } },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("assets search and filter states", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of CELLS) {
      try {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.goto("about:blank");
        if (c.setup) await c.setup(page);
        await page.goto("/#" + c.hash);
        await page.waitForTimeout(900);
        if (c.act) await c.act(page);
        await shoot(page, c.id, locale);
      } catch (err) {
        record({ cell: c.id, locale, unreachable: String(err).slice(0, 300) });
      }
    }
    await page.context().close();
  }
});
