import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../lib/db.ts";
import { migrateResetTables, OperationLedger } from "../lib/reset/operationLedger.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
const root = mkdtempSync(join(tmpdir(), "ima2-reset-ledger-"));
const a = new Database(join(root, "ledger.sqlite"));
const b = new Database(join(root, "ledger.sqlite"));
migrate(a); migrate(b);
const one = new OperationLedger(a); const two = new OperationLedger(b);
after(() => { a.close(); b.close(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); assert.equal(sentinelCount(), 0); });
const claim = (operationId: string, ledgerKey: string) => ({ operationId, ledgerKey, ownerId: "owner-a", provider: "codex" });
describe("reset ledger behavior across connections", () => {
  it("rejects a second unresolved claim for the same account", () => {
    one.claim(claim("claim-1", "account-1"));
    assert.throws(() => two.claim(claim("claim-2", "account-1")));
  });
  it("fences a paused or wrong owner before sending", () => {
    one.claim(claim("claim-3", "account-3"));
    assert.equal(two.sending("claim-3", "owner-b"), false);
  });
  it("cannot send a row already abandoned by recovery", () => {
    one.claim(claim("claim-4", "account-4"));
    b.prepare("UPDATE reset_operations SET state='abandoned' WHERE operation_id=?").run("claim-4");
    assert.equal(one.sending("claim-4", "owner-a"), false);
  });
});
describe("reset ledger recovery and revision", () => {
  it("abandons stale claims and releases their reservation", () => {
    one.claim(claim("stale-claim", "stale-account"));
    a.prepare("INSERT INTO reset_owners VALUES (?, ?, ?)").run("owner-a", process.pid, 0);
    a.prepare("INSERT INTO reset_targets VALUES (?, ?, ?, ?, ?)").run("codex", "stale-account", "credit", "stale-claim", 0);
    two.recover(100_000);
    assert.equal((one.get("stale-claim") as { state: string }).state, "abandoned");
  });
  it("releases a stale pre-send reservation", () => {
    one.claim(claim("stale-target", "stale-target-account"));
    a.prepare("INSERT INTO reset_targets VALUES (?, ?, ?, ?, ?)").run("codex", "stale-target-account", "credit", "stale-target", 0);
    two.recover(100_000);
    assert.equal(a.prepare("SELECT * FROM reset_targets WHERE operation_id=?").get("stale-target"), undefined);
  });
  it("marks stale sending operations unknown with recovered origin", () => {
    one.claim(claim("stale-send", "stale-send-account"));
    one.sending("stale-send", "owner-a");
    two.recover(100_000);
    assert.deepEqual(a.prepare("SELECT state, unknown_origin FROM reset_operations WHERE operation_id=?").get("stale-send"),
      { state: "unknown", unknown_origin: "recovered" });
  });
  it("records and persists owner unknown origin across reopening", () => {
    one.claim(claim("owner-unknown", "owner-unknown-account"));
    one.sending("owner-unknown", "owner-a");
    one.unknown("owner-unknown");
    const reopened = new Database(join(root, "ledger.sqlite"));
    try {
      assert.equal((reopened.prepare("SELECT unknown_origin FROM reset_operations WHERE operation_id=?").get("owner-unknown") as { unknown_origin: string }).unknown_origin, "owner");
    } finally { reopened.close(); }
  });
  it("refuses claims against a stale account revision", () => {
    a.prepare("INSERT INTO reset_accounts VALUES (?, ?, ?)").run("codex", "revision-account", 2);
    assert.throws(() => one.claim({ ...claim("stale-revision", "revision-account"), expectedRevision: 1 }));
  });
});
describe("reset ledger controls", () => {
  it("adds a nullable snapshot to existing databases idempotently", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE reset_operations (operation_id TEXT PRIMARY KEY, provider TEXT NOT NULL, ledger_key TEXT NOT NULL, target TEXT,
        state TEXT NOT NULL, unknown_origin TEXT, outcome TEXT, owner_id TEXT NOT NULL, acknowledged_at INTEGER,
        acknowledged_by TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO reset_operations VALUES ('old', 'codex', 'account', NULL, 'settled', NULL, NULL, 'owner', NULL, NULL, NULL, 0, 0)`);
      migrateResetTables(db); migrateResetTables(db);
      assert.deepEqual(db.prepare("SELECT credit_snapshot FROM reset_operations WHERE operation_id='old'").get(), { credit_snapshot: null });
    } finally { db.close(); }
  });
  it("migrates twice and records a settled operation", () => {
    one.claim(claim("control", "control"));
    assert.equal(one.sending("control", "owner-a"), true);
    one.settle("control", "reset");
    assert.equal((two.get("control") as { state: string }).state, "settled");
  });
});
