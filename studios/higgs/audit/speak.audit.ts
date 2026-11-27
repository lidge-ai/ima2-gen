import { test, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the talking-video form (lip sync, avatar, dubbing) on the fake server.
// Run: npx playwright test -c audit/playwright.audit.config.ts --project studio speak.audit.ts

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
function wav(seconds: number): Buffer {
  const data = Buffer.alloc(8000 * seconds, 128);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const AUDIO = { name: "narration-take-3.wav", mimeType: "audio/wav", buffer: wav(6) };
const BROKEN = { name: "voice-memo.wav", mimeType: "audio/wav", buffer: Buffer.from("not audio") };
const FACE = {
  name: "face.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
};
const VIDEO = /^(Video of the speaker|말하는 사람 영상)$/;
const SOUND = /^(Audio to speak|입힐 오디오|말할 오디오)$/;

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; setup?: Act; act?: Act }

const named = (name: RegExp): Act => async (page) => {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};
const fillLipsync: Act = async (page) => {
  await page.getByLabel(VIDEO).setInputFiles(CLIP);
  await page.getByLabel(SOUND).setInputFiles(AUDIO);
  await page.waitForTimeout(1200);
};
const noKeys: Act = async (page) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    const text = (await response.text()).replaceAll('"hasKey":true', '"hasKey":false').replaceAll('"keySource":"config"', '"keySource":null');
    await route.fulfill({ response, body: text });
  });
};

const CELLS: Cell[] = [
  { id: "speak__empty", hash: "/video?mode=speak" },
  { id: "speak__lipsync-filled", hash: "/video?mode=speak", act: fillLipsync },
  { id: "speak__picker", hash: "/video?mode=speak", act: named(/^(Model|모델): /) },
  { id: "speak__guide", hash: "/video?mode=speak", act: named(/^(How it works|사용 방법)$/) },
  {
    id: "speak__avatar-filled", hash: "/video?mode=speak",
    act: async (page) => {
      await named(/^(Avatar|아바타)$/)(page);
      await page.getByLabel(/^(Face photo|얼굴 사진)$/).setInputFiles(FACE);
      await page.getByLabel(SOUND).setInputFiles(AUDIO);
      await page.waitForTimeout(1200);
    },
  },
  {
    id: "speak__dubbing-language", hash: "/video?mode=speak",
    act: async (page) => {
      await named(/^(Dubbing|더빙)$/)(page);
      await page.getByLabel(/^(Video to dub|더빙할 영상)$/).setInputFiles(CLIP);
      await page.waitForTimeout(1200);
      await named(/^(Dub into|더빙할 언어)/)(page);
    },
  },
  { id: "speak__nokey", hash: "/video?mode=speak", setup: noKeys },
  { id: "speak__loading", hash: "/video?mode=speak", setup: async (page) => { await page.route("**/api/media/catalog*", () => undefined); } },
  {
    id: "speak__unreadable-length", hash: "/video?mode=speak",
    act: async (page) => {
      await page.getByLabel(VIDEO).setInputFiles(CLIP);
      await page.getByLabel(SOUND).setInputFiles(BROKEN);
      await page.waitForTimeout(1500);
    },
  },
  {
    id: "speak__submit-error", hash: "/video?mode=speak",
    setup: async (page) => {
      await page.route("**/api/media", (route) => (route.request().method() === "POST"
        ? route.fulfill({ status: 502, json: { error: { code: "FAL_UPSTREAM", message: "The provider did not answer" } } })
        : route.fallback()));
    },
    act: async (page) => {
      await fillLipsync(page);
      await named(/^(Generate|생성)/)(page);
      await page.waitForTimeout(800);
    },
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("talking video states", async ({ browser }) => {
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

