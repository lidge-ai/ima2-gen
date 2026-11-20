import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { CodexResetClient } from "../lib/reset/codexResetClient.ts";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { GrokResetClient } from "../lib/reset/grokResetClient.ts";
after(() => assert.equal(sentinelCount(), 0));
describe("Codex reset client behavior", () => {
  it("projects the list count and display fields", async () => {
    const fake = fakeResetTransport({ available_count: 1, total_earned_count: 2,
      credits: [{ id: "fixture", status: "available", title: "Reset", granted_at: "2026-11-01", expires_at: "2026-12-01" }] });
    const result = await new CodexResetClient(fake).list();
    assert.deepEqual(result, { availableCount: 1, totalEarnedCount: 2,
      credits: [{ id: "fixture", status: "available", title: "Reset", grantedAt: "2026-11-01", expiresAt: "2026-12-01" }] });
    assert.equal(fake.calls.length, 1);
  });
  it("classifies an unrecognized response as unknown", async () => {
    const fake = fakeResetTransport({ unexpected: true });
    assert.deepEqual(await new CodexResetClient(fake).consume("request-1"), { outcome: "unknown" });
    assert.equal(fake.calls.length, 1);
  });
});
describe("Codex reset client controls", () => {
  it("does not follow consuming redirects and treats 307 and 308 as unknown", async () => {
    const code = transformSync(readFileSync("lib/reset/transport.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
    for (const status of [307, 308]) {
      const calls: Array<{ redirect?: string }> = [];
      const mod = { exports: {} as { codexResetTransport(fn: () => string): { send(url: string, body: unknown): Promise<unknown> }; grokResetTransport(token: string): { send(url: string, body: unknown): Promise<unknown> } } };
      const request = async (_url: string, init: { redirect?: string }) => { calls.push(init); return new Response(null, { status, headers: { location: "https://example.invalid/redirect" } }); };
      runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({ codexSessionStore: () => ({ get: async () => ({ accountId: "a" }) }), authHeaders: () => ({}) }),
        fetch: request, process: { env: {} }, AbortSignal, Buffer, Uint8Array });
      const codex = mod.exports.codexResetTransport(() => "a");
      await assert.rejects(codex.send("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume", {}));
      const grok = mod.exports.grokResetTransport("test");
      const response = await grok.send("https://grok.com/prod_mc_billing.ConsumerUiSvc/RedeemReset", new Uint8Array());
      const fake = fakeResetTransport(response);
      assert.deepEqual(await new GrokResetClient(fake).redeem("coupon"), { outcome: "unknown" });
      assert.deepEqual(calls.map(call => call.redirect), ["manual", "manual"]);
      assert.equal(fake.calls.length, 1);
    }
  });
  it("sends one request id and no credit id", async () => {
    const fake = fakeResetTransport({ outcome: "reset" });
    await new CodexResetClient(fake).consume("request-2");
    assert.deepEqual(fake.calls.map((call) => call.body), [{ redeem_request_id: "request-2" }]);
  });
});
