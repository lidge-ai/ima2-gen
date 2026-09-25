import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as urls from "node:url";
import { EventEmitter } from "node:events";

const ROOT = "/fixture/runtime", HOME = "/fixture/home", DEP = "/fixture/dependencies/node_modules";
const policy = { version: 1, root: ROOT, home: HOME, dependencyRoots: [DEP] };
const bundles = new Map();
async function loadGuard(name): Promise<any> {
  let source = bundles.get(name);
  if (!source) {
    const entry = fileURLToPath(new URL("../ui/e2e/fixtures/" + name, import.meta.url));
    const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
      external: ["node:*"], logLevel: "silent", define: { "import.meta.url": JSON.stringify(urls.pathToFileURL(entry).href) } });
    source = result.outputFiles[0].text; bundles.set(name, source);
  }
  const native = [], reports = [], files = new Map([[HOME + "/config.json", "{}"], [ROOT + "/lib/module.js", "module"]]);
  const directories = new Set(["/", "/fixture", ROOT, HOME, DEP, ROOT + "/lib"]);
  const metadata = (p) => ({ isDirectory: () => directories.has(p), isFile: () => !directories.has(p),
    isSymbolicLink: () => p === ROOT + "/node_modules", dev: 1, ino: 1 });
  const io = (method, value) => { native.push(method); return Buffer.from(files.get(value) ?? "outside-sentinel"); };
  let fd = 20; const descriptors = new Map();
  const fakeFs: any = { constants: { O_SYNC: 1052672, O_NOFOLLOW: 131072 },
    realpathSync(p) { if (p === ROOT + "/node_modules") return DEP; if (files.has(p) || directories.has(p)) return p; throw Object.assign(Error("missing"), { code: "ENOENT" }); },
    lstatSync(p) { if (p === ROOT + "/node_modules" || files.has(p) || directories.has(p)) return metadata(p); throw Object.assign(Error("missing"), { code: "ENOENT" }); },
    readdirSync(p) { return [...files.keys(), ...directories].filter((x) => path.posix.dirname(x) === p && x !== p).map((x) => path.posix.basename(x)); },
    existsSync(p) { native.push("existsSync"); return files.has(p) || directories.has(p); },
    exists(p, callback) { native.push("exists"); queueMicrotask(() => callback(files.has(p))); },
  };
  const fakePromises: any = {};
  for (const method of ["readFile", "readdir", "opendir", "stat", "lstat", "realpath", "access", "readlink",
    "writeFile", "appendFile", "mkdir", "rm", "rmdir", "unlink", "truncate", "chmod", "chown", "utimes",
    "copyFile", "cp", "rename", "symlink", "link", "read", "readv", "write", "writev", "fstat",
    "ftruncate", "fchmod", "fchown", "futimes", "fsync", "fdatasync"]) {
    const run = (...args) => io(method, typeof args[0] === "number" ? descriptors.get(args[0]) : args[0]);
    fakeFs[method + "Sync"] ??= run;
    fakeFs[method] = (...args) => { const value = run(...args); queueMicrotask(() => args.at(-1)(null, value)); };
    fakePromises[method] = async (...args) => run(...args);
  }
  fakeFs.openSync = (p) => { native.push("openSync"); descriptors.set(++fd, p); return fd; };
  fakeFs.open = (p, ...args) => { const value = fakeFs.openSync(p); queueMicrotask(() => args.at(-1)(null, value)); };
  fakeFs.closeSync = (value) => { native.push("closeSync"); descriptors.delete(value); };
  fakeFs.close = (value, callback) => { fakeFs.closeSync(value); queueMicrotask(() => callback(null)); };
  fakePromises.open = async (p) => {
    const handle: any = new EventEmitter(); handle.fd = fakeFs.openSync(p);
    handle.readFile = async () => io("handle.readFile", p);
    handle.writeFile = async () => { io("handle.writeFile", p); };
    handle.stat = async () => metadata(p);
    handle.close = async () => { fakeFs.closeSync(handle.fd); handle.emit("close"); };
    return handle;
  };
  fakeFs.realpathSync.native = fakeFs.realpathSync;
  fakeFs.realpath.native = (p, ...args) => queueMicrotask(() => args.at(-1)(null, fakeFs.realpathSync(p)));
  fakeFs.createReadStream = () => { native.push("createReadStream"); return new EventEmitter(); };
  fakeFs.createWriteStream = () => { native.push("createWriteStream"); return new EventEmitter(); };
  class Socket { connect() { native.push("socket.connect"); return this; } }
  class TlsSocket extends Socket { override connect() { native.push("tls.connect"); return this; } }
  class ResolverBase { resolve4() { native.push("resolver.resolve4"); } }
  class Resolver extends ResolverBase {}
  const child: any = { ChildProcess: class { spawn() { native.push("child.spawn"); } } };
  for (const method of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
    child[method] = () => { native.push(method); };
    child[method][Symbol.for("nodejs.util.promisify.custom")] = async () => { native.push("custom." + method); };
  }
  const modules: any = { "node:path": path.posix, "node:url": urls, "node:fs": fakeFs, "node:fs/promises": fakePromises,
    "node:os": { homedir: () => "/ambient-unread" }, "node:module": { syncBuiltinESMExports() {} },
    "node:child_process": child, "node:worker_threads": { Worker: class { constructor() { native.push("worker"); } } },
    "node:net": { Socket, connect() { native.push("net.connect"); }, createConnection() { native.push("net.createConnection"); } },
    "node:tls": { TLSSocket: TlsSocket, connect() { native.push("tls.connect"); } },
    "node:dns": { Resolver, lookup() { native.push("dns.lookup"); }, resolveTxt() { native.push("dns.resolveTxt"); } },
    "node:dns/promises": { Resolver, lookup() { native.push("dnsPromises.lookup"); }, resolveTxt() { native.push("dnsPromises.resolveTxt"); } },
    "node:http2": { connect() { native.push("http2"); } },
    "node:dgram": { createSocket() { native.push("udp"); }, Socket: class { send() { native.push("udp.send"); } connect() { native.push("udp.connect"); } } },
  };
  const sandbox: any = { Buffer, URL, console, queueMicrotask, setTimeout, clearTimeout,
    process: { platform: "linux", cwd: () => ROOT, env: { IMA2_E2E_HOME: HOME }, execPath: "/fixture/node", execArgv: [],
      nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)) },
    WebSocket: class { constructor() { native.push("websocket"); } }, module: { exports: {} },
    require(name) { assert.ok(Object.hasOwn(modules, name), "No real module may escape the synthetic guard fixture: " + name); return modules[name]; },
  };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  return { api: sandbox.module.exports, modules, sandbox, native, reports, files, report: (row) => reports.push(row) };
}

