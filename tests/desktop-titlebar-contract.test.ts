import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Contract for the integrated titlebar: no separate titlebar WebContentsView,
// macOS traffic lights sit over the nav rail's reserved top row, and the served
// web UI gets only the platform from the preload bridge.
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function src(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("integrated titlebar", () => {
  it("removes the separate titlebar WebContentsView and its page", () => {
    const windows = src("desktop/lib/windows.mjs");
    assert.equal(existsSync(join(root, "desktop/lib/titlebar.mjs")), false);
    assert.equal(existsSync(join(root, "desktop/pages/titlebar.html")), false);
    assert.equal(existsSync(join(root, "desktop/pages/titlebar.js")), false);
    assert.ok(!windows.includes("WebContentsView"), "main window must render the UI in its own webContents");
  });

  it("keeps hiddenInset and centers traffic lights over the nav rail's top row", () => {
    const windows = src("desktop/lib/windows.mjs");
    assert.ok(windows.includes('"hiddenInset"'), "macOS must keep the hidden title bar");
    const pos = windows.match(/TRAFFIC_LIGHT_POSITION = \{ x: (\d+), y: (\d+) \}/);
    assert.ok(pos, "TRAFFIC_LIGHT_POSITION must stay a pinned literal");
    const [x, y] = [Number(pos[1]), Number(pos[2])];

    const css = src("ui/src/styles/desktop-shell.css");
    const rail = css.match(/--nav-rail-w:\s*(\d+)px/);
    const row = css.match(/--mac-titlebar-h:\s*(\d+)px/);
    assert.ok(rail && row, "desktop-shell.css must pin the macOS rail width and title row");
    const [railW, rowH] = [Number(rail[1]), Number(row[1])];
    // hiddenInset draws a ~52px-wide, ~14px-tall cluster whose top-left is (x, y).
    assert.ok(Math.abs(x + 26 - railW / 2) <= 2, `traffic lights (x=${x}) are not centered over the ${railW}px rail`);
    assert.ok(Math.abs(y + 7 - rowH / 2) <= 2, `traffic lights (y=${y}) are not centered in the ${rowH}px row`);
    assert.ok(/\.app--mac-desktop \.nav-rail \{[^}]*width: var\(--nav-rail-w\)/s.test(css),
      "the rail must follow --nav-rail-w so the grid column and rail stay in sync");
  });

  it("keeps browser sessions free of desktop chrome", () => {
    const css = src("ui/src/styles/desktop-shell.css");
    for (const rule of css.match(/^[^\s/*][^{]*\{/gm) ?? []) {
      assert.ok(rule.includes(".app--mac-desktop"), `desktop-shell.css rule leaks into the browser: ${rule}`);
    }
    assert.ok(!existsSync(join(root, "ui/src/components/SidebarTopStrip.tsx")), "no in-page titlebar controls");
    assert.ok(src("ui/src/App.tsx").includes("isMacDesktop() && !isMobile"), "desktop class is gated on the shell");
  });

  it("exposes only the platform to the served UI", () => {
    const preload = src("desktop/preload.cjs");
    const served = preload.slice(preload.indexOf("} else {"));
    assert.ok(served.includes("platform: process.platform"));
    assert.ok(!served.includes("ipcRenderer"), "served UI must not reach any ipc channel");
    const ipc = src("desktop/lib/ipc.mjs");
    assert.ok(!ipc.includes("allowServed"), "every ipc channel stays file://-only");
  });

  it("keeps desktop settings in the application menu", () => {
    const menu = src("desktop/lib/menu.mjs");
    assert.ok(menu.includes('{ label: "Settings…", accelerator: "Cmd+,", click: () => actions.openSettings() }'));
  });
});
