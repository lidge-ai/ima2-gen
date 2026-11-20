import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";

const root = mkdtempSync(join(tmpdir(), "ima2-reset-routes-"));
process.env.IMA2_CONFIG_DIR = root;
process.env.IMA2_DB_PATH = join(root, "app.sqlite");
process.env.DOTENV_CONFIG_PATH = join(root, "empty.env");
const { config } = await import("../config.js");
const { migrate, closeDb } = await import("../lib/db.js");
const { stopAgentQueueWorker } = await import("../lib/agentQueueWorker.js");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.js");
const { buildApp } = await import("../server.js");
const { Confirmations } = await import("../lib/reset/confirmations.js");
const { resetIdentity } = await import("../lib/reset/identity.js");
const { CodexAutoRedeem } = await import("../lib/reset/codexAutoRedeem.js");
const { CodexResetClient } = await import("../lib/reset/codexResetClient.js");
const { writeResetSettings } = await import("../lib/reset/settings.js");
let sequence = 0;
after(() => { stopAgentQueueWorker(); closeDb(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); assert.equal(sentinelCount(), 0); });

async function fixture(lan = false) {
  const db = new Database(join(root, `fixture-${sequence++}.sqlite`)); migrate(db);
  const transport = fakeResetTransport({ credits: [{ id: "one", granted_at: "2026-11-20", expires_at: "2026-12-20" }], available_count: 1 });
  let account = "a"; let usageReads = 0;
  const deps = { db, transport, accountId: () => account, usage: async () => { usageReads++; return { fresh: true }; } };
  const ctx = Object.assign(createTestRuntimeContext({ config: { ...config, server: { ...config.server,
    host: lan ? "0.0.0.0" : "127.0.0.1", lanToken: lan ? "test-token" : "" } } }), { resetDependencies: deps });
  const start = async () => {
    const app = buildApp(ctx); const server = createServer(app);
    server.once("close", app.locals.disposeLocalLanAccess);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
    return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
  };
  let running = await start();
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(running.base + path, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const confirm = async (operationId: string, headers = {}, purpose?: string) => (await (await request("/api/quota/reset-confirmations", { provider: "codex", operationId, accountRef: resetIdentity("codex", account).accountRef, purpose }, headers)).json() as { token: string }).token;
  return { db, transport, request, confirm, setAccount: (id: string) => { account = id; }, usageReads: () => usageReads,
    restart: async () => { await running.close(); running = await start(); },
    close: async () => { await running.close(); db.close(); } };
}
const redeemPath = "/api/quota/codex/reset-credits/redeem";
const consumeCalls = (f: Awaited<ReturnType<typeof fixture>>) => f.transport.calls.filter(call => call.url.endsWith("/consume"));
async function withFixture(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, lan = false) {
  const f = await fixture(lan); try { await fn(f); } finally { await f.close(); }
}

for (const code of ["reset", "nothing_to_reset", "no_credit", "already_redeemed", "future_code"]) {
  it(`returns provider code ${code} to the UI`, async () => withFixture(async f => {
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); return url.endsWith("/consume") ? { code, windows_reset: ["weekly"] } : { credits: [], available_count: 0 }; };
    const token = await f.confirm(code);
    const response = await f.request(redeemPath, { operationId: code, confirmationToken: token });
    const body = await response.json() as { result: { outcome: string; windowsReset?: string[] } };
    assert.equal(body.result.outcome, code === "future_code" ? "unknown" : code);
    if (code !== "future_code") assert.deepEqual(body.result.windowsReset, ["weekly"]);
  }));
}

