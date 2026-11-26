import { test, expect, type Browser, type Page } from "@playwright/test";
import { LOCALES, saveText, shoot } from "./lib.ts";

// Screen × state × width matrix of the higgs studio (L7 design audit). Tests run in order on
// one fake server: pristine states first, then seeded results. A cell that cannot be reached
// is recorded in metrics.jsonl as { cell, unreachable } instead of failing the run.

const LONG =
  "A slow dolly through a rain-soaked night market where steam rises from food stalls, neon signs in Korean and English flicker over puddles, a cyclist in a yellow raincoat crosses the frame, the camera keeps a shallow depth of field and ends on a close-up of a paper lantern swaying in the wind, AnUnbrokenTokenWithoutSpacesThatShouldWrapInsteadOfOverflowingTheCardLayout1234567890";

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({
    locale: locale === "ko" ? "ko-KR" : "en-US",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

type Act = (page: Page) => Promise<void>;
interface Cell {
  id: string;
  hash: string;
  act?: Act;
  /** Route overrides installed before navigation. */
  setup?: Act;
}

async function cell(page: Page, locale: string, c: Cell) {
  try {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (c.setup) await c.setup(page);
    // Leave the app first: going to the same URL with only a hash change would not reload,
    // so route overrides (no keys, stalled or failing requests) and open popovers would leak.
    await page.goto("about:blank");
    await page.goto("/#" + c.hash);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
    if (c.act) await c.act(page);
    await shoot(page, c.id, locale);
    if (locale === LOCALES[0]) saveText(c.id + ".html", await page.content());
  } catch (err) {
    const { record } = await import("./lib.ts");
    record({ cell: c.id, locale, unreachable: String(err).slice(0, 300) });
  }
}

const noKeys: Act = async (page) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    const text = (await response.text()).replaceAll('"hasKey":true', '"hasKey":false').replaceAll('"keySource":"config"', '"keySource":null');
    await route.fulfill({ response, body: text });
  });
};
const failing = (pattern: string): Act => async (page) => {
  await page.route(pattern, (route) => route.fulfill({ status: 500, json: { error: { code: "AUDIT_DOWN", message: "Server unavailable" } } }));
};
const stalled = (pattern: string): Act => async (page) => {
  await page.route(pattern, () => undefined);
};
/** Click the first visible control with this name, whatever role the build gives it (tab, button, radio). */
const click = (name: RegExp): Act => async (page) => {
  for (const role of ["button", "tab", "radio", "link"] as const) {
    const target = page.getByRole(role, { name }).filter({ visible: true }).first();
    if (await target.count()) {
      await target.click();
      await page.waitForTimeout(300);
      return;
    }
  }
  throw new Error("No visible control named " + String(name));
};
const GENERATE = /^(Generate|생성)/;
const SAVE = /^(Save|저장)/;
const KEY_LABEL = /^(API key|API 키)$/;
const prompt = (text: string): Act => async (page) => {
  await page.locator("textarea").first().fill(text);
};
const tab = (key: number): Act => async (page) => {
  for (let i = 0; i < key; i++) await page.keyboard.press("Tab");
};
/** Six showcase clips (the fake's two, repeated) so Home shows the grid, not the wide 1–2 clip cards. */
const clips = (count: number): Act => async (page) => {
  await page.route("**/api/showcase", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    const items = Array.from({ length: count }, (_, i) => ({ ...body.items[i % body.items.length]!, id: "audit-clip-" + i }));
    await route.fulfill({ response, json: { items } });
  });
};
const sixClips: Act = async (page) => {
  await page.route("**/api/showcase", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    const items = Array.from({ length: 6 }, (_, i) => ({ ...body.items[i % body.items.length]!, id: "audit-clip-" + i }));
    await route.fulfill({ response, json: { items } });
  });
};
const showcaseTile = (page: Page) => page.locator(".showcase-tile").nth(1);
/** A shared web instance (L9 deployment): spend caps from /api/web/session. */
const webCaps = (requestCapUsd: number): Act => async (page) => {
  await page.route("**/api/web/session", (route) =>
    route.fulfill({ json: { email: "member@example.com", spend: { day: "2026-11-27", spentUsd: 0, dailyCapUsd: 20, requestCapUsd } } }),
  );
};
const unpricedRestyle: Act = async (page) => {
  await webCaps(5)(page);
  await page.route("**/api/workflows/remix-restyle/estimate", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.estimate.complete = false;
    body.estimate.steps[0].usd = null;
    await route.fulfill({ response, json: body });
  });
};

