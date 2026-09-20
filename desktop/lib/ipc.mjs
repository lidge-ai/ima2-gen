import { BrowserWindow, app, ipcMain, shell } from "electron";

/** Only the bundled desktop pages (file://) may drive the shell; the served ima2 UI gets no bridge. */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame?.url.startsWith("file:")) throw new Error(`ipc ${channel}: untrusted sender`);
    return fn(e, ...args);
  });
}

export function registerIpc({ settingsStore, supervisor, actions, info }) {
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
  }));
  handle("desktop:server:restart", () => actions.restartServer());
  handle("desktop:open-app", () => actions.openApp());
  handle("desktop:open-settings", () => actions.openSettings());
  handle("desktop:open-generated", () => actions.openGenerated());
  handle("desktop:open-logs", () => actions.openLogs());
  handle("desktop:open-config-dir", () => shell.openPath(actions.configDir()));
  handle("desktop:close-self", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}