describe("reset route safety contracts", () => {
  it("refuses release of a sending operation and a different principal", async () => withFixture(async f => {
    f.db.prepare(`INSERT INTO reset_operations (operation_id, provider, ledger_key, state, owner_id, created_at, updated_at, credit_snapshot)
      VALUES ('sending', 'codex', 'codex:a', 'sending', 'owner', 0, 0, '[]')`).run();
    const path = "/api/quota/reset-operations/sending/release-fence";
    const accountRef = resetIdentity("codex", "a").accountRef;
    const headers = { "x-ima2-token": "test-token" };
    const token = await f.confirm("sending", headers, "release-fence");
    const origin = new URL((await f.request("/api/health", undefined, headers)).url).origin;
    const session = await f.request("/api/auth/lan/session", {}, { origin, ...headers });
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.equal((await f.request(path, { accountRef, confirmationToken: token }, { origin, cookie })).status, 403);
    assert.equal((await f.request(path, { accountRef, confirmationToken: await f.confirm("sending", headers, "release-fence") }, headers)).status, 409);
    assert.equal(consumeCalls(f).length, 0);
  }, true));
  it("recovers an expired-credit fence only with an account and principal bound release", async () => withFixture(async f => {
    let now = Date.parse("2026-11-21T00:00:00Z");
    let credits = [5, 20].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: new Date(now + m * 60_000).toISOString() }));
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    writeResetSettings(f.db, { enabled: true, leadMinutes: 20, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    const watcher = () => new CodexAutoRedeem(f.db, { accountId: async () => "a", client: () => new CodexResetClient(f.transport), now: () => now });
    await watcher().tick(); assert.equal(consumeCalls(f).length, 1);
    now += 6 * 60_000; credits = credits.slice(1);
    await watcher().tick(); assert.equal(consumeCalls(f).length, 1);
    assert.ok((f.db.prepare("SELECT credit_snapshot FROM reset_operations").get() as { credit_snapshot: string | null }).credit_snapshot);
    writeResetSettings(f.db, { enabled: false, leadMinutes: 20, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    await f.restart();
    const status = await (await f.request("/api/quota/reset-operations?provider=codex")).json() as { fence: { fenced: boolean; operation_id: string; outcome: string; settled_at: number; cause: string } };
    assert.equal(status.fence.fenced, true); assert.equal(status.fence.outcome, "reset");
    assert.equal(status.fence.cause, "credit list has not confirmed the earlier reset"); assert.ok(status.fence.settled_at);
    const id = status.fence.operation_id, path = `/api/quota/reset-operations/${id}/release-fence`;
    const accountRef = resetIdentity("codex", "a").accountRef;
    const token = await f.confirm(id, {}, "release-fence");
    assert.equal((await f.request(path, { accountRef: resetIdentity("codex", "b").accountRef, confirmationToken: token })).status, 409);
    f.setAccount("b");
    assert.notEqual((await f.request(path, { accountRef, confirmationToken: await f.confirm(id, {}, "release-fence") })).status, 200);
    assert.equal((await f.request(path, { accountRef: resetIdentity("codex", "b").accountRef, confirmationToken: await f.confirm(id, {}, "release-fence") })).status, 409);
    f.setAccount("a");
    const freshToken = await f.confirm(id, {}, "release-fence");
    assert.equal((await f.request(path, { accountRef, confirmationToken: freshToken })).status, 200);
    await f.restart();
    const row = f.db.prepare("SELECT fence_released_at, fence_released_by FROM reset_operations WHERE operation_id=?").get(id) as { fence_released_at: number; fence_released_by: string };
    assert.ok(row.fence_released_at); assert.ok(row.fence_released_by);
    writeResetSettings(f.db, { enabled: true, leadMinutes: 20, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    await watcher().tick(); assert.equal(consumeCalls(f).length, 2);
  }));
  it("releases an acknowledged unknown fence but rejects a redeem confirmation", async () => withFixture(async f => {
    f.db.prepare(`INSERT INTO reset_operations (operation_id, provider, ledger_key, state, owner_id, created_at, updated_at, credit_snapshot, acknowledged_at)
      VALUES ('unknown-op', 'codex', 'codex:a', 'acknowledged', 'owner', 1, 2, '[]', 2)`).run();
    const path = "/api/quota/reset-operations/unknown-op/release-fence", accountRef = resetIdentity("codex", "a").accountRef;
    const status = await (await f.request("/api/quota/reset-operations?provider=codex")).json() as { fence: { outcome: string } };
    assert.equal(status.fence.outcome, "unknown-acknowledged");
    assert.equal((await f.request(path, { accountRef, confirmationToken: await f.confirm("unknown-op") })).status, 400);
    assert.equal((await f.request(path, { accountRef, confirmationToken: await f.confirm("unknown-op", {}, "release-fence") })).status, 200);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("revalidates a manual list delayed across an auto redemption", async () => withFixture(async f => {
    const now = Date.parse("2026-11-21T00:00:00Z");
    let credits = [5, 6].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let lists = 0;
    f.transport.send = async (url, body) => {
      f.transport.calls.push({ url, body });
      if (url.endsWith("/consume")) { if (consumeCalls(f).length === 1) credits = credits.slice(1); return { code: "reset" }; }
      const snapshot = [...credits];
      if (++lists === 1) { started(); await gate; }
      return { credits: snapshot, available_count: snapshot.length };
    };
    writeResetSettings(f.db, { enabled: true, leadMinutes: 10, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    const watcher = new CodexAutoRedeem(f.db, { accountId: async () => "a", client: () => new CodexResetClient(f.transport), now: () => now });
    const token = await f.confirm("manual-delayed");
    const manual = f.request(redeemPath, { operationId: "manual-delayed", confirmationToken: token });
    await entered; await watcher.tick(); assert.equal(consumeCalls(f).length, 1);
    release(); assert.equal((await manual).status, 200);
    const row = f.db.prepare("SELECT credit_snapshot FROM reset_operations WHERE operation_id=?").get("manual-delayed") as { credit_snapshot: string };
    assert.deepEqual(JSON.parse(row.credit_snapshot), ["2026-11-20T00:00:00Z|2026-11-21T00:06:00Z"]);
    await watcher.tick();
    assert.equal(consumeCalls(f).length, 2);
  }));
  it("returns busy after two stale revisions without dispatching", async () => withFixture(async f => {
    let lists = 0;
    f.transport.send = async (url, body) => {
      f.transport.calls.push({ url, body }); lists++;
      f.db.prepare(`INSERT INTO reset_accounts VALUES ('codex', ?, 1)
        ON CONFLICT(provider, ledger_key) DO UPDATE SET revision=revision+1`).run(resetIdentity("codex", "a").ledgerKey);
      return { credits: [], available_count: 0 };
    };
    const token = await f.confirm("busy");
    const response = await f.request(redeemPath, { operationId: "busy", confirmationToken: token });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "RESET_BUSY");
    assert.equal(lists, 2); assert.equal(consumeCalls(f).length, 0);
    assert.equal(f.db.prepare("SELECT * FROM reset_operations WHERE operation_id='busy'").get(), undefined);
  }));
  it("rejects an incomplete fresh list after a stale revision", async () => withFixture(async f => {
    let lists = 0;
    f.transport.send = async (url, body) => {
      f.transport.calls.push({ url, body });
      if (++lists === 1) f.db.prepare("INSERT INTO reset_accounts VALUES ('codex', ?, 1)").run(resetIdentity("codex", "a").ledgerKey);
      return { credits: [], available_count: lists === 1 ? 0 : 1 };
    };
    const token = await f.confirm("partial-retry");
    const response = await f.request(redeemPath, { operationId: "partial-retry", confirmationToken: token });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "RESET_LIST_PARTIAL");
    assert.equal(lists, 2); assert.equal(consumeCalls(f).length, 0);
  }));
  it("fences auto after manual success until a listed credit disappears", async () => withFixture(async f => {
    const now = Date.parse("2026-11-21T00:00:00Z");
    let credits = [5, 6].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    const token = await f.confirm("manual-fence");
    assert.equal((await f.request(redeemPath, { operationId: "manual-fence", confirmationToken: token })).status, 200);
    writeResetSettings(f.db, { enabled: true, leadMinutes: 10, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    const watcher = new CodexAutoRedeem(f.db, { accountId: async () => "a", client: () => new CodexResetClient(f.transport), now: () => now });
    await watcher.tick(); assert.equal(consumeCalls(f).length, 1);
    credits = credits.slice(1); await watcher.tick(); assert.equal(consumeCalls(f).length, 2);
  }));
  it("writes the validated manual snapshot atomically when entering sending", async () => withFixture(async f => {
    const now = Date.parse("2026-11-21T00:00:00Z");
    const credits = [6, 5].map(m => ({ granted_at: "2026-11-20T00:00:00Z", expires_at: `2026-11-21T00:0${m}:00Z` }));
    let lists = 0;
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); if (url.endsWith("/consume")) return { code: "reset" };
      const current = ++lists === 1 ? credits : [credits[1]]; return { credits: current, available_count: current.length }; };
    await f.request("/api/quota/codex/reset-credits");
    f.db.exec(`CREATE TRIGGER inject_old_snapshot AFTER INSERT ON reset_operations BEGIN UPDATE reset_operations SET credit_snapshot='["2026-11-20T00:00:00Z|2026-11-21T00:06:00Z","2026-11-20T00:00:00Z|2026-11-21T00:05:00Z"]' WHERE operation_id=NEW.operation_id; END`);
    const token = await f.confirm("manual-interleave");
    assert.equal((await f.request(redeemPath, { operationId: "manual-interleave", confirmationToken: token })).status, 200);
    writeResetSettings(f.db, { enabled: true, leadMinutes: 10, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    await new CodexAutoRedeem(f.db, { accountId: async () => "a", client: () => new CodexResetClient(f.transport), now: () => now }).tick();
    assert.equal(consumeCalls(f).length, 1);
  }));
  it("records a consuming redirect failure as unknown and never resends", async () => withFixture(async f => {
    const send = f.transport.send.bind(f.transport);
    f.transport.send = async (url, body) => { if (url.endsWith("/consume")) { f.transport.calls.push({ url, body }); throw new Error("RESET_HTTP_307"); } return send(url, body); };
    const token = await f.confirm("redirect");
    await f.request(redeemPath, { operationId: "redirect", confirmationToken: token });
    assert.equal((f.db.prepare("SELECT state FROM reset_operations WHERE operation_id='redirect'").get() as { state: string }).state, "unknown");
    await f.request(redeemPath, { operationId: "redirect", confirmationToken: token }); assert.equal(consumeCalls(f).length, 1);
  }));
  it("rejects confirmation when the displayed Codex account changed", async () => withFixture(async f => {
    const displayed = await (await f.request("/api/quota/codex/reset-credits")).json() as { accountRef: string };
    assert.ok(displayed.accountRef); f.setAccount("b");
    const response = await f.request("/api/quota/reset-confirmations", { provider: "codex", operationId: "changed", accountRef: displayed.accountRef });
    assert.equal(response.status, 409); const body = await response.json() as { error: { code: string }; token?: string };
    assert.equal(body.error.code, "IDENTITY_CHANGED"); assert.equal(body.token, undefined);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("lists reset credits as the DTO", async () => withFixture(async f => {
    const data = await (await f.request("/api/quota/codex/reset-credits")).json() as { availableCount?: number };
    assert.equal(data.availableCount, 1); assert.equal(consumeCalls(f).length, 0);
  }));
  it("confirmation tokens expire and are single use", () => {
    const store = new Confirmations(); const token = store.issue({ provider: "codex", ledgerKey: "codex:a", operationId: "op", principalId: "p" });
    assert.ok(store.take(token)); assert.equal(store.take(token), undefined);
  });
  it("rejects an expired token without consumption", async () => withFixture(async f => {
    const store = new Confirmations(); const now = Date.now; let token: string;
    try { Date.now = () => 0; token = store.issue({ provider: "codex", ledgerKey: "codex:a", operationId: "op", principalId: "loopback" }); Date.now = () => 120001; assert.equal(store.take(token), undefined); }
    finally { Date.now = now; }
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("admits only one concurrent use", async () => withFixture(async f => {
    const token = await f.confirm("one");
    const responses = await Promise.all([f.request(redeemPath, { confirmationToken: token, operationId: "one" }), f.request(redeemPath, { confirmationToken: token, operationId: "two" })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]); assert.equal(consumeCalls(f).length, 1);
  }));
  it("rejects a different principal", async () => withFixture(async f => {
    const token = await f.confirm("op", { "x-ima2-token": "test-token" });
    const origin = new URL((await f.request("/api/health", undefined, { "x-ima2-token": "test-token" })).url).origin;
    const session = await f.request("/api/auth/lan/session", {}, { origin, "x-ima2-token": "test-token" });
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "op" }, { origin, cookie })).status, 403);
    assert.equal(consumeCalls(f).length, 0);
  }, true));
  it("rejects an identity change before dispatch", async () => withFixture(async f => {
    const token = await f.confirm("op"); f.setAccount("b");
    const response = await f.request(redeemPath, { confirmationToken: token, operationId: "op" });
    assert.equal(response.status, 409); assert.equal((await response.json() as { error: { code: string } }).error.code, "IDENTITY_CHANGED");
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("replay returns the recorded result without dispatch", async () => withFixture(async f => {
    const token = await f.confirm("op"); const first = await f.request(redeemPath, { confirmationToken: token, operationId: "op" }); assert.equal(first.status, 200);
    const replay = await f.request(redeemPath, { confirmationToken: token, operationId: "op" }); assert.equal(replay.status, 200);
    assert.equal(consumeCalls(f).length, 1);
  }));
  it("loads unresolved operations scoped to the current identity after restart", async () => withFixture(async f => {
    const insert = f.db.prepare("INSERT INTO reset_operations VALUES (?, 'codex', ?, NULL, 'unknown', 'owner', NULL, 'owner', NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL)");
    insert.run("own", "codex:a"); insert.run("other", "codex:b"); await f.restart();
    const data = await (await f.request("/api/quota/reset-operations?provider=codex")).json() as { operations: Array<{ operation_id: string }> };
    assert.deepEqual(data.operations.map(row => row.operation_id), ["own"]); assert.equal(consumeCalls(f).length, 0);
  }));
  it("acknowledges only unknown operations and refuses recovered operations with live owners", async () => withFixture(async f => {
    f.db.prepare("INSERT INTO reset_owners VALUES ('owner', ?, 0)").run(process.pid);
    const insert = f.db.prepare("INSERT INTO reset_operations VALUES (?, 'codex', 'codex:a', NULL, ?, ?, NULL, 'owner', NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL)");
    insert.run("claimed", "claimed", null);
    assert.equal((await f.request("/api/quota/reset-operations/claimed/acknowledge", {})).status, 409);
    f.db.prepare("UPDATE reset_operations SET state='abandoned' WHERE operation_id='claimed'").run();
    insert.run("recovered", "unknown", "recovered");
    assert.equal((await f.request("/api/quota/reset-operations/recovered/acknowledge", {})).status, 409);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("refuses recovered unknown acknowledgement while its owner is alive", async () => withFixture(async f => {
    f.db.prepare("INSERT INTO reset_owners VALUES ('owner', ?, 0)").run(process.pid);
    f.db.prepare("INSERT INTO reset_operations VALUES ('recovered', 'codex', 'codex:a', NULL, 'unknown', 'recovered', NULL, 'owner', NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL)").run();
    assert.equal((await f.request("/api/quota/reset-operations/recovered/acknowledge", {})).status, 409);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("refuses a reused token for a new operation", async () => withFixture(async f => {
    const token = await f.confirm("first"); assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "first" })).status, 200);
    assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "second" })).status, 400);
    assert.equal(consumeCalls(f).length, 1);
  }));
  it("rejects provider and target changes", async () => withFixture(async f => {
    assert.equal((await f.request("/api/quota/reset-confirmations", { provider: "grok", operationId: "op" })).status, 400);
    const token = await f.confirm("op");
    assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "op", target: "other" })).status, 400);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("sends at most once for simultaneous requests with the same operation", async () => withFixture(async f => {
    const token = await f.confirm("same");
    const responses = await Promise.all([f.request(redeemPath, { confirmationToken: token, operationId: "same" }), f.request(redeemPath, { confirmationToken: token, operationId: "same" })]);
    assert.ok(responses.some(response => response.status === 200));
    assert.equal(consumeCalls(f).length, 1);
  }));
  it("rejects an expired confirmation at the route", async () => withFixture(async f => {
    const original = Date.now;
    try {
      Date.now = () => 10_000;
      const token = await f.confirm("expired");
      Date.now = () => 130_001;
      assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "expired" })).status, 400);
      assert.equal(consumeCalls(f).length, 0);
    } finally { Date.now = original; }
  }));
  it("rejects a revoked LAN cookie", async () => withFixture(async f => {
    const origin = new URL((await f.request("/api/health", undefined, { "x-ima2-token": "test-token" })).url).origin;
    const session = await f.request("/api/auth/lan/session", {}, { origin, "x-ima2-token": "test-token" });
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    const token = await f.confirm("revoked", { origin, cookie });
    const revoke = await fetch(new URL("/api/auth/lan/session", session.url), { method: "DELETE", headers: { origin, cookie } });
    assert.equal(revoke.status, 204);
    assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "revoked" }, { origin, cookie })).status, 401);
    assert.equal(consumeCalls(f).length, 0);
  }, true));
  it("requires a nonempty account id", () => { assert.throws(() => resetIdentity("codex", "")); });
});

describe("reset route controls", () => {
  it("accepts the settings UI confirmationToken payload", async () => withFixture(async f => {
    const confirmationToken = await f.confirm("ui-payload");
    const response = await f.request(redeemPath, { operationId: "ui-payload", confirmationToken });
    assert.equal(response.status, 200);
    assert.deepEqual(consumeCalls(f).map(call => call.body), [{ redeem_request_id: "ui-payload" }]);
  }));
  it("confirmation performs no upstream calls", async () => withFixture(async f => { assert.ok(await f.confirm("op")); assert.equal(f.transport.calls.length, 0); }));
  it("missing token is rejected without consumption", async () => withFixture(async f => { assert.equal((await f.request(redeemPath, { operationId: "op" })).status, 400); assert.equal(consumeCalls(f).length, 0); }));
  it("LAN locked and cross-origin requests are rejected", async () => withFixture(async f => {
    assert.equal((await f.request(redeemPath, {})).status, 401);
    assert.equal((await f.request(redeemPath, {}, { "x-ima2-token": "test-token", origin: "https://evil.invalid" })).status, 403);
    assert.equal(consumeCalls(f).length, 0);
  }, true));
  it("happy path passes operation id to fake transport and refreshes usage", async () => withFixture(async f => {
    const token = await f.confirm("happy"); assert.equal((await f.request(redeemPath, { confirmationToken: token, operationId: "happy" })).status, 200);
    assert.deepEqual(consumeCalls(f)[0]?.body, { redeem_request_id: "happy" }); assert.equal(consumeCalls(f).length, 1); assert.equal(f.usageReads(), 1);
  }));
  it("attributes a manual fence to the nearest-expiring credit only", async () => withFixture(async f => {
    // The route attributes with the real clock, so expiries are relative to it.
    const now = Date.now(), grant = new Date(now - 86_400_000).toISOString();
    const expiresA = new Date(now + 5 * 60_000).toISOString();
    const a = { granted_at: grant, expires_at: expiresA }, b = { granted_at: grant, expires_at: new Date(now + 6 * 60_000).toISOString() };
    let credits = [b, a];
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); return url.endsWith("/consume") ? { code: "reset" } : { credits, available_count: credits.length }; };
    assert.equal((await f.request(redeemPath, { operationId: "manual-fence", confirmationToken: await f.confirm("manual-fence") })).status, 200);
    const row = f.db.prepare("SELECT fence_target FROM reset_operations WHERE operation_id='manual-fence'").get() as { fence_target: string | null };
    assert.equal(row.fence_target, `${grant}|${expiresA}`);
    writeResetSettings(f.db, { enabled: true, leadMinutes: 10, ledgerKey: resetIdentity("codex", "a").ledgerKey });
    const watcher = new CodexAutoRedeem(f.db, { accountId: async () => "a", client: () => new CodexResetClient(f.transport), now: () => now });
    credits = [a]; await watcher.tick(); assert.equal(consumeCalls(f).length, 1);
    credits = [b]; await watcher.tick(); assert.equal(consumeCalls(f).length, 2);
  }));
});
