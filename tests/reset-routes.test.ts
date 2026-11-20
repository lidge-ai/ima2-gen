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
let sequence = 0;
after(() => { stopAgentQueueWorker(); closeDb(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); assert.equal(sentinelCount(), 0); });

async function fixture(lan = false) {
  const db = new Database(join(root, `fixture-${sequence++}.sqlite`)); migrate(db);
  const transport = fakeResetTransport({ credits: [{ id: "one" }], available_count: 1 });
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
  const confirm = async (operationId: string, headers = {}) => (await (await request("/api/quota/reset-confirmations", { provider: "codex", operationId, accountRef: resetIdentity("codex", account).accountRef }, headers)).json() as { token: string }).token;
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
    f.transport.send = async (url, body) => { f.transport.calls.push({ url, body }); return { code, windows_reset: ["weekly"] }; };
    const token = await f.confirm(code);
    const response = await f.request(redeemPath, { operationId: code, confirmationToken: token });
    const body = await response.json() as { result: { outcome: string; windowsReset?: string[] } };
    assert.equal(body.result.outcome, code === "future_code" ? "unknown" : code);
    if (code !== "future_code") assert.deepEqual(body.result.windowsReset, ["weekly"]);
  }));
}

describe("reset route safety contracts", () => {
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
    const insert = f.db.prepare("INSERT INTO reset_operations VALUES (?, 'codex', ?, NULL, 'unknown', 'owner', NULL, 'owner', NULL, NULL, NULL, 0, 0)");
    insert.run("own", "codex:a"); insert.run("other", "codex:b"); await f.restart();
    const data = await (await f.request("/api/quota/reset-operations?provider=codex")).json() as { operations: Array<{ operation_id: string }> };
    assert.deepEqual(data.operations.map(row => row.operation_id), ["own"]); assert.equal(consumeCalls(f).length, 0);
  }));
  it("acknowledges only unknown operations and refuses recovered operations with live owners", async () => withFixture(async f => {
    f.db.prepare("INSERT INTO reset_owners VALUES ('owner', ?, 0)").run(process.pid);
    const insert = f.db.prepare("INSERT INTO reset_operations VALUES (?, 'codex', 'codex:a', NULL, ?, ?, NULL, 'owner', NULL, NULL, NULL, 0, 0)");
    insert.run("claimed", "claimed", null);
    assert.equal((await f.request("/api/quota/reset-operations/claimed/acknowledge", {})).status, 409);
    f.db.prepare("UPDATE reset_operations SET state='abandoned' WHERE operation_id='claimed'").run();
    insert.run("recovered", "unknown", "recovered");
    assert.equal((await f.request("/api/quota/reset-operations/recovered/acknowledge", {})).status, 409);
    assert.equal(consumeCalls(f).length, 0);
  }));
  it("refuses recovered unknown acknowledgement while its owner is alive", async () => withFixture(async f => {
    f.db.prepare("INSERT INTO reset_owners VALUES ('owner', ?, 0)").run(process.pid);
    f.db.prepare("INSERT INTO reset_operations VALUES ('recovered', 'codex', 'codex:a', NULL, 'unknown', 'recovered', NULL, 'owner', NULL, NULL, NULL, 0, 0)").run();
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
});
