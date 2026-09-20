const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ima2Desktop", {
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke("desktop:status"),
  getSettings: () => ipcRenderer.invoke("desktop:settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("desktop:settings:save", patch),
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  restartServer: () => ipcRenderer.invoke("desktop:server:restart"),
  openApp: () => ipcRenderer.invoke("desktop:open-app"),
  openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
  openGenerated: () => ipcRenderer.invoke("desktop:open-generated"),
  openLogs: () => ipcRenderer.invoke("desktop:open-logs"),
  openConfigDir: () => ipcRenderer.invoke("desktop:open-config-dir"),
  closeWindow: () => ipcRenderer.invoke("desktop:close-self"),
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("desktop:status", handler);
    return () => ipcRenderer.removeListener("desktop:status", handler);
  },
});
