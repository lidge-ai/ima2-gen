import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CODEX_FILE_AUTH_CONFIG,
  codexFileLoginArgs,
  codexLoginStatus,
} from "../lib/codexDetect.js";
import { startOAuthProxy } from "../lib/oauthLauncher.js";
import { packageCliCommand, resolvePackageBin } from "../lib/packageCli.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

test("package CLI resolution returns JavaScript entrypoints, not platform shims", () => {
  assert.match(resolvePackageBin("@openai/codex", "codex"), /@openai[/\\]codex[/\\]bin[/\\]codex\.js$/);
  assert.match(resolvePackageBin("openai-oauth", "openai-oauth"), /openai-oauth[/\\]dist[/\\]cli\.js$/);

  const command = packageCliCommand("@openai/codex", "codex", ["login", "status"], {
    execPath: "C:\\Program Files\\nodejs\\node.exe",
  });
  assert.equal(command.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.match(command.args[0], /@openai[/\\]codex[/\\]bin[/\\]codex\.js$/);
  assert.deepEqual(command.args.slice(1), ["login", "status"]);
});

test("Codex status probes the package-local wrapper through Node on Windows", () => {
  const calls: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
  const notLoggedIn = Object.assign(new Error("Command failed"), {
    status: 1,
    stderr: "Not logged in",
  });

  const status = codexLoginStatus(2_000, {
    platform: "win32",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    resolveCodexBin: () => "C:\\npm\\node_modules\\ima2-gen\\node_modules\\@openai\\codex\\bin\\codex.js",
    execFileSyncImpl: (command, args, options) => {
      calls.push({ command, args: args || [], shell: options?.shell });
      throw notLoggedIn;
    },
  });

  assert.equal(status, "unauthed");
  assert.deepEqual(calls, [{
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [
      "C:\\npm\\node_modules\\ima2-gen\\node_modules\\@openai\\codex\\bin\\codex.js",
      "login",
      "status",
    ],
    shell: false,
  }]);
});

test("Codex status falls back when the package-local wrapper fails before auth", () => {
  const calls: string[] = [];
  const brokenWrapper = Object.assign(new Error("Command failed"), {
    status: 1,
    stderr: "platform package is missing",
  });
  const notLoggedIn = Object.assign(new Error("Command failed"), {
    status: 1,
    stderr: "Not logged in",
  });

  const status = codexLoginStatus(2_000, {
    platform: "win32",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    resolveCodexBin: () => "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
    execFileSyncImpl: (command) => {
      calls.push(command);
      if (calls.length === 1) throw brokenWrapper;
      throw notLoggedIn;
    },
  });

  assert.equal(status, "unauthed");
  assert.deepEqual(calls, ["C:\\Program Files\\nodejs\\node.exe", "codex.cmd"]);
});

test("Codex status reports a broken wrapper separately from a missing CLI", () => {
  const brokenWrapper = Object.assign(new Error("Command failed"), {
    status: 1,
    stderr: "platform package is missing",
  });
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  let calls = 0;

  const status = codexLoginStatus(2_000, {
    platform: "win32",
    resolveCodexBin: () => "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
    execFileSyncImpl: () => {
      calls++;
      if (calls === 1) throw brokenWrapper;
      throw missing;
    },
  });

  assert.equal(status, "error");
  assert.equal(calls, 4);
});

test("Codex login arguments force proxy-compatible file credential storage", () => {
  assert.equal(CODEX_FILE_AUTH_CONFIG, 'cli_auth_credentials_store="file"');
  assert.deepEqual(codexFileLoginArgs(), ["login", "-c", CODEX_FILE_AUTH_CONFIG]);
  assert.deepEqual(codexFileLoginArgs({ deviceAuth: true }), [
    "login",
    "--device-auth",
    "-c",
    CODEX_FILE_AUTH_CONFIG,
  ]);
});

test("OAuth launcher skips keyring-only auth that the bundled proxy cannot consume", () => {
  let spawnCount = 0;
  const exits: unknown[] = [];
  startOAuthProxy({
    detectAuth: () => ({ authed: true, proxyReady: false }),
    spawnImpl: () => {
      spawnCount++;
      return new FakeChild();
    },
    onExit: (result: unknown) => exits.push(result),
  });

  assert.equal(spawnCount, 0);
  assert.deepEqual(exits, [{ code: 0, reason: "missing-auth-file" }]);
});

test("OAuth launcher starts its bundled JS with the detected auth file", () => {
  const calls: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
  const child = new FakeChild();
  const authFile = "C:\\Users\\test\\.codex\\auth.json";
  const launcher = startOAuthProxy({
    oauthPort: 10531,
    detectAuth: () => ({ authed: true, proxyReady: true, proxyAuthFile: authFile }),
    resolveOAuthBin: () => "C:\\npm\\node_modules\\ima2-gen\\node_modules\\openai-oauth\\dist\\cli.js",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    spawnImpl: (command: string, args: readonly string[], options: { shell?: boolean }) => {
      calls.push({ command, args, shell: options.shell });
      return child;
    },
  });

  assert.deepEqual(calls, [{
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [
      "C:\\npm\\node_modules\\ima2-gen\\node_modules\\openai-oauth\\dist\\cli.js",
      "--port",
      "10531",
      "--oauth-file",
      authFile,
    ],
    shell: false,
  }]);
  launcher.stop();
  assert.equal(child.killed, true);
});

class StubbornChild extends FakeChild {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];
  constructor(private readonly exitOn: string | null) { super(); }
  override kill(signal: string = "SIGTERM") {
    this.signals.push(signal);
    if (signal === this.exitOn) setImmediate(() => { this.signalCode = signal as NodeJS.Signals; this.emit("exit", null, signal); });
    return true;
  }
}

