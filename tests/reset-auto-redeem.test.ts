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
import { CodexResetClient } from "../lib/reset/codexResetClient.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { readResetSettings, writeResetSettings } from "../lib/reset/settings.ts";

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
  it("observes disable from another connection after it was enabled", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    await f.watcher.tick(); f.a.prepare("UPDATE reset_settings SET enabled=0 WHERE provider='codex'").run();
    await f.watcher.tick(); assert.equal(f.inspections(), 1);
  }));
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

describe("auto-redeem reservation and settings", () => {
  it("validates the persisted lead bounds and default", async () => fixture(async f => {
    f.a.prepare("DELETE FROM reset_settings").run();
    assert.deepEqual(readResetSettings(f.a), { enabled: false, leadMinutes: 10 });
    for (const leadMinutes of [0, 61, 1.5]) assert.throws(() => writeResetSettings(f.a, { enabled: true, leadMinutes }));
    assert.deepEqual(writeResetSettings(f.a, { enabled: true, leadMinutes: 1 }), { enabled: true, leadMinutes: 1 });
  }));
  it("reserves a target even when the first scheduler already settled", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }], outcome: "reset" });
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.a, deps).tick(); await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.deepEqual(fake.calls.find(c => c.url.endsWith("/consume"))?.body, { redeem_request_id: (f.a.prepare("SELECT operation_id FROM reset_targets").get() as { operation_id: string }).operation_id });
  }));
  it("never redispatches an unknown outcome after restart", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] });
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.a, deps).tick(); await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "unknown");
  }));
  it("abandons and releases its target if disabled before sending", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z"); let identityCalls = 0;
    const fake = fakeResetTransport({ credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }], outcome: "reset" });
    const deps = { accountId: async () => { if (++identityCalls === 2) f.a.prepare("UPDATE reset_settings SET enabled=0").run(); return "fixture-account"; },
      client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
    assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "abandoned");
    assert.equal((f.a.prepare("SELECT count(*) AS n FROM reset_targets").get() as { n: number }).n, 0);
  }));
  it("skips expired credits", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-20T23:59:00Z" }] });
    await new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now }).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
  }));
});
