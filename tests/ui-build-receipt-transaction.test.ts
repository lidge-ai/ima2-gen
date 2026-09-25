import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { readFile, writeFile, unlink, mkdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { beginUiBuild, finishUiBuild, abortUiBuild, verifyUiBuildReceipt } from "../scripts/lib/uiBuildReceipt.mjs";
import { receiptFixture } from "./_uiBuildReceiptFixture.mjs";

const verify = (f) => verifyUiBuildReceipt({ repoRoot: f.root, distDir: f.dist, requireGitHead: false });
const execute = promisify(execFile);
const fixtureGit = (root, ...args) => execFileSync("git", ["-c", "core.hooksPath=" + join(root, "no-hooks"),
  "-c", "commit.gpgsign=false", "-c", "user.name=Receipt fixture", "-c", "user.email=fixture@example.invalid", ...args],
{ cwd: root, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CONFIG)/.test(key))) });

test("same-process transaction publishes complete outputs and consumers wait for lock release", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root);
    await assert.rejects(verify(f), { code: "UI_RECEIPT_BUSY" });
    await assert.rejects(beginUiBuild(f.root), { code: "UI_RECEIPT_BUSY" });
    const result = await finishUiBuild(f.root, tx);
    assert.equal(result.outputs.length, 4);
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_TRANSACTION" });
    await abortUiBuild(f.root, tx);
    assert.equal((await verify(f)).binding, "source-digest");
    await abortUiBuild(f.root, tx);
    const next = await beginUiBuild(f.root);
    await abortUiBuild(f.root, tx);
    await assert.rejects(verify(f), { code: "UI_RECEIPT_BUSY" });
    await abortUiBuild(f.root, next);
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

test("copied transactions and wrong nonce cannot borrow or delete a held build", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root);
    await assert.rejects(finishUiBuild(f.root, { ...tx }), { code: "UI_RECEIPT_TRANSACTION" });
    await assert.rejects(abortUiBuild(f.root, { ...tx }), { code: "UI_RECEIPT_TRANSACTION" });
    const path = join(f.root, "ui/node_modules/.cache/ima2-ui-build/active/input.json");
    const original = await readFile(path, "utf8");
    await writeFile(path, JSON.stringify({ ...JSON.parse(original), nonce: "foreign" }));
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_TRANSACTION" });
    await assert.rejects(abortUiBuild(f.root, tx), { code: "UI_RECEIPT_CLEANUP" });
    await writeFile(path, original);
    await abortUiBuild(f.root, tx);
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

test("source edits invalidate a build and do not leave an admissible receipt", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root);
    await f.put("ui/src/entry.ts", "changed source");
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_BUILD_CHANGED" });
    await abortUiBuild(f.root, tx);
    await assert.rejects(verify(f), { code: "UI_RECEIPT_MISSING" });
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

test("actual watcher callback observes edit/revert before finish without sleeping", { timeout: 10000 }, async (t) => {
  const f = await receiptFixture(); let tx, notify;
  const seen = new Promise<any>((resolve) => { notify = resolve; });
  const originalWatch = fs.watch;
  t.mock.method(fs, "watch", function (path, options, callback) {
    return originalWatch(path, options, (event, filename) => {
      callback(event, filename);
      if (String(filename).endsWith("entry.ts")) notify();
    });
  });
  syncBuiltinESMExports();
  try {
    tx = await beginUiBuild(f.root);
    const path = join(f.root, "ui/src/entry.ts"), original = await readFile(path);
    await writeFile(path, "temporary edit"); await seen; await writeFile(path, original);
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_BUILD_CHANGED" });
  } finally {
    if (tx) await abortUiBuild(f.root, tx);
    t.mock.restoreAll(); syncBuiltinESMExports(); await f.close();
  }
});

test("same-size public asset tamper and added outputs reject an otherwise valid receipt", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root); await finishUiBuild(f.root, tx); await abortUiBuild(f.root, tx);
    await f.put("ui/dist/fonts/fixture.woff2", "FONTBYTES");
    await assert.rejects(verify(f), { code: "UI_RECEIPT_OUTPUT" });
    await f.put("ui/dist/fonts/fixture.woff2", "fontbytes");
    await f.put("ui/dist/new.bin", "unlisted");
    await assert.rejects(verify(f), { code: "UI_RECEIPT_OUTPUT" });
    await unlink(join(f.dist, "new.bin"));
    assert.equal((await verify(f)).binding, "source-digest");
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

