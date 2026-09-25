import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canOpenExternally, contextMenuTemplate, installContextMenus } from "../desktop/lib/context-menu.mjs";

const ids = (items) => items.map((item) => item.id ?? item.role ?? item.type);
const editFlags = (over = {}) => ({
  canUndo: false, canRedo: false, canCut: true, canCopy: true,
  canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: true,
  ...over,
});

describe("desktop context menu", () => {
  it("gives editable fields edit commands gated on editFlags", () => {
    const items = contextMenuTemplate({ isEditable: true, editFlags: editFlags({ canUndo: false, canCut: false }) }, { inspect: true });
    assert.deepEqual(ids(items).slice(0, 9), [
      "undo", "redo", "separator", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "separator",
    ]);
    assert.equal(items.find((i) => i.id === "undo").enabled, false);
    assert.equal(items.find((i) => i.id === "cut").enabled, false);
    assert.equal(items.find((i) => i.id === "copy").enabled, true);
  });

  it("offers image actions plus Inspect Element on a generated image", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "image",
      srcURL: "http://127.0.0.1:8787/generated/a.png", x: 10, y: 20,
      selectionText: "", linkURL: "",
    }, { inspect: true });
    assert.deepEqual(ids(items), ["copy-image", "save-image", "copy-image-address", "separator", "inspect"]);
  });

  it("combines image and link actions when the image is inside a link", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "image",
      srcURL: "http://127.0.0.1:8787/generated/a.png", x: 0, y: 0,
      linkURL: "https://example.com", selectionText: "",
    }, { inspect: true });
    assert.deepEqual(ids(items), [
      "copy-image", "save-image", "copy-image-address",
      "open-link", "copy-link", "separator", "inspect",
    ]);
  });

  it("keeps Copy Link but drops Open Link for non-http(s) targets", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "",
      linkURL: "devtools://devtools/bundled/inspector.html", selectionText: "", x: 0, y: 0,
    }, { inspect: true });
    assert.deepEqual(ids(items), ["copy-link", "separator", "inspect"]);
  });

  it("offers Copy for plain selected text", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "", linkURL: "",
      selectionText: "hello", x: 0, y: 0,
    }, { inspect: true });
    assert.deepEqual(ids(items), ["copy", "separator", "inspect"]);
  });

  it("falls back to Select All on bare page chrome so right-click always answers", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "", linkURL: "",
      selectionText: "", x: 0, y: 0,
    }, { inspect: true });
    assert.deepEqual(ids(items), ["selectAll", "separator", "inspect"]);
  });
});

describe("desktop context menu in a packaged build", () => {
  it("leaves Inspect Element out unless asked for", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "", linkURL: "",
      selectionText: "hello", x: 0, y: 0,
    });
    assert.deepEqual(ids(items), ["copy"]);
  });

  it("names a data: image image.png instead of its base64 payload", async () => {
    const saved = [];
    const handlers = new Map();
    const app = { isPackaged: true, on: (e, fn) => handlers.set(e, fn) };
    let popupTemplate = null;
    installContextMenus({
      app,
      Menu: { buildFromTemplate: (t) => { popupTemplate = t; return { popup() {} }; } },
      clipboard: { writeText() {} },
      dialog: { showSaveDialog: async (opts) => { saved.push(opts.defaultPath); return { canceled: true }; } },
      shell: {},
    });
    const listeners = new Map();
    const contents = { getType: () => "window", session: null, on: (e, fn) => listeners.set(e, fn) };
    handlers.get("web-contents-created")(null, contents);
    listeners.get("context-menu")(null, {
      isEditable: false, mediaType: "image", srcURL: "data:image/png;base64,iVBORw0KGgo=",
      linkURL: "", selectionText: "", x: 0, y: 0,
    });
    assert.equal(popupTemplate.some((i) => i.id === "inspect"), false);
    popupTemplate.find((i) => i.id === "save-image").click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(saved, ["image.png"]);
  });
});

describe("canOpenExternally", () => {
  it("allows only http and https", () => {
    for (const url of ["http://a.b", "https://a.b/x?y=1"]) {
      assert.equal(canOpenExternally(url), true, url);
    }
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "devtools://d", "mailto:a@b.c", "slack://open", "not a url"]) {
      assert.equal(canOpenExternally(url), false, url);
    }
  });
});

describe("installContextMenus", () => {
  const fakeApp = () => {
    const handlers = new Map();
    return { handlers, on: (event, fn) => handlers.set(event, fn) };
  };
  const fakeContents = (type, session) => {
    const handlers = new Map();
    return { handlers, getType: () => type, session, on: (e, fn) => handlers.set(e, fn) };
  };
  const deps = {
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    clipboard: { writeText() {} },
    dialog: {},
    shell: {},
  };

  it("skips DevTools webContents so they keep their own menu", () => {
    const app = fakeApp();
    installContextMenus({ app, ...deps });
    const devtools = fakeContents("devtools", { on() { throw new Error("no session hook"); } });
    app.handlers.get("web-contents-created")(null, devtools);
    assert.equal(devtools.handlers.has("context-menu"), false);
  });

  it("attaches context-menu and hooks will-download once per session", () => {
    const app = fakeApp();
    installContextMenus({ app, ...deps });
    const sessionEvents = [];
    const session = { on: (e, fn) => sessionEvents.push([e, fn]) };
    const a = fakeContents("browserView", session);
    const b = fakeContents("browserView", session);
    app.handlers.get("web-contents-created")(null, a);
    app.handlers.get("web-contents-created")(null, b);
    assert.equal(a.handlers.has("context-menu"), true);
    assert.equal(b.handlers.has("context-menu"), true);
    assert.deepEqual(sessionEvents.map(([e]) => e), ["will-download"]);
  });
});
