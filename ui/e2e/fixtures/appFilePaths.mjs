import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isDescendant, safeDenial } from "./appPolicy.mjs";

const homeForbidden = ["runtime", ".npm-global", ".nvm", ".fnm", ".volta", ".bun", ".config/yarn", ".asdf",
  ".local/share", "Library/pnpm", ".npm", "AppData"];
const wildcardBases = [".nvm/versions/node", ".fnm/node-versions", ".asdf/installs/nodejs", ".local/share/mise/installs/node",
  "Library/pnpm/global", ".local/share/pnpm/global", "AppData/Local/pnpm/global", ".npm/_npx",
  "AppData/Local/npm-cache/_npx", "AppData/Roaming/npm-cache/_npx", "AppData/Roaming/nvm"];
const forbiddenData = /^(?:\.env.*|\.ima2|\.codex|\.grok|\.progrok|generated|auth\.json|config\.json|.*\.(?:db|sqlite).*)$/i;
const metadataOperations = new Set(["stat", "lstat", "realpath", "access"]);
export function toPath(value) {
  let result;
  if (Buffer.isBuffer(value)) {
    result = value.toString("utf8");
    if (!Buffer.from(result).equals(value)) throw safeDenial();
  } else if (value instanceof URL) {
    if (value.protocol !== "file:") throw safeDenial();
    result = fileURLToPath(value);
  } else if (typeof value === "string") result = value;
  else throw safeDenial();
  if (result.includes("\0")) throw safeDenial();
  return result;
}
export function lexicalPath(value) { return resolve(toPath(value)); }
const normalOp = (operation) => operation.replace(/^promises\./, "").replace(/\.native$/, "").replace(/Sync$/, "");
const normalized = (path) => path.split(sep).join("/");
const inMigration = (path, home) => {
  const rel = normalized(relative(home, path));
  return homeForbidden.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"));
};
export function expectedMetadata(value, operation, policy) {
  let path;
  try { path = lexicalPath(value); } catch { return false; }
  const op = normalOp(operation);
  if (operation === "existsSync") {
    return path === join(policy.root, ".ima2/config.json")
      || path === join(policy.home, ".npm-global/bin", process.platform === "win32" ? "agy.cmd" : "agy");
  }
  if (op === "stat") {
    if (path === join(policy.root, "generated")) return true;
    if (["/opt/homebrew", "/usr/local"].some((prefix) =>
      path === prefix + "/lib/node_modules/ima2-gen/generated" || path === prefix + "/node_modules/ima2-gen/generated")) return true;
    return isDescendant(path, policy.home) && inMigration(path, policy.home)
      && normalized(path).endsWith("/node_modules/ima2-gen/generated");
  }
  return op === "readdir" && wildcardBases.some((part) => path === join(policy.home, part));
}
export function expectedPlatformProbe(value, operation, write) {
  if (write || !["open", "readFile"].includes(normalOp(operation))) return false;
  // Content remains denied. This only identifies the observed libc
  // detector probes so its report-based fallback can run without false alarm.
  let path;
  try { path = lexicalPath(value); } catch { return false; }
  // better-sqlite3 13.2 reads maps synchronously for libc detection and falls back on denial.
  return path === "/proc/self/exe" || path === "/usr/bin/ldd"
    || (path === "/proc/self/maps" && operation === "readFileSync");
}
function admitted(path, operation, write, policy) {
  if (isDescendant(path, policy.home)) return !inMigration(path, policy.home);
  if (write) return false;
  if (isDescendant(path, policy.root)) {
    if (isDescendant(path, join(policy.root, "ui/dist"))) return true;
    return !relative(policy.root, path).split(sep).some((part) => forbiddenData.test(part));
  }
  for (const root of policy.dependencyRoots) if (isDescendant(path, root)) {
    return !relative(root, path).split(sep).some((part) => forbiddenData.test(part));
  }
  return metadataOperations.has(normalOp(operation)) && [policy.root, policy.home, ...policy.dependencyRoots].some((root) => isDescendant(root, path));
}
export function createPathChecker(policy, native) {
  return (value, operation, write = false) => {
    const lexical = lexicalPath(value);
    if (!admitted(lexical, operation, write, policy)) throw safeDenial();
    let cursor = lexical; const suffix = [];
    while (true) {
      try {
        const canonical = resolve(native.realpathSync(cursor), ...suffix);
        if (!admitted(canonical, operation, write, policy)) throw safeDenial();
        return lexical;
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw safeDenial();
        const parent = dirname(cursor);
        if (parent === cursor) throw safeDenial();
        suffix.unshift(relative(parent, cursor)); cursor = parent;
      }
    }
  };
}
