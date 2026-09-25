import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { popupGeometry, trayAnchor, POPUP_WIDTH, POPUP_HEIGHT } from "../desktop/lib/tray-geometry.mjs";
import { createLoginItem, linuxAutostartEntry, linuxAutostartFile } from "../desktop/lib/login-item.mjs";
import { collectTraySnapshot } from "../desktop/lib/tray-data.mjs";
import { trayIconName } from "../desktop/lib/icons.mjs";
import { encodeIco } from "../desktop/scripts/make-icons.mjs";

const fhd = { x: 0, y: 0, width: 1920, height: 1040 };

describe("tray popup geometry", () => {
  it("opens above a bottom taskbar tray icon, centered and clamped to the right edge", () => {
    const g = popupGeometry({ x: 1800, y: 1060 }, fhd);
    assert.equal(g.width, POPUP_WIDTH);
    assert.equal(g.height, POPUP_HEIGHT);
    assert.equal(g.x, 1920 - 8 - POPUP_WIDTH);
    assert.equal(g.y, 1040 - 8 - POPUP_HEIGHT);
  });

  it("opens below a top panel icon", () => {
    const g = popupGeometry({ x: 900, y: 12 }, { x: 0, y: 28, width: 1920, height: 1052 });
    assert.equal(g.x, 900 - POPUP_WIDTH / 2);
    assert.equal(g.y, 28 + 8);
  });

  it("stays inside a secondary display with negative origin and shrinks on tiny work areas", () => {
    const area = { x: -1280, y: 0, width: 1280, height: 400 };
    const g = popupGeometry({ x: -10, y: 390 }, area);
    assert.ok(g.x >= area.x + 8 && g.x + g.width <= area.x + area.width - 8);
    assert.equal(g.height, 400 - 16);
    assert.equal(g.y, 8);
  });

  it("falls back to the work area's bottom-right corner when the tray host reports no rect", () => {
    assert.deepEqual(trayAnchor({ x: 0, y: 0, width: 0, height: 0 }, fhd), { x: 1920, y: 1040 });
    assert.deepEqual(trayAnchor({ x: 10, y: 20, width: 20, height: 40 }, fhd), { x: 20, y: 40 });
  });
});

describe("login item", () => {
  it("writes and removes an XDG autostart entry on Linux, preferring $APPIMAGE", () => {
    const home = mkdtempSync(join(tmpdir(), "ima2-autostart-"));
    const env = { XDG_CONFIG_HOME: home, APPIMAGE: "/opt/apps/ima2 1.0.AppImage" };
    const item = createLoginItem({ app: {}, platform: "linux", env, execPath: "/tmp/.mount_x/ima2" });
    const file = linuxAutostartFile(env);
    assert.equal(file, join(home, "autostart", "ima2.desktop"));
    assert.equal(item.isEnabled(), false);
    item.set(true);
    assert.equal(item.isEnabled(), true);
    assert.match(readFileSync(file, "utf8"), /^Exec="\/opt\/apps\/ima2 1\.0\.AppImage"$/m);
    item.set(false);
    assert.equal(existsSync(file), false);
  });

  it("uses Electron login item settings on Windows and macOS", () => {
    const calls: unknown[] = [];
    let open = false;
    const app = {
      getLoginItemSettings: () => ({ openAtLogin: open }),
      setLoginItemSettings: (s: { openAtLogin: boolean }) => { calls.push(s); open = s.openAtLogin; },
    };
    const item = createLoginItem({ app, platform: "win32" });
    item.set(true);
    item.set(true);
    assert.deepEqual(calls, [{ openAtLogin: true }]);
    assert.equal(item.isEnabled(), true);
  });

  it("passes openAsHidden through on macOS only", () => {
    const calls: unknown[] = [];
    let state = { openAtLogin: false, openAsHidden: false };
    const app = {
      getLoginItemSettings: () => state,
      setLoginItemSettings: (s: { openAtLogin: boolean; openAsHidden: boolean }) => { calls.push(s); state = s; },
    };
    const item = createLoginItem({ app, platform: "darwin" });
    item.set(true, { hidden: true });
    item.set(true, { hidden: true });
    item.set(true, { hidden: false });
    assert.deepEqual(calls, [{ openAtLogin: true, openAsHidden: true }, { openAtLogin: true, openAsHidden: false }]);
  });

  it("leaves plain exec paths unquoted", () => {
    assert.match(linuxAutostartEntry("/usr/bin/ima2"), /^Exec=\/usr\/bin\/ima2$/m);
  });
});

describe("tray snapshot", () => {
  it("returns only status when the server is not running", async () => {
    const snap = await collectTraySnapshot({ status: { state: "starting", url: null }, fetchImpl: () => { throw new Error("no fetch"); } });
    assert.deepEqual(snap.jobs, []);
    assert.deepEqual(snap.recent, []);
  });

  it("maps inflight jobs and recent history to absolute loopback URLs", async () => {
    const base = "http://127.0.0.1:3333";
    const fetchImpl = async (url: string) => ({
      ok: true,
      json: async () => url.includes("/api/inflight")
        ? { jobs: [{ requestId: "r1", kind: "classic", prompt: "cat", phase: "streaming", startedAt: 5 }] }
        : { items: [{ filename: "a.png", url: "/generated/a.png", thumb: "/generated/.thumbs/a.jpg", createdAt: 1 }, { filename: "b.mp4", url: "/generated/b.mp4" }] },
    });
    const snap = await collectTraySnapshot({ status: { state: "running", url: base }, fetchImpl });
    assert.equal(snap.jobs[0].phase, "streaming");
    assert.equal(snap.recent[0].thumb, `${base}/generated/.thumbs/a.jpg`);
    assert.equal(snap.recent[1].isVideo, true);
    assert.equal(snap.error, null);
  });
});

describe("platform tray icons", () => {
  it("uses ICO on Windows, PNG on Linux and the template image on macOS", () => {
    assert.equal(trayIconName("win32"), "tray.ico");
    assert.equal(trayIconName("win32", { update: true }), "tray-update.ico");
    assert.equal(trayIconName("linux", { update: true }), "tray-update.png");
    assert.equal(trayIconName("darwin", { update: true }), "trayTemplate.png");
  });

  it("encodes a PNG-framed ICO directory", () => {
    const png = Buffer.from([1, 2, 3]);
    const ico = encodeIco([{ size: 16, png }, { size: 256, png }]);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 2);
    assert.equal(ico.readUInt8(6), 16);
    assert.equal(ico.readUInt8(22), 0);
    assert.equal(ico.readUInt32LE(6 + 12), 6 + 32);
    assert.equal(ico.length, 6 + 32 + 6);
  });
});
