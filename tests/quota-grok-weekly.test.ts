import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchGrokBilling, parseGrokCreditsResponse } from "../lib/quota/grokBilling.ts";
import { sentinelCount } from "./helpers/resetTestGuard.ts";

after(() => assert.equal(sentinelCount(), 0));
const end = "2026-12-01T00:00:00Z";
const response = { config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end }, creditUsagePercent: 25,
  productUsage: [{ product: "chat", percent: 12 }, { product: null, percent: "bad" }], prepaidBalance: 17 } };
describe("Grok weekly behavior", () => {
  it("projects valid product usage and prepaid balance while ignoring malformed rows", () => {
    assert.deepEqual(parseGrokCreditsResponse(response), { percent: 25, periodEnd: end,
      productUsage: [{ product: "chat", percent: 12 }], prepaidBalance: 17 });
  });
  it("labels a CLI weekly observation", async () => {
    const home = mkdtempSync(join(tmpdir(), "ima2-weekly-source-"));
    const original = globalThis.fetch;
    try {
      mkdirSync(join(home, ".grok"));
      writeFileSync(join(home, ".grok", "auth.json"), JSON.stringify({ fixture: {
        key: "synthetic", auth_mode: "oidc", oidc_issuer: "https://auth.x.ai", user_id: "cli-user" } }));
      writeFileSync(join(home, ".grok", "version.json"), JSON.stringify({ version: "1.0.0" }));
      globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
      const result = await fetchGrokBilling(home);
      assert.equal((result as typeof result & { source?: string }).source, "grok-cli");
    } finally { globalThis.fetch = original; rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
});
describe("Grok weekly controls", () => {
  it("preserves the existing weekly percent and end", () => {
    const parsed = parseGrokCreditsResponse(response);
    assert.equal(parsed?.percent, 25);
    assert.equal(parsed?.periodEnd, end);
  });
});
