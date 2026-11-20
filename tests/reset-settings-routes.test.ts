import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";

const root = mkdtempSync(join(tmpdir(), "ima2-reset-settings-"));
process.env.IMA2_CONFIG_DIR = root;
process.env.IMA2_DB_PATH = join(root, "app.sqlite");
process.env.DOTENV_CONFIG_PATH = join(root, "empty.env");
const { config } = await import("../config.js");
const { migrate, closeDb } = await import("../lib/db.js");
const { stopAgentQueueWorker } = await import("../lib/agentQueueWorker.js");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.js");
const { buildApp } = await import("../server.js");
after(() => { stopAgentQueueWorker(); closeDb(); rmSync(root, { recursive: true, force: true }); assert.equal(sentinelCount(), 0); });
let seq = 0;
async function fixture(fn: (f: { request: (method: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>; calls: () => number }) => Promise<void>, lan = false) {
  const db = new Database(join(root, `test-${seq++}.sqlite`)); migrate(db);
  const fake = fakeResetTransport({ credits: [] });
  const ctx = Object.assign(createTestRuntimeContext({ config: { ...config, server: { ...config.server,
    host: lan ? "0.0.0.0" : "127.0.0.1", lanToken: lan ? "test-token" : "" } } }),
  { resetDependencies: { db, transport: fake, accountId: () => "fixture", usage: async () => ({}) } });
  const app = buildApp(ctx), server = createServer(app); server.once("close", app.locals.disposeLocalLanAccess);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  const url = `http://127.0.0.1:${address.port}/api/quota/reset-settings`;
  const request = (method: string, body?: unknown, headers: Record<string, string> = {}) => fetch(url, { method,
    headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try { await fn({ request, calls: () => fake.calls.length }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
}
it("settings GET defaults disabled and PUT validates 1-60", async () => fixture(async f => {
  assert.deepEqual(await (await f.request("GET")).json(), { enabled: false, leadMinutes: 10 });
  for (const leadMinutes of [0, 61, 1.5]) assert.equal((await f.request("PUT", { enabled: true, leadMinutes })).status, 400);
  for (const leadMinutes of [1, 60]) {
    const response = await f.request("PUT", { enabled: false, leadMinutes }); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false, leadMinutes });
  }
  assert.equal(f.calls(), 0);
}));
it("settings PUT reconfigures watcher through buildApp", async () => fixture(async f => {
  assert.equal((await f.request("PUT", { enabled: true, leadMinutes: 10 })).status, 200);
  for (let i = 0; i < 20 && f.calls() === 0; i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.calls(), 1);
}));
it("settings GET and PUT enforce LAN principal and origin protection", async () => fixture(async f => {
  for (const method of ["GET", "PUT"]) {
    const body = method === "PUT" ? { enabled: true, leadMinutes: 10 } : undefined;
    assert.equal((await f.request(method, body)).status, 401);
    assert.equal((await f.request(method, body, { "x-ima2-token": "test-token", origin: "https://evil.invalid" })).status, 403);
    assert.equal((await f.request(method, body, { "x-ima2-token": "test-token" })).status, 200);
  }
}, true));
