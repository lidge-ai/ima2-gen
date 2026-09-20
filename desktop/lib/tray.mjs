import { Menu, Tray, nativeImage } from "electron";

const STATE_LABEL = {
  starting: "Starting server…",
  running: "Server running",
  stopped: "Server stopped",
  error: "Server error",
};

function loadTrayIcon(iconPath) {
  const img = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") img.setTemplateImage(true);
  return img;
}

export class TrayController {
  constructor({ iconPath, actions }) {
    this.iconPath = iconPath;
    this.actions = actions;
    this.tray = null;
    this.status = { state: "stopped", url: null, external: false };
    this.settings = {};
  }

  create() {
    if (this.tray) return this.tray;
    this.tray = new Tray(loadTrayIcon(this.iconPath));
    this.tray.setToolTip("ima2");
    if (process.platform !== "darwin") this.tray.on("click", () => this.actions.openApp());
    this.render();
    return this.tray;
  }

  update({ status, settings }) {
    if (status) this.status = status;
    if (settings) this.settings = settings;
    this.render();
  }

  #statusLine() {
    const { state, url, external, lastError } = this.status;
    if (state === "running" && url) return `${STATE_LABEL.running} · ${url.replace(/^https?:\/\//, "")}${external ? " (external)" : ""}`;
    if (state === "error" && lastError) return `${STATE_LABEL.error}: ${lastError}`;
    return STATE_LABEL[state] ?? state;
  }

  render() {
    if (!this.tray) return;
    const running = this.status.state === "running";
    const menu = Menu.buildFromTemplate([
      { label: this.#statusLine(), enabled: false },
      { type: "separator" },
      { label: "Open ima2", accelerator: "CmdOrCtrl+O", click: () => this.actions.openApp(), enabled: running || this.status.state === "starting" },
      { label: "Open in Browser", click: () => this.actions.openInBrowser(), enabled: running },
      { label: "Open Generated Folder", click: () => this.actions.openGenerated() },
      { type: "separator" },
      { label: "Restart Server", click: () => this.actions.restartServer(), enabled: !this.status.external },
      { label: "Open Server Log", click: () => this.actions.openLogs() },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => this.actions.openSettings() },
      { type: "separator" },
      { label: "Quit ima2", accelerator: "CmdOrCtrl+Q", click: () => this.actions.quit() },
    ]);
    this.tray.setContextMenu(menu);
    this.tray.setToolTip(`ima2 — ${this.#statusLine()}`);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}
