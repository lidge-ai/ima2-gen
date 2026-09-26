import { Menu, app, webContents } from "electron";
import { editMenu } from "./edit-menu.mjs";

const isMac = process.platform === "darwin";

/* The main window's own webContents is the app, but reload/zoom should still
   follow whichever surface is focused (popups, devtools) — target it directly. */
function focused() {
  return webContents.getFocusedWebContents();
}

function zoomBy(delta) {
  const wc = focused();
  if (wc) wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta);
}

function viewMenu() {
  return {
    label: "View",
    submenu: [
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focused()?.reload() },
      { label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R", click: () => focused()?.reloadIgnoringCache() },
      { label: "Toggle Developer Tools", accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I", click: () => focused()?.toggleDevTools() },
      { type: "separator" },
      { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomBy(0) },
      { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => zoomBy(0.5) },
      { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoomBy(-0.5) },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}

function appMenu(actions) {
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Check for Updates…", enabled: actions.updaterActive, visible: Boolean(actions.updaterActive), click: () => actions.checkForUpdates() },
      { type: "separator" },
      { label: "Settings…", accelerator: "Cmd+,", click: () => actions.openSettings() },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { label: "Quit ima2", accelerator: "Cmd+Q", click: () => actions.quit() },
    ],
  };
}

function serverMenu(actions) {
  return {
    label: "Server",
    submenu: [
      { label: "Open ima2", accelerator: "CmdOrCtrl+O", click: () => actions.openApp() },
      { label: "Open in Browser", click: () => actions.openInBrowser() },
      { label: "Open Generated Folder", click: () => actions.openGenerated() },
      { type: "separator" },
      { label: "Restart Server", accelerator: "CmdOrCtrl+Alt+R", click: () => actions.restartServer() },
      { label: "Open Server Log", click: () => actions.openLogs() },
      ...(isMac ? [] : [
        { type: "separator" },
        { label: "Settings…", accelerator: "Ctrl+,", click: () => actions.openSettings() },
        { type: "separator" },
        { label: "Quit ima2", accelerator: "Ctrl+Q", click: () => actions.quit() },
      ]),
    ],
  };
}

export function installApplicationMenu(actions) {
  const template = [
    ...(isMac ? [appMenu(actions)] : []),
    serverMenu(actions),
    editMenu({ isMac, focused }),
    viewMenu(),
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "ima2-gen on GitHub", click: () => actions.openUrl("https://github.com/lidge-ai/ima2-gen") },
        { label: "Documentation", click: () => actions.openUrl("https://lidge-ai.github.io/ima2-gen/") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
