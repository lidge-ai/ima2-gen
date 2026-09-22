async function stopAndDispose(supervisor, logger) {
  try {
    await supervisor.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[desktop] server shutdown failed: ${message}`);
  } finally {
    supervisor.dispose();
  }
}

export function wireAppLifecycle(options) {
  const { app, supervisor, windows, settingsStore, applyDockVisibility, logger = console } = options;
  let state = "running";

  app.on("second-instance", () => windows.showMain());
  app.on("activate", () => windows.showMain());
  app.on("window-all-closed", () => {
    if (state !== "running") return;
    if (!settingsStore.get().keepRunningOnClose) app.quit();
    else applyDockVisibility(settingsStore.get(), windows);
  });
  app.on("before-quit", (event) => {
    if (state === "update-install") return;
    event.preventDefault();
    if (state !== "running") return;
    state = "normal-quit";
    windows.closeAllForQuit();
    void stopAndDispose(supervisor, logger).finally(() => app.exit(0));
  });

  return {
    async prepareForUpdateInstall() {
      if (state !== "running") return false;
      state = "update-preparing";
      await stopAndDispose(supervisor, logger);
      state = "update-install";
      return true;
    },
  };
}
