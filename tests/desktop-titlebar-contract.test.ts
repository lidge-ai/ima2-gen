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
    const row = css.match(/--chrome-top-h:\s*(\d+)px/);
    const inset = css.match(/\.app--macos \{ --tl-inset: (\d+)px; \}/);
    assert.ok(row && inset, "top-strip.css must pin --chrome-top-h and the macOS --tl-inset");
    const rowH = Number(row[1]);
    // Traffic lights are ~12-14px tall: y is their TOP edge, so centering them
    // in the row means y + ~7 == rowH / 2. Bound generously, pin the row math.
    assert.ok(y >= Math.floor(rowH / 2) - 8 && y <= Math.floor(rowH / 2),
      `trafficLightPosition.y=${y} does not center a ~14px cluster in the ${rowH}px strip`);
    assert.ok(x >= 8 && x <= 24, `trafficLightPosition.x=${x} drifts from the left corner`);
    assert.equal(Number(inset[1]), 80, "macOS strip inset must cover the traffic-light cluster");
  });

  it("exposes only a minimal bridge to the served UI", () => {
    const preload = src("desktop/preload.cjs");
    const served = preload.slice(preload.indexOf("} else {"));
    assert.ok(served.includes('"desktop:open-settings"'), "served UI needs the settings button");
    for (const ch of [
      "desktop:status", "settings:get", "settings:save", "server:restart",
      "open-logs", "open-config-dir", "desktop:quit", "tray:snapshot",
    ]) {
      assert.ok(!served.includes(ch), `served UI must not reach ${ch}`);
    }
  });

  it("gates served-UI ipc channels on the local server origin", () => {
    const ipc = src("desktop/lib/ipc.mjs");
    assert.ok(ipc.includes("url.startsWith(supervisor.url)"),
      "allowServed must verify the sender is the local server");
    assert.ok(ipc.includes('handle("desktop:open-settings", () => actions.openSettings(), { allowServed: true })'));
    // every privileged channel stays file://-only
    for (const ch of ["desktop:status", "desktop:settings:get", "desktop:settings:save", "desktop:server:restart", "desktop:quit"]) {
      const line = ipc.split("\n").find((l) => l.includes(`handle("${ch}"`));
      assert.ok(line && !line.includes("allowServed"), `${ch} must remain file://-only`);
    }
  });
});
