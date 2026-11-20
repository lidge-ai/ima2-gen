import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateResetTables, OperationLedger } from "../lib/reset/operationLedger.ts";
import { CodexAutoRedeem } from "../lib/reset/codexAutoRedeem.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { CodexResetClient } from "../lib/reset/codexResetClient.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { readResetSettings, writeResetSettings } from "../lib/reset/settings.ts";
import { resetIdentity } from "../lib/reset/identity.ts";

after(() => assert.equal(sentinelCount(), 0));
it("disables legacy opt-ins exactly once during migration", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE reset_settings (provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL, lead_minutes INTEGER NOT NULL, updated_at INTEGER NOT NULL); INSERT INTO reset_settings VALUES ('codex', 1, 15, 0)");
    migrateResetTables(db);
    assert.deepEqual(readResetSettings(db), { enabled: false, leadMinutes: 15, ledgerKey: null });
    writeResetSettings(db, { enabled: true, leadMinutes: 15, ledgerKey: "codex:a" }); migrateResetTables(db);
    assert.deepEqual(readResetSettings(db), { enabled: true, leadMinutes: 15, ledgerKey: "codex:a" });
  } finally { db.close(); }
});
async function fixture(fn: (ctx: { a: Database.Database; b: Database.Database; watcher: CodexAutoRedeem;
  scheduled: Array<() => void>; inspections: () => number }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "ima2-auto-fixture-"));
  const a = new Database(join(root, "db")); const b = new Database(join(root, "db"));
  migrateResetTables(a); a.prepare("INSERT INTO reset_settings (provider, enabled, lead_minutes, updated_at, ledger_key) VALUES ('codex', 0, 10, 0, 'codex:fixture-account')").run();
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
  for (const change of ["lead", "expiry", "binding"]) it(`abandons when ${change} changes during preparation`, async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    let now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] });
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const transport = Object.assign(fake, { prepare: async () => { entered(); await gate; return fake; } });
    const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(transport), now: () => now });
    const pending = watcher.tick(); await started;
    if (change === "expiry") now += 5 * 60_000;
    else writeResetSettings(f.a, { enabled: true, leadMinutes: change === "lead" ? 1 : 10, ledgerKey: change === "binding" ? "codex:other" : "codex:fixture-account" });
    release(); await pending;
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
    assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "abandoned");
    assert.equal(f.a.prepare("SELECT * FROM reset_targets").all().length, 0);
  }));
  it("does not clear a fence from a partial list before a stale complete list", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const credits = [5, 6].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    let response: unknown = { credits, available_count: credits.length };
    const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : response; };
    const watcher = new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    await watcher.tick();
    response = { credits: [credits[1], null] }; await watcher.tick();
    response = { credits, available_count: credits.length }; await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.ok((f.a.prepare("SELECT credit_snapshot FROM reset_operations").get() as { credit_snapshot: string | null }).credit_snapshot);
  }));
  it("fences using the final pre-send list after an earlier credit disappears", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const credits = [6, 5].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    let lists = 0; const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); if (url.endsWith("/consume")) return { code: "reset" };
      const current = ++lists === 1 ? credits : [credits[1]]; return { credits: current, available_count: current.length }; };
    const watcher = new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    await watcher.tick(); await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.deepEqual(JSON.parse((f.a.prepare("SELECT credit_snapshot FROM reset_operations LIMIT 1").get() as { credit_snapshot: string }).credit_snapshot),
      [`${credits[1].granted_at}|${credits[1].expires_at}`]);
  }));
  it("does not clear a fence or dispatch from lists missing a count", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const credit = { granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" };
    let response: unknown = { credits: [credit] }; const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : response; };
    const watcher = new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    await watcher.tick(); assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
    response = { credits: [credit], available_count: 1 }; await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    response = { credits: [] }; await watcher.tick();
    assert.ok((f.a.prepare("SELECT credit_snapshot FROM reset_operations").get() as { credit_snapshot: string | null }).credit_snapshot);
    response = { credits: [credit], available_count: 1 }; await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
  }));
  it("only inspects the account that opted in and resumes on return", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    let account = "b"; const fake = fakeResetTransport({ credits: [], available_count: 0 });
    const watcher = new CodexAutoRedeem(f.a, { accountId: async () => account, client: () => new CodexResetClient(fake) });
    await watcher.tick(); assert.equal(fake.calls.length, 0);
    account = "a"; await watcher.tick(); assert.equal(fake.calls.length, 1);
  }));
  it("keeps a persisted fence when an unrelated snapshot credit expires", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    let now = Date.parse("2026-11-21T00:00:00Z");
    const grant = "2026-11-20T00:00:00Z";
    const a = { granted_at: grant, expires_at: "2026-11-21T00:01:00Z" };
    const b = { granted_at: grant, expires_at: "2026-11-21T00:05:00Z" };
    const c = { granted_at: grant, expires_at: "2026-11-21T00:06:00Z" };
    let credits = [a, b];
    const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    const sends = () => fake.calls.filter(call => call.url.endsWith("/consume")).length;
    await new CodexAutoRedeem(f.a, deps).tick(); assert.equal(sends(), 1);
    now += 2 * 60_000; credits = [b, c];
    await new CodexAutoRedeem(f.b, deps).tick(); assert.equal(sends(), 1);
    credits = [c]; await new CodexAutoRedeem(f.b, deps).tick(); assert.equal(sends(), 2);
  }));
  it("clears a fence when a consumed credit disappears before expiry", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const grant = "2026-11-20T00:00:00Z";
    const a = { granted_at: grant, expires_at: "2026-11-21T00:05:00Z" };
    const b = { granted_at: grant, expires_at: "2026-11-21T00:06:00Z" };
    let credits = [a, b]; const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.a, deps).tick(); credits = [b]; await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(call => call.url.endsWith("/consume")).length, 2);
  }));
  it("rechecks upstream credit immediately before sending and releases a removed target", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }], outcome: "reset" });
    let lists = 0; const send = fake.send.bind(fake);
    fake.send = async (url, body) => { if (!url.endsWith("/consume") && ++lists === 2) return { credits: [], available_count: 0 }; return send(url, body); };
    const scheduled: Array<() => void> = [];
    await new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now }, cb => scheduled.push(cb)).tick();
    assert.equal(lists, 2); assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
    assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "abandoned");
    assert.equal(f.a.prepare("SELECT * FROM reset_targets").all().length, 0); assert.equal(scheduled.length, 1);
  }));
  it("waits for a kept reservation to disappear before selecting the next credit", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    let credits = [5, 6].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    const watcher = new CodexAutoRedeem(f.a, deps);
    await watcher.tick(); await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    credits = credits.slice(0, 1); await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 2);
  }));
  for (const code of ["nothing_to_reset", "no_credit"]) it(`releases ${code} for a later retry`, async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({});
    fake.send = async (url, body) => { fake.calls.push({ url, body }); return url.endsWith("/consume") ? { code } : { available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] }; };
    const watcher = new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    await watcher.tick(); await watcher.tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 2);
    assert.equal(f.a.prepare("SELECT * FROM reset_targets").all().length, 0);
  }));
  it("checks disable after asynchronous transport preparation and before sending", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] });
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const transport = Object.assign(fake, { prepare: async () => { entered(); await gate; return fake; } });
    const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(transport), now: () => now });
    const run = watcher.tick();
    await Promise.race([started, run]);
    writeResetSettings(f.a, { enabled: false, leadMinutes: 10, ledgerKey: "codex:fixture-account" }); release(); await run;
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
  }));
  it("enters sending before a disable triggered at network dispatch", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] });
    const send = fake.send.bind(fake);
    fake.send = async (url, body) => { if (url.endsWith("/consume")) { assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "sending"); writeResetSettings(f.a, { enabled: false, leadMinutes: 10, ledgerKey: "codex:fixture-account" }); } return send(url, body); };
    await new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now }).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
  }));
  it("validates the persisted lead bounds and default", async () => fixture(async f => {
    f.a.prepare("DELETE FROM reset_settings").run();
    assert.deepEqual(readResetSettings(f.a), { enabled: false, leadMinutes: 10, ledgerKey: null });
    for (const leadMinutes of [0, 61, 1.5]) assert.throws(() => writeResetSettings(f.a, { enabled: true, leadMinutes }));
    assert.deepEqual(writeResetSettings(f.a, { enabled: true, leadMinutes: 1, ledgerKey: "codex:fixture-account" }), { enabled: true, leadMinutes: 1, ledgerKey: "codex:fixture-account" });
  }));
  it("reserves a target even when the first scheduler already settled", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }], outcome: "reset" });
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.a, deps).tick(); await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.deepEqual(fake.calls.find(c => c.url.endsWith("/consume"))?.body, { redeem_request_id: (f.a.prepare("SELECT operation_id FROM reset_targets").get() as { operation_id: string }).operation_id });
  }));
  it("never redispatches an unknown outcome after restart", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z");
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }] });
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    await new CodexAutoRedeem(f.a, deps).tick(); await new CodexAutoRedeem(f.b, deps).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 1);
    assert.equal((f.a.prepare("SELECT state FROM reset_operations").get() as { state: string }).state, "unknown");
  }));
  it("abandons and releases its target if disabled before sending", async () => fixture(async f => {
    f.a.prepare("UPDATE reset_settings SET enabled=1 WHERE provider='codex'").run();
    const now = Date.parse("2026-11-21T00:00:00Z"); let identityCalls = 0;
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" }], outcome: "reset" });
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
    const fake = fakeResetTransport({ available_count: 1, credits: [{ granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-20T23:59:00Z" }] });
    await new CodexAutoRedeem(f.a, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now }).tick();
    assert.equal(fake.calls.filter(c => c.url.endsWith("/consume")).length, 0);
  }));
});

describe("S6b-B2 scheduler interleavings", () => {
  const now = Date.parse("2026-11-21T00:00:00Z");
  const credit = { granted_at: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:05:00Z" };
  const sends = (calls: Array<{ url: string }>) => calls.filter(c => c.url.endsWith("/consume")).length;
  it("disabled scheduler performs zero transport fetches for three ticks", async () => fixture(async f => {
    const fake = fakeResetTransport({ available_count: 1, credits: [credit] });
    const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    watcher.start(); await watcher.tick(); await watcher.tick(); await watcher.tick(); watcher.stop();
    assert.equal(fake.calls.length, 0);
  }));
  it("lead change reconfigures the next inspection", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 1, ledgerKey: "codex:fixture-account" });
    const fake = fakeResetTransport({ available_count: 1, credits: [credit], outcome: "reset" });
    const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
    await watcher.tick(); assert.equal(sends(fake.calls), 0);
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" }); watcher.reconfigure();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(sends(fake.calls), 1);
  }));
  it("manual claim during inspection causes a fresh inspection before dispatch", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const fake = fakeResetTransport({ available_count: 1, credits: [credit], outcome: "reset" });
    let release!: () => void; let inspected!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { inspected = resolve; });
    let lists = 0; const baseSend = fake.send.bind(fake);
    fake.send = async (url, body) => { if (!url.endsWith("/consume") && ++lists === 1) { inspected(); await gate; } return baseSend(url, body); };
    const callbacks: Array<() => void> = [];
    const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now }, cb => callbacks.push(cb));
    const run = watcher.tick(); await started;
    const ledger = new OperationLedger(f.a);
    ledger.claim({ operationId: "manual", provider: "codex", ledgerKey: "codex:fixture-account", ownerId: "manual" });
    assert.equal(ledger.sending("manual", "manual"), true); ledger.settle("manual", "{}");
    release(); await run; assert.equal(sends(fake.calls), 0); assert.equal(callbacks.length, 1);
    callbacks[0]!(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(lists, 3); assert.equal(sends(fake.calls), 1);
  }));
  it("second scheduler inspected before first settles and claims afterwards", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const fake = fakeResetTransport({ available_count: 1, credits: [credit], outcome: "reset" });
    let release!: () => void; let inspected!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { inspected = resolve; });
    let lists = 0; const baseSend = fake.send.bind(fake);
    fake.send = async (url, body) => { if (!url.endsWith("/consume") && ++lists === 1) { const response = await baseSend(url, body); inspected(); await gate; return response; } return baseSend(url, body); };
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    const callbacks: Array<() => void> = [];
    const second = new CodexAutoRedeem(f.b, deps, cb => callbacks.push(cb));
    const pending = second.tick(); await started; await new CodexAutoRedeem(f.a, deps).tick();
    assert.equal(sends(fake.calls), 1); release(); await pending;
    assert.equal(callbacks.length, 0);
    assert.equal(sends(fake.calls), 1);
  }));
  it("restart inside lead window makes one attempt", async () => fixture(async f => {
    writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
    const fake = fakeResetTransport({ available_count: 1, credits: [credit], outcome: "reset" });
    const deps = { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now };
    const first = new CodexAutoRedeem(f.a, deps); first.stop();
    await new CodexAutoRedeem(f.b, deps).tick(); await new CodexAutoRedeem(f.a, deps).tick();
    assert.equal(sends(fake.calls), 1);
  }));
});

it("reconfigures again when lead changes during an inspection", async () => fixture(async f => {
  const now = Date.parse("2026-11-21T00:00:00Z");
  writeResetSettings(f.a, { enabled: true, leadMinutes: 10, ledgerKey: "codex:fixture-account" });
  const fake = fakeResetTransport({ credits: [], available_count: 0 });
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let lists = 0; const send = fake.send.bind(fake);
  fake.send = async (url, body) => { if (++lists === 1) { started(); await gate; } return send(url, body); };
  const watcher = new CodexAutoRedeem(f.b, { accountId: async () => "fixture-account", client: () => new CodexResetClient(fake), now: () => now });
  const pending = watcher.tick(); await entered;
  writeResetSettings(f.a, { enabled: true, leadMinutes: 20, ledgerKey: "codex:fixture-account" }); watcher.reconfigure();
  release(); await pending; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(lists, 2);
}));
