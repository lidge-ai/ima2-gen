import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextMenuTemplate } from "../desktop/lib/context-menu.mjs";

const ids = (items) => items.map((item) => item.id ?? item.role ?? item.type);
const editFlags = (over = {}) => ({
  canUndo: false, canRedo: false, canCut: true, canCopy: true,
  canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: true,
  ...over,
});

describe("desktop context menu", () => {
  it("gives editable fields the standard edit roles gated on editFlags", () => {
    const items = contextMenuTemplate({ isEditable: true, editFlags: editFlags({ canUndo: false, canCut: false }) });
    assert.deepEqual(ids(items).slice(0, 9), [
      "undo", "redo", "separator", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "separator",
    ]);
    assert.equal(items.find((i) => i.role === "undo").enabled, false);
    assert.equal(items.find((i) => i.role === "cut").enabled, false);
    assert.equal(items.find((i) => i.role === "copy").enabled, true);
  });

  it("offers image actions plus Inspect Element on a generated image", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "image",
      srcURL: "http://127.0.0.1:8787/generated/a.png", x: 10, y: 20,
      selectionText: "", linkURL: "",
    });
    assert.deepEqual(ids(items), ["copy-image", "save-image", "copy-image-address", "separator", "inspect"]);
  });

  it("combines image and link actions when the image is inside a link", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "image",
      srcURL: "http://127.0.0.1:8787/generated/a.png", x: 0, y: 0,
      linkURL: "https://example.com", selectionText: "",
    });
    assert.deepEqual(ids(items), [
      "copy-image", "save-image", "copy-image-address",
      "open-link", "copy-link", "separator", "inspect",
    ]);
  });

  it("offers Copy for plain selected text", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "", linkURL: "",
      selectionText: "hello", x: 0, y: 0,
    });
    assert.deepEqual(ids(items), ["copy", "separator", "inspect"]);
  });

  it("falls back to Select All on bare page chrome so right-click always answers", () => {
    const items = contextMenuTemplate({
      isEditable: false, mediaType: "none", srcURL: "", linkURL: "",
      selectionText: "", x: 0, y: 0,
    });
    assert.deepEqual(ids(items), ["selectAll", "separator", "inspect"]);
  });
});
