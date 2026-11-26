// Spend guard for the shared-key web instance (L9): per-request and daily caps,
// unpriced models refused, ledger persisted with the signed-in email.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpendGuard, estimateMediaUsd } from "../lib/webAccess/spendGuard.ts";
import type { MediaModelSpec, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const source = { source: "https://example.test/pricing", checkedAt: "2026-11-26" };
const imageSpec = {
  id: "openai/gpt-image-2", upstreamId: "gpt-image-2", vendor: "openai", label: "Image", kind: "image", tasks: ["text-to-image"], params: {}, docsUrl: "",
  pricing: [
    { unit: "image", usd: 0.006, variant: "1K · low", ...source },
    { unit: "image", usd: 0.0528, variant: "1K · medium", ...source },
    { unit: "image", usd: 0.2108, variant: "1K · high", ...source },
  ],
} as unknown as MediaModelSpec;
const videoSpec = {
  ...imageSpec, id: "acme/clip", kind: "video", params: { durationsSec: [5, 10] },
  pricing: [{ unit: "second", usd: 0.1, variant: "720p", ...source }, { unit: "second", usd: 0.3, variant: "1080p", ...source }],
} as unknown as MediaModelSpec;
const unpriced = { ...imageSpec, id: "acme/free", pricing: [] } as unknown as MediaModelSpec;
const tokens = { ...imageSpec, id: "openai/direct", pricing: [{ unit: "1k-tokens", usd: 0.03, ...source }] } as unknown as MediaModelSpec;

const req = (extra: Partial<MediaSubmitRequest>): MediaSubmitRequest => ({ model: "m", task: "text-to-image", inputs: [], ...extra });

test("estimates use the exact published variant, or the highest price when the variant is unknown", () => {
  assert.deepEqual(estimateMediaUsd(imageSpec, req({ resolution: "1K", vendorOptions: { quality: "low" } })), { usd: 0.006, basis: "exact" });
  assert.deepEqual(estimateMediaUsd(imageSpec, req({ count: 2 })), { usd: 0.4216, basis: "upper-bound" });
  assert.deepEqual(estimateMediaUsd(videoSpec, req({ task: "text-to-video", durationSec: 5, resolution: "720p" })), { usd: 0.5, basis: "exact" });
  // Duration missing: the longest listed duration at the highest price.
  assert.deepEqual(estimateMediaUsd(videoSpec, req({ task: "text-to-video" })), { usd: 3, basis: "upper-bound" });
  assert.equal(estimateMediaUsd(unpriced, req({})).usd, null);
  assert.equal(estimateMediaUsd(tokens, req({})).usd, null);
});

async function guardFixture(t: import("node:test").TestContext, opts: { daily?: number; perRequest?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ima2-web-spend-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  let now = Date.parse("2026-11-26T10:00:00Z");
  const ledgerFile = join(dir, "web-spend-ledger.json");
  const make = () => createSpendGuard({ dailyCapUsd: opts.daily ?? 5, requestCapUsd: opts.perRequest ?? 1, ledgerFile, timeZone: "Asia/Seoul", now: () => now });
  return { ledgerFile, make, advance: (ms: number) => { now += ms; } };
}

test("unpriced models and requests over the per-request cap are refused with clear codes", async t => {
  const { make } = await guardFixture(t);
  const guard = make();
  await assert.rejects(guard.admit({ requestId: "r1", model: "acme/free", email: "a@x.test", estimate: { usd: null, basis: "upper-bound" } }),
    { code: "WEB_SPEND_UNPRICED", status: 403 });
  await assert.rejects(guard.admit({ requestId: "r2", model: "acme/clip", email: "a@x.test", estimate: { usd: 1.5, basis: "exact" } }),
    (error: Error & { code?: string; status?: number }) => error.code === "WEB_SPEND_REQUEST_CAP" && error.status === 402
      && error.message.includes("$1.50") && error.message.includes("$1.00"));
  assert.equal((await guard.status()).spentUsd, 0);
});

test("the daily cap counts every admitted request, survives a restart and resets on the next local day", async t => {
  const { make, ledgerFile, advance } = await guardFixture(t, { daily: 1, perRequest: 1 });
  const guard = make();
  await guard.admit({ requestId: "r1", model: "m", email: "a@x.test", estimate: { usd: 0.6, basis: "exact" } });
  await assert.rejects(guard.admit({ requestId: "r2", model: "m", email: "b@x.test", estimate: { usd: 0.6, basis: "exact" } }),
    { code: "WEB_SPEND_DAILY_CAP", status: 429 });
  const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
  assert.equal(ledger.days["2026-11-26"].entries[0].email, "a@x.test");
  assert.equal(ledger.days["2026-11-26"].entries.length, 1);
  const restarted = make();
  await assert.rejects(restarted.admit({ requestId: "r3", model: "m", email: "a@x.test", estimate: { usd: 0.5, basis: "exact" } }), { code: "WEB_SPEND_DAILY_CAP" });
  // 10:00Z is 19:00 in Seoul; six hours later is the next day there.
  advance(6 * 3600_000);
  const next = await restarted.admit({ requestId: "r4", model: "m", email: "a@x.test", estimate: { usd: 0.5, basis: "exact" } });
  assert.equal(next.day, "2026-11-27");
  assert.equal(next.spentUsd, 0.5);
});

test("concurrent admissions cannot overshoot the daily cap", async t => {
  const { make } = await guardFixture(t, { daily: 1, perRequest: 1 });
  const guard = make();
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
    guard.admit({ requestId: "r" + i, model: "m", email: "a@x.test", estimate: { usd: 0.3, basis: "exact" } })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
  assert.equal((await guard.status()).spentUsd, 0.9);
});
