import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { build } from "esbuild";
import { EventEmitter } from "node:events";
import * as urls from "node:url";

// Execute the actual preflight in a synthetic host, never start the fixture.
// No HOME mutation, real filesystem probe, browser, socket, or child process.
const runnerHome = "/home/runner";
const checkout = runnerHome + "/work/ima2-gen/ima2-gen";
const azure = "/opt/az/azcliextensions";
const result = await build({ entryPoints: ["ui/e2e/fixtures/appServer.ts"], bundle: true,
  write: false, platform: "node", format: "cjs", external: ["node:*", "@playwright/test"], logLevel: "silent",
  define: { "import.meta.url": JSON.stringify(`file://${checkout}/ui/e2e/fixtures/appServer.ts`) },
  plugins: [{ name: "preflight-owner-boundaries", setup(builder) {
    const replacements = {
      "./appProjection": "export const createAppProjection=(x)=>__wp09.projection(x);export const verifyAppProjection=async()=>{};",
      "./appOwnership": "export const issueAppHome=async()=>'/tmp/wp09-synthetic';export const requireAppHome=async()=>{};export const registerOwnedApp=async(x)=>__wp09.register(x);export const isOwnedBrowserOrigin=()=>false;export const disposeOwnedApps=async()=>{};export const hasUnexitedOwnedApps=()=>false;",
      "./appRuntimeBuild": "export const disposeRuntimeBuildCache=async()=>{};",
      "./stubUpstream": "export const startStubUpstream=(mode)=>__wp09.stub(mode);",
    };
    builder.onResolve({ filter: /.*/ }, (args) => args.importer.endsWith("appServer.ts") && Object.hasOwn(replacements, args.path)
      ? { path: args.path, namespace: "preflight" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "preflight" }, (args) => ({ contents: replacements[args.path], loader: "js" }));
  } }],
});

function host(overrides: any = {}) {
  return {
    env: { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_RUN_ID: "fixture-run",
      HOME: runnerHome, GITHUB_WORKSPACE: checkout, XDG_CONFIG_HOME: runnerHome + "/.config",
      AZURE_EXTENSION_DIR: azure },
    present: new Set([runnerHome + "/.config", azure]), symlinks: new Set(),
    uid: 0, mode: 0o755, mounts: "", entries: [], ...overrides,
  };
}

function load(state, overrides: any = {}) {
  const fs = {
    existsSync: (p) => state.present.has(p), realpathSync: (p) => p,
    lstatSync: (p) => {
      if (p !== checkout && !state.present.has(p) && !state.symlinks.has(p)) {
        throw Object.assign(Error("fixture absent path"), { code: "ENOENT" });
      }
      return { isSymbolicLink: () => state.symlinks.has(p), uid: state.uid,
        mode: state.mode, isDirectory: () => true };
    },
    readdirSync: () => state.entries,
    readFileSync: (p) => { assert.equal(p, "/proc/self/mountinfo"); return state.mounts; },
    mkdtempSync: () => { throw Error("preflight must not create fixture directories"); },
    writeFileSync: () => { throw Error("preflight must not write files"); },
  };
  // This is a synthetic Linux host even when the unit test runs on Windows.
  const modules = { "node:fs": { ...fs, ...overrides.fs }, "node:path": path.posix,
    "node:url": { ...urls, fileURLToPath: (value) => urls.fileURLToPath(value, { windows: false }) },
    "@playwright/test": { expect: {}, test: { extend: () => ({}) } },
    "node:fs/promises": overrides.promises ?? {},
    "node:os": { homedir: () => runnerHome, userInfo: () => ({ homedir: runnerHome }), tmpdir: () => "/tmp" },
    "node:child_process": overrides.childProcess ?? { spawn: () => { throw Error("preflight must not spawn"); } },
    "node:http": overrides.http ?? { createServer: () => { throw Error("preflight must not open sockets"); } },
    "node:net": overrides.net ?? { createConnection: () => { throw Error("preflight must not open sockets"); } },
  };
  const module = { exports: {} as any };
  const require = (name) => {
    if (!Object.hasOwn(modules, name)) throw Error("Unexpected preflight dependency: " + name);
    return modules[name];
  };
  new Function("require", "module", "exports", "process", "__wp09", result.outputFiles[0].text
    + "\n//# sourceURL=wp02-preflight-bundle.js")(require, module, module.exports,
    { env: state.env, platform: "linux", cwd: () => checkout + "/ui", execPath: "/fixture/node" }, {
      projection: overrides.projection ?? (() => { throw Error("preflight must not project"); }),
      stub: overrides.stub ?? (() => { throw Error("preflight must not start upstream"); }),
      register: overrides.register ?? (() => {}),
    });
  return module.exports;
}

