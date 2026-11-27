import { test, type Page } from "@playwright/test";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { dir } from "./lib.ts";

// Journey walks for the L7 experience audit (lanes/L7-ux.md). Each journey is a scripted walk
// of what a person does, step by step, against the kit's fake server. Every step records the
// clicks and keystrokes it took, what the screen offers next, and a screenshot, so the same walk
// can be repeated after a change and compared (fewer steps, no dead ends).

const WIDTH = Number(process.env.JOURNEY_WIDTH ?? 1440);
const LOCALE = process.env.JOURNEY_LOCALE ?? "en";

class Walk {
  private n = 0;
  clicks = 0;
  keys = 0;
  constructor(
    readonly page: Page,
    readonly id: string,
  ) {}
  async step(label: string, run: () => Promise<void>, cost: { clicks?: number; keys?: number } = {}) {
    this.n += 1;
    let error: string | null = null;
    try {
      await run();
      await this.page.waitForTimeout(500);
    } catch (err) {
      error = String(err).split("\n")[0]!.slice(0, 240);
    }
    this.clicks += cost.clicks ?? 0;
    this.keys += cost.keys ?? 0;
    const view = await this.page.evaluate(() => {
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
      };
      const name = (el: Element) => (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      return {
        url: location.hash,
        heading: [...document.querySelectorAll("h1,h2")].filter(shown).map(name).slice(0, 4),
        actions: [...document.querySelectorAll("button:not([disabled]),a[href]")].filter(shown).map(name).filter(Boolean).slice(0, 25),
        disabled: [...document.querySelectorAll("button[disabled]")].filter(shown).map(name).filter(Boolean).slice(0, 8),
        alerts: [...document.querySelectorAll("[role=alert],[role=status]")].filter(shown).map(name).filter(Boolean).slice(0, 6),
      };
    });
    const file = "journey-" + this.id + "__" + String(this.n).padStart(2, "0") + "__" + WIDTH + "__" + LOCALE + ".jpg";
    await this.page.screenshot({ path: join(dir(), file), type: "jpeg", quality: 76 });
    appendFileSync(
      join(dir(), "journeys.jsonl"),
      JSON.stringify({ journey: this.id, step: this.n, label, width: WIDTH, locale: LOCALE, clicks: this.clicks, keys: this.keys, error, file, ...view }) + "\n",
    );
  }
}

async function start(browser: import("@playwright/test").Browser, id: string, noKeys = false) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH <= 390 ? 844 : 900 }, locale: LOCALE === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce" });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), LOCALE);
  const page = await context.newPage();
  if (noKeys)
    await page.route("**/api/media/catalog*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replaceAll('"hasKey":true', '"hasKey":false') });
    });
  return new Walk(page, id);
}

const T = (en: string, ko: string) => new RegExp("^(" + en + "|" + ko + ")", "i");
const visible = (page: Page, role: "button" | "link" | "tab", name: RegExp) => page.getByRole(role, { name }).filter({ visible: true }).first();
const anyControl = async (page: Page, name: RegExp) => {
  for (const role of ["button", "link", "tab"] as const) {
    const target = visible(page, role, name);
    if (await target.count()) return target;
  }
  throw new Error("no control " + String(name));
};

