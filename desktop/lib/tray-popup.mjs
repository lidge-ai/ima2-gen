import { BrowserWindow, screen } from "electron";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { popupGeometry, trayAnchor } from "./tray-geometry.mjs";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PRELOAD = join(desktopDir, "preload.cjs");
const TRAY_PAGE = join(desktopDir, "pages", "tray.html");

// Closing on focus loss is what makes the popup feel like a menu. Windows can hand focus back to
// the taskbar right after the click that opened it, which would close the popup in the same
// gesture; a short grace window makes that race unreachable.
const FOCUS_GRACE_MS = 400;

/** Windows 11 22H2 (build 22621) is the first build with a DWM acrylic backdrop for Electron. */
export function supportsAcrylic(platform = process.platform, osRelease = release()) {
  if (platform !== "win32") return false;
  const build = Number(String(osRelease).split(".")[2]);
  return Number.isInteger(build) && build >= 22621;
}

export class TrayPopup {
  constructor({ onVisibilityChange } = {}) {
    this.win = null;
    this.shownAt = 0;
    this.onVisibilityChange = onVisibilityChange ?? (() => {});
    this.acrylic = supportsAcrylic();
  }

  #ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "ima2",
      backgroundColor: this.acrylic ? "#00000000" : "#141518",
      ...(this.acrylic ? { backgroundMaterial: "acrylic" } : {}),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--ima2-tray-acrylic=${this.acrylic ? "on" : "off"}`],
      },
    });
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.on("blur", () => {
      if (Date.now() - this.shownAt >= FOCUS_GRACE_MS) this.hide();
    });
    win.on("close", (e) => {
      if (this.disposing) return;
      e.preventDefault();
      this.hide();
    });
    win.on("closed", () => { this.win = null; });
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void win.loadFile(TRAY_PAGE);
    this.win = win;
    return win;
  }

  isVisible() {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  show(trayBounds) {
    const win = this.#ensure();
    const probe = trayBounds && trayBounds.width > 0 ? { x: trayBounds.x, y: trayBounds.y } : screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(probe);
    win.setBounds(popupGeometry(trayAnchor(trayBounds, workArea), workArea));
    this.shownAt = Date.now();
    win.show();
    win.focus();
    win.webContents.send("desktop:tray:visibility", true);
    this.onVisibilityChange(true);
  }

  hide() {
    if (!this.isVisible()) return;
    this.win.hide();
    this.win.webContents.send("desktop:tray:visibility", false);
    this.onVisibilityChange(false);
  }

  toggle(trayBounds) {
    if (this.isVisible()) this.hide();
    else this.show(trayBounds);
  }

  destroy() {
    this.disposing = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
