import { BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mountTitlebarLayout } from "./titlebar.mjs";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PRELOAD = join(desktopDir, "preload.cjs");
const LOADING_PAGE = join(desktopDir, "pages", "loading.html");
const SETTINGS_PAGE = join(desktopDir, "pages", "settings.html");

function isLocalServerUrl(target, serverUrl) {
  if (!serverUrl) return false;
  try {
    return new URL(target).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

export class WindowManager {
  constructor({ getServerUrl, getSettings, iconPath, onVisibilityChange, onHiddenToTray }) {
    this.getServerUrl = getServerUrl;
    this.getSettings = getSettings;
    this.iconPath = iconPath;
    this.onVisibilityChange = onVisibilityChange ?? (() => {});
    this.onHiddenToTray = onHiddenToTray ?? (() => {});
    this.main = null;
    this.mainContent = null;
    this.titlebar = null;
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
      trafficLightPosition: { x: 14, y: 14 },
    }));
    this.main = win;
    const { bar, content } = mountTitlebarLayout(win, this.#webPreferences());
    this.titlebar = bar;
    this.mainContent = content;
    win.show();
    win.on("close", (e) => {
      if (this.quitting || !this.getSettings().keepRunningOnClose) return;
      e.preventDefault();
      win.hide();
      this.onHiddenToTray();
    });
    win.on("closed", () => {
      this.main = null;
      this.mainContent = null;
      this.titlebar = null;
      this.onVisibilityChange();
    });
    win.on("hide", () => this.onVisibilityChange());
    win.on("show", () => this.onVisibilityChange());
    content.webContents.setWindowOpenHandler(({ url }) => {
      if (isLocalServerUrl(url, this.getServerUrl())) return { action: "allow" };
      void shell.openExternal(url);
      return { action: "deny" };
    });
    content.webContents.on("will-navigate", (e, url) => {
      if (isLocalServerUrl(url, this.getServerUrl()) || url.startsWith("file:")) return;
      e.preventDefault();
      void shell.openExternal(url);
    });
    // A server that is up but fails the page load would otherwise leave Chromium's error
    // page with no way back; show the loading screen (and its restart/log actions) instead.
    content.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || String(url).startsWith("file:")) return;
      void content.webContents.loadFile(LOADING_PAGE);
    });
    this.syncMainContent();
    return win;
  }

  /** Point the main content view at the live server once it is up, else the loading page. */
  syncMainContent() {
    const view = this.mainContent;
    if (!view || !this.main || this.main.isDestroyed()) return;
    const url = this.getServerUrl();
    const current = view.webContents.getURL();
    if (url) {
      if (!current.startsWith(url)) void view.webContents.loadURL(url);
      return;
    }
    if (!current.startsWith("file:")) void view.webContents.loadFile(LOADING_PAGE);
  }

  #allContents() {
    const list = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => w.webContents);
    for (const view of [this.titlebar, this.mainContent]) {
      if (view && !view.webContents.isDestroyed()) list.push(view.webContents);
    }
    return list;
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
