import { BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  constructor({ getServerUrl, getSettings, iconPath }) {
    this.getServerUrl = getServerUrl;
    this.getSettings = getSettings;
    this.iconPath = iconPath;
    this.main = null;
    this.settings = null;
    this.quitting = false;
  }

  #baseOptions(extra) {
    return {
      show: false,
      backgroundColor: "#111214",
      icon: this.iconPath,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
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
    win.once("ready-to-show", () => win.show());
    win.on("close", (e) => {
      if (this.quitting || !this.getSettings().keepRunningOnClose) return;
      e.preventDefault();
      win.hide();
    });
    win.on("closed", () => { this.main = null; });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isLocalServerUrl(url, this.getServerUrl())) return { action: "allow" };
      void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (isLocalServerUrl(url, this.getServerUrl()) || url.startsWith("file:")) return;
      e.preventDefault();
      void shell.openExternal(url);
    });
    this.syncMainContent();
    return win;
  }

  /** Point the main window at the live server once it is up, else the loading page. */
  syncMainContent() {
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    const url = this.getServerUrl();
    const current = win.webContents.getURL();
    if (url) {
      if (!current.startsWith(url)) void win.loadURL(url);
      return;
    }
    if (!current.startsWith("file:")) void win.loadFile(LOADING_PAGE);
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
    win.on("closed", () => { this.settings = null; });
    void win.loadFile(SETTINGS_PAGE);
    return win;
  }

  broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
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
