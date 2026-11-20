import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { CodexResetClient } from "../lib/reset/codexResetClient.ts";
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
  it("sends one request id and no credit id", async () => {
    const fake = fakeResetTransport({ outcome: "reset" });
    await new CodexResetClient(fake).consume("request-2");
    assert.deepEqual(fake.calls.map((call) => call.body), [{ redeem_request_id: "request-2" }]);
  });
});
