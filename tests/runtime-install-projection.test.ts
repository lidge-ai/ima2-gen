import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { projectRuntimeInstallContract, readRuntimeInstallContract } from "../scripts/generate-runtime-install-contract.mjs";

const files = ["README.md", "docs/README.ko.md", "docs/README.ja.md", "docs/README.zh-CN.md", "docs/README.zh-TW.md", "AGENTS.md", "structure/06-infra-operations.md"];
async function fixture(engine = ">=24") {
  const root = await mkdtemp(join(tmpdir(), "ima2-runtime-projection-"));
  await mkdir(join(root, "scripts")); await mkdir(join(root, "site/public"), { recursive: true }); await mkdir(join(root, "docs")); await mkdir(join(root, "structure"));
  await writeFile(join(root, "package.json"), JSON.stringify({ bin: { ima2: "bin/ima2.js" }, engines: { node: engine }, packageManager: "npm@11.18.0", dependencies: { openai: "^5", express: "^5" } })); await writeFile(join(root, ".node-version"), "24.17.0\n");
  for (const name of ["install-mac.sh", "install-linux.sh"]) await writeFile(join(root, "scripts", name), `x\n# runtime-contract:generated:start\nMIN_NODE=99\n# runtime-contract:generated:end\ny\n`);
  await writeFile(join(root, "scripts/install-windows.ps1"), "# runtime-contract:generated:start\n$MIN_NODE = 99\n# runtime-contract:generated:end\n");
  for (const path of files) await writeFile(join(root, path), `before\n<!-- runtime-install:generated:start -->\nold\n<!-- runtime-install:generated:end -->\nafter\n`);
  for (const name of ["install-mac.sh", "install-linux.sh", "install-windows.ps1"]) await writeFile(join(root, "site/public", name), "stale\n");
  return root;
}

test("projects package metadata, installer markers, and public copies deterministically", async () => { const root = await fixture(); try { assert.equal((await readRuntimeInstallContract(root)).minimumNodeMajor, 24); const first = await projectRuntimeInstallContract(root); assert.ok(first.changedPaths.length); const before = await readFile(join(root, "README.md"), "utf8"); assert.deepEqual((await projectRuntimeInstallContract(root)).changedPaths, []); assert.equal(await readFile(join(root, "README.md"), "utf8"), before); assert.match(await readFile(join(root, "site/public/install-linux.sh"), "utf8"), /MIN_NODE=24/); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
test("invalid metadata or markers fails before writing any target", async () => { const root = await fixture(">=22"); try { const original = await readFile(join(root, "README.md"), "utf8"); await writeFile(join(root, "scripts/install-mac.sh"), "missing markers"); await assert.rejects(projectRuntimeInstallContract(root), /MARKERS_INVALID/); assert.equal(await readFile(join(root, "README.md"), "utf8"), original); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
test("check is read-only and catches source, public, and document drift", async () => { const root = await fixture(); try { await projectRuntimeInstallContract(root); const source = await readFile(join(root, "scripts/install-linux.sh"), "utf8"), before = await readFile(join(root, "README.md"), "utf8"); await writeFile(join(root, "scripts/install-linux.sh"), source.replace("MIN_NODE=24", "MIN_NODE=23")); assert.ok((await projectRuntimeInstallContract(root, { check: true })).changedPaths.includes("scripts/install-linux.sh")); await writeFile(join(root, "scripts/install-linux.sh"), source); await writeFile(join(root, "site/public/install-linux.sh"), "drift"); assert.ok((await projectRuntimeInstallContract(root, { check: true })).changedPaths.includes("site/public/install-linux.sh")); await writeFile(join(root, "site/public/install-linux.sh"), source); await writeFile(join(root, "README.md"), before.replace("| Node engine |", "| Changed engine |")); assert.ok((await projectRuntimeInstallContract(root, { check: true })).changedPaths.includes("README.md")); assert.equal((await readFile(join(root, "README.md"), "utf8")).includes("Changed engine"), true); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
test("duplicate markers and malformed package values reject without partial writes", async () => { for (const mutate of [async (root: string) => writeFile(join(root, "README.md"), "<!-- runtime-install:generated:start -->\n<!-- runtime-install:generated:start -->\n<!-- runtime-install:generated:end -->"), async (root: string) => { const p = JSON.parse(await readFile(join(root, "package.json"), "utf8")); p.packageManager = "npm@latest"; await writeFile(join(root, "package.json"), JSON.stringify(p)); }, async (root: string) => { const p = JSON.parse(await readFile(join(root, "package.json"), "utf8")); delete p.dependencies.openai; await writeFile(join(root, "package.json"), JSON.stringify(p)); }]) { const root = await fixture(); try { const original = await readFile(join(root, "docs/README.ko.md"), "utf8"); await mutate(root); await assert.rejects(projectRuntimeInstallContract(root)); assert.equal(await readFile(join(root, "docs/README.ko.md"), "utf8"), original); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } } });
test("CLI defaults to its working directory and returns 0, 1, or 2", async () => {
  const root = await fixture();
  try {
    const script = join(process.cwd(), "scripts/generate-runtime-install-contract.mjs");
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.equal(run(["--root"]).status, 2);
    assert.equal(run(["--root", "--check"]).status, 2);
    assert.equal(run(["--root", root, "--check"]).status, 1);
    assert.equal(run([]).status, 0);
    const checked = run(["--check"]);
    assert.equal(checked.status, 0);
    assert.deepEqual(JSON.parse(checked.stdout).changedPaths, []);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
