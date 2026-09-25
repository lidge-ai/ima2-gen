import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { editMenu } from "../desktop/lib/edit-menu.mjs";

describe("desktop edit menu", () => {
  it("keeps the stock responder-chain role on macOS", () => {
    assert.deepEqual(editMenu({ isMac: true, focused: () => null }), { role: "editMenu" });
  });

  it("sends Windows/Linux edit shortcuts to the focused webContents, not the host window", () => {
    const calls: string[] = [];
    const wc = new Proxy({}, { get: (_t, name) => () => calls.push(String(name)) });
    const menu: any = editMenu({ isMac: false, focused: () => wc });
    const byLabel = new Map(menu.submenu.filter((i: any) => i.label).map((i: any) => [i.label, i]));
    for (const [label, accel] of [["Cut", "CmdOrCtrl+X"], ["Copy", "CmdOrCtrl+C"], ["Paste", "CmdOrCtrl+V"], ["Select All", "CmdOrCtrl+A"], ["Undo", "CmdOrCtrl+Z"]]) {
      const item: any = byLabel.get(label);
      assert.equal(item.accelerator, accel, label);
      assert.equal(item.role, undefined, label);
      item.click();
    }
    assert.deepEqual(calls, ["cut", "copy", "paste", "selectAll", "undo"]);
  });

  it("does nothing when no webContents has focus", () => {
    const menu: any = editMenu({ isMac: false, focused: () => null });
    for (const item of menu.submenu) if (item.click) item.click();
  });

  it("is the Edit menu the application menu installs", () => {
    const source = readFileSync("desktop/lib/menu.mjs", "utf8");
    assert.match(source, /editMenu\(\{ isMac, focused \}\)/);
    assert.doesNotMatch(source, /role: "editMenu"/);
  });
});
