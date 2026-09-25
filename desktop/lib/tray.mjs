import { Menu, Tray, nativeImage } from "electron";

const STATE_LABEL = {
  starting: "Starting server…",
  running: "Server running",
  stopped: "Server stopped",
  error: "Server error",
};

function loadTrayIcon(iconPath, platform) {
  const img = nativeImage.createFromPath(iconPath);
  if (platform === "darwin") img.setTemplateImage(true);
  return img;
}

/**
 * Tray gestures follow the opencodex desktop shell:
 *   Windows  left click toggles the status popup, double click opens the window, right click the menu.
 *   Linux    StatusNotifier hosts rarely deliver clicks, so the menu is the whole interaction and
 *            carries a "Show Status" entry for the popup.
 *   macOS    the menu opens on click (NSStatusItem), also with a "Show Status" entry.
 */
export class TrayController {
  constructor({ iconPath, updateIconPath, actions, platform = process.platform }) {
    this.iconPath = iconPath;
    this.updateIconPath = updateIconPath ?? iconPath;
    this.actions = actions;
    this.platform = platform;
    this.tray = null;
    this.status = { state: "stopped", url: null, external: false };
    this.settings = {};
    this.updatePending = false;
  }

  create() {
    if (this.tray) return this.tray;
    this.tray = new Tray(loadTrayIcon(this.iconPath, this.platform));
    this.tray.setToolTip("ima2");
    if (this.platform === "win32") {
      this.tray.on("click", () => this.actions.toggleTrayPopup?.(this.bounds()));
      this.tray.on("double-click", () => {
        this.actions.hideTrayPopup?.();
        this.actions.openApp();
      });
    } else if (this.platform === "linux") {
      this.tray.on("click", () => this.actions.openApp());
    }
    this.render();
    return this.tray;
  }

  bounds() {
    try {
      return this.tray?.getBounds() ?? null;
    } catch {
      return null;
    }
  }

  update({ status, settings }) {
    if (status) this.status = status;
    if (settings) this.settings = settings;
    this.render();
  }

  setUpdatePending(pending) {
    if (this.updatePending === pending) return;
    this.updatePending = pending;
    if (this.tray && this.platform !== "darwin") {
      this.tray.setImage(loadTrayIcon(pending ? this.updateIconPath : this.iconPath, this.platform));
    }
    this.render();
  }

  statusLine() {
    const { state, url, external, lastError } = this.status;
    if (state === "running" && url) return `${STATE_LABEL.running} · ${url.replace(/^https?:\/\//, "")}${external ? " (external)" : ""}`;
    if (state === "error" && lastError) return `${STATE_LABEL.error}: ${lastError}`;
    return STATE_LABEL[state] ?? state;
  }

  menuTemplate() {
    const running = this.status.state === "running";
    const updater = Boolean(this.actions.updaterActive);
    return [
      { label: this.statusLine(), enabled: false },
      { type: "separator" },
      { label: "Show Status", click: () => this.actions.showTrayPopup?.(this.bounds()) },
      { label: "Open ima2", click: () => this.actions.openApp(), enabled: running || this.status.state === "starting" },
      { label: "Open in Browser", click: () => this.actions.openInBrowser(), enabled: running },
      { label: "Open Generated Folder", click: () => this.actions.openGenerated() },
      { type: "separator" },
      { label: "Start at Login", type: "checkbox", checked: Boolean(this.settings.openAtLogin), click: (item) => this.actions.setOpenAtLogin?.(item.checked) },
      { label: "Restart Server", click: () => this.actions.restartServer(), enabled: !this.status.external },
      { label: "Open Server Log", click: () => this.actions.openLogs() },
      { type: "separator" },
      { label: this.updatePending ? "Update Ready — Restart to Install…" : "Check for Updates…", enabled: updater, visible: updater, click: () => this.actions.checkForUpdates() },
      { label: "Settings…", click: () => this.actions.openSettings() },
      { type: "separator" },
      { label: "Quit ima2", click: () => this.actions.quit() },
    ];
  }

  render() {
    if (!this.tray) return;
    this.tray.setContextMenu(Menu.buildFromTemplate(this.menuTemplate()));
    this.tray.setToolTip(`ima2 — ${this.statusLine()}`.slice(0, 127));
  }

  /** One-time Windows balloon explaining that closing the window keeps ima2 in the tray. */
  notifyStillRunning() {
    if (!this.tray || this.platform !== "win32") return;
    this.tray.displayBalloon({
      iconType: "info",
      title: "ima2 is still running",
      content: "The local server keeps running in the notification area. Right-click the tray icon to quit.",
    });
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}
