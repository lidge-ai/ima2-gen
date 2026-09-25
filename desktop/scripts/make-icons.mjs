// Generates desktop icons from the brand assets:
//   icon.png            1024x1024 app icon from assets/logo.png (electron-builder derives .icns)
//   icon.ico            16-256px multi-resolution app icon (Windows window/taskbar/installer)
//   tray.png            32x32 tray icon from assets/brand/favicon.svg (dark tile reads on light and dark trays)
//   tray.ico            16-48px multi-resolution tray icon (Windows notification area, per-DPI crisp)
//   tray-update.*       the same tray icon with an update dot (Windows/Linux pending-update indicator)
//   trayTemplate.png    22x22 + @2x template icon from assets/brand/mark.svg (macOS menubar)
// Callable as a CLI (`npm run icons`) or imported (main.mjs self-heal, beforeBuild hook).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const APP_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48];

// macOS template images must be black + alpha; the OS tints them for the menubar appearance.
function templateGlyph() {
  return Buffer.from(readFileSync(mark, "utf8").replace('fill="currentColor"', 'fill="#000"'));
}

/** Packs PNG frames into a Vista+ ICO container (PNG-compressed entries). */
export function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

function updateDot(size) {
  const r = Math.max(3, Math.round(size * 0.2));
  const c = size - r - Math.max(0, Math.round(size * 0.02));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="#ff5a4e" stroke="#111214" stroke-width="${Math.max(1, size / 20)}"/></svg>`,
  );
}

async function trayPng(size, withDot) {
  const base = sharp(favicon, { density: 300 }).resize(size, size).png();
  if (!withDot) return base.toBuffer();
  return sharp(await base.toBuffer()).composite([{ input: updateDot(size) }]).png().toBuffer();
}

async function writeIco(file, sizes, render) {
  const frames = [];
  for (const size of sizes) frames.push({ size, png: await render(size) });
  writeFileSync(file, encodeIco(frames));
}

export async function generateIcons(outDir = defaultOutDir) {
  mkdirSync(outDir, { recursive: true });
  await sharp(logo).resize(1024, 1024).png().toFile(join(outDir, "icon.png"));
  await writeIco(join(outDir, "icon.ico"), APP_ICO_SIZES, (size) => sharp(logo).resize(size, size).png().toBuffer());
  // favicon.svg is 512px intrinsic, mark.svg is ~1400px from its viewBox: both already
  // rasterize well above the 22-44px targets at the default density.
  for (const withDot of [false, true]) {
    const stem = withDot ? "tray-update" : "tray";
    writeFileSync(join(outDir, `${stem}.png`), await trayPng(32, withDot));
    writeFileSync(join(outDir, `${stem}@2x.png`), await trayPng(64, withDot));
    await writeIco(join(outDir, `${stem}.ico`), TRAY_ICO_SIZES, (size) => trayPng(size, withDot));
  }
  for (const [name, size] of [["trayTemplate.png", 22], ["trayTemplate@2x.png", 44]]) {
    await sharp(templateGlyph())
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
