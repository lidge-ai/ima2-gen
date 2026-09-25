const { contextBridge, ipcRenderer } = require("electron");

// The bridge is only for the bundled desktop pages (loading/settings/titlebar).
// The served ima2 UI (http://127.0.0.1:<port>) runs in the same view but must
// not be able to touch settings or the server process.
if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("ima2Desktop", {
    platform: process.platform,
    getStatus: () => ipcRenderer.invoke("desktop:status"),
    getSettings: () => ipcRenderer.invoke("desktop:settings:get"),
    saveSettings: (patch) => ipcRenderer.invoke("desktop:settings:save", patch),
    getInfo: () => ipcRenderer.invoke("desktop:info"),
    restartServer: () => ipcRenderer.invoke("desktop:server:restart"),
    checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
    openApp: () => ipcRenderer.invoke("desktop:open-app"),
    openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
    openGenerated: () => ipcRenderer.invoke("desktop:open-generated"),
    openLogs: () => ipcRenderer.invoke("desktop:open-logs"),
    openConfigDir: () => ipcRenderer.invoke("desktop:open-config-dir"),
    closeWindow: () => ipcRenderer.invoke("desktop:close-self"),
    trayAcrylic: process.argv.includes("--ima2-tray-acrylic=on"),
    getTraySnapshot: () => ipcRenderer.invoke("desktop:tray:snapshot"),
    hideTrayPopup: () => ipcRenderer.invoke("desktop:tray:hide"),
    openInBrowser: () => ipcRenderer.invoke("desktop:open-in-browser"),
    quit: () => ipcRenderer.invoke("desktop:quit"),
    onTrayVisibility: (cb) => {
      const handler = (_e, visible) => cb(visible);
      ipcRenderer.on("desktop:tray:visibility", handler);
      return () => ipcRenderer.removeListener("desktop:tray:visibility", handler);
    },
    onStatus: (cb) => {
      const handler = (_e, status) => cb(status);
      ipcRenderer.on("desktop:status", handler);
      return () => ipcRenderer.removeListener("desktop:status", handler);
    },
  });
}
