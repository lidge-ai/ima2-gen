import { BrowserWindow, app, ipcMain, shell } from "electron";

export function registerIpc({ settingsStore, supervisor, actions, info }) {
  ipcMain.handle("desktop:status", () => supervisor.snapshot());
  ipcMain.handle("desktop:settings:get", () => settingsStore.get());
  ipcMain.handle("desktop:settings:save", (_e, patch) => settingsStore.update(patch ?? {}));
  ipcMain.handle("desktop:info", () => ({
    ...info,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath("userData"),
  }));
  ipcMain.handle("desktop:server:restart", () => actions.restartServer());
  ipcMain.handle("desktop:open-app", () => actions.openApp());
  ipcMain.handle("desktop:open-settings", () => actions.openSettings());
  ipcMain.handle("desktop:open-generated", () => actions.openGenerated());
  ipcMain.handle("desktop:open-logs", () => actions.openLogs());
  ipcMain.handle("desktop:open-config-dir", () => shell.openPath(actions.configDir()));
  ipcMain.handle("desktop:close-self", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}