test("JR1 first visit to first image, no keys yet", async ({ browser }) => {
  const w = await start(browser, "jr1-first-image", true);
  const p = w.page;
  await w.step("open home", async () => {
    await p.goto("/#/");
  });
  await w.step("follow the add-key prompt", async () => (await anyControl(p, T("Add API key|Add your first API key", "API 키 추가|첫 API 키"))).click(), { clicks: 1 });
  await w.step("find a provider by search", async () => p.getByRole("searchbox").first().fill("openai"), { clicks: 1, keys: 6 });
  await p.unrouteAll({ behavior: "ignoreErrors" });
  await w.step("paste a key and save", async () => {
    const row = p.getByRole("article").filter({ hasText: /OpenAI/ }).first();
    await row.getByLabel(/API key|API 키/).fill("fake-openai-key");
    await row.getByRole("button", { name: /^(Save|저장)/ }).click();
  }, { clicks: 2, keys: 1 });
  await w.step("go to Image", async () => (await anyControl(p, T("Image$", "이미지$"))).click(), { clicks: 1 });
  await w.step("type a prompt", async () => p.locator("textarea").first().fill("A ceramic cup on linen, morning light"), { clicks: 1, keys: 1 });
  await w.step("generate", async () => visible(p, "button", T("Generate", "생성")).click(), { clicks: 1 });
  await w.step("wait for the result", async () => {
    await p.getByRole("article").filter({ hasText: /ceramic cup/ }).getByRole("link", { name: /Download|다운로드/ }).first().waitFor({ timeout: 90_000 });
  });
  await w.step("open the result", async () => p.getByRole("article").filter({ hasText: /ceramic cup/ }).locator("img,video").first().click(), { clicks: 1 });
  await p.context().close();
});

test("JR2 pick a video model, see the cost, run, fail and recover", async ({ browser }) => {
  const w = await start(browser, "jr2-video-model");
  const p = w.page;
  await w.step("open Video", async () => {
    await p.goto("/#/video");
  });
  await w.step("open the model picker", async () => visible(p, "button", /^(Model|모델): /).click(), { clicks: 1 });
  await w.step("search kling", async () => p.getByRole("dialog").getByRole("searchbox").fill("kling"), { keys: 5 });
  await w.step("pick the first Kling model", async () => p.getByRole("dialog").getByRole("button").filter({ hasText: /Kling/ }).first().click(), { clicks: 1 });
  await w.step("type a prompt and read the cost", async () => p.locator("textarea").first().fill("A paper boat drifting on a canal"), { clicks: 1, keys: 1 });
  await w.step("generate", async () => visible(p, "button", T("Generate", "생성")).click(), { clicks: 1 });
  await w.step("while it runs", async () => p.waitForTimeout(1500));
  await w.step("submit one that fails for quota", async () => {
    await p.locator("textarea").first().fill("[fail:quota] a failing sample");
    await visible(p, "button", T("Generate", "생성")).click();
    await p.getByRole("alert").first().waitFor({ timeout: 90_000 });
  }, { clicks: 2, keys: 1 });
  await p.context().close();
});

test("JR3 remix a clip", async ({ browser }) => {
  const w = await start(browser, "jr3-remix");
  const p = w.page;
  await w.step("open Remix", async () => {
    await p.goto("/#/remix");
  });
  await w.step("pick a motion clip", async () => p.locator(".remix-clip").first().click(), { clicks: 1 });
  await w.step("add a reference image", async () => {
    await p.locator("input[type=file][accept*=image]").first().setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
  }, { clicks: 1 });
  await w.step("read the plan and cost", async () => p.getByText(/Steps and estimated cost|단계와 예상 비용/).first().scrollIntoViewIfNeeded());
  await w.step("run", async () => visible(p, "button", T("Generate", "생성")).click(), { clicks: 1 });
  await w.step("watch the steps", async () => p.waitForTimeout(4000));
  await w.step("switch run path to Subscription", async () => (await anyControl(p, T("Subscription", "구독"))).click(), { clicks: 1 });
  await p.context().close();
});

test("JR4 find an earlier result and reuse it", async ({ browser }) => {
  const w = await start(browser, "jr4-find-reuse");
  const p = w.page;
  await w.step("open Assets", async () => {
    await p.goto("/#/assets");
  });
  await w.step("filter to videos", async () => (await anyControl(p, T("Videos", "영상"))).click(), { clicks: 1 });
  await w.step("open the first result", async () => visible(p, "button", /^Open |열기$/).click(), { clicks: 1 });
  await w.step("look for reuse actions", async () => p.waitForTimeout(300));
  await p.context().close();
});