test("guard policy validates only synthetic roots and rejects unknown schema", async () => {
  const f = await loadGuard("appPolicy.mjs");
  assert.equal(f.api.parsePolicy(policy).root, ROOT);
  assert.throws(() => f.api.parsePolicy({ ...policy, extra: true }), { code: "E2E_POLICY_INVALID" });
  assert.equal(f.api.isDescendant(ROOT + "-other/x", ROOT), false);
  assert.equal(f.native.length, 0);
});
test("process guard blocks direct, custom, inherited and Worker entry points before sentinels", async () => {
  const f = await loadGuard("appProcessGuard.mjs"), child = f.modules["node:child_process"];
  const restore = f.api.installProcessGuard(f.report, f.api.createProcessClassifier(policy, [DEP + "/codex.js"]));
  try {
    for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
      assert.throws(() => child[name]("foreign", []), { code: "E2E_PROCESS_DENIED" });
      assert.equal(child[name][Symbol.for("nodejs.util.promisify.custom")], undefined);
    }
    assert.throws(() => new f.modules["node:worker_threads"].Worker("foreign"), { code: "E2E_PROCESS_DENIED" });
    assert.throws(() => child.ChildProcess.prototype.spawn({}), { code: "E2E_PROCESS_DENIED" });
    assert.throws(() => child.spawn("agy", ["--version"]), { code: "E2E_PROCESS_DENIED" });
    assert.equal(f.reports.at(-1).discovery, "agy-version");
    assert.throws(() => child.execFileSync("arbitrary", ["login", "status"]), { code: "E2E_PROCESS_DENIED" });
    assert.equal(f.reports.at(-1).discovery, null); assert.equal(f.native.length, 0);
  } finally { restore(); }
  child.spawn(); assert.deepEqual(f.native, ["spawn"]);
});
test("network guard denies foreign and resolver/protocol paths while admitting only exact owned TCP", async () => {
  const f = await loadGuard("appNetworkGuard.mjs"), m = f.modules;
  const restore = f.api.installNetworkGuard(policy, f.report, "http://127.0.0.1:41234");
  try {
    for (const call of [() => m["node:net"].connect({ host: "foreign", port: 443 }),
      () => m["node:net"].Socket.prototype.connect({ host: "127.0.0.1", port: 3333 }),
      () => m["node:net"].connect({ host: "127.0.0.1", port: 41234, path: "/socket" }),
      () => new m["node:dns"].Resolver().resolve4("foreign"),
      () => m["node:dns/promises"].resolveTxt("foreign"), () => m["node:tls"].connect({ host: "127.0.0.1", port: 41234 }),
      () => m["node:http2"].connect("foreign"), () => m["node:dgram"].createSocket("udp4"),
      () => new f.sandbox.WebSocket("ws://foreign")]) assert.throws(call, { code: "E2E_EGRESS_DENIED" });
    assert.equal(f.native.length, 0);
    m["node:net"].connect({ host: "127.0.0.1", port: 41234 });
    assert.deepEqual(f.native, ["net.connect"]);
  } finally { restore(); }
});

