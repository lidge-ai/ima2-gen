import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRuntime, decideStartup, takeoverBlocker } from "../desktop/lib/startup-decision.mjs";
import { launchOrigin } from "../desktop/lib/launch-origin.mjs";
import { takeoverPromptOptions } from "../desktop/lib/takeover-prompt.mjs";
import { sanitizeSettings } from "../desktop/lib/settings.mjs";

// devlog/_plan/260929_background_runtime/030: the startup decision table.

const ROOT = "/Applications/ima2.app/Contents/Resources/app";
const realpath = ((p: string) => p) as never;
const runtime = (extra: Record<string, unknown> = {}) => ({ pid: 4242, url: "http://127.0.0.1:3333", bootId: "b1", startedAt: 1, launcher: "foreground", root: "/usr/lib/node_modules/ima2-gen", version: "3.23.2", ...extra });
const live = (extra: Record<string, unknown> = {}, rt: Record<string, unknown> = {}) => ({ ok: true, status: { schema: "ima2-status/1", liveness: "live", runtime: runtime(rt), stoppable: true, manager: { state: "absent" }, serviceOwnership: "unmanaged", ...extra } });
const absent = (manager: Record<string, unknown> = { state: "absent" }, serviceSharesConfig: boolean | null = null) => ({ ok: true, status: { schema: "ima2-status/1", liveness: "absent-proven", runtime: null, stoppable: false, manager, serviceOwnership: "unmanaged", serviceSharesConfig } });
const decide = (parsed: unknown, existingServer = "ask", origin = "user") => decideStartup({ parsed, bundledRoot: ROOT, existingServer, origin, realpath });

describe("desktop startup decision", () => {
  it("blocks when the bundled CLI cannot answer, or answers unknown", () => {
    assert.equal(decide({ ok: false, reason: "missing" }).action, "blocked");
    const unknown = { ok: true, status: { liveness: "unknown", reason: "timeout", manager: { state: "absent" } } };
    assert.equal(decide(unknown).action, "blocked");
  });

  it("starts only on proven absence with no active or unknown login service", () => {
    assert.equal(decide(absent()).action, "start");
    assert.equal(decide(absent({ state: "bound", kind: "launchd", pid: null, active: false })).action, "start");
    assert.equal(decide(absent({ state: "bound", kind: "launchd", pid: 9, active: true })).action, "wait-service");
    // A login service for another config dir is not about to start *this* server.
    assert.equal(decide(absent({ state: "bound", kind: "launchd", pid: 9, active: true }, false)).action, "start");
    assert.equal(decide(absent({ state: "bound", kind: "launchd", pid: 9, active: true }, true)).action, "wait-service");
    assert.equal(decide(absent({ state: "unknown", reason: "launchctl failed" })).action, "blocked");
  });

  it("attaches to its own bundled server without asking", () => {
    assert.equal(decide(live({}, { launcher: "desktop", root: ROOT })).action, "attach-bundled");
    // Same launcher from a different app bundle is native.
    assert.equal(decide(live({}, { launcher: "desktop", root: "/other/app" })).action, "ask");
  });

  it("follows the existingServer setting for a native server", () => {
    assert.equal(decide(live(), "attach").action, "attach-guest");
    assert.equal(decide(live(), "takeover").action, "takeover");
    assert.equal(decide(live(), "ask").action, "ask");
  });

  it("never prompts during a login launch", () => {
    assert.equal(decide(live(), "ask", "login").action, "attach-guest");
    assert.equal(decide(live(), "takeover", "login").action, "takeover");
  });

  it("offers no takeover it cannot perform safely", () => {
    const noAdvert = decide(live({ stoppable: false }), "takeover");
    assert.equal(noAdvert.action, "attach-guest");
    assert.match(noAdvert.reason, /port scan/);
    const unknownOwner = decide(live({ serviceOwnership: "unknown" }), "takeover");
    assert.equal(unknownOwner.action, "attach-guest");
    assert.match(unknownOwner.reason, /login service/);
    assert.equal(takeoverBlocker(live().status), null);
  });

  it("classifies by realpath and treats an unreadable path as native", () => {
    const throwing = () => { throw new Error("ENOENT"); };
    assert.equal(classifyRuntime(runtime({ launcher: "desktop", root: ROOT }), ROOT, throwing as never), "native");
    assert.equal(classifyRuntime(null, ROOT, realpath), "native");
  });
});

describe("launch origin", () => {
  it("recognises the autostart flag and macOS wasOpenedAtLogin", () => {
    assert.equal(launchOrigin(["electron", ".", "--autostart"], {}), "login");
    assert.equal(launchOrigin(["electron", "."], { wasOpenedAtLogin: true }), "login");
    assert.equal(launchOrigin(["electron", "."], {}), "user");
  });
});

describe("takeover prompt and setting", () => {
  it("names who runs the server and warns about the login service", () => {
    const opts = takeoverPromptOptions(live({ serviceOwnership: "managed" }, { launcher: null }).status);
    assert.deepEqual(opts.buttons, ["Use the bundled server", "Keep using it"]);
    assert.match(opts.detail, /login service/);
    assert.match(opts.detail, /ima2 service uninstall/);
    assert.match(takeoverPromptOptions(live({}, { launcher: "background" }).status).detail, /ima2 start/);
  });

  it("sanitises existingServer to its three values", () => {
    assert.equal(sanitizeSettings({}).existingServer, "ask");
    assert.equal(sanitizeSettings({ existingServer: "takeover" }).existingServer, "takeover");
    assert.equal(sanitizeSettings({ existingServer: "kill-everything" }).existingServer, "ask");
  });
});
