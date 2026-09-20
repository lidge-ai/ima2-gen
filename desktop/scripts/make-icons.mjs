// Generates desktop/build icons from assets/logo.png:
//   icon.png            1024x1024 app icon (electron-builder derives .icns/.ico)
//   tray.png            32x32 colored tray icon (Windows/Linux)
//   trayTemplate.png    22x22 + @2x monochrome template icon (macOS menubar)
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..", "..");
const outDir = resolve(here, "..", "build");
const logo = join(rootDir, "assets", "logo.png");
const WHITE_CUTOFF = 240;

async function knockOutWhite(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > WHITE_CUTOFF && data[i + 1] > WHITE_CUTOFF && data[i + 2] > WHITE_CUTOFF) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

const TRAY_GLYPH = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">
  <g fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="9" width="22" height="22" rx="5"/>
    <path d="M7 27 L14 19 L19 24 L23 20 L26 23"/>
    <path d="M26 20 L33 14 M26 20 L33 26"/>
  </g>
  <g fill="#000">
    <circle cx="12" cy="15.5" r="2.2"/>
    <circle cx="35.5" cy="12" r="3.2"/>
    <circle cx="35.5" cy="28" r="3.2"/>
  </g>
</svg>`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const transparent = await knockOutWhite(logo);
  const png = await transparent.png().toBuffer();
  await sharp(png).resize(1024, 1024).png().toFile(join(outDir, "icon.png"));
  await sharp(png).resize(32, 32).png().toFile(join(outDir, "tray.png"));
  await sharp(Buffer.from(TRAY_GLYPH)).resize(22, 22).png().toFile(join(outDir, "trayTemplate.png"));
  await sharp(Buffer.from(TRAY_GLYPH)).resize(44, 44).png().toFile(join(outDir, "trayTemplate@2x.png"));
  console.log(`[desktop] icons written to ${outDir}`);
}

await main();