test("numeric loopback lookup serves the bind literal without invoking a native resolver", async () => {
  const f = await loadGuard("appNetworkGuard.mjs"), m = f.modules;
  const restore = f.api.installNetworkGuard(policy, f.report, "http://127.0.0.1:41234");
  try {
    const all = await new Promise<any>((resolve, reject) => m["node:dns"].lookup("127.0.0.1", { all: true },
      (error, addresses) => error ? reject(error) : resolve(addresses)));
    assert.equal(JSON.stringify(all), '[{"address":"127.0.0.1","family":4}]');
    const one = await new Promise<any>((resolve, reject) => m["node:dns"].lookup("127.0.0.1",
      (error, address, family) => error ? reject(error) : resolve({ address, family })));
    assert.deepEqual(one, { address: "127.0.0.1", family: 4 });
    assert.equal(JSON.stringify(await m["node:dns/promises"].lookup("127.0.0.1")), '{"address":"127.0.0.1","family":4}');
    assert.deepEqual(f.native, []); assert.deepEqual(f.reports, []);
    assert.throws(() => m["node:dns"].lookup("localhost", () => {}), { code: "E2E_EGRESS_DENIED" });
    assert.throws(() => m["node:dns"].lookup("127.0.0.1", { family: 6 }, () => {}), { code: "E2E_EGRESS_DENIED" });
    assert.throws(() => m["node:net"].connect({ host: "127.0.0.1", port: 3333 }), { code: "E2E_EGRESS_DENIED" });
    assert.deepEqual(f.native, []);
  } finally { restore(); }
  m["node:dns"].lookup("127.0.0.1", () => {}); assert.deepEqual(f.native, ["dns.lookup"]);
});

test("fixed readonly platform probes stay denied but are distinguished from unexpected content and writes", async () => {
  const f = await loadGuard("appFilesystemGuard.mjs"), fs = f.modules["node:fs"];
  const restore = f.api.installFilesystemGuard(policy, f.report);
  try {
    for (const path of ["/proc/self/exe", "/usr/bin/ldd"]) {
      assert.throws(() => fs.openSync(path, "r"), { code: "E2E_FILESYSTEM_DENIED" });
      assert.equal(f.reports.at(-1).category, "expected-platform-probe");
      assert.throws(() => fs.readFileSync(path), { code: "E2E_FILESYSTEM_DENIED" });
      assert.equal(f.reports.at(-1).category, "expected-platform-probe");
      for (const flags of ["w", "r+", 512]) {
        assert.throws(() => fs.openSync(path, flags), { code: "E2E_FILESYSTEM_DENIED" });
        assert.equal(f.reports.at(-1).category, "outside-fixture");
      }
      assert.throws(() => fs.readFileSync(path, { flag: "r+" }), { code: "E2E_FILESYSTEM_DENIED" });
      assert.equal(f.reports.at(-1).category, "outside-fixture");
    }
    assert.throws(() => fs.readFileSync("/proc/version"), { code: "E2E_FILESYSTEM_DENIED" });
    assert.equal(f.reports.at(-1).category, "outside-fixture");
    assert.throws(() => fs.readFileSync(ROOT + "/.ima2/config.json"), { code: "E2E_FILESYSTEM_DENIED" });
    assert.equal(f.reports.at(-1).category, "outside-fixture"); assert.deepEqual(f.native, []);
  } finally { restore(); }
});
test("filesystem guard preserves synthetic-home data and blocks outside paths, write flags and foreign descriptors", async () => {
  const f = await loadGuard("appFilesystemGuard.mjs"), fs = f.modules["node:fs"], promises = f.modules["node:fs/promises"];
  const restore = f.api.installFilesystemGuard(policy, f.report);
  try {
    assert.equal(f.modules["node:os"].homedir(), HOME);
    assert.equal(fs.readFileSync(HOME + "/config.json").toString(), "{}");
    f.native.length = 0;
    assert.throws(() => fs.readFileSync("/outside/secret"), { code: "E2E_FILESYSTEM_DENIED" });
    assert.throws(() => fs.readFileSync(ROOT + "/lib/module.js", { flag: "w" }), { code: "E2E_FILESYSTEM_DENIED" });
    assert.throws(() => fs.readFileSync(999), { code: "E2E_FILESYSTEM_DENIED" });
    assert.equal(fs.existsSync(ROOT + "/.ima2/config.json"), false);
    assert.equal(f.reports.at(-1).category, "expected-discovery-metadata");
    await assert.rejects(promises.readFile("/outside/secret"), { code: "E2E_FILESYSTEM_DENIED" });
    await new Promise<void>((resolve) => fs.readFile("/outside/secret", (error) => { assert.equal(error.code, "E2E_FILESYSTEM_DENIED"); resolve(); }));
    assert.equal(f.native.length, 0);
    const handle = await promises.open(HOME + "/config.json", "r");
    assert.equal((await handle.readFile()).toString(), "{}");
    await assert.rejects(handle.writeFile("bad"), { code: "E2E_FILESYSTEM_DENIED" });
    await handle.close();
    await assert.rejects(handle.readFile(), { code: "E2E_FILESYSTEM_DENIED" });
  } finally { restore(); }
  assert.equal(f.modules["node:os"].homedir(), "/ambient-unread");
});
