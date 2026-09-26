// Edit menu for the application menu bar. Kept electron-free so node:test can
// exercise the template, the same convention as context-menu.mjs.
//
// On macOS the edit roles send copy:/paste:/… down the responder chain, which
// reaches the focused webContents and also the native save/open panels, so
// the stock roles stay. On Windows and Linux a role runs against the focused
// BrowserWindow's own webContents — correct for the main window, but wrong
// when a popup/devtools surface holds focus. There each item calls the
// command on the focused webContents instead.

const EDIT_ITEMS = [
  { id: "undo", label: "Undo", accelerator: "CmdOrCtrl+Z" },
  { id: "redo", label: "Redo", accelerator: "CmdOrCtrl+Y" },
  null,
  { id: "cut", label: "Cut", accelerator: "CmdOrCtrl+X" },
  { id: "copy", label: "Copy", accelerator: "CmdOrCtrl+C" },
  { id: "paste", label: "Paste", accelerator: "CmdOrCtrl+V" },
  { id: "pasteAndMatchStyle", label: "Paste and Match Style", accelerator: "CmdOrCtrl+Shift+V" },
  { id: "delete", label: "Delete" },
  null,
  { id: "selectAll", label: "Select All", accelerator: "CmdOrCtrl+A" },
];

export function editMenu({ isMac, focused }) {
  if (isMac) return { role: "editMenu" };
  return {
    label: "Edit",
    submenu: EDIT_ITEMS.map((item) => (
      item === null
        ? { type: "separator" }
        : { label: item.label, accelerator: item.accelerator, click: () => focused()?.[item.id]() }
    )),
  };
}
