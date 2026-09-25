// Capture README screenshots from an isolated demo runtime.
// Usage (from ui/): node ../devlog/_plan/260925_readme_release/scripts/capture-readme.mjs <baseUrl> <outDir> <graphSessionId>
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

// Playwright lives in ui/node_modules; resolve it from the current directory.
const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");

const [base = "http://127.0.0.1:3401", outDir = "/tmp/ima2-readme-demo/shots", graphSession = ""] = process.argv.slice(2);
const HERO = "gpt-5.6-luna_3x2_20260925_Studio-still-life-of_0.png";
const CUTOUT = "gpt-5.6-luna_1x1_20260925_A-vintage-silver-ran_0_2.png";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
async function page(storage, height = 900) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height }, deviceScaleFactor: 2, colorScheme: "dark" });
  await ctx.addInitScript((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, Object.entries({ "ima2.onboardingDismissed": "1", "ima2.themeMode": "dark", ...storage }));
  const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  return p;
}
async function settle(p, ms = 1500) { await p.waitForLoadState("networkidle"); await p.waitForTimeout(ms); }
async function park(p) { await p.mouse.move(1439, 899); await p.waitForTimeout(400); }
async function select(p, filename) {
  await p.getByRole("button", { name: "Create" }).first().click();
  await settle(p, 600);
  await p.locator(`img[src*="${filename.replace(/\.png$/, "")}"]`).first().click();
  await settle(p, 900);
}

// Create workspace with a finished result and prompt.
{
  const p = await page({});
  await select(p, HERO);
  await p.locator("textarea").first().fill("Abstract liquid-chrome sculpture on a matte black plinth, charcoal gradient backdrop, crisp rim light, high-end product photography");
  await settle(p, 400);
  await park(p);
  await p.screenshot({ path: `${outDir}/readme-create.png` });
  await p.context().close();
}
// Home with recent work.
{
  const p = await page({}, 1100);
  await p.getByRole("button", { name: "Home" }).first().click();
  await settle(p);
  await p.mouse.move(1439, 1099);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${outDir}/readme-home.png` });
  await p.context().close();
}
// Node graph: one source, three branches.
if (graphSession) {
  const p = await page({ "ima2.activeSessionId": graphSession });
  await p.getByRole("button", { name: "Node graph" }).first().click();
  await settle(p, 2500);
  await p.locator(".right-panel-toggle").first().click({ timeout: 5000 });
  await settle(p, 800);
  await p.locator(".react-flow__controls-fitview").first().click();
  await settle(p, 1200);
  // The floating toolbar covers the top of a fitted graph; step out once.
  await p.locator(".react-flow__controls-zoomout").first().click();
  await settle(p, 800);
  await park(p);
  await p.screenshot({ path: `${outDir}/readme-node.png` });
  await p.context().close();
}
// Canvas Mode on a transparent cutout.
{
  const p = await page({});
  await select(p, CUTOUT);
  await p.getByRole("button", { name: "Open image in canvas mode" }).first().click();
  await settle(p, 2000);
  await park(p);
  await p.screenshot({ path: `${outDir}/readme-canvas.png` });
  await p.context().close();
}
await browser.close();
