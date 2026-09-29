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
