import { test, type Browser, type Page } from "@playwright/test";
import { LOCALES, record, shoot } from "./lib.ts";

// State × width captures of the camera moves: the menu on a prompt, and the cards on the Presets page.
// Run: npx playwright test -c audit/playwright.audit.config.ts motion.audit.ts --project=studio

type Act = (page: Page) => Promise<void>;
interface Cell { id: string; hash: string; act?: Act }
const BUTTON = /^(Camera move|카메라 무브)$/;
const openMenu: Act = async (page) => { await page.getByRole("button", { name: BUTTON }).first().click(); await page.waitForTimeout(300); };
const typed = (text: string): Act => async (page) => { await page.getByRole("textbox").first().fill(text); };
const then = (...acts: Act[]): Act => async (page) => { for (const act of acts) await act(page); };
const VIDEO = "/video?model=bytedance%2Fseedance-2.5";

const CELLS: Cell[] = [
  { id: "motion__button", hash: VIDEO, act: typed("A fox trots along a frozen harbor at dawn") },
  { id: "motion__menu", hash: VIDEO, act: then(typed("A fox trots along a frozen harbor at dawn"), openMenu) },
  { id: "motion__menu-search", hash: VIDEO, act: then(openMenu, async (page) => { await page.getByRole("dialog").getByRole("searchbox").fill("drone"); }) },
  { id: "motion__menu-none", hash: VIDEO, act: then(openMenu, async (page) => { await page.getByRole("dialog").getByRole("searchbox").fill("teleport"); }) },
  {
    id: "motion__inserted", hash: VIDEO,
    act: then(typed("A fox trots along a frozen harbor at dawn"), openMenu, async (page) => { await page.getByRole("dialog").getByRole("button", { name: /^(Orbit left|왼쪽으로 돌기)$/ }).click(); await page.waitForTimeout(300); }),
  },
  { id: "motion__cards", hash: "/presets/moves" },
  { id: "motion__cards-search", hash: "/presets/moves", act: async (page) => { await page.getByRole("searchbox").fill("drone"); } },
  { id: "motion__cards-none", hash: "/presets/moves", act: async (page) => { await page.getByRole("searchbox").fill("teleport"); } },
  { id: "motion__director", hash: "/director/director-studio", act: then(typed("She crosses the square as the lamps come on"), openMenu) },
];

async function open(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
  return context.newPage();
}

test("camera move states", async ({ browser }) => {
  for (const locale of LOCALES) {
    const page = await open(browser, locale);
    for (const c of CELLS) {
      try {
        await page.goto("about:blank");
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
