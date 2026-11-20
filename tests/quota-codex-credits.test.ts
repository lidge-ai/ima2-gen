import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchCodexUsage } from "../lib/quota/codexUsage.ts";
import type { CodexSession } from "../lib/codexBackend/session.ts";
const originalFetch = globalThis.fetch;
const session: CodexSession = { accountId: "fixture", accessToken: "fixture", path: "fixture", isFedRamp: false, refreshToken: undefined };
afterEach(() => { globalThis.fetch = originalFetch; });
async function usage(body: unknown, accountId = "fixture") {
  globalThis.fetch = async () => Response.json(body);
  return await fetchCodexUsage({ ...session, accountId }) as unknown as Record<string, unknown>;
}
describe("Codex credits behavior", () => {
  it("exposes balance and reset credit counts including usable now", async () => {
    const result = await usage({ credits: { has_credits: true, unlimited: false, balance: "12.50" },
      rate_limit_reset_credits: { available_count: 3, applicable_available_count: 2 } });
    assert.deepEqual(result.credits, { hasCredits: true, unlimited: false, balance: "12.50" });
    assert.deepEqual(result.resetCredits, { availableCount: 3, applicableAvailableCount: 2 });
  });
  it("retains an omitted observation only for the same account", async () => {
    await usage({ credits: { has_credits: true, unlimited: false, balance: "7" } });
    const same = await usage({});
    assert.deepEqual(same.credits, { hasCredits: true, unlimited: false, balance: "7" });
    assert.equal((await usage({}, "another")).credits, null);
  });
  it("maps codex plan names to display names", async () => {
    const result = await usage({ plan_type: "prolite" });
    assert.equal((result.account as { plan: string }).plan, "Pro 100");
  });
});
describe("Codex credits controls", () => {
  it("preserves a known email", async () => {
    assert.equal(((await usage({ email: "fixture@example.invalid" })).account as { email: string }).email, "fixture@example.invalid");
  });
});
