const UPDATE_DOWNLOAD_BUTTON = 0;
const UPDATE_INSTALL_BUTTON = 0;

function inactiveController() {
  return {
    active: false,
    checkForUpdates: async () => false,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function resolveAutoUpdater(module) {
  return module?.autoUpdater ?? module?.default?.autoUpdater;
}

function updateAvailableDialog(version) {
  return {
    type: "info",
    buttons: ["Download Update", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "ima2 Update",
    message: `ima2 ${version} is available.`,
    detail: "Download the update now?",
  };
}

function updateDownloadedDialog(version) {
  return {
    type: "info",
    buttons: ["Restart and Install", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "ima2 Update Ready",
    message: `ima2 ${version} is ready to install.`,
    detail: "ima2 will stop its local server and restart to finish the update.",
  };
}

export async function createUpdaterController(options) {
  const {
    app,
    dialog,
    prepareForInstall,
    platform = process.platform,
    arch = process.arch,
    logger = console,
    loadUpdater = () => import("electron-updater"),
  } = options;
  if (!app.isPackaged || platform !== "darwin" || arch !== "arm64") return inactiveController();

  let autoUpdater;
  try {
    autoUpdater = resolveAutoUpdater(await loadUpdater());
    if (!autoUpdater) throw new Error("electron-updater did not export autoUpdater");
  } catch (error) {
    logger.error(`[desktop:update] updater unavailable: ${errorMessage(error)}`);
    return inactiveController();
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("error", (error) => {
    logger.error(`[desktop:update] ${errorMessage(error)}`);
  });

  let checking = false;
  const checkForUpdates = async ({ manual = false } = {}) => {
    if (checking) return false;
    checking = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return false;
      if (!result.isUpdateAvailable) {
        if (manual) await dialog.showMessageBox({ type: "info", title: "ima2 Update", message: "ima2 is up to date." });
        return true;
      }
      const prompt = await dialog.showMessageBox(updateAvailableDialog(result.updateInfo.version));
      if (prompt.response === UPDATE_DOWNLOAD_BUTTON) await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      logger.error(`[desktop:update] check failed: ${errorMessage(error)}`);
      if (manual) {
        await dialog.showMessageBox({ type: "error", title: "ima2 Update", message: "Unable to check for updates.", detail: errorMessage(error) });
      }
      return false;
    } finally {
      checking = false;
    }
  };

  autoUpdater.on("update-downloaded", (info) => {
    void (async () => {
      const prompt = await dialog.showMessageBox(updateDownloadedDialog(info.version));
      if (prompt.response !== UPDATE_INSTALL_BUTTON) return;
      if (await prepareForInstall()) autoUpdater.quitAndInstall();
    })().catch((error) => {
      logger.error(`[desktop:update] install preparation failed: ${errorMessage(error)}`);
    });
  });

  return { active: true, checkForUpdates };
}
