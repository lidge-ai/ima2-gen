import { test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the element library (Assets tab, picker, save from a result) on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts library.audit.ts --project=studio

const SAMPLE = (name: string) => readFileSync(fileURLToPath(new URL("../public/samples/" + name, import.meta.url)));
const SEED = [
  ["Mina, ceramic artist", "character", "editorial.jpg"], ["Red stoneware mug", "product", "packshot.jpg"],
  ["Sunlit studio corner", "scene", "isometric.jpg"], ["Blue hour ridgeline", "style", "landscape.jpg"],
] as const;
type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }

/** Removes every element, then adds the seed set, through the same API the screen uses. */
async function reset(page: Page, seed: boolean) {
  const list = (await (await page.request.get("/api/assets?kind=element&limit=200")).json()) as { assets: { id: string }[] };
  for (const asset of list.assets) await page.request.delete("/api/assets/" + asset.id);
  if (!seed) return;
  for (const [name, elementKind, sample] of [...SEED].reverse()) {
    const upload = (await (await page.request.post("/api/media/inputs", { data: SAMPLE(sample), headers: { "content-type": "image/jpeg" } })).json()) as { ref: string };
    await page.request.post("/api/assets/promote-element", { data: { inputRef: upload.ref, name, elementKind } });
  }
}
const named = (name: RegExp): Act => async (page) => {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};
const mug = (page: Page) => page.getByRole("article", { name: "Red stoneware mug" });

const CELLS: Cell[] = [
  { id: "library__empty", hash: "/assets/elements", setup: (page) => reset(page, false) },
  { id: "library__list", hash: "/assets/elements", setup: (page) => reset(page, true) },
  {
    id: "library__new-filled", hash: "/assets/elements", setup: (page) => reset(page, true),
    act: async (page) => {
      const form = page.getByRole("form", { name: /^(New element|새 요소)$/ });
      await form.getByLabel(/^(Image|이미지)$/).setInputFiles({ name: "kettle.jpg", mimeType: "image/jpeg", buffer: SAMPLE("packshot.jpg") });
      await form.getByLabel(/^(Name|이름)$/).fill("Matte black pour-over kettle with a long neck");
      await form.getByRole("button", { name: /^(Product|제품)$/ }).click();
    },
  },
  { id: "library__kind-filter", hash: "/assets/elements", setup: (page) => reset(page, true), act: async (page) => { await page.getByRole("group", { name: /^(Element kinds|요소 종류)$/ }).getByRole("button", { name: /^(Scene|장소)$/ }).click(); } },
  { id: "library__edit", hash: "/assets/elements", setup: (page) => reset(page, true), act: async (page) => { await mug(page).getByRole("button", { name: /^(Edit|수정)$/ }).click(); } },
  { id: "library__delete-confirm", hash: "/assets/elements", setup: (page) => reset(page, true), act: async (page) => { await mug(page).getByRole("button", { name: /^(Delete|삭제)$/ }).click(); } },
  { id: "library__loading", hash: "/assets/elements", setup: async (page) => { await page.route("**/api/assets?*", () => undefined); } },
  { id: "library__load-error", hash: "/assets/elements", setup: async (page) => { await page.route("**/api/assets?*", (route) => route.fulfill({ status: 500, json: { error: { code: "DB_ERROR", message: "database is locked" } } })); } },
  { id: "library__picker", hash: "/image?mode=edit", setup: (page) => reset(page, true), act: named(/^(From elements|요소에서 고르기)$/) },
  { id: "library__picker-empty", hash: "/image?mode=edit", setup: (page) => reset(page, false), act: named(/^(From elements|요소에서 고르기)$/) },
  {
    id: "library__picked-in-tray", hash: "/image?mode=edit", setup: (page) => reset(page, true),
    act: async (page) => { await named(/^(From elements|요소에서 고르기)$/)(page); await page.getByRole("dialog").getByRole("button", { name: /Red stoneware mug/ }).click(); await page.waitForTimeout(400); },
  },
  {
    id: "library__video-picker", hash: "/video?model=bytedance%2Fseedance-2.5", setup: (page) => reset(page, true),
    act: async (page) => { await page.getByRole("button", { name: /^(References|레퍼런스)$/ }).click(); await named(/^(From elements|요소에서 고르기)$/)(page); },
  },
  {
    id: "library__save-result", hash: "/assets/images",
    // A result to save: made once through the image form, then found again in Assets.
    setup: async (page) => {
      await reset(page, true);
      const history = (await (await page.request.get("/api/history?limit=1")).json()) as { items?: unknown[] };
      if (history.items?.length) return;
      await page.goto("/#/image");
      await page.getByLabel(/^(Prompt|프롬프트)$/).fill("A lighthouse keeper at dusk, film photo");
      await named(/^(Generate|생성)/)(page);
      await page.getByRole("article").getByRole("img").first().waitFor({ timeout: 180_000 });
    },
    act: async (page) => {
      await page.getByRole("button", { name: /^Open | 열기$/ }).first().click();
      await named(/^(Save as element|요소로 저장)$/)(page);
      await page.getByRole("dialog").getByLabel(/^(Name|이름)$/).fill("Lighthouse keeper");
    },
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("element library states", async ({ browser }) => {
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