function fakeFallbackNet(outcome = "ECONNREFUSED") {
  const calls = [];
  return { calls, net: { createConnection(options) {
    const record = { ...options, timeout: null, destroyed: false };
    calls.push(record);
    const socket = Object.assign(new EventEmitter(), {
      setTimeout(ms) { record.timeout = ms; return this; },
      destroy() { record.destroyed = true; return this; },
    });
    queueMicrotask(() => {
      if (outcome === "connect" || outcome === "timeout") socket.emit(outcome);
      else socket.emit("error", Object.assign(Error("synthetic socket outcome"), { code: outcome }));
    });
    return socket;
  } } };
}

test("J6 probes only the two fallback targets and destroys every refused synthetic socket", async () => {
  const fixture = fakeFallbackNet();
  const proof = await load(host(), fixture).assertJ6FallbackPorts();
  const targets = ["127.0.0.1", "::1"].map((host) => ({ host, port: 10531 }));
  assert.deepEqual(proof, targets.map((target) => ({ ...target, outcome: "ECONNREFUSED" })));
  assert.deepEqual(fixture.calls, targets.map((target) => ({ ...target, timeout: 750, destroyed: true })));
});

test("J6 refuses listeners, timeouts and unexpected socket errors without startup", async () => {
  for (const [outcome, message] of [["connect", /fallback listener/], ["timeout", /probe timeout/], ["EACCES", /EACCES/]] as any[]) {
    const fixture = fakeFallbackNet(outcome);
    await assert.rejects(load(host(), fixture).startApp("minimax", { j6: true }), message);
    assert.equal(fixture.calls.length, 2);
    assert.ok(fixture.calls.every((call) => call.destroyed));
  }
});

test("J6 fallback helper rejects non-hosted identity before allocating any socket", async () => {
  for (const field of ["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT"]) {
    const state = host(); state.env[field] = "not-hosted";
    const fixture = fakeFallbackNet();
    await assert.rejects(load(state, fixture).assertJ6FallbackPorts(), /disposable GitHub-hosted/);
    assert.deepEqual(fixture.calls, []);
  }
});

test("J6 permits only verified hosted path metadata and reports it", () => {
  const proof = load(host()).assertJ6Isolation();
  assert.deepEqual(proof.runnerPaths, { xdgConfigHome: runnerHome + "/.config", azureExtensions: azure });
  assert.equal(proof.providerEnvironmentAbsent, true);
  assert.equal(proof.authStoresAbsent, true);
});

test("J6 does not treat path exceptions as credential or arbitrary-root exceptions", () => {
  for (const [key, value] of [["AZURE_CLIENT_SECRET", "fixture-secret"], ["OPENAI_API_KEY", "fixture-secret"],
    ["XDG_CONFIG_HOME", "/other/config"], ["AZURE_EXTENSION_DIR", "/other/extensions"]]) {
    const state = host(); state.env[key] = value;
    assert.throws(() => load(state).assertJ6Isolation(), /unsafe environment names/);
  }
});

test("J6 rejects linked paths, nonroot ownership and unobserved writable modes", () => {
  for (const state of [host({ symlinks: new Set([azure]) }), host({ symlinks: new Set([runnerHome + "/.config"]) }),
    host({ uid: 1001 }), host({ mode: 0o775 })]) {
    assert.throws(() => load(state).assertJ6Isolation(), /unsafe environment names/);
  }
});

test("verified XDG root still rejects auth stores and dotenv overrides", () => {
  const state = host(); state.present.add(runnerHome + "/.config/gcloud");
  assert.throws(() => load(state).assertJ6Isolation(), /auth store exists/);
  assert.throws(() => load(host({ entries: [".env.local"] })).assertJ6Isolation(), /dotenv override/);
  assert.throws(() => load(host({ mounts: "mount /Users/fixture/.grok /data rw" })).assertJ6Isolation(), /credential-bearing mount/);
});

test("J6 distinguishes genuine absent XDG root from a dangling symlink", () => {
  const state = host(); state.present.delete(runnerHome + "/.config");
  assert.equal(load(state).assertJ6Isolation().authStoresAbsent, true);
  state.symlinks.add(runnerHome + "/.config");
  assert.throws(() => load(state).assertJ6Isolation(), /unsafe environment names/);
});

test("J6 remains blocked on local/self-hosted contexts before any resource allocation", () => {
  for (const field of ["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT"]) {
    const state = host(); state.env[field] = "not-hosted";
    assert.throws(() => load(state).assertJ6Isolation(), /disposable GitHub-hosted/);
  }
});

