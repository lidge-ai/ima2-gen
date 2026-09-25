import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as util from "node:util";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { issueAppHome, registerOwnedApp, isOwnedBrowserOrigin, disposeOwnedApps } from "../ui/e2e/fixtures/appOwnership.ts";

const guards = ["appPolicy.mjs", "appFilePaths.mjs", "appFileDescriptors.mjs", "appFilesystemGuard.mjs", "appProcessGuard.mjs", "appNetworkGuard.mjs"];
const tracked = ["server.ts", "config.ts", "bin/ima2.ts", "package.json", "package-lock.json",
  "tsconfig.json", "tsconfig.build.json", "tsconfig.bin.json", ...guards.map((name) => "ui/e2e/fixtures/" + name)];
const compiled = await build({ entryPoints: [fileURLToPath(new URL("../ui/e2e/fixtures/appRuntimeBuild.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", external: ["node:*"], logLevel: "silent" });

async function fixture() {
  const container = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "wp09-runtime-unit-")));
  const root = path.join(container, "repo"), temporary = path.join(container, "tmp");
  const compilerRoot = path.join(root, "node_modules/typescript");
  const state = { head: "a".repeat(40), failStage: "", compiles: [], gitCalls: 0 };
  const put = async (name, text) => { const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
  await fs.mkdir(temporary, { recursive: true });
  for (const name of tracked) await put(name, name.endsWith(".json") ? "{}" : "export {};\n");
  for (const name of ["server.js", "config.js", "bin/ima2.js"]) await put(name, "export {};\n");
  await put("node_modules/typescript/package.json", JSON.stringify({ version: "synthetic-1" }));
  await put("node_modules/typescript/bin/tsc", "synthetic compiler");
  await put("node_modules/typescript/lib/tsc.js", "synthetic implementation");
  async function execute(file, args, options) {
    if (file === "git") {
      state.gitCalls++;
      assert.equal(options.cwd, root);
      assert.equal(options.env.GIT_DIR, undefined);
      if (args.join(" ") === "rev-parse HEAD") return state.head + "\n";
      if (args.join(" ") === "rev-parse --show-toplevel") return root + "\n";
      assert.deepEqual(Array.from(args), ["ls-files", "-z", "--cached"]);
      return tracked.join("\0") + "\0";
    }
    assert.equal(file, "/synthetic/node");
    assert.equal(args[0], path.join(compilerRoot, "bin/tsc"));
    assert.equal(options.timeout, 120000); assert.equal(options.maxBuffer, 8 * 1024 * 1024);
    const config = args[2], output = args[4]; state.compiles.push(config);
    assert.ok(output.startsWith(temporary + path.sep));
    if (state.failStage === config) throw Object.assign(new Error("synthetic compiler failure"), { code: "SYNTHETIC_COMPILER" });
    const outputs = config === "tsconfig.build.json" ? ["server.js", "config.js"] : ["bin/ima2.js"];
    for (const name of outputs) {
      const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "export {};\n");
    }
    return outputs.map((name) => "TSFILE: " + path.join(output, name)).join("\n");
  }
  const execFile = (file, args, options, callback) => {
    execute(file, args, options).then((stdout) => callback(null, { stdout, stderr: "" }), (error) => callback(error));
  };
  // Every subprocess is synthetic; no compiler, Git executable, app or runtime
  // guard is executed. Real IO is confined to this test's freshly-owned tree.
  const modules = { "node:fs/promises": fs, "node:path": path, "node:crypto": crypto, "node:util": util,
    "node:os": { tmpdir: () => temporary }, "node:child_process": { execFile },
    "node:module": { createRequire: () => ({ resolve: (name) => {
      assert.equal(name, "typescript/package.json"); return path.join(compilerRoot, "package.json");
    } }) } };
  const context = { Buffer, module: { exports: {} as any }, process: { execPath: "/synthetic/node", version: "v22.synthetic",
    env: { GIT_DIR: "/unowned/git", PATH: "/synthetic/bin" } }, require: (name) => {
    assert.ok(Object.hasOwn(modules, name), "unexpected real dependency: " + name); return modules[name];
  } };
  vm.runInNewContext(compiled.outputFiles[0].text, context, { timeout: 2000 });
  const api = context.module.exports;
  return { root, temporary, state, put, api, async close() {
    try { await api.disposeRuntimeBuildCache(); }
    finally { await fs.rm(container, { recursive: true, force: false }); }
  } };
}

test("concurrent runtime consumers share one verified synthetic compiler pair", async () => {
  const f = await fixture();
  try {
    const [one, two] = await Promise.all([f.api.getVerifiedRuntimeBuild(f.root), f.api.getVerifiedRuntimeBuild(f.root)]);
    assert.equal(one, two); assert.deepEqual(f.state.compiles, ["tsconfig.build.json", "tsconfig.bin.json"]);
    assert.equal(one.compilerVersion, "synthetic-1"); assert.equal(one.files.length, 10);
    assert.equal(Object.isFrozen(one), true); assert.equal(Object.isFrozen(one.files), true);
    assert.equal(await fs.readFile(path.join(one.root, "bin/ima2.js"), "utf8"), "#!/usr/bin/env node\nexport {};\n");
    assert.equal(await f.api.getVerifiedRuntimeBuild(f.root), one);
    assert.equal(f.state.compiles.length, 2);
  } finally { await f.close(); }
});

