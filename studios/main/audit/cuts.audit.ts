import { test, type Browser, type Page } from "@playwright/test";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of Director studio's cut list.
// Run: npx playwright test -c audit/playwright.audit.config.ts cuts.audit.ts --project=studio

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; act?: Act }
const on: Act = async (page) => { await page.getByRole("button", { name: /^(Cut list|컷 목록)$/ }).click(); };
const fill = (texts: string[]): Act => async (page) => {
  for (let i = 2; i < texts.length; i += 1) await page.getByRole("button", { name: /^(Add shot|컷 추가)$/ }).click();
  const boxes = page.locator(".cut textarea");
  for (const [i, text] of texts.entries()) await boxes.nth(i).fill(text);
  await page.waitForTimeout(700);
};
const length = (n: number, seconds: number): Act => async (page) => {
  await page.locator(".cut").nth(n - 1).locator(".cut-head button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp("^" + seconds + "(\\s?s|초)$") }).click();
};
const then = (...acts: Act[]): Act => async (page) => { for (const act of acts) await act(page); };
const THREE = ["She opens the door onto a wet street", "Rain runs down the window of the tram", "The street below, lamps coming on one by one"];
const SIX = [...THREE, "A cat under the awning", "Her reflection in a puddle", "The tram pulls away"];

const CELLS: Cell[] = [
  { id: "cuts__one-scene" },
  { id: "cuts__empty", act: on },
  { id: "cuts__filled", act: then(on, fill(THREE), length(2, 8)) },
  { id: "cuts__length-menu", act: then(on, fill(THREE), async (page) => { await page.locator(".cut").nth(1).locator(".cut-head button").first().click(); await page.waitForTimeout(300); }) },
  { id: "cuts__full-over", act: then(on, fill(SIX), length(1, 12), length(2, 12), length(3, 12), length(4, 12), length(5, 12), length(6, 12)) },
  {
    id: "cuts__refused",
    act: then(
      async (page) => {
        await page.route("**/api/workflows/director-studio/estimate", (route) =>
          route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "WORKFLOW_INPUT_INVALID", error: "shots: shot 2 is 12 s; bytedance/seedance-2.5 makes 4-10 s per shot", field: "shots", status: 400 }) }),
        );
      },
      on, fill(THREE),
      async (page) => { await page.unroute("**/api/workflows/director-studio/estimate"); },
    ),
  },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("cut list states", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of CELLS) {
      try {
        await page.goto("about:blank");
        await page.goto("/#/director/director-studio");
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
