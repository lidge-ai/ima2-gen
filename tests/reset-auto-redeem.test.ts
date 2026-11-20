import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateResetTables } from "../lib/reset/operationLedger.ts";
import { CodexAutoRedeem } from "../lib/reset/codexAutoRedeem.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";

after(() => assert.equal(sentinelCount(), 0));
async function fixture(fn: (ctx: { a: Database.Database; b: Database.Database; watcher: CodexAutoRedeem;
  scheduled: Array<() => void>; inspections: () => number }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "ima2-auto-fixture-"));
  const a = new Database(join(root, "db")); const b = new Database(join(root, "db"));
  migrateResetTables(a); a.prepare("INSERT INTO reset_settings VALUES ('codex', 0, 10, 0)").run();
  const scheduled: Array<() => void> = []; let calls = 0;
  const watcher = new CodexAutoRedeem(b, async () => { calls++; }, cb => scheduled.push(cb));
  try { await fn({ a, b, watcher, scheduled, inspections: () => calls }); }
  finally { a.close(); b.close(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
describe("auto-redeem behavior", () => {
  it("observes enable from another connection within one tick after boot", async () => fixture(async f => {
    f.watcher.start(); f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    await f.watcher.tick(); assert.equal(f.inspections(), 1);
  }));
});
describe("auto-redeem controls", () => {
  it("starts while disabled and performs no inspections across ticks", async () => fixture(async f => {
    f.watcher.start(); assert.equal(f.scheduled.length, 1);
    await f.watcher.tick(); await f.watcher.tick(); await f.watcher.tick(); assert.equal(f.inspections(), 0);
  }));
});
