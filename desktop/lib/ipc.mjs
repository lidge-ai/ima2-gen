import { BrowserWindow, app, ipcMain, shell } from "electron";

/**
 * Only bundled desktop pages (file://) may drive the shell. Channels the served
 * ima2 UI legitimately needs (the settings gear in its top strip) opt in with
 * `allowServed`, which also trusts the local server origin — never remote pages.
 */
export function registerIpc({ settingsStore, supervisor, actions, info }) {
  const isTrustedSender = (url, allowServed) => {
    if (url.startsWith("file:")) return true;
    return allowServed && Boolean(supervisor.url) && url.startsWith(supervisor.url);
  };
  function handle(channel, fn, { allowServed = false } = {}) {
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedSender(e.senderFrame?.url ?? "", allowServed)) {
        throw new Error(`ipc ${channel}: untrusted sender`);
      }
      return fn(e, ...args);
    });
  }

  handle("desktop:status", () => supervisor.snapshot());
  handle("desktop:settings:get", () => settingsStore.get());
  handle("desktop:settings:save", (_e, patch) => settingsStore.update(patch ?? {}));
  handle("desktop:info", () => ({
    ...info,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath("userData"),
    updaterActive: actions.updaterActive,
  }));
  handle("desktop:check-updates", () => actions.checkForUpdates());
  handle("desktop:server:restart", () => actions.restartServer());
  handle("desktop:open-app", () => actions.openApp());
  handle("desktop:open-settings", () => actions.openSettings(), { allowServed: true });
  handle("desktop:open-in-browser", () => actions.openInBrowser(), { allowServed: true });
  handle("desktop:open-generated", () => actions.openGenerated());
  handle("desktop:open-logs", () => actions.openLogs());
  handle("desktop:open-config-dir", () => shell.openPath(actions.configDir()));
  handle("desktop:tray:snapshot", () => actions.traySnapshot());
  handle("desktop:tray:hide", () => actions.hideTrayPopup());
  handle("desktop:quit", () => actions.quit());
  handle("desktop:close-self", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}