test("J6 diagnostics expose fixed-path metadata without changing refusal or inspecting arbitrary values", () => {
  const state = host({ mode: 0o775 });
  const api = load(state);
  assert.equal(api.j6RunnerPathDiagnostics().AZURE_EXTENSION_DIR.mode, "775");
  assert.equal(api.j6RunnerPathDiagnostics().AZURE_EXTENSION_DIR.expectedPath, true);
  assert.throws(() => api.assertJ6Isolation(), /unsafe environment names/);
  state.env.AZURE_EXTENSION_DIR = "/untrusted/location";
  assert.deepEqual(load(state).j6RunnerPathDiagnostics().AZURE_EXTENSION_DIR, { expectedPath: false, inspected: false });
  state.env.GITHUB_ACTIONS = "false";
  assert.deepEqual(load(state).j6RunnerPathDiagnostics(), { inspected: false });
});

test("J6 recognizes observed canonical root-owned777 Azure path as unused metadata only", () => {
  const api = load(host({ mode: 0o777 }));
  assert.equal(api.assertJ6Isolation().azureExtensionHandling, "unused-public-tool-metadata");
  assert.equal(api.j6RunnerPathDiagnostics().AZURE_EXTENSION_DIR.mode, "777");
});

test("actual J6 startApp binds an emitted projection, IPC and allowlisted child environment", async () => {
  const state = host({ mode: 0o777 }); state.env.PATH = "/fixture/bin";
  const captured = [], writes = []; let stubClosed = false, projectionClosed = false, registered;
  const child = Object.assign(new EventEmitter(), {
    pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null,
    kill(this: any, signal) { this.signalCode = signal; queueMicrotask(() => { this.emit("exit", null, signal); this.emit("close", null, signal); }); return true; },
  });
  const projection = { root: "/tmp/wp09-runtime", guardPath: "/tmp/wp09-runtime/appNetworkGuard.mjs",
    entryPath: "/tmp/wp09-runtime/server.js", policyPath: "/tmp/wp09-runtime/fixture-policy.json",
    dispose: async () => { projectionClosed = true; } };
  const api = load(state, {
    net: fakeFallbackNet().net,
    promises: {
      mkdir: async () => {}, realpath: async (path) => path,
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      writeFile: async (path, value) => { writes.push([path, value]); },
    },
    projection: async (options) => { assert.equal(options.repoRoot, checkout); return projection; },
    register: (record) => { registered = record; },
    stub: async () => ({ url: "http://127.0.0.1:40123/v1", calls: [], externalAttempts: [], generationRequests: [],
      close: async () => { stubClosed = true; } }),
    childProcess: { spawn: (...args) => {
      captured.push(args);
      queueMicrotask(() => {
        child.emit("message", { type: "ima2-e2e-guard-ready", version: 1 });
        child.stdout.emit("data", Buffer.from("Image Gen running at http://127.0.0.1:40124"));
      });
      return child;
    } },
  });
  const app = await api.startApp("minimax", { j6: true, provider: "oauth" });
  try {
    assert.equal(captured.length, 1);
    const [command, args, options] = captured[0];
    assert.equal(command, "/fixture/node");
    assert.deepEqual(args, ["--import", projection.guardPath, projection.entryPath]);
    assert.equal(options.cwd, projection.root);
    assert.equal(options.stdio.at(-1), "ipc");
    for (const name of ["AZURE_EXTENSION_DIR", "XDG_CONFIG_HOME", "HOME", "NODE_OPTIONS"]) assert.equal(Object.hasOwn(options.env, name), false);
    assert.equal(options.env.IMA2_NO_OAUTH_PROXY, "1");
    assert.equal(Object.hasOwn(options.env, "IMA2_NO_GROK_PROXY"), false);
    assert.equal(options.env.IMA2_MCP_PROVIDERS, ",");
    assert.equal(options.env.IMA2_E2E_POLICY, projection.policyPath);
    assert.equal(Object.hasOwn(options, "shell"), false);
    const configWrites = writes.filter(([path]) => path.endsWith("/config.json"));
    assert.equal(configWrites.length, 1); assert.deepEqual(JSON.parse(configWrites[0][1]).mcp.enabledProviders, []);
    assert.equal(writes.filter(([path, value]) => path.endsWith("/fixture.env") && value === "").length, 1);
    assert.equal(app.guard.ready, true); assert.equal(registered.appOrigin, app.baseUrl);
    assert.equal(app.isolation.azureExtensionHandling, "unused-public-tool-metadata");
  } finally { await app.close(); }
  assert.equal(child.signalCode, "SIGTERM"); assert.equal(stubClosed, true); assert.equal(projectionClosed, true);
  assert.equal(registered.exited(), true);
});
