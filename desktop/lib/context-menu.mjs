// Right-click context menus for every webContents (main view, titlebar,
// settings, OAuth popups). Electron ships no default menu, so without this a
// right-click does nothing. Kept electron-free: `contextMenuTemplate` is pure
// and `installContextMenus` takes its Electron pieces as injected deps, the
// same convention as app-lifecycle.mjs / login-item.mjs, so node:test can
// exercise the template without a runtime.

/**
 * Decide which menu applies to a `context-menu` event's params.
 * Custom actions carry an `id` dispatched by `activate`; everything else uses
 * built-in roles gated on the edit flags Chromium reports.
 */
export function contextMenuTemplate(params) {
  const items = [];
  if (params.isEditable) {
    const flags = params.editFlags;
    items.push(
      { role: "undo", enabled: flags.canUndo },
      { role: "redo", enabled: flags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut },
      { role: "copy", enabled: flags.canCopy },
      { role: "paste", enabled: flags.canPaste },
      { role: "pasteAndMatchStyle", enabled: flags.canPaste },
      { role: "selectAll", enabled: flags.canSelectAll },
    );
  } else {
    if (params.mediaType === "image" && params.srcURL) {
      items.push(
        { id: "copy-image", label: "Copy Image" },
        { id: "save-image", label: "Save Image As…" },
        { id: "copy-image-address", label: "Copy Image Address" },
      );
    }
    if (params.linkURL) {
      items.push(
        { id: "open-link", label: "Open Link in Browser" },
        { id: "copy-link", label: "Copy Link" },
      );
    }
    if (params.selectionText) {
      items.push({ role: "copy" });
    }
    if (items.length === 0) items.push({ role: "selectAll" });
  }
  items.push({ type: "separator" }, { id: "inspect", label: "Inspect Element" });
  return items;
}

function activate(contents, params, { clipboard, shell }, id) {
  if (id === "copy-image") contents.copyImageAt(params.x, params.y);
  else if (id === "save-image") contents.downloadURL(params.srcURL);
  else if (id === "copy-image-address") clipboard.writeText(params.srcURL);
  else if (id === "open-link") void shell.openExternal(params.linkURL);
  else if (id === "copy-link") clipboard.writeText(params.linkURL);
  else if (id === "inspect") contents.inspectElement(params.x, params.y);
}

/** Attach one handler per webContents as it is created; covers views and popups. */
export function installContextMenus({ app, Menu, clipboard, shell }) {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("context-menu", (_event, params) => {
      const template = contextMenuTemplate(params).map((item) => (
        item.id
          ? { ...item, click: () => activate(contents, params, { clipboard, shell }, item.id) }
          : item
      ));
      Menu.buildFromTemplate(template).popup();
    });
  });
}
