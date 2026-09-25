import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_FILE_AUTH_CONFIG,
  codexFileLoginArgs,
  codexLoginStatus,
} from "../lib/codexDetect.js";
import { packageCliCommand, resolvePackageBin } from "../lib/packageCli.js";

test("package CLI resolution returns JavaScript entrypoints, not platform shims", () => {
  assert.match(resolvePackageBin("@openai/codex", "codex"), /@openai[/\\]codex[/\\]bin[/\\]codex\.js$/);

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

test("generation admission re-syncs the proxy session file even while the proxy is ready", async () => {
  const { waitForOAuthReady } = await import("../lib/oauthProxy/runtime.js");
  let syncs = 0;
  await waitForOAuthReady({ oauthReadyState: "ready", syncOAuthProxySession: () => { syncs++; return false; } });
  assert.equal(syncs, 1);
});
