import { test, type Browser, type Page } from "@playwright/test";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of folders on Assets and in a result's lightbox, on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts binder.audit.ts --project=studio

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }
interface Row { filename: string; mediaType: string; prompt: string }

const SEED = [
  { model: "openai/gpt-image-2", task: "text-to-image", prompt: "A red fox crossing a frozen harbor at dawn", inputs: [] },
  { model: "openai/gpt-image-2.6", task: "text-to-image", prompt: "Blue whale breaching beside a small fishing boat", inputs: [] },
  { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "The fox runs along the pier, handheld camera", inputs: [] },
];
const rows = async (page: Page) => ((await (await page.request.get("/api/history?includeAudio=1&limit=50")).json()) as { items: Row[] }).items;

/** Three results and two folders ("Harbor series" with the two fox results, "Client review" empty), made through the API the screens use. */
async function seed(page: Page) {
  if ((await rows(page)).length < SEED.length) {
    for (const data of SEED) await page.request.post("/api/media", { data });
    for (let i = 0; i < 120 && (await rows(page)).length < SEED.length; i += 1) await page.waitForTimeout(1000);
  }
  const have = ((await (await page.request.get("/api/assets/folders")).json()) as { folders: { id: string; name: string }[] }).folders;
  if (have.some((folder) => folder.name === "Harbor series")) return;
  const make = async (name: string) => ((await (await page.request.post("/api/assets/folders", { data: { name } })).json()) as { folder: { id: string } }).folder.id;
  const harbor = await make("Harbor series");
  await make("Client review");
  for (const row of (await rows(page)).filter((entry) => /fox/i.test(entry.prompt))) {
    await page.request.post("/api/assets", { data: { kind: row.mediaType, filePath: row.filename, folderId: harbor } });
  }
}
const named = (name: RegExp): Act => async (page) => { await page.getByRole("button", { name }).filter({ visible: true }).first().click(); await page.waitForTimeout(300); };
const inFolder = (name: string): Act => async (page) => { await named(/^(Folder|폴더): /)(page); await page.getByRole("dialog").getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(900); };
const openFox: Act = async (page) => { await page.getByRole("button", { name: /red fox/ }).first().click(); await page.waitForTimeout(400); };
const manager: Act = named(/^(Edit folders|폴더 편집)$/);
const harborRow = (page: Page) => page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Harbor series" });

const CELLS: Cell[] = [
  { id: "binder__toolbar", hash: "/assets/all", setup: seed },
  { id: "binder__filter-menu", hash: "/assets/all", setup: seed, act: named(/^(Folder|폴더): /) },
  { id: "binder__in-folder", hash: "/assets/all", setup: seed, act: inFolder("Harbor series") },
  { id: "binder__empty-folder", hash: "/assets/all", setup: seed, act: inFolder("Client review") },
  { id: "binder__list", hash: "/assets/all", setup: seed, act: manager },
  { id: "binder__list-rename", hash: "/assets/all", setup: seed, act: async (page) => { await manager(page); await harborRow(page).getByRole("button", { name: /^(Rename|이름 바꾸기)$/ }).click(); } },
  { id: "binder__list-delete", hash: "/assets/all", setup: seed, act: async (page) => { await manager(page); await harborRow(page).getByRole("button", { name: /^(Delete|삭제)$/ }).click(); } },
  { id: "binder__result", hash: "/assets/images", setup: seed, act: openFox },
  { id: "binder__result-menu", hash: "/assets/images", setup: seed, act: async (page) => { await openFox(page); await page.getByRole("dialog").getByRole("button", { name: /^(Folder|폴더): / }).click(); await page.waitForTimeout(300); } },
  {
    id: "binder__result-new", hash: "/assets/images", setup: seed,
    act: async (page) => {
      await openFox(page);
      await page.getByRole("dialog").getByRole("button", { name: /^(Folder|폴더): / }).click();
      await page.getByRole("button", { name: /^(New folder…|새 폴더…)$/ }).click();
      await page.getByLabel(/^(New folder name|새 폴더 이름)$/).fill("Winter set");
    },
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("folder states", async ({ browser }) => {
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