for (const stage of ["tsconfig.build.json", "tsconfig.bin.json"]) test("compiler failure cleans owned cache and permits retry: " + stage, async () => {
  const f = await fixture();
  try {
    f.state.failStage = stage;
    await assert.rejects(f.api.getVerifiedRuntimeBuild(f.root), { code: "SYNTHETIC_COMPILER" });
    assert.deepEqual(await fs.readdir(f.temporary), []);
    f.state.failStage = "";
    assert.ok((await f.api.getVerifiedRuntimeBuild(f.root)).root.startsWith(f.temporary + path.sep));
  } finally { await f.close(); }
});

for (const mutation of ["source", "head", "compiler", "emitted", "cache", "missing-guard"]) test("cached runtime refuses changed " + mutation, async () => {
  const f = await fixture();
  try {
    const snapshot = await f.api.getVerifiedRuntimeBuild(f.root);
    if (mutation === "source") await f.put("config.ts", "changed source");
    if (mutation === "head") f.state.head = "b".repeat(40);
    if (mutation === "compiler") await f.put("node_modules/typescript/lib/tsc.js", "changed compiler");
    if (mutation === "emitted") await f.put("server.js", "changed preceding build");
    if (mutation === "cache") await fs.writeFile(path.join(snapshot.root, "server.js"), "tamper");
    if (mutation === "missing-guard") await fs.unlink(path.join(snapshot.root, "appPolicy.mjs"));
    const expected = mutation === "cache" ? /E2E_CACHE_TAMPER/ : mutation === "emitted" ? /E2E_EMITTED_STALE/
      : mutation === "missing-guard" ? /ENOENT/ : /E2E_CACHE_STALE/;
    await assert.rejects(f.api.getVerifiedRuntimeBuild(f.root), expected);
    assert.equal(f.state.compiles.length, 2);
  } finally { await f.close(); }
});

test("identical cached bytes do not authorize replacing the runtime root with a symlink", async () => {
  const f = await fixture(); let runtime, backup;
  try {
    runtime = (await f.api.getVerifiedRuntimeBuild(f.root)).root; backup = runtime + "-owned-backup";
    await fs.rename(runtime, backup); await fs.symlink(backup, runtime, "dir");
    await assert.rejects(f.api.getVerifiedRuntimeBuild(f.root), /E2E_CACHE_OWNERSHIP/);
    assert.equal(f.state.compiles.length, 2);
  } finally {
    if (runtime && backup) { await fs.unlink(runtime); await fs.rename(backup, runtime); }
    await f.close();
  }
});

test("failed cache disposal retains ownership and never deletes a replacement root", async () => {
  const f = await fixture(); let container, backup;
  try {
    const snapshot = await f.api.getVerifiedRuntimeBuild(f.root);
    container = path.dirname(snapshot.root); backup = container + "-owned-backup";
    await fs.rename(container, backup); await fs.mkdir(container);
    await fs.writeFile(path.join(container, "replacement-marker"), "KEEP");
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.api.disposeRuntimeBuildCache(), /E2E_CACHE_OWNERSHIP/);
      assert.equal(await fs.readFile(path.join(container, "replacement-marker"), "utf8"), "KEEP");
      await assert.rejects(f.api.getVerifiedRuntimeBuild(f.root), /E2E_CACHE_OWNERSHIP/);
    }
    await fs.unlink(path.join(container, "replacement-marker")); await fs.rmdir(container);
    await fs.rename(backup, container); backup = undefined;
    await f.api.disposeRuntimeBuildCache(); await f.api.disposeRuntimeBuildCache();
    assert.deepEqual(await fs.readdir(f.temporary), []);
  } finally {
    if (backup) {
      await fs.unlink(path.join(container, "replacement-marker")); await fs.rmdir(container); await fs.rename(backup, container);
    }
    await f.close();
  }
});

test("a starting app record cannot later admit a malformed or foreign browser origin", async () => {
  // Only an issued temporary home is created: no app, guard or socket starts.
  const home = await issueAppHome(); let origin = null, closed = false;
  await registerOwnedApp({ home, get appOrigin() { return origin; }, stubOrigin: "http://127.0.0.1:41234",
    closeResources: async () => { closed = true; }, exited: () => closed, verificationReported: () => true, verify() {} });
  try {
    for (const value of ["https://example.invalid", "http://127.0.0.1:3333", "http://127.0.0.1:41235/path"]) {
      origin = value; assert.equal(isOwnedBrowserOrigin(value), false);
    }
    origin = "http://127.0.0.1:41235"; assert.equal(isOwnedBrowserOrigin(origin), true);
  } finally { await disposeOwnedApps(); }
  assert.equal(isOwnedBrowserOrigin("http://127.0.0.1:41235"), false);
  await assert.rejects(fs.lstat(home), { code: "ENOENT" });
});

