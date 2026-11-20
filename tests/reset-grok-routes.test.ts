import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { FAKE_TRANSPORT } from "../lib/reset/fakeTransportBrand.js";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
const root = mkdtempSync(join(tmpdir(), "ima2-grok-routes-"));
process.env.IMA2_CONFIG_DIR = root; process.env.IMA2_DB_PATH = join(root, "main.sqlite");
process.env.DOTENV_CONFIG_PATH = join(root, "absent.env");
const { config } = await import("../config.js");
const { migrate, closeDb } = await import("../lib/db.js");
const { stopAgentQueueWorker } = await import("../lib/agentQueueWorker.js");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.js");
const { buildApp } = await import("../server.js");
const { resetIdentity } = await import("../lib/reset/identity.js");
after(() => { stopAgentQueueWorker(); closeDb(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); assert.equal(sentinelCount(), 0); });
const frame = (flag: number, data: number[]) => [flag, 0, 0, 0, data.length, ...data];
const bytes = (s: string) => [...new TextEncoder().encode(s)];
const response = (payload: number[], status = 0) => ({ body: Uint8Array.from([...frame(0, payload), ...frame(128, bytes(`grpc-status: ${status}\r\n`))]), status: 200 });
const coupon = [82, 10, 82, 3, ...bytes("one"), 242, 1, 2, 8, 42];
let sequence = 0;
async function fixture(lan = false) {
  const db = new Database(join(root, `fixture-${sequence++}.sqlite`)); migrate(db);
  let sub: string | null = "a", currentBearer = "ima2-bearer", reply = response(coupon), redeemed = response([]), sessionReads = 0;
  let switchAt = 0;
  const calls: Array<{ url: string; body: unknown; bearer: string }> = [];
  const transport = { [FAKE_TRANSPORT]: true, async send(url: string, body: unknown) {
    calls.push({ url, body, bearer: currentBearer }); return url.endsWith("RedeemReset") ? redeemed : reply;
  } };
  const deps = { db, transport, accountId: () => "codex", usage: async () => ({ source: "grok-cli", accountLabel: "other" }),
    grokSession: async () => { if (++sessionReads === switchAt) sub = "b"; return { bearer: currentBearer, identity: sub ? { ledgerKey: `grok:oidc:${sub}`, email: "coupon@example.test" } : null, transport }; } };
  const ctx = Object.assign(createTestRuntimeContext({ config: { ...config, server: { ...config.server,
    host: lan ? "0.0.0.0" : "127.0.0.1", lanToken: lan ? "test-token" : "" } } }), { resetDependencies: deps });
  const start = async () => {
    const app = buildApp(ctx), server = createServer(app); server.once("close", app.locals.disposeLocalLanAccess);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
    return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
  };
  let running = await start();
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(running.base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const confirm = async (operationId: string, target = "one") => (await (await request("/api/quota/reset-confirmations", { provider: "grok", operationId, target, accountRef: resetIdentity("grok", `grok:oidc:${sub}`).accountRef })).json() as { token: string }).token;
  return { db, calls, request, confirm, weekly: deps.usage, setSub: (v: string | null) => { sub = v; }, switchOnRead: (v: number) => { switchAt = v; }, setReply: (v: typeof reply) => { reply = v; }, setRedeemed: (v: typeof redeemed) => { redeemed = v; },
    restart: async () => { await running.close(); running = await start(); }, close: async () => { await running.close(); db.close(); } };
}
async function withFixture(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) { const f = await fixture(); try { await fn(f); } finally { await f.close(); } }
const path = "/api/quota/grok/reset-coupons/redeem";
const sends = (f: Awaited<ReturnType<typeof fixture>>) => f.calls.filter(c => c.url.endsWith("RedeemReset"));
describe("Grok coupon routes", () => {
  it("rejects confirmation when the displayed Grok account changed", async () => withFixture(async f => {
    const displayed = await (await f.request("/api/quota/grok/reset-coupons")).json() as { accountRef: string };
    assert.ok(displayed.accountRef); f.setSub("b");
    const res = await f.request("/api/quota/reset-confirmations", { provider: "grok", operationId: "changed", target: "one", accountRef: displayed.accountRef });
    assert.equal(res.status, 409); const body = await res.json() as { error: { code: string }; token?: string };
    assert.equal(body.error.code, "IDENTITY_CHANGED"); assert.equal(body.token, undefined);
    assert.equal(sends(f).length, 0);
  }));
  it("lists session coupons with account label and validity end, independent of weekly CLI account", async () => withFixture(async f => {
    assert.deepEqual(await f.weekly(), { source: "grok-cli", accountLabel: "other" });
    const res = await f.request("/api/quota/grok/reset-coupons"); assert.equal(res.status, 200);
    const data = await res.json() as { accountLabel: string; coupons: Array<{ validityEnd: number }> };
    assert.equal(data.accountLabel, "coupon@example.test"); assert.equal(data.coupons[0]?.validityEnd, 42);
    assert.equal(f.calls[0]?.bearer, "ima2-bearer"); assert.match(f.calls[0]!.url, /GetRemainingResets$/);
  }));
  it("binds the token to identity, principal and target, then reserves and sends exactly once", async () => withFixture(async f => {
    const token = await f.confirm("op"); assert.ok(token);
    const res = await f.request(path, { operationId: "op", target: "one", confirmationToken: token }); assert.equal(res.status, 200);
    assert.equal(sends(f).length, 1); assert.deepEqual([...sends(f)[0]!.body as Uint8Array], [0, 0, 0, 0, 5, 10, 3, ...bytes("one")]);
    assert.deepEqual(f.db.prepare("SELECT ledger_key, target_key FROM reset_targets").get(), { ledger_key: "grok:oidc:a", target_key: "one" });
    assert.equal((await f.request(path, { operationId: "op", target: "one", confirmationToken: token })).status, 200); assert.equal(sends(f).length, 1);
  }));
  it("rejects a changed identity without dispatch", async () => withFixture(async f => {
    const token = await f.confirm("op"); f.setSub("b");
    const res = await f.request(path, { operationId: "op", target: "one", confirmationToken: token }); assert.equal(res.status, 409); assert.equal(sends(f).length, 0);
  }));
  it("abandons its reservation when identity changes after claim", async () => withFixture(async f => {
    const token = await f.confirm("op"); f.switchOnRead(3);
    const res = await f.request(path, { operationId: "op", target: "one", confirmationToken: token });
    assert.equal(res.status, 409); assert.equal(sends(f).length, 0);
    assert.equal((f.db.prepare("SELECT state FROM reset_operations WHERE operation_id='op'").get() as { state: string }).state, "abandoned");
    assert.equal(f.db.prepare("SELECT * FROM reset_targets").all().length, 0);
  }));
  it("rejects a confirmation used by a different LAN principal", async () => {
    const f = await fixture(true);
    try {
      const tokenHeaders = { "x-ima2-token": "test-token" };
      const health = await f.request("/api/health", undefined, tokenHeaders), origin = new URL(health.url).origin;
      const session = await f.request("/api/auth/lan/session", {}, { ...tokenHeaders, origin });
      const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
      const confirmation = await f.request("/api/quota/reset-confirmations", { provider: "grok", operationId: "op", target: "one", accountRef: resetIdentity("grok", "grok:oidc:a").accountRef }, tokenHeaders);
      const { token } = await confirmation.json() as { token: string };
      assert.equal((await f.request(path, { operationId: "op", target: "one", confirmationToken: token }, { origin, cookie })).status, 403);
      assert.equal(sends(f).length, 0);
    } finally { await f.close(); }
  });
  it("fails closed when userinfo is unavailable", async () => withFixture(async f => {
    f.setSub(null); assert.notEqual((await f.request("/api/quota/grok/reset-coupons")).status, 200); assert.equal(f.calls.length, 0);
  }));
  for (const state of ["claimed", "sending", "unknown"]) it(`does not redispatch ${state} after restart`, async () => withFixture(async f => {
    f.db.prepare("INSERT INTO reset_operations VALUES ('op', 'grok', 'grok:oidc:a', 'one', ?, NULL, NULL, 'old', NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL)").run(state);
    await f.restart(); assert.equal((await f.request(path, { operationId: "op", target: "one" })).status, 200); assert.equal(sends(f).length, 0);
  }));
  for (const [name, bad] of [["missing trailer", { body: Uint8Array.from([0, 0, 0, 0, 0]), status: 200 }], ["nonzero status", response([], 7)]] as const) it(`records ${name} as unknown and blocks another attempt`, async () => withFixture(async f => {
    const token = await f.confirm("op"); f.setRedeemed(bad);
    await f.request(path, { operationId: "op", target: "one", confirmationToken: token });
    assert.equal((f.db.prepare("SELECT state FROM reset_operations WHERE operation_id='op'").get() as { state: string }).state, "unknown");
    const next = await f.confirm("next"); assert.equal((await f.request(path, { operationId: "next", target: "one", confirmationToken: next })).status, 409); assert.equal(sends(f).length, 1);
  }));
  for (const status of [307, 308]) it(`records HTTP ${status} as unknown and never resends`, async () => withFixture(async f => {
    const token = await f.confirm("redirect"); f.setRedeemed({ ...response([]), status });
    await f.request(path, { operationId: "redirect", target: "one", confirmationToken: token });
    assert.equal((f.db.prepare("SELECT state FROM reset_operations WHERE operation_id='redirect'").get() as { state: string }).state, "unknown");
    await f.request(path, { operationId: "redirect", target: "one", confirmationToken: token });
    assert.equal(sends(f).length, 1);
  }));
  it("does not infer success from a missing coupon after an attempt", async () => withFixture(async f => {
    const token = await f.confirm("op"); f.setRedeemed({ body: new Uint8Array(), status: 200 });
    await f.request(path, { operationId: "op", target: "one", confirmationToken: token }); f.setReply(response([]));
    await f.request("/api/quota/grok/reset-coupons");
    assert.equal((f.db.prepare("SELECT state FROM reset_operations WHERE operation_id='op'").get() as { state: string }).state, "unknown");
  }));
});