function launchWith(child: StubbornChild) {
  return startOAuthProxy({
    detectAuth: () => ({ authed: true, proxyReady: true, proxyAuthFile: "/tmp/ima2-auth.json" }),
    resolveOAuthBin: () => "/x/cli.js",
    spawnImpl: () => child,
    onExit: () => {},
  });
}

test("OAuth launcher reports the session file it handed to the proxy", () => {
  assert.equal(launchWith(new StubbornChild("SIGTERM")).authFile, "/tmp/ima2-auth.json");
  const none = startOAuthProxy({ detectAuth: () => ({ authed: false, proxyReady: false, proxyAuthFile: null }), onExit: () => {} });
  assert.equal(none.authFile, null);
});

test("OAuth launcher keeps restarting crashes spaced past the crash window", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const children = [0, 1, 2, 3, 4].map(() => new StubbornChild(null));
  let spawned = 0;
  const launcher = startOAuthProxy({
    detectAuth: () => ({ authed: true, proxyReady: true, proxyAuthFile: "/tmp/a.json" }),
    resolveOAuthBin: () => "/x/cli.js",
    restartDelayMs: 1000,
    spawnImpl: () => children[Math.min(spawned++, children.length - 1)],
    onExit: () => {},
  });
  // Each child lives >5s (not an immediate-exit) and crashes >60s after the previous one.
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(6000);
    children[i].emit("exit", 1);
    t.mock.timers.tick(61_000);
  }
  assert.equal(spawned, 5, "spread-out crashes must never exhaust the restart budget");
  launcher.stop();
});

test("OAuth launcher gives up on a rapid crash loop inside the window", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const children = [0, 1, 2, 3, 4].map(() => new StubbornChild(null));
  let spawned = 0;
  const launcher = startOAuthProxy({
    detectAuth: () => ({ authed: true, proxyReady: true, proxyAuthFile: "/tmp/a.json" }),
    resolveOAuthBin: () => "/x/cli.js",
    restartDelayMs: 1000,
    spawnImpl: () => children[Math.min(spawned++, children.length - 1)],
    onExit: () => {},
  });
  // Four crashes ~7s apart: the 4th lands inside the window and ends restarts.
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(6000);
    children[i].emit("exit", 1);
    t.mock.timers.tick(1000);
  }
  assert.equal(spawned, 4);
  t.mock.timers.tick(10_000);
  assert.equal(spawned, 4, "no fifth spawn after the windowed budget is exhausted");
  launcher.stop();
});

test("stopAndWait resolves only after the child exits, escalating to SIGKILL", async () => {
  const polite = new StubbornChild("SIGTERM");
  await launchWith(polite).stopAndWait(50);
  assert.deepEqual(polite.signals, ["SIGTERM"]);

  const stubborn = new StubbornChild("SIGKILL");
  await launchWith(stubborn).stopAndWait(50);
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);
});

test("stopAndWait rejects when the child survives SIGKILL, so no replacement races its port", async () => {
  const immortal = new StubbornChild(null);
  await assert.rejects(launchWith(immortal).stopAndWait(20), /did not exit/);
});

test("generation admission re-syncs the proxy session file even while the proxy is ready", async () => {
  const { waitForOAuthReady } = await import("../lib/oauthProxy/runtime.js");
  let syncs = 0;
  await waitForOAuthReady({ oauthReadyState: "ready", syncOAuthProxySession: () => { syncs++; return false; } });
  assert.equal(syncs, 1);
});
