import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-queue-migration-"));
const DB_PATH = join(TEST_DIR, "legacy.db");
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = DB_PATH;

const legacy = new Database(DB_PATH);
legacy.exec(`
  CREATE TABLE agent_queue_items (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    prompt     TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'queued',
    created_at INTEGER NOT NULL
  );
`);
legacy.close();

const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("Agent queue migration contract", () => {
  it("holds a write lock throughout migration and permits a second connection to migrate", () => {
    const path = join(TEST_DIR, "concurrent.db");
    const first = new Database(path);
    const second = new Database(path, { timeout: 0 });
    const originalExec = first.exec.bind(first);
    let checkedLock = false;
    first.exec = (sql: string) => {
      if (!checkedLock) {
        checkedLock = true;
        assert.throws(() => second.transaction(() => {}).immediate(), { code: "SQLITE_BUSY" });
      }
      return originalExec(sql);
    };
    try {
      db.migrate(first);
      assert.equal(checkedLock, true);
      assert.doesNotThrow(() => db.migrate(second));
      const columns = second.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
      for (const name of ["graph_version", "style_sheet", "style_sheet_enabled"]) {
        assert.ok(columns.some((column) => column.name === name), `${name} should exist`);
      }
    } finally {
      first.close();
      second.close();
    }
  });

  it("does not change an already migrated schema or its data", () => {
    const database = new Database(join(TEST_DIR, "idempotent.db"));
    try {
      db.migrate(database);
      database.prepare("INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)").run("kept", 1, 1);
      const schema = database.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
      const version = database.pragma("schema_version", { simple: true });
      db.migrate(database);
      assert.deepEqual(database.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(), schema);
      assert.equal(database.pragma("schema_version", { simple: true }), version);
      assert.ok(database.prepare("SELECT id FROM sessions WHERE id = ?").get("kept"));
    } finally {
      database.close();
    }
  });

  it("adds planner queue columns to existing user databases", () => {
    const database = db.getDb();
    const columns = (database
      .prepare("PRAGMA table_info(agent_queue_items)")
      .all() as Array<{ name: string }>)
      .map((row) => row.name);

    for (const name of [
      "request_id",
      "options",
      "tool_plan",
      "position",
      "result_image_ids",
      "error_code",
      "error_class",
      "error_message",
      "started_at",
      "finished_at",
    ]) {
      assert.ok(columns.includes(name), `${name} should be migrated`);
    }
  });
});
