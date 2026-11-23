import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { join, relative } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { safeDenial, REPORTED } from "./appPolicy.mjs";
import { createPathChecker, expectedMetadata, expectedPlatformProbe, lexicalPath } from "./appFilePaths.mjs";
import { accessMode, createDescriptorRegistry } from "./appFileDescriptors.mjs";

export function installFilesystemGuard(policy, report = () => {}) {
  const restores = [];
  const native = { realpathSync: fs.realpathSync, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync,
    existsSync: fs.existsSync, exists: fs.exists };
  const checkPath = createPathChecker(policy, native);
  const descriptors = createDescriptorRegistry(report);
  const platformLabels = new Map([["/usr/bin/ldd", "platformLdd"], ["/proc/self/exe", "platformExecutable"],
    ["/proc/self/maps", "platformMaps"], ["/proc/version", "platformKernel"], ["/proc/self/cgroup", "platformContainer"]]);
  const mark = (error, operation, value, platformProbe = false) => {
    if (error?.[REPORTED]) return error;
    const denied = safeDenial(); denied[REPORTED] = true;
    let label;
    try { label = platformLabels.get(lexicalPath(value)); } catch { /* Never print unvalidated paths. */ }
    report({ type: "ima2-e2e-file-denied", operation: label ? `${operation}.${label}` : operation,
      category: platformProbe ? "expected-platform-probe"
        : expectedMetadata(value, operation, policy) ? "expected-discovery-metadata" : "outside-fixture" });
    return denied;
  };
  const path = (value, operation, write = false) => {
    if (expectedPlatformProbe(value, operation, write)) throw mark(null, operation, value, true);
    if (expectedMetadata(value, operation, policy)) throw mark(null, operation, value);
    return checkPath(value, operation, write);
  };
  const isDescriptor = (value) => typeof value === "number"
    || (value && typeof value === "object" && !(value instanceof URL) && !Buffer.isBuffer(value));
  const flags = (args, key, fallback) => typeof args[1] === "object" && args[1] !== null ? args[1][key] ?? fallback : fallback;
  const dataPath = (args, operation, write, openFlags) => {
    if (isDescriptor(args[0])) return descriptors.check(args[0], operation, write ? "write" : "read");
    return path(args[0], operation, write || accessMode(openFlags).write);
  };
  const copyTree = (source, destination, operation) => {
    const base = path(source, operation), target = path(destination, operation, true);
    const visit = (current) => {
      let stat;
      try { stat = native.lstatSync(current); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw safeDenial();
      path(current, operation); path(join(target, relative(base, current)), operation, true);
      if (stat.isDirectory()) for (const entry of native.readdirSync(current)) visit(join(current, entry));
    };
    visit(base);
  };
  const denialReturn = (mode, args, error) => {
    if (mode === "promise") return Promise.reject(error);
    if (mode === "callback" && typeof args.at(-1) === "function") { process.nextTick(args.at(-1), error); return undefined; }
    throw error;
  };
  const wrapper = (original, mode, operation, validate, after = (_state, value) => value, final = () => {}) =>
    function (...args) {
      let state;
      try { state = validate(args, operation); }
      catch (error) { return denialReturn(mode, args, mark(error, operation, args[0])); }
      if (mode === "promise") {
        return Promise.resolve().then(() => Reflect.apply(original, this, args))
          .then((value) => after(state, value)).finally(() => final(state));
      }
      if (mode === "callback" && typeof args.at(-1) === "function") {
        const callback = args.at(-1);
        args[args.length - 1] = function (...values) {
          try { if (values[0] == null && values.length > 1) values[1] = after(state, values[1]); }
          finally { final(state); }
          return Reflect.apply(callback, this, values);
        };
        return Reflect.apply(original, this, args);
      }
      try { return after(state, Reflect.apply(original, this, args)); } finally { final(state); }
    };
  const patch = (target, key, value) => {
    const original = Object.getOwnPropertyDescriptor(target, key);
    if (!original || typeof original.value !== "function") return;
    Object.defineProperty(target, key, { ...original, value });
    restores.push(() => Object.defineProperty(target, key, original));
  };
  const install = (name, validate, after, final) => {
    for (const [target, key, mode, operation] of [[fs, name, "callback", name], [fs, name + "Sync", "sync", name + "Sync"], [fsp, name, "promise", "promises." + name]]) {
      if (typeof target[key] !== "function") continue;
      const original = target[key], guarded = wrapper(original, mode, operation, validate, after, final);
      if (typeof original.native === "function") {
        Object.defineProperty(guarded, "native", { configurable: true, writable: true,
          value: wrapper(original.native, mode, operation + ".native", validate, after, final) });
      }
      patch(target, key, guarded);
    }
  };
  const restore = () => {
    descriptors.restore();
    for (const restore of restores.reverse()) restore();
    syncBuiltinESMExports();
  };
  try {
    const oldHome = os.homedir;
    os.homedir = () => policy.home; restores.push(() => { os.homedir = oldHome; });
    for (const name of ["readdir", "opendir", "stat", "lstat", "realpath", "access", "readlink"]) install(name, (args, op) => path(args[0], op));
    install("readFile", (args, op) => dataPath(args, op, false, flags(args, "flag", "r")));
    for (const name of ["writeFile", "appendFile", "truncate"]) install(name, (args, op) => dataPath(args, op, true, "w"));
    for (const name of ["mkdir", "rm", "rmdir", "unlink", "chmod", "chown", "utimes"]) install(name, (args, op) => path(args[0], op, true));
    install("copyFile", (args, op) => { path(args[0], op); path(args[1], op, true); });
    install("cp", (args, op) => copyTree(args[0], args[1], op));
    install("rename", (args, op) => { path(args[0], op, true); path(args[1], op, true); });
    for (const name of ["symlink", "link"]) install(name, () => { throw safeDenial(); });
    install("open", (args, op) => {
      const openFlags = typeof args[1] === "function" || args[1] === undefined ? "r" : args[1];
      path(args[0], op, accessMode(openFlags).write); return openFlags;
    }, (openFlags, value) => typeof value === "number" ? (descriptors.register(value, openFlags), value) : descriptors.bindHandle(value, openFlags));
    for (const name of ["read", "readv", "fstat"]) install(name, (args, op) => descriptors.check(args[0], op, name === "fstat" ? "metadata" : "read"));
    for (const name of ["write", "writev", "ftruncate", "fchmod", "fchown", "futimes"]) install(name, (args, op) => descriptors.check(args[0], op, "write"));
    for (const name of ["fsync", "fdatasync"]) install(name, (args, op) => descriptors.check(args[0], op, "metadata"));
    install("close", (args, op) => descriptors.check(args[0], op, "metadata"), undefined, (entry) => descriptors.forget(entry));
    patch(fs, "existsSync", function (value) {
      try { path(value, "existsSync"); return Reflect.apply(native.existsSync, this, [value]); }
      catch (error) { mark(error, "existsSync", value); return false; }
    });
    patch(fs, "exists", function (value, callback) {
      try { path(value, "exists"); return Reflect.apply(native.exists, this, [value, callback]); }
      catch (error) { mark(error, "exists", value); process.nextTick(callback, false); }
    });
    for (const name of ["createReadStream", "createWriteStream"]) {
      const original = fs[name], write = name === "createWriteStream";
      patch(fs, name, function (value, options = {}) {
        let openFlags;
        try {
          if (options?.fd !== undefined || options?.fs !== undefined) throw safeDenial();
          openFlags = options?.flags ?? (write ? "w" : "r"); path(value, name, write || accessMode(openFlags).write);
        } catch (error) { throw mark(error, name, value); }
        const stream = Reflect.apply(original, this, [value, options]); let entry;
        stream.once("open", (fd) => { entry = descriptors.register(fd, openFlags); });
        stream.once("close", () => { if (entry) descriptors.forget(entry); });
        return stream;
      });
    }
    syncBuiltinESMExports();
  } catch (error) { restore(); throw error; }
  let restored = false;
  return () => { if (!restored) { restored = true; restore(); } };

}
