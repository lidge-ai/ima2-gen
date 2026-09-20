import { app, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "./lib/settings.mjs";
import { ServerSupervisor } from "./lib/server.mjs";
import { WindowManager } from "./lib/windows.mjs";
import { TrayController } from "./lib/tray.mjs";
import { installApplicationMenu } from "./lib/menu.mjs";
import { registerIpc } from "./lib/ipc.mjs";
import { registerTitlebarProtocol, registerTitlebarScheme } from "./lib/titlebar.mjs";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(desktopDir, "..");
const isMac = process.platform === "darwin";
const buildDir = join(desktopDir, "build");
const appIcon = join(buildDir, process.platform === "win32" ? "icon.ico" : "icon.png");
const trayIcon = join(buildDir, isMac ? "trayTemplate.png" : "tray.png");

app.setName("ima2");
if (process.platform === "win32") app.setAppUserModelId("com.lidge.ima2");
registerTitlebarScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

async function boot() {
  await app.whenReady();
  registerTitlebarProtocol(buildDir);

  const settingsStore = createSettingsStore(app.getPath("userData"));
  const supervisor = new ServerSupervisor({
    rootDir,
    isPackaged: app.isPackaged,
    logFile: join(app.getPath("logs"), "server.log"),
  });
  const windows = new WindowManager({
    iconPath: appIcon,
    getServerUrl: () => supervisor.url,
    getSettings: () => settingsStore.get(),
    onVisibilityChange: () => applyDockVisibility(settingsStore.get(), windows),
  });

  const configDir = () => settingsStore.get().configDir || process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
  const actions = {
    openApp: () => { if (isMac) app.dock?.show(); windows.showMain(); },
    openInBrowser: () => { if (supervisor.url) void shell.openExternal(supervisor.url); },
    openGenerated: () => shell.openPath(join(configDir(), "generated")),
    openLogs: () => shell.openPath(supervisor.logFile),
    openSettings: () => windows.showSettings(),
    openUrl: (url) => shell.openExternal(url),
    restartServer: () => supervisor.restart(settingsStore.get()),
    configDir,
    quit: () => app.quit(),
  };

  const tray = new TrayController({ iconPath: trayIcon, actions });
  tray.create();
  tray.update({ settings: settingsStore.get() });
  installApplicationMenu(actions);
  registerIpc({ settingsStore, supervisor, actions, info: { rootDir, logFile: supervisor.logFile } });

  supervisor.on("status", (status) => {
    tray.update({ status });
    windows.broadcast("desktop:status", status);
    windows.syncMainContent();
  });
  settingsStore.onChange((next, changed) => onSettingsChanged({ next, changed, supervisor, tray, windows }));

  wireAppLifecycle({ supervisor, windows, settingsStore });
  if (settingsStore.get().openAtLogin) applyLoginItem(settingsStore.get());
  applyDockVisibility(settingsStore.get(), windows);

  if (!existsSync(join(rootDir, "server.js"))) {
    dialog.showErrorBox("ima2 server build missing", `server.js not found in ${rootDir}.\nRun: npm run build:server && npm run ui:build`);
  }

  if (!settingsStore.get().startHidden) windows.showMain();
  await supervisor.start(settingsStore.get());
}

function onSettingsChanged({ next, changed, supervisor, tray, windows }) {
  tray.update({ settings: next });
  windows.broadcast("desktop:status", supervisor.snapshot());
  if (changed.includes("openAtLogin") || (next.openAtLogin && changed.includes("startHidden"))) applyLoginItem(next);
  if (changed.includes("menubarOnly")) applyDockVisibility(next, windows);
  const needsRestart = ["port", "devLogging", "nodeBinary", "configDir"];
  if (changed.some((k) => needsRestart.includes(k))) void supervisor.restart(next);
}

function applyLoginItem(settings) {
  if (!app.isPackaged) return;
  const current = app.getLoginItemSettings();
  if (current.openAtLogin === settings.openAtLogin && current.openAsHidden === settings.startHidden) return;
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: settings.startHidden });
}

function applyDockVisibility(settings, windows) {
  if (!isMac || !app.dock) return;
  if (settings.menubarOnly && !windows.hasVisibleWindow()) app.dock.hide();
  else app.dock.show();
}

function wireAppLifecycle({ supervisor, windows, settingsStore }) {
  let shuttingDown = false;

  app.on("second-instance", () => windows.showMain());
  app.on("activate", () => windows.showMain());
  app.on("window-all-closed", () => {
    if (!settingsStore.get().keepRunningOnClose) app.quit();
    else applyDockVisibility(settingsStore.get(), windows);
  });
  app.on("before-quit", (e) => {
    if (shuttingDown) return;
    shuttingDown = true;
    e.preventDefault();
    windows.closeAllForQuit();
    void supervisor.stop().finally(() => {
      supervisor.dispose();
      app.exit(0);
    });
  });
}