test("abandoned lock refuses reuse and never invalidates another owner's receipt", async () => {
  const f = await receiptFixture();
  try {
    await mkdir(join(f.root, "ui/node_modules/.cache/ima2-ui-build/active"), { recursive: true });
    await f.put("ui/dist/.ima2-ui-build-receipt.json", "prior owned marker");
    await assert.rejects(beginUiBuild(f.root), { code: "UI_RECEIPT_BUSY" });
    assert.equal(await readFile(join(f.dist, ".ima2-ui-build-receipt.json"), "utf8"), "prior owned marker");
  } finally { await f.close(); }
});

for (const signal of ["null-filename", "watch-error"]) test("watcher " + signal + " invalidates the real transaction", async (t) => {
  const f = await receiptFixture(), watchers = []; let tx;
  t.mock.method(fs, "watch", (_path, _options, callback) => {
    const watcher: any = new EventEmitter(); watcher.close = () => {}; watchers.push({ watcher, callback }); return watcher;
  });
  syncBuiltinESMExports();
  try {
    tx = await beginUiBuild(f.root); assert.ok(watchers.length > 0);
    if (signal === "null-filename") watchers[0].callback("rename", null);
    else watchers[0].watcher.emit("error", new Error("synthetic watch failure"));
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_BUILD_CHANGED" });
    await abortUiBuild(f.root, tx); await assert.rejects(verify(f), { code: "UI_RECEIPT_MISSING" });
  } finally { if (tx) await abortUiBuild(f.root, tx); t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
});

for (const path of ["ui/src/entry.ts", "ui/index.html", "ui/public/fonts/fixture.woff2", "ui/vite.config.ts", "package-lock.json"]) {
  test("receipt rejects changed selected source: " + path, async () => {
    const f = await receiptFixture(); let tx;
    try {
      tx = await beginUiBuild(f.root); await finishUiBuild(f.root, tx); await abortUiBuild(f.root, tx);
      await f.put(path, "independent altered input");
      await assert.rejects(verify(f), { code: "UI_RECEIPT_SOURCE" });
    } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
  });
}

test("actual synthetic Git HEAD change invalidates unchanged receipt inputs", async () => {
  const f = await receiptFixture(); let tx;
  const git = (...args) => fixtureGit(f.root, ...args);
  try {
    git("init"); git("commit", "--allow-empty", "-m", "fixture A");
    const firstHead = git("rev-parse", "HEAD").trim();
    tx = await beginUiBuild(f.root); const receipt = await finishUiBuild(f.root, tx); await abortUiBuild(f.root, tx);
    assert.equal(receipt.headSha, firstHead);
    assert.equal((await verifyUiBuildReceipt({ repoRoot: f.root, distDir: f.dist, requireGitHead: true })).binding, "git-and-source");
    git("commit", "--allow-empty", "-m", "fixture B");
    assert.notEqual(git("rev-parse", "HEAD").trim(), firstHead);
    await assert.rejects(verify(f), { code: "UI_RECEIPT_HEAD" });
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

async function wrapperFixture() {
  const f = await receiptFixture();
  try {
    const modules = ["uiBuildReceipt.mjs", "uiBuildReceiptSchema.mjs", "uiBuildReceiptFiles.mjs", "uiBuildReceiptTransaction.mjs"];
    for (const name of modules) await f.put("scripts/lib/" + name, await readFile(new URL("../scripts/lib/" + name, import.meta.url)));
    await f.put("scripts/write-ui-build-receipt.mjs", await readFile(new URL("../scripts/write-ui-build-receipt.mjs", import.meta.url)));
    await f.put("package.json", '{"type":"module"}'); await f.put("ui/package.json", '{"type":"module"}');
    await f.put(".gitignore", "/ui/node_modules/\n/ui/dist/\n");
    await f.put("ui/src/compiler-fixture-mode.json", '"success"');
    await f.put("ui/node_modules/typescript/package.json", '{"name":"typescript","type":"module"}');
    await f.put("ui/node_modules/vite/package.json", '{"name":"vite","type":"module"}');
    const common = `import fs from "node:fs/promises";
      const mode=JSON.parse(await fs.readFile("src/compiler-fixture-mode.json","utf8"));
      const stage=process.argv.includes("-b")?"tsc-app":process.argv.includes("-p")?"tsc-e2e":"vite";
      await fs.mkdir("node_modules/.cache",{recursive:true});
      await fs.appendFile("node_modules/.cache/stages.jsonl",JSON.stringify({stage,
        secretPresent:Object.hasOwn(process.env,"OPENAI_API_KEY"),target:process.env.VITE_IMA2_API_TARGET})+"\\n");
      if(mode===stage)process.exit(7);
    `;
    await f.put("ui/node_modules/typescript/bin/tsc", common);
    await f.put("ui/node_modules/vite/bin/vite.js", common + `
      await fs.rm("dist",{recursive:true,force:true});await fs.mkdir("dist/assets",{recursive:true});
      await fs.writeFile("dist/index.html","<main>synthetic compiled app</main>");
      await fs.writeFile("dist/assets/app.js","export {};");
    `);
    fixtureGit(f.root, "init"); fixtureGit(f.root, "add", "."); fixtureGit(f.root, "commit", "-m", "owned wrapper fixture");
    return f;
  } catch (error: any) { await f.close(); throw error; }
}

test("real wrapper releases each failed synthetic compiler stage and keeps the Git worktree clean", async () => {
  const f = await wrapperFixture();
  const run = () => execute(process.execPath, [join(f.root, "scripts/write-ui-build-receipt.mjs")], {
    cwd: join(f.root, "ui"), timeout: 15000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      OPENAI_API_KEY: "WP09-SYNTHETIC-SECRET-DO-NOT-LOG" },
  });
  try {
    for (const stage of ["tsc-app", "tsc-e2e", "vite"]) {
      await f.put("ui/src/compiler-fixture-mode.json", JSON.stringify(stage));
      fixtureGit(f.root, "add", "ui/src/compiler-fixture-mode.json"); fixtureGit(f.root, "commit", "-m", "synthetic fault " + stage);
      const before = fixtureGit(f.root, "status", "--porcelain");
      await assert.rejects(run(), (error: any) => {
        assert.equal(error.code, 1); assert.match(error.stderr, /UI_RECEIPT_IO/);
        assert.doesNotMatch(error.stdout + error.stderr, /WP09-SYNTHETIC-SECRET/); return true;
      });
      await assert.rejects(lstat(join(f.root, "ui/node_modules/.cache/ima2-ui-build/active")), { code: "ENOENT" });
      await assert.rejects(verify(f), { code: "UI_RECEIPT_MISSING" });
      assert.equal(fixtureGit(f.root, "status", "--porcelain"), before);
      await f.put("ui/src/compiler-fixture-mode.json", '"success"');
      fixtureGit(f.root, "add", "ui/src/compiler-fixture-mode.json"); fixtureGit(f.root, "commit", "-m", "restore synthetic compiler");
      const output = await run(); assert.equal(JSON.parse(output.stdout).binding, "git-and-source");
      assert.equal((await verify(f)).receipt.outputs.length, 2);
      assert.equal(fixtureGit(f.root, "status", "--porcelain"), "");
      assert.match(fixtureGit(f.root, "check-ignore", "ui/dist/index.html", "ui/node_modules/.cache/stages.jsonl"), /stages\.jsonl/);
    }
    const observations = (await readFile(join(f.root, "ui/node_modules/.cache/stages.jsonl"), "utf8")).trim().split("\n").map<any>(JSON.parse as any);
    assert.deepEqual(observations.map(({ stage }) => stage), ["tsc-app", "tsc-app", "tsc-e2e", "vite",
      "tsc-app", "tsc-e2e", "tsc-app", "tsc-e2e", "vite", "tsc-app", "tsc-e2e", "vite", "tsc-app", "tsc-e2e", "vite"]);
    assert.ok(observations.every(({ secretPresent, target }) => !secretPresent && target === "http://127.0.0.1:1"));
  } finally { await f.close(); }
});

test("build option changes invalidate an in-flight transaction without leaking a receipt", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root); process.env.VITE_SOURCEMAP = "1";
    await assert.rejects(finishUiBuild(f.root, tx), { code: "UI_RECEIPT_BUILD_CHANGED" });
    await abortUiBuild(f.root, tx); await assert.rejects(verify(f), { code: "UI_RECEIPT_MISSING" });
  } finally { delete process.env.VITE_SOURCEMAP; if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});

test("an archive cannot impersonate Git and broken Git metadata is not archive fallback", async () => {
  const f = await receiptFixture(); let tx;
  try {
    tx = await beginUiBuild(f.root); await finishUiBuild(f.root, tx); await abortUiBuild(f.root, tx);
    assert.equal((await verify(f)).binding, "source-digest");
    await assert.rejects(verifyUiBuildReceipt({ repoRoot: f.root, distDir: f.dist, requireGitHead: true }), { code: "UI_RECEIPT_HEAD" });
    await f.put(".git", "gitdir: ./missing-owned-git-dir\n");
    await assert.rejects(verify(f), { code: "UI_RECEIPT_HEAD" });
  } finally { if (tx) await abortUiBuild(f.root, tx); await f.close(); }
});
