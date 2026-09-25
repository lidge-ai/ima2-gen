const UPDATE_DOWNLOAD_BUTTON = 0;
const UPDATE_INSTALL_BUTTON = 0;

function inactiveController() {
  return {
    active: false,
    checkForUpdates: async () => false,
    setAutoDownload: () => {},
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

/**
 * Self-update coverage matches what the release publishes: signed+notarized
 * Apple Silicon macOS, NSIS-installed Windows (every shipped Windows package
 * is an installer; a zip is never published), and Linux only when running from
 * an AppImage — a deb install has no writable self-update path and must stay
 * inactive.
 */
function updaterSupported({ platform, arch, env }) {
  if (platform === "darwin") return arch === "arm64";
  if (platform === "win32") return true;
  if (platform === "linux") return Boolean(env.APPIMAGE);
  return false;
}

export async function createUpdaterController(options) {
  const {
    app,
    dialog,
    prepareForInstall,
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    logger = console,
    loadUpdater = () => import("electron-updater"),
    autoDownload = true,
    onUpdateReady = () => {},
  } = options;
  if (!app.isPackaged || !updaterSupported({ platform, arch, env })) return inactiveController();

  let autoUpdater;
  try {
    autoUpdater = resolveAutoUpdater(await loadUpdater());
    if (!autoUpdater) throw new Error("electron-updater did not export autoUpdater");
  } catch (error) {
    logger.error(`[desktop:update] updater unavailable: ${errorMessage(error)}`);
    return inactiveController();
  }

  // Auto-update mode downloads in the background; manual checks still prompt first.
  autoUpdater.autoDownload = autoDownload;
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
      // With autoDownload on, electron-updater is already downloading; no prompt needed.
      if (!autoUpdater.autoDownload) {
        const prompt = await dialog.showMessageBox(updateAvailableDialog(result.updateInfo.version));
        if (prompt.response === UPDATE_DOWNLOAD_BUTTON) await autoUpdater.downloadUpdate();
      }
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
    onUpdateReady(info);
    void (async () => {
      const prompt = await dialog.showMessageBox(updateDownloadedDialog(info.version));
      if (prompt.response !== UPDATE_INSTALL_BUTTON) return;
      if (await prepareForInstall()) autoUpdater.quitAndInstall();
    })().catch((error) => {
      logger.error(`[desktop:update] install preparation failed: ${errorMessage(error)}`);
    });
  });

  return {
    active: true,
    checkForUpdates,
    setAutoDownload: (enabled) => { autoUpdater.autoDownload = enabled === true; },
  };
}