const PRISTINE: Cell[] = [
  { id: "home__nokeys", hash: "/", setup: noKeys },
  { id: "home__default", hash: "/" },
  { id: "home__focus", hash: "/", act: tab(6) },
  { id: "home__loading", hash: "/", setup: stalled("**/api/media/catalog*") },
  { id: "home__error", hash: "/", setup: failing("**/api/media/catalog*") },
  { id: "image__empty", hash: "/image" },
  { id: "image__picker", hash: "/image", act: click(/^(Model|모델): /) },
  { id: "image__nokey", hash: "/image", setup: noKeys },
  { id: "image__longprompt", hash: "/image", act: prompt(LONG) },
  { id: "image__loading", hash: "/image", setup: stalled("**/api/media/catalog*") },
  { id: "video__empty", hash: "/video" },
  { id: "video__picker", hash: "/video", act: click(/^(Model|모델): /) },
  { id: "video__presets", hash: "/video", act: click(/^(Presets|프리셋)$/) },
  { id: "video__guide", hash: "/video", act: click(/^(How it works|사용 방법)$/) },
  { id: "video__nokey", hash: "/video", setup: noKeys },
  { id: "video__longprompt", hash: "/video", act: prompt(LONG) },
  { id: "video__edit", hash: "/video", act: click(/^(Edit video|Edit|영상 편집)$/) },
  { id: "video__focus", hash: "/video", act: tab(9) },
  { id: "presets__video", hash: "/presets/video" },
  { id: "presets__image", hash: "/presets/image" },
  { id: "remix__motion", hash: "/remix/remix-motion-transfer" },
  { id: "remix__motion-sub", hash: "/remix/remix-motion-transfer-subscription" },
  { id: "remix__swap", hash: "/remix/remix-object-swap" },
  { id: "remix__swap-sub", hash: "/remix/remix-object-swap-subscription" },
  { id: "remix__restyle", hash: "/remix/remix-restyle" },
  { id: "remix__restyle-sub", hash: "/remix/remix-restyle-subscription" },
  { id: "remix__history-empty", hash: "/remix/remix-motion-transfer", act: click(/^(History|기록)$/) },
  { id: "remix__error", hash: "/remix", setup: failing("**/api/workflows") },
  { id: "remix__loading", hash: "/remix", setup: stalled("**/api/workflows") },
  { id: "director__studio", hash: "/director/director-studio" },
  { id: "director__cinema", hash: "/director/director-cinema" },
  { id: "director__cast", hash: "/director/director-cast" },
  { id: "director__locations", hash: "/director/director-locations" },
  { id: "director__error", hash: "/director", setup: failing("**/api/workflows") },
  { id: "models__all", hash: "/models" },
  { id: "models__heygen", hash: "/models/heygen" },
  { id: "models__audio", hash: "/models", act: click(/^(Audio|오디오)$/) },
  { id: "models__nomatch", hash: "/models", act: async (p) => p.getByRole("searchbox").first().fill("zzzz") },
  { id: "models__loading", hash: "/models", setup: stalled("**/api/media/catalog*") },
  { id: "assets__empty", hash: "/assets" },
  { id: "assets__saved-empty", hash: "/assets/saved" },
  { id: "assets__error", hash: "/assets", setup: failing("**/api/history*") },
  { id: "keys__default", hash: "/keys" },
  { id: "keys__focus", hash: "/keys?focus=byteplus" },
  { id: "keys__nomatch", hash: "/keys", act: async (p) => p.getByRole("searchbox").first().fill("zzzz") },
  { id: "keys__loading", hash: "/keys", setup: stalled("**/api/media/catalog*") },
  { id: "keys__error", hash: "/keys", setup: failing("**/api/media/catalog*") },
  {
    id: "keys__rejected",
    hash: "/keys?focus=vidu",
    act: async (p) => {
      const row = p.getByRole("article", { name: "Vidu API" });
      await row.getByLabel(KEY_LABEL).fill("rejected-by-provider");
      await row.getByRole("button", { name: SAVE }).click();
      await p.waitForTimeout(800);
    },
  },
  {
    id: "keys__env",
    hash: "/keys?focus=openai",
    setup: async (page) => {
      await page.route("**/api/media/catalog*", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.adapters = body.adapters.map((a: { keyVocabulary: string }) => (a.keyVocabulary === "openai" ? { ...a, hasKey: true, keySource: "env" } : a));
        await route.fulfill({ response, json: body });
      });
    },
  },
  { id: "notfound__route", hash: "/does-not-exist" },
  { id: "home__showcase-grid", hash: "/", setup: sixClips, act: async (p) => p.mouse.move(0, 0) },
  { id: "home__showcase-twelve", hash: "/", setup: clips(12), act: async (p) => p.mouse.move(0, 0) },
  {
    id: "remix__web-unpriced",
    hash: "/remix/remix-restyle",
    setup: unpricedRestyle,
    act: async (p) => {
      // Earlier cells used up the first-visit example, so give the run its own source.
      const remove = p.getByRole("button", { name: /^(Remove Source video|원본 영상 삭제|원본 영상 제거)/ });
      if (await remove.count()) await remove.first().click();
      await p.getByLabel(/^(Source video|원본 영상)$/).first().setInputFiles({ name: "source.mp4", mimeType: "video/mp4", buffer: Buffer.from("audit") });
      await p.waitForTimeout(1500);
    },
  },
  { id: "video__web-over-cap", hash: "/video", setup: webCaps(0.1), act: prompt("over the per-run limit") },
  {
    id: "video__picker-after-keyless",
    hash: "/video",
    act: async (p) => {
      // Pick a keyed model, then a keyless one, then reopen: Recent keeps only the keyed one.
      for (const name of [/Seedance 2\.5 Flash|시댄스 2\.5 Flash/, /Vidu Q4/]) {
        await p.getByRole("button", { name: /^(Model|모델): / }).click();
        await p.getByRole("dialog").getByRole("button", { name }).first().click();
      }
      await p.getByRole("button", { name: /^(Model|모델): / }).click();
      await p.waitForTimeout(400);
    },
  },
  { id: "home__showcase-hover", hash: "/", setup: sixClips, act: async (p) => { await showcaseTile(p).hover(); await p.waitForTimeout(400); } },
  {
    id: "home__showcase-tap",
    hash: "/",
    setup: sixClips,
    act: async (p) => {
      await showcaseTile(p).locator(".showcase-peek").click({ position: { x: 12, y: 12 } });
      await p.mouse.move(0, 0);
      await p.waitForTimeout(400);
    },
  },
];

