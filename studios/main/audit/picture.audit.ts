import { test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the image tools (edit, upscale, vectorize, separate) on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts picture.audit.ts --project=studio

const SAMPLES = ["editorial.jpg", "isometric.jpg", "packshot.jpg", "landscape.jpg"].map((name) => fileURLToPath(new URL("../public/samples/" + name, import.meta.url)));
/** A sample photo under the name a person's file would have. */
const file = (name: string, i = 0) => ({ name, mimeType: "image/jpeg", buffer: readFileSync(SAMPLES[i % SAMPLES.length]!) });
type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }

const add = (...names: string[]): Act => async (page) => {
  await page.getByLabel(/^(Image file|이미지 파일)$/).setInputFiles(names.map((name, i) => file(name, i)));
  await page.waitForTimeout(700);
};
const named = (name: RegExp): Act => async (page) => {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};
const prompt = (text: string): Act => async (page) => { await page.getByLabel(/^(Prompt|프롬프트)$/).fill(text); };
const noKeys: Act = async (page) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('"hasKey":true', '"hasKey":false').replaceAll('"keySource":"config"', '"keySource":null') });
  });
};

const CELLS: Cell[] = [
  { id: "picture__create-tabs", hash: "/image" },
  { id: "picture__edit-empty", hash: "/image?mode=edit" },
  { id: "picture__edit-three", hash: "/image?mode=edit", act: async (page) => { await add("door.png", "paint-sample.png", "window-frame.png")(page); await prompt("Paint the door the red of the sample, keep the frame")(page); } },
  { id: "picture__edit-full", hash: "/image?mode=edit", act: add("one.png", "two.png", "three.png", "four.png") },
  { id: "picture__edit-route-open", hash: "/image?mode=edit", act: async (page) => { await add("door.png")(page); await named(/^(Run through|실행 경로)/)(page); } },
  { id: "picture__upscale", hash: "/image?mode=upscale", act: add("old-photo-scan.png") },
  { id: "picture__separate", hash: "/image?mode=separate", act: add("product-shot.png") },
  { id: "picture__vectorize-needs-key", hash: "/image?mode=vectorize", act: add("logo-sketch.png") },
  { id: "picture__picker", hash: "/image?mode=edit", act: named(/^(Model|모델): /) },
  { id: "picture__nokey", hash: "/image?mode=edit", setup: noKeys },
  { id: "picture__unrunnable-model", hash: "/image?mode=edit&model=black-forest-labs%2Fflux-2-pro" },
  {
    id: "picture__submit-error", hash: "/image?mode=upscale",
    setup: async (page) => {
      await page.route("**/api/media", (route) => (route.request().method() === "POST"
        ? route.fulfill({ status: 502, json: { error: { code: "FAL_UPSTREAM", message: "The provider did not answer" } } })
        : route.fallback()));
    },
    act: async (page) => { await add("old-photo-scan.png")(page); await named(/^(Generate|생성)/)(page); await page.waitForTimeout(800); },
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("image tool states", async ({ browser }) => {
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
