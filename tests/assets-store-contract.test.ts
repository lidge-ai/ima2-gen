import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-assets-store-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "a.png"), "png!");
writeFileSync(join(GENERATED_DIR, "b.mp4"), "mp4!");

const store = await import("../lib/assetsStore.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function expectCode(fn: () => unknown, code: string, status: number) {
  assert.throws(fn, (error: unknown) => {
    const actual = error as { code?: string; status?: number };
    return actual.code === code && actual.status === status;
  });
}

describe("assets store contract", () => {
  it("round-trips CRUD, relative paths, metadata, and full tag replacement", () => {
    const asset = store.createAsset({
      kind: "image", name: "Hero", filePath: join(GENERATED_DIR, "a.png"),
      notes: "first note", metadata: { width: 8, nested: { ok: true } }, tags: ["red", "hero"],
    });
    assert.match(asset.id, /^a_/);
    assert.equal(asset.filePath, "a.png");
    assert.deepEqual(asset.metadata, { width: 8, nested: { ok: true } });
    assert.deepEqual(asset.tags, ["hero", "red"]);

    const updated = store.updateAsset(asset.id, {
      name: "Hero 2", notes: "second note", tags: ["blue"], metadata: { width: 16 },
    });
    assert.equal(updated?.name, "Hero 2");
    assert.deepEqual(updated?.tags, ["blue"]);
    assert.deepEqual(store.getAsset(asset.id)?.metadata, { width: 16 });
    assert.equal(store.deleteAsset(asset.id), true);
    assert.equal(store.getAsset(asset.id), null);
    assert.equal(store.deleteAsset(asset.id), false);
  });

  it("rejects kinds outside the allowlist", () => {
    expectCode(() => store.createAsset({ kind: "audio" as never }), "INVALID_ASSET_KIND", 400);
  });

  it("creates, renames, and moves folders while validating parent graphs", () => {
    const root = store.createFolder({ name: "Root" });
    const child = store.createFolder({ name: "Child", parentId: root.id });
    const other = store.createFolder({ name: "Other" });
    assert.match(root.id, /^af_/);
    assert.equal(store.updateFolder(child.id, { name: "Renamed", parentId: other.id })?.parentId, other.id);
    expectCode(() => store.createFolder({ name: "Bad", parentId: "af_missing" }), "INVALID_PARENT", 400);
    expectCode(() => store.updateFolder(root.id, { parentId: root.id }), "FOLDER_CYCLE", 409);
    store.updateFolder(child.id, { parentId: root.id });
    expectCode(() => store.updateFolder(root.id, { parentId: child.id }), "FOLDER_CYCLE", 409);
  });

  it("refuses to delete folders containing assets or child folders", () => {
    const assetFolder = store.createFolder({ name: "Has asset" });
    const asset = store.createAsset({ kind: "image", name: "inside", folderId: assetFolder.id });
    expectCode(() => store.deleteFolder(assetFolder.id), "FOLDER_NOT_EMPTY", 409);
    store.deleteAsset(asset.id);
    assert.equal(store.deleteFolder(assetFolder.id), true);

    const parent = store.createFolder({ name: "Has child" });
    const child = store.createFolder({ name: "Nested", parentId: parent.id });
    expectCode(() => store.deleteFolder(parent.id), "FOLDER_NOT_EMPTY", 409);
    assert.equal(store.deleteFolder(child.id), true);
    assert.equal(store.deleteFolder(parent.id), true);
  });

  it("paginates without duplicates or omissions, including equal timestamps", () => {
    const made = Array.from({ length: 4 }, (_, i) => store.createAsset({ kind: "image", name: `page-${i}` }));
    const first = store.listAssets({ q: "page-", limit: 2 });
    const second = store.listAssets({ q: "page-", limit: 2, cursor: first.nextCursor! });
    assert.equal(new Set([...first.assets, ...second.assets].map((a) => a.id)).size, 4);
    assert.deepEqual(new Set([...first.assets, ...second.assets].map((a) => a.id)), new Set(made.map((a) => a.id)));

    db.getDb().prepare("UPDATE assets SET created_at = ? WHERE name LIKE 'page-%'").run(123456789);
    const tie1 = store.listAssets({ q: "page-", limit: 2 });
    const tie2 = store.listAssets({ q: "page-", limit: 2, cursor: tie1.nextCursor! });
    assert.equal(new Set([...tie1.assets, ...tie2.assets].map((a) => a.id)).size, 4);
    assert.equal(tie2.nextCursor, null);
  });

  it("searches name and notes and treats SQL wildcard characters literally", () => {
    store.createAsset({ kind: "image", name: "needle in name" });
    store.createAsset({ kind: "image", name: "plain", notes: "needle in notes" });
    store.createAsset({ kind: "image", name: "literal %_ token" });
    store.createAsset({ kind: "image", name: "wildcard decoy" });
    assert.equal(store.listAssets({ q: "needle" }).assets.length, 2);
    assert.deepEqual(store.listAssets({ q: "%_" }).assets.map((a) => a.name), ["literal %_ token"]);
  });

  it("combines kind, tag, and folder filters and clamps limit to 500", () => {
    const folder = store.createFolder({ name: "Filters" });
    const wanted = store.createAsset({ kind: "video", name: "wanted", folderId: folder.id, tags: ["pick"] });
    store.createAsset({ kind: "image", name: "wrong-kind", folderId: folder.id, tags: ["pick"] });
    store.createAsset({ kind: "video", name: "wrong-tag", folderId: folder.id, tags: ["other"] });
    assert.deepEqual(store.listAssets({ kind: "video", folderId: folder.id, tag: "pick" }).assets.map((a) => a.id), [wanted.id]);
    assert.doesNotThrow(() => store.listAssets({ limit: 9999 }));
    assert.ok(store.listAssets({ limit: 9999 }).assets.length <= 500);
    assert.deepEqual(store.listTags(), [...store.listTags()].sort());
  });
});
