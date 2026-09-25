import { app, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "./lib/settings.mjs";
import { resolveIconPaths } from "./lib/icons.mjs";
import { ServerSupervisor } from "./lib/server.mjs";
import { WindowManager } from "./lib/windows.mjs";
import { TrayController } from "./lib/tray.mjs";
import { TrayPopup } from "./lib/tray-popup.mjs";
import { collectTraySnapshot } from "./lib/tray-data.mjs";
import { createLoginItem } from "./lib/login-item.mjs";
import { installApplicationMenu } from "./lib/menu.mjs";
import { registerIpc } from "./lib/ipc.mjs";
import { wireAppLifecycle } from "./lib/app-lifecycle.mjs";
import { createUpdaterController } from "./lib/updater.mjs";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(desktopDir, "..");
const isMac = process.platform === "darwin";
const buildDir = join(desktopDir, "build");

app.setName("ima2");
if (process.platform === "win32") app.setAppUserModelId("com.lidge.ima2");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

async function boot() {
  await app.whenReady();

  const { appIcon, trayIcon, trayUpdateIcon } = await resolveIconPaths({
    buildDir,
    fallbackDir: join(app.getPath("userData"), "icons"),
    log: (line) => console.warn(line),
  });

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
    onVisibilityChange: () => {
      if (!windows.main && !windows.settings && !settingsStore.get().keepRunningOnClose) popup.release();
      applyDockVisibility(settingsStore.get(), windows);
    },
    onHiddenToTray: () => notifyHiddenToTray(),
  });
  let trayHintShown = false;
  const notifyHiddenToTray = () => {
    if (trayHintShown) return;
    trayHintShown = true;
    tray.notifyStillRunning();
  };
  const loginItem = createLoginItem({ app });
  const popup = new TrayPopup();
  const lifecycle = wireAppLifecycle({ supervisor, windows, settingsStore, applyDockVisibility, app });
  const updater = await createUpdaterController({
    app,
    dialog,
    prepareForInstall: () => lifecycle.prepareForUpdateInstall(),
    autoDownload: settingsStore.get().autoUpdate,
    onUpdateReady: () => tray.setUpdatePending(true),
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
    checkForUpdates: () => updater.checkForUpdates({ manual: true }),
    updaterActive: updater.active,
    configDir,
    quit: () => app.quit(),
    toggleTrayPopup: (bounds) => popup.toggle(bounds),
    showTrayPopup: (bounds) => popup.show(bounds),
    hideTrayPopup: () => popup.hide(),
    traySnapshot: () => collectTraySnapshot({ status: supervisor.snapshot() }),
    setOpenAtLogin: (enabled) => settingsStore.update({ openAtLogin: enabled === true }),
  };

  const tray = new TrayController({ iconPath: trayIcon, updateIconPath: trayUpdateIcon, actions });
  app.on("before-quit", () => popup.destroy());
  tray.create();
  tray.update({ settings: settingsStore.get() });
  installApplicationMenu(actions);
  registerIpc({ settingsStore, supervisor, actions, info: { rootDir, logFile: supervisor.logFile } });

  supervisor.on("status", (status) => {
    tray.update({ status });
    windows.broadcast("desktop:status", status);
    popup.win?.webContents.send("desktop:status", status);
    windows.syncMainContent();
  });
  settingsStore.onChange((next, changed) => onSettingsChanged({ next, changed, supervisor, tray, windows, updater, loginItem }));

  if (settingsStore.get().openAtLogin) applyLoginItem(loginItem, settingsStore.get());
  applyDockVisibility(settingsStore.get(), windows);

  if (!existsSync(join(rootDir, "server.js"))) {
    dialog.showErrorBox("ima2 server build missing", `server.js not found in ${rootDir}.\nRun: npm run build:server && npm run ui:build`);
  }

  if (!settingsStore.get().startHidden) windows.showMain();
  await supervisor.start(settingsStore.get());
  if (settingsStore.get().autoUpdate) void updater.checkForUpdates();
}

function onSettingsChanged({ next, changed, supervisor, tray, windows, updater, loginItem }) {
  tray.update({ settings: next });
  if (changed.includes("autoUpdate")) updater.setAutoDownload(next.autoUpdate);
  windows.broadcast("desktop:status", supervisor.snapshot());
  if (changed.includes("openAtLogin") || changed.includes("startHidden")) applyLoginItem(loginItem, next);
  if (changed.includes("menubarOnly")) applyDockVisibility(next, windows);
  const needsRestart = ["port", "devLogging", "nodeBinary", "configDir"];
  if (changed.some((k) => needsRestart.includes(k))) void supervisor.restart(next);
}

function applyLoginItem(loginItem, settings) {
  if (!app.isPackaged) return;
  try {
    loginItem.set(settings.openAtLogin, { hidden: settings.startHidden === true });
  } catch (error) {
    console.warn(`[desktop] login item update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyDockVisibility(settings, windows) {
  if (!isMac || !app.dock) return;
  if (settings.menubarOnly && !windows.hasVisibleWindow()) app.dock.hide();
  else app.dock.show();
}
