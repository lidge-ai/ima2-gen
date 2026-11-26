import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/mirelo.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "mirelo/mirelo-sfx-2.0", task: "video-to-audio", prompt: "rain", durationSec: 5, inputs: [{ role: "source-video", url: "https://example.com/in.mp4", mimeType: "video/mp4" }] };
function fixture(responses: Array<[number, unknown]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    assert.ok(next, "unexpected request");
    return new Response(JSON.stringify(next[1]), { status: next[0] });
  };
  const ctx: MediaAdapterContext = { apiKey: key, fetch: fetcher as typeof fetch };
  return { calls, ctx };
}

test("video and text submissions use documented v3 request bodies", async () => {
  const { ctx, calls } = fixture([[202, { id: "gen_1" }], [202, { id: "gen_2" }]]);
  const job = await adapter.submit(ctx, request);
  assert.equal(job.providerJobId, "gen_1");
  assert.equal(calls[0]?.url, "https://api.mirelo.ai/v3/video-to-sfx/generations");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${key}`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: "sfx-2.0", duration_ms: 5000, input: { video: { type: "url", url: "https://example.com/in.mp4" }, prompt: "rain" } });
  await adapter.submit(ctx, { ...request, task: "text-to-audio", inputs: [] });
  assert.equal(calls[1]?.url, "https://api.mirelo.ai/v3/text-to-sfx/generations");
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { model: "sfx-2.0", duration_ms: 5000, input: { prompt: "rain" } });
});

test("polls queued and running jobs, returns audio and expiry, and maps failures", async () => {
  const output = { status: "succeeded", variants: [{ status: "succeeded", files: { audio: { url: "https://cdn.example/out.wav", format: "wav", url_expires_at: "2026-12-01T00:00:00Z" } } }] };
  const { ctx, calls } = fixture([[200, { status: "queued" }], [200, { status: "running", progress: 0.5 }], [200, { status: "succeeded", result: { output } }], [200, { status: "failed", errors: [{ code: "insufficient_credits", message: `bad ${key}`, retryable: false }] }]]);
  const job = { providerJobId: "gen_1", resume: { task: "video-to-audio" } };
  assert.equal((await adapter.poll(ctx, job)).status, "queued");
  assert.equal((await adapter.poll(ctx, job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "audio", url: "https://cdn.example/out.wav", mimeType: "audio/wav", expiresAt: "2026-12-01T00:00:00Z" }] });
  const failed = await adapter.poll(ctx, job);
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") { assert.equal(failed.error.category, "quota"); assert.ok(!failed.error.message.includes(key)); }
  assert.equal(calls[0]?.url, "https://api.mirelo.ai/v3/video-to-sfx/generations/gen_1");
});

test("classifies HTTP errors and redacts echoed secrets", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [402, "quota", false], [429, "rate-limit", true], [503, "upstream", true]] as const) {
    const { ctx } = fixture([[status, { error: { message: `echo ${key}` } }]]);
    try { await adapter.submit(ctx, request); assert.fail("expected error"); } catch (error) {
      assert.ok(!String(error).includes(key));
      const normalized = adapter.normalizeError(error);
      assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable);
      assert.match(normalized.code, /^MIRELO_/); assert.ok(!normalized.message.includes(key));
    }
  }
});

test("rejects unknown model, options and invalid parameters", async () => {
  const { ctx } = fixture([]);
  for (const patch of [{ model: "bad" }, { vendorOptions: { surprise: true } }, { durationSec: 601 }, { count: 5 }]) {
    await assert.rejects(adapter.submit(ctx, { ...request, ...patch }));
  }
});

test("validates keys with a free account GET", async () => {
  const { ctx, calls } = fixture([[200, {}], [401, {}], [403, {}]]);
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal((await adapter.validateKey(ctx)).ok, false);
  assert.equal((await adapter.validateKey(ctx)).ok, false);
  assert.equal(calls[0]?.url, "https://api.mirelo.ai/v3/me");
  assert.equal(calls[0]?.init.method, "GET");
});

test("does not silently discard failed variants on partial success", async () => {
  const { ctx } = fixture([[200, { status: "partially_succeeded", errors: [{ code: "result_unreadable", message: "variant lost", retryable: false }], result: { output: { status: "partially_succeeded", variants: [{ status: "succeeded", files: { audio: { url: "https://cdn.example/a.wav", format: "wav" } } }] } } }]]);
  const result = await adapter.poll(ctx, { providerJobId: "gen_1", resume: { task: "text-to-audio" } });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "MIRELO_RESULT_UNREADABLE");
});