test("projection construction keeps its original failure when cleanup also fails", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, "ui/dist"), { recursive: true });
    const output = await build({ entryPoints: [fileURLToPath(new URL("../ui/e2e/fixtures/appProjection.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
      external: ["node:*", "./appOwnership", "./appRuntimeBuild", "../../../scripts/lib/uiBuildReceipt.mjs"] });
    let attemptedCleanup = "";
    const modules = { "node:path": path, "node:crypto": crypto, "node:util": util,
      "node:os": { tmpdir: () => f.temporary }, "node:child_process": { execFile() { throw Error("unexpected subprocess"); } },
      "node:fs/promises": { ...fs, rm: async (target) => {
        assert.ok(target.startsWith(f.temporary + path.sep)); attemptedCleanup = target; throw Error("SYNTHETIC_CLEANUP_FAILURE");
      } },
      "./appOwnership": { requireAppHome: async () => {} },
      "./appRuntimeBuild": { getVerifiedRuntimeBuild: async () => ({ root: f.root, files: [{
        emittedPath: "server.js", emittedSha256: "0".repeat(64),
      }] }), readRuntimeFile: async () => Buffer.from("different bytes") },
      "../../../scripts/lib/uiBuildReceipt.mjs": { verifyUiBuildReceipt: async () => ({ receipt: { outputs: [] } }) },
    };
    const context = { Buffer, module: { exports: {} as any }, require: (name) => {
      assert.ok(Object.hasOwn(modules, name), "unexpected real dependency: " + name); return modules[name];
    } };
    vm.runInNewContext(output.outputFiles[0].text, context, { timeout: 2000 });
    await assert.rejects(context.module.exports.createAppProjection({ repoRoot: f.root, home: f.temporary, buildDir: path.join(f.root, "ui/dist") }), (error: any) => {
      assert.equal(error.name, "AggregateError");
      assert.deepEqual(Array.from(error.errors, (cause: any) => cause.message), ["E2E_PROJECTION_INVALID", "SYNTHETIC_CLEANUP_FAILURE"]); return true;
    });
    assert.ok(attemptedCleanup.startsWith(f.temporary + path.sep));
  } finally { await f.close(); }
});

for (const fault of ["copy-tamper", "post-copy-busy"]) test("projection rejects a build/copy race: " + fault, async () => {
  const f = await fixture();
  try {
    const buildDir = path.join(f.root, "ui/dist"); await f.put("ui/dist/index.html", "GOOD");
    await f.put("assets/mcp-snapshots/higgsfield.sanitized.json", "{}");
    await f.put("assets/mcp-snapshots/runway.sanitized.json", "{}");
    const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
    const outputs = [{ path: "index.html", bytes: 4, sha256: digest("GOOD") }];
    const compiled = await build({ entryPoints: [fileURLToPath(new URL("../ui/e2e/fixtures/appProjection.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
      external: ["node:*", "./appOwnership", "./appRuntimeBuild", "../../../scripts/lib/uiBuildReceipt.mjs"] });
    let receiptReads = 0;
    const modules = { "node:path": path, "node:crypto": crypto, "node:util": util, "node:fs/promises": fs,
      "node:os": { tmpdir: () => f.temporary }, "node:child_process": { execFile(_file, args, _options, callback) {
        assert.equal(args[0], "ls-files"); callback(null, { stdout: "assets/mcp-snapshots/higgsfield.sanitized.json\0assets/mcp-snapshots/runway.sanitized.json\0" });
      } },
      "./appOwnership": { requireAppHome: async () => {} },
      "./appRuntimeBuild": { getVerifiedRuntimeBuild: async () => ({ root: f.root, files: [{
        emittedPath: "server.js", emittedSha256: digest("export {};\n"),
      }] }), readRuntimeFile: async (root, name) => {
        if (root === buildDir && fault === "copy-tamper") return Buffer.from("EVIL");
        return fs.readFile(path.join(root, name));
      } },
      "../../../scripts/lib/uiBuildReceipt.mjs": {
        inventoryUiOutputs: async (root) => {
          assert.equal(await fs.readFile(path.join(root, "index.html"), "utf8"), "GOOD"); return outputs;
        },
        verifyUiBuildReceipt: async () => {
          receiptReads++;
          if (fault === "post-copy-busy" && receiptReads > 1) throw Object.assign(Error("UI_RECEIPT_BUSY"), { code: "UI_RECEIPT_BUSY" });
          return { receipt: { outputs } };
        },
      },
    };
    const context = { Buffer, module: { exports: {} as any }, require: (name) => {
      assert.ok(Object.hasOwn(modules, name), "unexpected real dependency: " + name); return modules[name];
    } };
    vm.runInNewContext(compiled.outputFiles[0].text, context, { timeout: 2000 });
    await assert.rejects(context.module.exports.createAppProjection({ repoRoot: f.root, home: f.temporary, buildDir }),
      fault === "copy-tamper" ? /E2E_PROJECTION_INVALID/ : /UI_RECEIPT_BUSY/);
    assert.equal(receiptReads, fault === "copy-tamper" ? 1 : 2);
    assert.deepEqual(await fs.readdir(f.temporary), []);
  } finally { await f.close(); }
});
