import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { wireAppLifecycle } from "../desktop/lib/app-lifecycle.mjs";

class FakeApp extends EventEmitter {
  calls: string[] = [];
  quit() { this.calls.push("quit"); }
  exit(code: number) { this.calls.push(`exit:${code}`); }
}

function fixture() {
  const app = new FakeApp();
  const calls: string[] = [];
  let releaseStop: (() => void) | null = null;
  const supervisor = {
    stop: () => new Promise<void>((resolve) => { calls.push("stop"); releaseStop = resolve; }),
    dispose: () => calls.push("dispose"),
  };
  const windows = {
    showMain: () => calls.push("show"),
    closeAllForQuit: () => calls.push("close"),
  };
  const settingsStore = { get: () => ({ keepRunningOnClose: false }) };
  const coordinator = wireAppLifecycle({
    app,
    supervisor,
    windows,
    settingsStore,
    applyDockVisibility: () => calls.push("dock"),
    logger: { error: (value: unknown) => calls.push(`error:${String(value)}`) },
  });
  return { app, calls, coordinator, releaseStop: () => releaseStop?.() };
}

describe("desktop app lifecycle", () => {
  it("prevents normal quit until the server has stopped", async () => {
    const { app, calls, releaseStop } = fixture();
    let prevented = 0;
    app.emit("before-quit", { preventDefault: () => { prevented += 1; } });

    assert.equal(prevented, 1);
    assert.deepEqual(calls, ["close", "stop"]);
    assert.deepEqual(app.calls, []);

    releaseStop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["close", "stop", "dispose"]);
    assert.deepEqual(app.calls, ["exit:0"]);
  });

  it("blocks incidental quit while preparing an update then allows updater quit", async () => {
    const { app, calls, coordinator, releaseStop } = fixture();
    const preparing = coordinator.prepareForUpdateInstall();
    let prevented = 0;

    app.emit("before-quit", { preventDefault: () => { prevented += 1; } });
    app.emit("window-all-closed");
    assert.equal(prevented, 1);
    assert.deepEqual(app.calls, []);

    releaseStop();
    assert.equal(await preparing, true);
    assert.deepEqual(calls, ["stop", "dispose"]);

    app.emit("before-quit", { preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 1, "updater-owned quit must not be intercepted");
    assert.deepEqual(app.calls, []);
  });

  it("runs the existing window-close policy while idle", () => {
    const { app } = fixture();
    app.emit("window-all-closed");
    assert.deepEqual(app.calls, ["quit"]);
  });
});
