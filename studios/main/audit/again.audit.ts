import { test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of making a result again with its settings and sending an image to the video form.
// Run: npx playwright test -c audit/playwright.audit.config.ts again.audit.ts --project=studio

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }
interface Row { filename: string; prompt: string }
const SAMPLE = readFileSync(fileURLToPath(new URL("../public/samples/editorial.jpg", import.meta.url)));
const P = { plain: "The harbor wakes, slow push in", framed: "She turns to the window", still: "A lighthouse at dusk, film photo" };
const rows = async (page: Page) => ((await (await page.request.get("/api/history?includeAudio=1&limit=50")).json()) as { items: Row[] }).items;

/** Three results made through the API: a video with its own settings, a video made from a start frame, and an image. */
async function seed(page: Page) {
  if ((await rows(page)).some((row) => row.prompt === P.still)) return;
  const upload = (await (await page.request.post("/api/media/inputs", { data: SAMPLE, headers: { "content-type": "image/jpeg" } })).json()) as { ref: string };
  for (const data of [
    { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: P.plain, durationSec: 8, aspectRatio: "9:16", resolution: "1080p", audio: false, inputs: [] },
    { model: "bytedance/seedance-2.5", task: "image-to-video", prompt: P.framed, durationSec: 12, aspectRatio: "1:1", inputs: [{ role: "first-frame", ref: upload.ref }] },
    { model: "openai/gpt-image-2", task: "text-to-image", prompt: P.still, aspectRatio: "3:2", resolution: "2K", inputs: [] },
  ]) await page.request.post("/api/media", { data });
  for (let i = 0; i < 120 && (await rows(page)).filter((row) => Object.values(P).includes(row.prompt)).length < 3; i += 1) await page.waitForTimeout(1000);
}
const openResult = (prompt: string): Act => async (page) => { await page.getByRole("button", { name: new RegExp(prompt.slice(0, 18)) }).first().click(); await page.waitForTimeout(400); };
const press = (name: RegExp): Act => async (page) => { await page.getByRole("dialog").getByRole("button", { name }).click(); await page.waitForTimeout(1200); };
const then = (...acts: Act[]): Act => async (page) => { for (const act of acts) await act(page); };
const AGAIN = /^(Same prompt and settings|같은 프롬프트와 설정으로)$/;
const VIDEO = /^(Use in video|영상에 쓰기)$/;
const sendTo = (place: RegExp): Act => async (page) => { await page.getByRole("dialog").getByRole("button", { name: VIDEO }).click(); await page.getByRole("dialog", { name: VIDEO }).getByRole("button", { name: place }).click(); await page.waitForTimeout(1200); };

const CELLS: Cell[] = [
  { id: "again__image-result", hash: "/assets/images", setup: seed, act: openResult(P.still) },
  { id: "again__video-result", hash: "/assets/videos", setup: seed, act: openResult(P.plain) },
  { id: "again__video-filled", hash: "/assets/videos", setup: seed, act: then(openResult(P.plain), press(AGAIN)) },
  { id: "again__video-inputs-note", hash: "/assets/videos", setup: seed, act: then(openResult(P.framed), press(AGAIN)) },
  { id: "again__image-filled", hash: "/assets/images", setup: seed, act: then(openResult(P.still), press(AGAIN)) },
  { id: "again__video-menu", hash: "/assets/images", setup: seed, act: then(openResult(P.still), async (page) => { await page.getByRole("dialog").getByRole("button", { name: VIDEO }).click(); await page.waitForTimeout(300); }) },
  { id: "again__end-frame", hash: "/assets/images", setup: seed, act: then(openResult(P.still), sendTo(/^(End frame|끝 프레임)$/)) },
  { id: "again__reference", hash: "/assets/images", setup: seed, act: then(openResult(P.still), sendTo(/^(Reference|레퍼런스)$/)) },
  {
    id: "again__no-references", hash: "/video?model=kling%2Fkling-3", setup: seed,
    act: async (page) => {
      const path = (await rows(page)).find((row) => row.prompt === P.still)!.filename;
      await page.evaluate((file) => {
        sessionStorage.setItem("ima2-studio-handoff", JSON.stringify({ url: "/generated/" + file, mimeType: "image/png", name: "lighthouse", target: "video", values: { slot: "reference" }, path: file }));
        window.dispatchEvent(new CustomEvent("ima2-handoff", { detail: { handled: false } }));
      }, path);
      await page.waitForTimeout(600);
    },
  },
  { id: "again__folder-menu", hash: "/assets/all", setup: seed, act: async (page) => { await page.getByRole("button", { name: /^(Folder|폴더): / }).click(); await page.waitForTimeout(300); } },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("make-again and send-to states", async ({ browser }) => {
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
