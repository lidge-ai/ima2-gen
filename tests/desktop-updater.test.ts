import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createUpdaterController } from "../desktop/lib/updater.mjs";

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkResult: any = { isUpdateAvailable: false, updateInfo: { version: "3.16.1" } };
  calls: string[] = [];

  async checkForUpdates() {
    this.calls.push("check");
    return this.checkResult;
  }

  async downloadUpdate() {
    this.calls.push("download");
    return ["/tmp/ima2.zip"];
  }

  quitAndInstall() {
    this.calls.push("install");
  }
}

function fixture({ responses = [] as number[] } = {}) {
  const autoUpdater = new FakeAutoUpdater();
  const dialogs: any[] = [];
  const logs: string[] = [];
  const order: string[] = [];
  const dialog = {
    async showMessageBox(options: any) {
      dialogs.push(options);
      return { response: responses.shift() ?? 1 };
    },
  };
  const logger = {
    info: (value: unknown) => logs.push(`info:${String(value)}`),
    error: (value: unknown) => logs.push(`error:${String(value)}`),
  };
  const create = (overrides: Record<string, unknown> = {}) => createUpdaterController({
    app: { isPackaged: true },
    dialog,
    platform: "darwin",
    arch: "arm64",
    env: {},
    logger,
    loadUpdater: async () => ({ autoUpdater }),
    prepareForInstall: async () => { order.push("prepare"); return true; },
    ...overrides,
  });
  return { autoUpdater, dialogs, logs, order, create };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("desktop updater", () => {
  it("never loads or checks on unpackaged apps or unsupported platforms", async () => {
    for (const guard of [
      { app: { isPackaged: false } },
      { platform: "linux", env: {} },            // non-AppImage installs (deb, unpackaged) cannot self-update
      { platform: "linux", env: { APPIMAGE: "" } },
      { platform: "darwin", arch: "x64" },       // only Apple Silicon macOS is shipped
      { platform: "freebsd" },
    ]) {
      let loads = 0;
      const { create } = fixture();
      const controller = await create({
        ...guard,
        loadUpdater: async () => { loads += 1; throw new Error("must not load"); },
      });
      assert.equal(controller.active, false);
      assert.equal(await controller.checkForUpdates({ manual: true }), false);
      assert.equal(loads, 0);
    }
  });

  it("activates on every shipped platform: macOS arm64, Windows, Linux AppImage", async () => {
    for (const guard of [
      {},                                        // darwin arm64
      { platform: "win32", arch: "x64" },
      { platform: "win32", arch: "arm64" },
      { platform: "linux", arch: "x64", env: { APPIMAGE: "/opt/ima2/ima2.AppImage" } },
      { platform: "linux", arch: "arm64", env: { APPIMAGE: "/opt/ima2/ima2.AppImage" } },
    ]) {
      const { autoUpdater, create } = fixture();
      const controller = await create(guard);
      assert.equal(controller.active, true, JSON.stringify(guard));
      assert.equal(autoUpdater.autoDownload, true);
      assert.equal(await controller.checkForUpdates(), true);
    }
  });

  it("auto-downloads by default, keeps install-on-quit off, and follows setAutoDownload", async () => {
    const { autoUpdater, create } = fixture();
    const controller = await create();

    assert.equal(controller.active, true);
    assert.equal(autoUpdater.autoDownload, true);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);

    controller.setAutoDownload(false);
    assert.equal(autoUpdater.autoDownload, false);
    controller.setAutoDownload(true);
    assert.equal(autoUpdater.autoDownload, true);

    const manual = fixture();
    await manual.create({ autoDownload: false });
    assert.equal(manual.autoUpdater.autoDownload, false);
  });

  it("fails soft when the packaged updater dependency cannot load", async () => {
    const { logs, create } = fixture();
    const controller = await create({ loadUpdater: async () => { throw new Error("missing module"); } });

    assert.equal(controller.active, false);
    assert.ok(logs.some((line) => line.includes("missing module")));
  });

  it("keeps background no-update quiet and reports manual no-update", async () => {
    const { autoUpdater, dialogs, create } = fixture();
    const controller = await create();

    assert.equal(await controller.checkForUpdates(), true);
    assert.equal(dialogs.length, 0);
    assert.equal(await controller.checkForUpdates({ manual: true }), true);
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].message, /up to date/i);
    assert.deepEqual(autoUpdater.calls, ["check", "check"]);
  });

  it("auto-update mode checks without prompting for the download", async () => {
    const { autoUpdater, dialogs, create } = fixture();
    autoUpdater.checkResult = { isUpdateAvailable: true, updateInfo: { version: "3.17.0" } };
    const controller = await create();

    assert.equal(await controller.checkForUpdates(), true);
    assert.equal(dialogs.length, 0);
    assert.deepEqual(autoUpdater.calls, ["check"]);
  });

  it("downloads an available update only after consent when auto-download is off", async () => {
    const accepted = fixture({ responses: [0] });
    accepted.autoUpdater.checkResult = { isUpdateAvailable: true, updateInfo: { version: "3.17.0" } };
    const acceptedController = await accepted.create({ autoDownload: false });
    await acceptedController.checkForUpdates({ manual: true });
    assert.deepEqual(accepted.autoUpdater.calls, ["check", "download"]);
    assert.match(accepted.dialogs[0].message, /3\.17\.0/);

    const declined = fixture({ responses: [1] });
    declined.autoUpdater.checkResult = { isUpdateAvailable: true, updateInfo: { version: "3.17.0" } };
    const declinedController = await declined.create({ autoDownload: false });
    await declinedController.checkForUpdates({ manual: true });
    assert.deepEqual(declined.autoUpdater.calls, ["check"]);
  });

  it("stops the server before installing a downloaded update", async () => {
    const { autoUpdater, order, create } = fixture({ responses: [0] });
    autoUpdater.quitAndInstall = () => { order.push("install"); };
    await create();

    autoUpdater.emit("update-downloaded", { version: "3.17.0" });
    await settle();
    assert.deepEqual(order, ["prepare", "install"]);
  });

  it("does not prepare or install when restart consent is declined", async () => {
    const { autoUpdater, order, create } = fixture({ responses: [1] });
    autoUpdater.quitAndInstall = () => { order.push("install"); };
    await create();

    autoUpdater.emit("update-downloaded", { version: "3.17.0" });
    await settle();
    assert.deepEqual(order, []);
  });

  it("logs background failures but surfaces manual failures", async () => {
    const { autoUpdater, dialogs, logs, create } = fixture();
    autoUpdater.checkForUpdates = async () => { throw new Error("offline"); };
    const controller = await create();

    assert.equal(await controller.checkForUpdates(), false);
    assert.equal(dialogs.length, 0);
    assert.ok(logs.some((line) => line.includes("offline")));

    assert.equal(await controller.checkForUpdates({ manual: true }), false);
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].message, /unable to check/i);
  });

  it("wires the menu action and starts the background check after the server", () => {
    const main = readFileSync("desktop/main.mjs", "utf8");
    const menu = readFileSync("desktop/lib/menu.mjs", "utf8");

    assert.match(menu, /Check for Updates…[\s\S]*actions\.checkForUpdates\(\)/);
    assert.ok(main.indexOf("await supervisor.start") < main.indexOf("void updater.checkForUpdates()"));
    assert.match(main, /prepareForInstall: \(\) => lifecycle\.prepareForUpdateInstall\(\)/);
  });
});
