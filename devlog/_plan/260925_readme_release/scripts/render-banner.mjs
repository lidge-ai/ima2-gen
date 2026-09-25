// Render assets/brand/banner.png from banner.html (run from ui/ so Playwright and sharp resolve).
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const req = createRequire(join(process.cwd(), "package.json"));
const { chromium } = req("playwright");
const sharp = req("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../../../assets/brand/banner.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(here, "banner.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const png = await page.screenshot({ type: "png", omitBackground: true });
await browser.close();
await sharp(png).png({ compressionLevel: 9, palette: false }).toFile(out);
console.log(out);
