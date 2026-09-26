// Right-click context menus for every webContents (main window, settings,
// tray popup, OAuth popups). Electron ships no default menu, so without this a
// right-click does nothing. Kept electron-free: `contextMenuTemplate` and
// `canOpenExternally` are pure and `installContextMenus` takes its Electron
// pieces as injected deps, the same convention as app-lifecycle.mjs /
// login-item.mjs, so node:test can exercise the template without a runtime.
//
// Edit commands are dispatched as explicit `contents.*()` calls rather than
// menu `role`s: on macOS roles route through the window's first responder,
// which may not be the surface that was right-clicked.

const EDIT_ACTIONS = [
  { id: "undo", label: "Undo", flag: "canUndo" },
  { id: "redo", label: "Redo", flag: "canRedo" },
  null,
  { id: "cut", label: "Cut", flag: "canCut" },
  { id: "copy", label: "Copy", flag: "canCopy" },
  { id: "paste", label: "Paste", flag: "canPaste" },
  { id: "pasteAndMatchStyle", label: "Paste and Match Style", flag: "canPaste" },
  { id: "selectAll", label: "Select All", flag: "canSelectAll" },
];

/** Only web pages may leave the app; deep links and file URLs stay inside. */
export function canOpenExternally(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function basenameFromUrl(url) {
  try {
    const { protocol, pathname } = new URL(url);
    // data:/blob: "paths" are the payload or a UUID, not a filename.
    if (protocol === "data:" || protocol === "blob:") return "image.png";
    const name = pathname.split("/").pop();
    return name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide which menu applies to a `context-menu` event's params.
 * Every actionable item carries an `id` dispatched by `activate` against the
 * same webContents that raised the event.
 */
export function contextMenuTemplate(params, { inspect = false } = {}) {
  const items = [];
  if (params.isEditable) {
    const flags = params.editFlags ?? {};
    for (const action of EDIT_ACTIONS) {
      items.push(action === null
        ? { type: "separator" }
        : { id: action.id, label: action.label, enabled: Boolean(flags[action.flag]) });
    }
  } else {
    if (params.mediaType === "image" && params.srcURL) {
      items.push(
        { id: "copy-image", label: "Copy Image" },
        { id: "save-image", label: "Save Image As…" },
        { id: "copy-image-address", label: "Copy Image Address" },
      );
    }
    if (params.linkURL) {
      if (canOpenExternally(params.linkURL)) {
        items.push({ id: "open-link", label: "Open Link in Browser" });
      }
      items.push({ id: "copy-link", label: "Copy Link" });
    }
    if (params.selectionText) items.push({ id: "copy", label: "Copy" });
    if (items.length === 0) items.push({ id: "selectAll", label: "Select All" });
  }
  if (inspect) items.push({ type: "separator" }, { id: "inspect", label: "Inspect Element" });
  return items;
}

async function saveImageAs(contents, params, { dialog, pendingSavePaths }) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: params.suggestedFilename || basenameFromUrl(params.srcURL),
  });
  if (canceled || !filePath) return;
  pendingSavePaths.set(contents, filePath);
  contents.downloadURL(params.srcURL);
}

async function activate(contents, params, deps, id) {
  const { clipboard, shell } = deps;
  if (id === "copy-image") contents.copyImageAt(params.x, params.y);
  else if (id === "save-image") await saveImageAs(contents, params, deps);
  else if (id === "copy-image-address") clipboard.writeText(params.srcURL);
  else if (id === "open-link") {
    if (canOpenExternally(params.linkURL)) void shell.openExternal(params.linkURL);
  } else if (id === "copy-link") clipboard.writeText(params.linkURL);
  else if (id === "inspect") contents.inspectElement(params.x, params.y);
  else contents[id](); // edit commands: undo/redo/cut/copy/paste/pasteAndMatchStyle/selectAll
}

/** Attach one handler per webContents as it is created; covers views and popups. */
export function installContextMenus({ app, Menu, clipboard, dialog, shell }) {
  // "Save Image As…" resolves a save dialog first, then steers the matching
  // download to that path in will-download. pendingSavePaths ties the two
  // events to the webContents that asked.
  const pendingSavePaths = new WeakMap();
  const hookedSessions = new WeakSet();
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "devtools") return; // keep DevTools' own menu
    const { session } = contents;
    if (session && !hookedSessions.has(session)) {
      hookedSessions.add(session);
      session.on("will-download", (_event, item, downloadContents) => {
        const path = pendingSavePaths.get(downloadContents);
        if (!path) return;
        item.setSavePath(path);
        pendingSavePaths.delete(downloadContents);
      });
    }
    contents.on("context-menu", (_event, params) => {
      const deps = { clipboard, dialog, shell, pendingSavePaths };
      const template = contextMenuTemplate(params, { inspect: !app.isPackaged }).map((item) => (
        item.id
          ? { ...item, click: () => { void activate(contents, params, deps, item.id); } }
          : item
      ));
      Menu.buildFromTemplate(template).popup();
    });
  });
}
