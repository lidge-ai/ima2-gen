// Generates desktop icons from the brand assets:
//   icon.png            1024x1024 app icon from assets/logo.png (electron-builder derives .icns/.ico)
//   tray.png            32x32 tray icon from assets/brand/favicon.svg (dark tile reads on light and dark trays)
//   trayTemplate.png    22x22 + @2x template icon from assets/brand/mark.svg (macOS menubar)
// Callable as a CLI (`npm run icons`) or imported (main.mjs self-heal, beforeBuild hook).
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..", "..");
const defaultOutDir = resolve(here, "..", "build");
const logo = join(rootDir, "assets", "logo.png");
const mark = join(rootDir, "assets", "brand", "mark.svg");
const favicon = join(rootDir, "assets", "brand", "favicon.svg");
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// macOS template images must be black + alpha; the OS tints them for the menubar appearance.
function templateGlyph() {
  return Buffer.from(readFileSync(mark, "utf8").replace('fill="currentColor"', 'fill="#000"'));
}

export async function generateIcons(outDir = defaultOutDir) {
  mkdirSync(outDir, { recursive: true });
  await sharp(logo).resize(1024, 1024).png().toFile(join(outDir, "icon.png"));
  await sharp(favicon, { density: 300 }).resize(32, 32).png().toFile(join(outDir, "tray.png"));
  for (const [name, size] of [["trayTemplate.png", 22], ["trayTemplate@2x.png", 44]]) {
    await sharp(templateGlyph(), { density: 300 })
      .resize(size, size, { fit: "contain", background: CLEAR })
      .png()
      .toFile(join(outDir, name));
  }
  return outDir;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const outDir = await generateIcons();
  console.log(`[desktop] icons written to ${outDir}`);
}
