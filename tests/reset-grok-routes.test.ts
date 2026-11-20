import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";

const root = mkdtempSync(join(tmpdir(), "ima2-grok-routes-"));
process.env.IMA2_CONFIG_DIR = root; process.env.IMA2_DB_PATH = join(root, "main.sqlite");
process.env.DOTENV_CONFIG_PATH = join(root, "absent.env");
const { config } = await import("../config.js");
const { migrate, closeDb } = await import("../lib/db.js");
const { stopAgentQueueWorker } = await import("../lib/agentQueueWorker.js");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.js");
const { buildApp } = await import("../server.js");
after(() => { stopAgentQueueWorker(); closeDb(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); assert.equal(sentinelCount(), 0); });

describe("Grok coupon routes", () => {
  it("lists coupons through the app using the injected transport", async () => {
    const db = new Database(join(root, "fixture.sqlite")); migrate(db);
    const transport = fakeResetTransport({ tokens: [] });
    const ctx = Object.assign(createTestRuntimeContext({ config }), { resetDependencies: {
      db, transport, accountId: () => "fixture", usage: async () => ({}) } });
    const app = buildApp(ctx); const server = createServer(app);
    server.once("close", app.locals.disposeLocalLanAccess);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const addr = server.address(); if (!addr || typeof addr === "string") throw new Error("missing address");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/quota/grok/reset-coupons`);
      assert.equal(res.status, 200);
      assert.equal(transport.calls.length, 1);
      assert.match(transport.calls[0]!.url, /ConsumerUiSvc\/GetRemainingResets$/);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
  });
});
