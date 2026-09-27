import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Contract for the integrated titlebar (Codex-style): no separate titlebar
// WebContentsView, macOS traffic lights share the UI's own 40px top row, and
// the served web UI gets only a minimal preload bridge.
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

  it("keeps hiddenInset and centers traffic lights in the UI's top row", () => {
    const windows = src("desktop/lib/windows.mjs");
    assert.ok(windows.includes('"hiddenInset"'), "macOS must keep the hidden title bar");
    const pos = windows.match(/TRAFFIC_LIGHT_POSITION = \{ x: (\d+), y: (\d+) \}/);
    assert.ok(pos, "TRAFFIC_LIGHT_POSITION must stay a pinned literal");
    const [x, y] = [Number(pos[1]), Number(pos[2])];

    const css = src("ui/src/styles/top-strip.css");
    // Both are divided by the page zoom so ⌘−/⌘+ cannot slide the row off the lights.
    const row = css.match(/--chrome-top-h:\s*calc\((\d+)px \/ var\(--chrome-zoom, 1\)\)/);
    const inset = css.match(/\.app--macos \{ --tl-inset: calc\((\d+)px \/ var\(--chrome-zoom, 1\)\); \}/);
    assert.ok(row && inset, "top-strip.css must pin --chrome-top-h and the macOS --tl-inset");
    assert.ok(src("ui/src/App.tsx").includes("syncDesktopChromeZoom()"),
      "App must publish --chrome-zoom for the zoom-independent title row");
    assert.ok(css.includes(".panel-top"), "the mirrored right-panel strip must exist");
    assert.ok(/\.panel-top \{[^}]*height: var\(--chrome-top-h\)/s.test(css),
      ".panel-top must share the same row height as the left strip");
    const rowH = Number(row[1]);
    // Traffic lights are ~12-14px tall: y is their TOP edge, so centering them
    // in the row means y + ~7 == rowH / 2. Bound generously, pin the row math.
    assert.ok(y >= Math.floor(rowH / 2) - 8 && y <= Math.floor(rowH / 2),
      `trafficLightPosition.y=${y} does not center a ~14px cluster in the ${rowH}px strip`);
    assert.ok(x >= 8 && x <= 24, `trafficLightPosition.x=${x} drifts from the left corner`);
    assert.equal(Number(inset[1]), 80, "macOS strip inset must cover the traffic-light cluster");
  });

  it("shares the same 40px row with overlay caption buttons on Windows", () => {
    const windows = src("desktop/lib/windows.mjs");
    // Only Windows hides the native caption and overlays min/max/close into the
    // web strip; Linux keeps the native default frame (overlay unverified there).
    assert.ok(/titleBarStyle: process\.platform === "darwin" \? "hiddenInset" : process\.platform === "win32" \? "hidden" : "default"/.test(windows),
      "only win32 may drop the native caption; other non-mac stays on the default frame");
    assert.ok(windows.includes('process.platform === "win32" ? { titleBarOverlay: TITLE_BAR_OVERLAY, autoHideMenuBar: true } : {}'),
      "titleBarOverlay and the auto-hidden menu bar must be win32-only");
    const overlay = windows.match(/TITLE_BAR_OVERLAY = \{ height: (\d+), color: "(#[0-9a-fA-F]+)", symbolColor: "(#[0-9a-fA-F]+)" \}/);
    assert.ok(overlay, "Windows main window needs a pinned titleBarOverlay literal");
    assert.ok(windows.includes("autoHideMenuBar: true"),
      "the native menu bar must not render a second row (Alt still reveals it)");

    const loading = src("desktop/pages/loading.css");
    assert.ok(!loading.includes('data-platform="linux"'),
      "loading page keeps its native frame on Linux — no drag strip there");

    const css = src("ui/src/styles/top-strip.css");
    const row = css.match(/--chrome-top-h:\s*calc\((\d+)px \/ var\(--chrome-zoom, 1\)\)/);
    const inset = css.match(/\.app--windows \{ --wc-inset: calc\((\d+)px \/ var\(--chrome-zoom, 1\)\); \}/);
    assert.ok(row && inset, "top-strip.css must pin --chrome-top-h and the Windows --wc-inset");
    assert.equal(Number(overlay[1]), Number(row[1]),
      "overlay height must equal the web strip's row height");
    assert.ok(Number(inset[1]) >= 46 * 3,
      `--wc-inset=${inset[1]} must clear the 3 caption buttons (~46px each)`);
    assert.ok(/\.app--windows \.panel-top \{[^}]*var\(--wc-inset\)/s.test(css),
      "the right-strip toggle must sit clear of the overlay buttons");
    assert.ok(css.includes("app--settings-open:not(.app--windows) .panel-top"),
      "on Windows .panel-top must stay mounted as the drag surface under the overlay");

    assert.ok(src("ui/src/App.tsx").includes('" app--windows"'),
      "App must tag the windows desktop shell like app--macos");
    const shell = src("ui/src/lib/desktopShell.ts");
    assert.ok(shell.includes('platform === "win32"'),
      "desktopShell must expose a Windows check off the bridge platform");
  });

  it("keeps sidebar-less workspaces and the node toolbar clear of the strip", () => {
    const css = src("ui/src/styles/top-strip.css");
    // Collapsed nav drops the grid to one column — the sidebar-less workspaces
    // pin column 2 for the rail, so without the override they leave a dead band.
    assert.ok(
      /\.app\.app--nav-collapsed > \.home-workspace,\s*\.app\.app--nav-collapsed > \.agent-workspace,\s*\.app\.app--nav-collapsed > \.assets-workspace,\s*\.app\.app--nav-collapsed > \.assetgen-workspace \{\s*grid-column: 1 \/ -1;/s.test(css),
      "collapsed home/agent/assets/assetgen workspaces must span the single column",
    );
    assert.ok(
      /\.app--rp-collapsed \.node-canvas \.node-studio-toolbar \{[^}]*margin-right: calc\(15px \+ 44px \+ var\(--wc-inset\)\)/s.test(css),
      "the node canvas toolbar must clear the floating panel toggle when collapsed",
    );
  });

  it("exposes only a minimal bridge to the served UI", () => {
    const preload = src("desktop/preload.cjs");
    const served = preload.slice(preload.indexOf("} else {"));
    assert.ok(served.includes('"desktop:open-settings"'), "served UI needs the settings button");
    for (const ch of [
      "desktop:status", "settings:get", "settings:save", "server:restart",
      "open-logs", "open-config-dir", "open-in-browser", "desktop:quit", "tray:snapshot",
    ]) {
      assert.ok(!served.includes(ch), `served UI must not reach ${ch}`);
    }
  });

  it("gates served-UI ipc channels on the local server origin", () => {
    const ipc = src("desktop/lib/ipc.mjs");
    assert.ok(ipc.includes("isLocalServerUrl(url, supervisor.url)"),
      "allowServed must compare the sender origin (scheme+host+port) with the local server");
    assert.ok(ipc.includes('handle("desktop:open-settings", () => actions.openSettings(), { allowServed: true })'));
    // every privileged channel stays file://-only
    for (const ch of ["desktop:status", "desktop:settings:get", "desktop:settings:save", "desktop:server:restart", "desktop:quit", "desktop:open-in-browser"]) {
      const line = ipc.split("\n").find((l) => l.includes(`handle("${ch}"`));
      assert.ok(line && !line.includes("allowServed"), `${ch} must remain file://-only`);
    }
  });
});
