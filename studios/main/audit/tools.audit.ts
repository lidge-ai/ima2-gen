import { test, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the edit-video form (change, extend, upscale) on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts tools.audit.ts --project=studio

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
const SOURCE = /^(Video to (change|extend|upscale)|(바꿀|연장할|업스케일할) 영상)$/;

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }

const named = (name: RegExp): Act => async (page) => {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};
const clip: Act = async (page) => {
  await page.getByLabel(SOURCE).setInputFiles(CLIP);
  await page.waitForTimeout(1200);
};
/** Every route reads as keyed, so each tool shows its ready form. */
const allKeys: Act = async (page) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('"hasKey":false', '"hasKey":true') });
  });
};
const noKeys: Act = async (page) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('"hasKey":true', '"hasKey":false').replaceAll('"keySource":"config"', '"keySource":null') });
  });
};
const GROK = "/video?mode=edit&model=xai%2Fgrok-imagine-video";
const SEEDANCE = "/video?mode=edit&model=bytedance%2Fseedance-2";

const CELLS: Cell[] = [
  { id: "tools__default", hash: "/video?mode=edit" },
  { id: "tools__change-follows-source", hash: GROK, setup: allKeys, act: async (page) => { await clip(page); await page.getByLabel(/^(Prompt|프롬프트)/).fill("Turn the afternoon into a snowy night, keep the camera move"); } },
  { id: "tools__change-settings", hash: SEEDANCE, setup: allKeys, act: clip },
  { id: "tools__change-needs-key", hash: SEEDANCE },
  { id: "tools__extend", hash: GROK, setup: allKeys, act: async (page) => { await named(/^(Extend|연장)$/)(page); await clip(page); } },
  { id: "tools__extend-length-open", hash: GROK, setup: allKeys, act: async (page) => { await named(/^(Extend|연장)$/)(page); await named(/^(Added length|추가 길이): /)(page); } },
  { id: "tools__upscale-empty", hash: "/video?mode=edit", act: named(/^(Upscale|업스케일)$/) },
  { id: "tools__upscale-filled", hash: "/video?mode=edit", act: async (page) => { await named(/^(Upscale|업스케일)$/)(page); await clip(page); } },
  { id: "tools__picker", hash: "/video?mode=edit", act: named(/^(Model|모델): /) },
  { id: "tools__nokey", hash: "/video?mode=edit", setup: noKeys },
  { id: "tools__loading", hash: "/video?mode=edit", setup: async (page) => { await page.route("**/api/media/catalog*", () => undefined); } },
  {
    id: "tools__submit-error", hash: "/video?mode=edit",
    setup: async (page) => {
      await page.route("**/api/media", (route) => (route.request().method() === "POST"
        ? route.fulfill({ status: 502, json: { error: { code: "FAL_UPSTREAM", message: "The provider did not answer" } } })
        : route.fallback()));
    },
    act: async (page) => { await named(/^(Upscale|업스케일)$/)(page); await clip(page); await named(/^(Generate|생성)/)(page); await page.waitForTimeout(800); },
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("edit video states", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of CELLS) {
      try {
        await page.unrouteAll({ behavior: "ignoreErrors" });
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
    await page.context().close();
  }
});