test("pristine screens", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of PRISTINE) await cell(page, locale, c);
    await page.context().close();
  }
});

async function submitVideo(page: Page, text: string) {
  await page.goto("/#/video");
  await page.getByLabel("Prompt", { exact: true }).fill(text);
  await page.getByRole("button", { name: /Generate/ }).click();
  await page.waitForTimeout(250);
}

test("seed results", async ({ browser }) => {
  const page = await open(browser, "en");
  for (let i = 0; i < 3; i++) await submitVideo(page, "Seed clip " + (i + 1) + ": a paper boat drifting");
  await submitVideo(page, LONG);
  for (const category of ["auth", "quota", "rate-limit", "invalid-request", "moderation", "upstream", "timeout"])
    await submitVideo(page, "[fail:" + category + "] failing sample " + category);
  await page.goto("/#/image");
  for (let i = 0; i < 4; i++) {
    await page.locator("textarea").first().fill("Seed still " + (i + 1) + ": a ceramic cup on linen");
    await page.getByRole("button", { name: /Generate/ }).click();
    await page.waitForTimeout(250);
  }
  await page.goto("/#/director/director-cast");
  await page.getByLabel("Prompt", { exact: true }).fill("A traveler with a red coat");
  await page.getByRole("button", { name: /Generate/ }).click();
  await page.waitForTimeout(40_000);
  await expect(page.getByRole("button", { name: /Attach cast:/ }).first()).toBeVisible({ timeout: 60_000 });
  await page.context().close();
});

const FILLED: Cell[] = [
  { id: "home__filled", hash: "/" },
  { id: "image__filled", hash: "/image" },
  { id: "video__filled", hash: "/video" },
  {
    id: "video__running",
    hash: "/video",
    act: async (p) => {
      await p.locator("textarea").first().fill("Running sample: clouds over a ridge");
      await p.getByRole("button", { name: GENERATE }).click();
      await p.waitForTimeout(600);
    },
  },
  {
    id: "video__canceled",
    hash: "/video",
    act: async (p) => {
      await p.locator("textarea").first().fill("Canceled sample: a train at dawn");
      await p.getByRole("button", { name: GENERATE }).click();
      await p.getByRole("article", { name: /Canceled sample/ }).getByRole("button", { name: /Cancel|취소/ }).click();
      await p.waitForTimeout(600);
    },
  },
  { id: "assets__all", hash: "/assets" },
  { id: "assets__videos", hash: "/assets/videos" },
  { id: "assets__images", hash: "/assets/images" },
  { id: "assets__compact", hash: "/assets", act: click(/^(Compact|촘촘하게)$/) },
  { id: "assets__lightbox", hash: "/assets", act: async (p) => p.getByRole("button", { name: /^Open |열기$/ }).first().click() },
  { id: "director__with-cast", hash: "/director/director-studio" },
  { id: "director__cast-history", hash: "/director/director-cast" },
  { id: "keys__saved", hash: "/keys?focus=google", act: async (p) => {
      const row = p.getByRole("article", { name: /Google/ }).first();
      await row.getByLabel(KEY_LABEL).fill("fake-google-key");
      await row.getByRole("button", { name: SAVE }).click();
      await p.waitForTimeout(800);
    } },
  { id: "home__keyed", hash: "/" },
];

test("screens with results", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of FILLED) await cell(page, locale, c);
    await page.context().close();
  }
});

