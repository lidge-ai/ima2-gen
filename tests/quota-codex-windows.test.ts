import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchCodexUsage } from "../lib/quota/codexUsage.ts";
import type { CodexSession } from "../lib/codexBackend/session.ts";

const session: CodexSession = { accountId: "fixture", accessToken: "fixture", path: "fixture", isFedRamp: false, refreshToken: undefined };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
async function usage(data: unknown) {
  globalThis.fetch = async () => Response.json(data);
  return fetchCodexUsage(session);
}
describe("Codex window behavior", () => {
  it("classifies the primary window by duration and gives it a stable id", async () => {
    const result = await usage({ rate_limit: { primary_window: { limit_window_seconds: 604800, used_percent: 27 } } });
    assert.equal(result.windows[0]?.label, "7d");
    assert.equal((result.windows[0] as unknown as { id: string }).id, "primary");
  });
  it("keeps missing utilization unknown", async () => {
    const result = await usage({ rate_limit: { primary_window: { limit_window_seconds: 18000 } } });
    assert.equal(result.windows[0]?.percent, null);
  });
  it("keeps invalid duration unknown instead of assigning a positional label", async () => {
    const result = await usage({ rate_limit: { primary_window: { limit_window_seconds: 0, used_percent: 0 } } });
    assert.equal(result.windows[0]?.label, null);
  });
  it("renders nonstandard durations exactly", async () => {
    const result = await usage({ rate_limit: { primary_window: { limit_window_seconds: 5400, used_percent: 1 } } });
    assert.equal(result.windows[0]?.label, "90m");
  });
  it("projects additional windows without duplicate ids", async () => {
    const bucket = { metered_feature: "fixture", limit_name: "Extra", rate_limit: {
      primary_window: { limit_window_seconds: 18000, used_percent: 1 },
      secondary_window: { limit_window_seconds: 604800, used_percent: 2 },
    } };
    const result = await usage({ additional_rate_limits: [bucket, bucket, null, {}] });
    assert.equal(result.windows.length, 4);
    assert.equal(new Set(result.windows.map((w) => (w as unknown as { id: string }).id)).size, 4);
  });
});
describe("Codex window controls", () => {
  it("rounds a known positional primary percentage", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 41.6 } } });
    assert.equal(result.windows[0]?.percent, 42);
  });
  it("returns no windows when limits are absent", async () => {
    assert.deepEqual((await usage({})).windows, []);
  });
});
