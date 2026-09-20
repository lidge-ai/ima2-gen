import { Menu, app } from "electron";

const isMac = process.platform === "darwin";

function appMenu(actions) {
  return {
    label: app.name,
    submenu: [
      { role: "about" },
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
      { label: "Restart Server", accelerator: "CmdOrCtrl+Shift+R", click: () => actions.restartServer() },
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
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "ima2-gen on GitHub", click: () => actions.openUrl("https://github.com/lidge-jun/ima2-gen") },
        { label: "Documentation", click: () => actions.openUrl("https://lidge-jun.github.io/ima2-gen/") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
