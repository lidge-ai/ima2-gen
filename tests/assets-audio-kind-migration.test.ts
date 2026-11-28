// The "audio" asset kind: the assets table of an existing database is rebuilt to accept it, losing nothing.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-audio-kind-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "voice.mp3"), "mp3-bytes");

const db = await import("../lib/db.ts");
const { registerAssetsRoutes } = await import("../routes/assets.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** The asset tables as schema version 9 made them, with rows that point at each other. */
function version9(path: string) {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta (key, value) VALUES ('schema_version', '9');
    CREATE TABLE asset_folders (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES asset_folders(id) ON DELETE SET NULL
    );
    CREATE TABLE assets (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('image','video','element','preset','template')),
      name       TEXT NOT NULL,
      file_path  TEXT,
      folder_id  TEXT,
      notes      TEXT,
      metadata   TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES asset_folders(id) ON DELETE SET NULL
    );
    CREATE TABLE asset_tags (
      asset_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (asset_id, tag),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_assets_kind ON assets(kind, created_at);
    CREATE INDEX idx_assets_folder ON assets(folder_id, created_at);
    CREATE INDEX idx_assets_created ON assets(created_at DESC, id DESC);
    CREATE INDEX idx_asset_tags_tag ON asset_tags(tag);
    CREATE TABLE sprite_recipes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, recipe TEXT NOT NULL,
      anchor_asset_id TEXT, anchor_status TEXT NOT NULL DEFAULT 'missing'
        CHECK (anchor_status IN ('missing','candidate','approved')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (anchor_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );
    CREATE TABLE sprite_recipe_rows (
      recipe_id TEXT NOT NULL, state_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','queued','running','complete','error','canceled')),
      request_id TEXT, result_asset_id TEXT, error_code TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (recipe_id, state_key),
      FOREIGN KEY (recipe_id) REFERENCES sprite_recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (result_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );
    INSERT INTO asset_folders VALUES ('f1', 'Foxes', NULL, 1, 1);
    INSERT INTO assets VALUES ('a1', 'image', 'fox', 'fox.png', 'f1', 'a note', NULL, 10, 11);
    INSERT INTO assets VALUES ('a2', 'element', 'Mina', NULL, NULL, NULL, '{"elementKind":"character","name":"Mina","refs":["fox.png"]}', 20, 21);
    INSERT INTO assets VALUES ('a3', 'video', 'clip', 'clip.mp4', NULL, NULL, NULL, 30, 31);
    INSERT INTO asset_tags VALUES ('a1', 'animal'), ('a1', 'winter'), ('a2', 'cast');
    INSERT INTO sprite_recipes VALUES ('r1', 'walk', '{}', 'a1', 'approved', 1, 1);
    INSERT INTO sprite_recipe_rows VALUES ('r1', 'idle', 'complete', 'req', 'a3', NULL, 1);
  `);
  return database;
}
const dump = (database: Database.Database) => ({
  assets: database.prepare("SELECT * FROM assets ORDER BY id").all(),
  tags: database.prepare("SELECT * FROM asset_tags ORDER BY asset_id, tag").all(),
  folders: database.prepare("SELECT * FROM asset_folders ORDER BY id").all(),
  recipes: database.prepare("SELECT * FROM sprite_recipes ORDER BY id").all(),
  rows: database.prepare("SELECT * FROM sprite_recipe_rows ORDER BY recipe_id, state_key").all(),
});
const insertAsset = (database: Database.Database, id: string, kind: string) =>
  database.prepare("INSERT INTO assets (id, kind, name, file_path, created_at, updated_at) VALUES (?, ?, 'n', 'x', 1, 1)").run(id, kind);

describe("a version 9 database gains the audio asset kind", () => {
  it("keeps every asset, tag, folder and sprite link, and leaves no broken reference", () => {
    const database = version9(join(TEST_DIR, "v9-keep.db"));
    try {
      const before = dump(database);
      assert.throws(() => insertAsset(database, "early", "audio"), /CHECK constraint/);
      db.migrate(database);
      assert.deepEqual(dump(database), before);
      assert.deepEqual(database.pragma("foreign_key_check"), []);
      assert.equal(database.pragma("foreign_keys", { simple: true }), 1, "foreign keys are enforced again after the rebuild");
      assert.equal((database.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string }).value, "10");
      const indexes = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'assets' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
      assert.deepEqual(indexes, ["idx_assets_created", "idx_assets_folder", "idx_assets_kind"]);
      assert.equal((database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'assets_%' AND type = 'table'").get() as { n: number }).n, 0, "no leftover working table");
    } finally {
      database.close();
    }
  });

  it("accepts audio, still refuses an unknown kind, and the other tables still follow an asset's deletion", () => {
    const database = version9(join(TEST_DIR, "v9-use.db"));
    try {
      db.migrate(database);
      insertAsset(database, "au1", "audio");
      assert.equal((database.prepare("SELECT kind FROM assets WHERE id = 'au1'").get() as { kind: string }).kind, "audio");
      assert.throws(() => insertAsset(database, "bad", "hologram"), /CHECK constraint/);
      database.prepare("DELETE FROM assets WHERE id = 'a1'").run();
      assert.equal((database.prepare("SELECT COUNT(*) AS n FROM asset_tags WHERE asset_id = 'a1'").get() as { n: number }).n, 0);
      assert.equal((database.prepare("SELECT anchor_asset_id AS id FROM sprite_recipes WHERE id = 'r1'").get() as { id: string | null }).id, null);
      database.prepare("DELETE FROM asset_folders WHERE id = 'f1'").run();
      assert.deepEqual(database.pragma("foreign_key_check"), []);
    } finally {
      database.close();
    }
  });

  it("a second start changes nothing", () => {
    const database = version9(join(TEST_DIR, "v9-twice.db"));
    try {
      db.migrate(database);
      const once = dump(database);
      const schema = database.pragma("schema_version", { simple: true });
      db.migrate(database);
      assert.equal(database.pragma("schema_version", { simple: true }), schema, "the second start ran schema statements");
      assert.deepEqual(dump(database), once);
    } finally {
      database.close();
    }
  });

  it("a new database starts with the audio kind", () => {
    const database = new Database(join(TEST_DIR, "fresh.db"));
    try {
      db.migrate(database);
      insertAsset(database, "au1", "audio");
      assert.equal((database.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string }).value, "10");
    } finally {
      database.close();
    }
  });
});

describe("POST /api/assets with kind audio", () => {
  it("needs a file in the generated storage, like image and video, and lists by kind", async () => {
    const app = express();
    app.use(express.json());
    registerAssetsRoutes(app, {});
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
    const post = async (body: unknown) => {
      const response = await fetch(base + "/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    };
    try {
      const bare = await post({ kind: "audio", name: "Narration" });
      assert.deepEqual([bare.status, bare.body.error.code], [400, "INVALID_FILENAME"]);
      const missing = await post({ kind: "audio", name: "Narration", filePath: "nope.mp3" });
      assert.deepEqual([missing.status, missing.body.error.code], [400, "INVALID_FILENAME"]);
      const made = await post({ kind: "audio", name: "Narration", filePath: "voice.mp3" });
      assert.equal(made.status, 201);
      assert.deepEqual([made.body.asset.kind, made.body.asset.filePath], ["audio", "voice.mp3"]);
      const listed = await (await fetch(base + "/api/assets?kind=audio")).json() as any;
      assert.deepEqual(listed.assets.map((asset: any) => asset.name), ["Narration"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
