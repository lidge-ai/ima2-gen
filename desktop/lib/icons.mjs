import { existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "icon.png", "icon.ico",
  "tray.png", "tray.ico", "tray-update.png", "tray-update.ico",
  "trayTemplate.png", "trayTemplate@2x.png",
];

/** Tray image per platform: ICO on Windows (per-DPI frames), template glyph on macOS, PNG on Linux. */
export function trayIconName(platform, { update = false } = {}) {
  if (platform === "darwin") return "trayTemplate.png";
  const stem = update ? "tray-update" : "tray";
  return platform === "win32" ? `${stem}.ico` : `${stem}.png`;
}

/**
 * Resolves the app/tray icon paths. The build tree only holds generated icons when
 * `npm run icons` (or `npm start`, or electron-builder's beforeBuild hook) ran —
 * a bare `electron .` or a package produced without them leaves the menubar icon
 * invisible. When any are missing, generate a fresh set into a writable dir.
 */
export async function resolveIconPaths({ buildDir, fallbackDir, platform = process.platform, log = console.warn }) {
  const missing = REQUIRED.some((name) => !existsSync(join(buildDir, name)));
  let dir = buildDir;
  if (missing) {
    try {
      const { generateIcons } = await import("../scripts/make-icons.mjs");
      dir = await generateIcons(fallbackDir);
      log(`[desktop] icons missing from ${buildDir}; generated into ${dir}`);
    } catch (error) {
      log(`[desktop] icon generation failed: ${error.message}`);
    }
  }
  return {
    appIcon: join(dir, platform === "win32" ? "icon.ico" : "icon.png"),
    trayIcon: join(dir, trayIconName(platform)),
    trayUpdateIcon: join(dir, trayIconName(platform, { update: true })),
  };
}
