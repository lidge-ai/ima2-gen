// Rebuild vendor/openai-oauth-2.0.0-ima2.1.tgz from the published openai-oauth@2.0.0.
// Usage: node scripts/vendor/openai-oauth/build.mjs
// The patch adds dist/ima2-session.js and routes the runtime's session and upstream fetch
// through it (see that file for the contract). Everything else stays byte-identical.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM = "openai-oauth@2.0.0";
const VERSION = "2.0.0-ima2.1";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const work = mkdtempSync(join(tmpdir(), "ima2-openai-oauth-"));

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tarball = execFileSync(npm, ["pack", UPSTREAM, "--silent"], { cwd: work, encoding: "utf8" }).trim().split("\n").pop();
execFileSync("tar", ["-xzf", tarball], { cwd: work });
const pkgDir = join(work, "package");

copyFileSync(join(here, "ima2-session.js"), join(pkgDir, "dist", "ima2-session.js"));

const chunkName = readFileSync(join(pkgDir, "dist", "index.js"), "utf8").match(/from "\.\/(chunk-[A-Z0-9]+\.js)"/)?.[1];
if (!chunkName) throw new Error("runtime chunk not found in dist/index.js");
const chunkPath = join(pkgDir, "dist", chunkName);
let chunk = readFileSync(chunkPath, "utf8");
const before = `var createOpenAIOAuthRuntime = (settings = {}) => {
  const auth = openaiCredentials(settings);
  const sharedSettings = {
    ...settings,
    auth: () => auth.getSession(),
    responsesState: false
  };`;
const after = `var createOpenAIOAuthRuntime = (settings = {}) => {
  const auth = createIma2Session(settings);
  const sharedSettings = {
    ...settings,
    fetch: auth.fetch,
    auth: () => auth.getSession(),
    responsesState: false
  };`;
if (!chunk.includes(before)) throw new Error("createOpenAIOAuthRuntime shape changed; update the patch");
chunk = chunk.replace(before, after);
chunk = `import { createIma2Session } from "./ima2-session.js";\n${chunk}`;
writeFileSync(chunkPath, chunk);

const pkgPath = join(pkgDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = VERSION;
pkg.ima2Patch = "dist/ima2-session.js: re-reads the session file per request, one serialized refresh shared by near-expiry tokens and upstream 401s with a single retry, compare-before-write so a concurrent login wins, atomic auth.json write-back that keeps unknown keys and mode 0600";
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);

const packed = execFileSync(npm, ["pack", "--silent"], { cwd: pkgDir, encoding: "utf8" }).trim().split("\n").pop();
const dest = join(root, "vendor", `openai-oauth-${VERSION}.tgz`);
copyFileSync(join(pkgDir, packed), dest);
console.log(dest);

