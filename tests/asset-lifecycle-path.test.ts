import assert from "node:assert/strict";
import { test, mock } from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

test("asset mutations reject roots and unsafe restore paths before effects", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "ima2-asset-path-")));
  const generated = join(root, "generated"), trash = join(root, "trash"), outside = join(root, "outside");
  const mutations: string[] = [];
  const mocks: Array<{ restore(): void }> = [];
  let denyMutations = true;
  let trashFails = false;
  const owned = (path: string) => assert.ok(resolve(path).startsWith(root + sep), "only owned fixture paths");
  try {
    for (const path of [generated, trash, outside, join(generated, "nested")]) await fs.mkdir(path);
    await fs.writeFile(join(trash, "saved.png"), "owned media");
    await fs.writeFile(join(trash, "saved.png.json"), '{"owned":true}');
    await fs.writeFile(`${trash}.json`, "root sidecar stays");
    await fs.writeFile(join(outside, "sentinel"), "unchanged");
    mocks.push(mock.module(new URL("../config.ts", import.meta.url).href, { namedExports: {
      config: { storage: { generatedDir: generated, trashDir: trash } },
    } }));
    mocks.push(mock.module(new URL("../lib/db.ts", import.meta.url).href, { namedExports: {
      getDb: () => ({ prepare: () => ({ all: () => [] }) }),
    } }));
    mocks.push(mock.module(new URL("../lib/systemTrash.ts", import.meta.url).href, { namedExports: {
      async moveToSystemTrash(paths: string[]) {
        mutations.push("trash"); paths.forEach(owned);
        if (denyMutations || trashFails) throw Error("OWNED_TRASH_REFUSAL");
      },
    } }));
    mocks.push(mock.module("fs/promises", { namedExports: { ...fs,
      async rename(from: string, to: string) {
        mutations.push("rename"); owned(from); owned(to);
        if (denyMutations) throw Error("MUTATION_BEFORE_VALIDATION");
        return fs.rename(from, to);
      },
      async unlink(path: string) {
        mutations.push("unlink"); owned(path);
        if (denyMutations) throw Error("MUTATION_BEFORE_VALIDATION");
        return fs.unlink(path);
      },
    } }));
    const { resolveInGenerated, trashAsset, restoreAsset, deleteAssetPermanent } = await import("../lib/assetLifecycle.ts");

    await t.test("lexical output resolution rejects root but permits new filenames", () => {
      for (const name of [".", generated, "nested/..", "../outside/sentinel"]) {
        assert.throws(() => resolveInGenerated("unused", name), { code: "INVALID_FILENAME" });
      }
      assert.equal(resolveInGenerated("unused", "new.png"), join(generated, "new.png"));
    });
    await t.test("single-asset trash cannot move a root or directory", async () => {
      mutations.length = 0;
      for (const name of [".", "nested"]) {
        await assert.rejects(trashAsset("unused", name), { code: "INVALID_FILENAME" });
      }
      assert.deepEqual(mutations, []);
      assert.equal((await fs.stat(generated)).isDirectory(), true);
    });
    await t.test("restore rejects trash root, traversal and directory sources without moves", async () => {
      mutations.length = 0;
      for (const id of [".", trash, "../outside/sentinel"]) {
        await assert.rejects(restoreAsset("unused", id, "restored.png"), { code: "INVALID_FILENAME" });
      }
      await fs.mkdir(join(trash, "directory"));
      await assert.rejects(restoreAsset("unused", "directory", "restored.png"), { code: "INVALID_FILENAME" });
      assert.deepEqual(mutations, []);
      assert.equal(await fs.readFile(`${trash}.json`, "utf8"), "root sidecar stays");
    });
    await t.test("outside destination parents and unsafe sidecars fail before media move", async () => {
      mutations.length = 0;
      const kind = process.platform === "win32" ? "junction" : "dir";
      await fs.symlink(outside, join(trash, "escape"), kind);
      await assert.rejects(restoreAsset("unused", "escape/sentinel", "restored.png"), { code: "INVALID_FILENAME" });
      await fs.symlink(outside, join(generated, "escape"), kind);
      await assert.rejects(restoreAsset("unused", "saved.png", "escape/restored.png"), { code: "INVALID_FILENAME" });
      await fs.writeFile(join(trash, "dangling.png"), "keep");
      await fs.symlink(join(root, "missing"), join(trash, "dangling.png.json"), kind);
      await assert.rejects(restoreAsset("unused", "dangling.png", "restored.png"), { code: "INVALID_FILENAME" });
      await fs.writeFile(join(trash, "directory-sidecar.png"), "keep");
      await fs.mkdir(join(trash, "directory-sidecar.png.json"));
      await assert.rejects(restoreAsset("unused", "directory-sidecar.png", "restored.png"), { code: "INVALID_FILENAME" });
      assert.deepEqual(mutations, []);
      assert.equal(await fs.readFile(join(trash, "saved.png"), "utf8"), "owned media");
      assert.equal(await fs.readFile(join(outside, "sentinel"), "utf8"), "unchanged");
    });
    await t.test("normal and nested restore preserve media and optional sidecar", async () => {
      denyMutations = false; mutations.length = 0;
      assert.deepEqual(await restoreAsset("unused", "saved.png", "nested/restored.png"), { ok: true });
      assert.equal(await fs.readFile(join(generated, "nested/restored.png"), "utf8"), "owned media");
      assert.equal(await fs.readFile(join(generated, "nested/restored.png.json"), "utf8"), '{"owned":true}');
      await fs.writeFile(join(trash, "solo.png"), "solo");
      assert.deepEqual(await restoreAsset("unused", "solo.png", "solo.png"), { ok: true });
      assert.equal(await fs.readFile(join(generated, "solo.png"), "utf8"), "solo");
    });
    await t.test("normal trash fallback mints flat names and permanent delete remains scoped", async () => {
      trashFails = true; mutations.length = 0;
      await fs.writeFile(join(generated, "fallback.png"), "fallback");
      await trashAsset("unused", "nested/../fallback.png");
      const names = await fs.readdir(trash);
      const moved = names.find((name) => /^\d+_fallback\.png$/.test(name));
      assert.ok(moved);
      assert.equal(basename(moved), moved);
      assert.equal(dirname(join(trash, moved)), trash);
      await deleteAssetPermanent("unused", "solo.png");
      await assert.rejects(fs.stat(join(generated, "solo.png")), { code: "ENOENT" });
      assert.equal(await fs.readFile(join(outside, "sentinel"), "utf8"), "unchanged");
    });
  } finally {
    for (const handle of mocks.reverse()) handle.restore();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
