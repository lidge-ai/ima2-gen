import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../lib/db.ts";
import { OperationLedger } from "../lib/reset/operationLedger.ts";
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
describe("reset ledger controls", () => {
  it("migrates twice and records a settled operation", () => {
    one.claim(claim("control", "control"));
    assert.equal(one.sending("control", "owner-a"), true);
    one.settle("control", "reset");
    assert.equal((two.get("control") as { state: string }).state, "settled");
  });
});
