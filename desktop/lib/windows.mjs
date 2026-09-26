import { BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isExternalWebUrl, isLocalServerUrl, resolveWindowOpen } from "./window-open.mjs";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PRELOAD = join(desktopDir, "preload.cjs");
const LOADING_PAGE = join(desktopDir, "pages", "loading.html");
const SETTINGS_PAGE = join(desktopDir, "pages", "settings.html");

// The web UI draws the title row itself (ui/src/styles/top-strip.css, --chrome-top-h).
// The traffic lights sit inside it: x clears the toggle-left air, y centers the
// ~14px-tall cluster in the 40px row. Pinned by tests/desktop-titlebar-contract.test.ts.
const TRAFFIC_LIGHT_POSITION = { x: 16, y: 13 };

export class WindowManager {
  constructor({ getServerUrl, getSettings, iconPath, onVisibilityChange, onHiddenToTray }) {
    this.getServerUrl = getServerUrl;
    this.getSettings = getSettings;
    this.iconPath = iconPath;
    this.onVisibilityChange = onVisibilityChange ?? (() => {});
    this.onHiddenToTray = onHiddenToTray ?? (() => {});
    this.main = null;
    this.settings = null;
    this.quitting = false;
  }

  #webPreferences() {
    return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };
  }

  #baseOptions(extra) {
    return {
      show: false,
      backgroundColor: "#111214",
      icon: this.iconPath,
      webPreferences: this.#webPreferences(),
      ...extra,
    };
  }

  showMain() {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore();
      this.main.show();
      this.main.focus();
      return this.main;
    }
    const win = new BrowserWindow(this.#baseOptions({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      title: "ima2",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    }));
    this.main = win;
    win.show();
    win.on("close", (e) => {
      if (this.quitting || !this.getSettings().keepRunningOnClose) return;
      e.preventDefault();
      win.hide();
      this.onHiddenToTray();
    });
    win.on("closed", () => {
      this.main = null;
      this.onVisibilityChange();
    });
    win.on("hide", () => this.onVisibilityChange());
    win.on("show", () => this.onVisibilityChange());
    const contents = win.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      const outcome = resolveWindowOpen(url, this.getServerUrl());
      if (outcome === "allow") return { action: "allow" };
      if (outcome === "external") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (e, url) => {
      if (isLocalServerUrl(url, this.getServerUrl()) || url.startsWith("file:")) return;
      e.preventDefault();
      if (isExternalWebUrl(url)) void shell.openExternal(url);
    });
    // A server that is up but fails the page load would otherwise leave Chromium's error
    // page with no way back; show the loading screen (and its restart/log actions) instead.
    contents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || String(url).startsWith("file:")) return;
      void contents.loadFile(LOADING_PAGE);
    });
    this.syncMainContent();
    return win;
  }

  /** Point the main window at the live server once it is up, else the loading page. */
  syncMainContent() {
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    const contents = win.webContents;
    const url = this.getServerUrl();
    const current = contents.getURL();
    if (url) {
      if (!current.startsWith(url)) void contents.loadURL(url);
      return;
    }
    if (!current.startsWith("file:")) void contents.loadFile(LOADING_PAGE);
  }

  #allContents() {
    return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => w.webContents);
  }

  showSettings() {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show();
      this.settings.focus();
      return this.settings;
    }
    const win = new BrowserWindow(this.#baseOptions({
      width: 520,
      height: 780,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "ima2 Settings",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    }));
    this.settings = win;
    win.setMenuBarVisibility(false);
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => { this.settings = null; this.onVisibilityChange(); });
    void win.loadFile(SETTINGS_PAGE);
    return win;
  }

  broadcast(channel, payload) {
    for (const contents of this.#allContents()) contents.send(channel, payload);
  }

  hideAll() {
    for (const win of BrowserWindow.getAllWindows()) win.hide();
  }

  hasVisibleWindow() {
    return BrowserWindow.getAllWindows().some((w) => w.isVisible());
  }

  closeAllForQuit() {
    this.quitting = true;
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  }
}
