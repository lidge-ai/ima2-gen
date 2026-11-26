import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/sync.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "sync/sync-lipsync-2", task: "lipsync", inputs: [
  { role: "source-video", url: "https://example.com/video.mp4", mimeType: "video/mp4" },
  { role: "source-audio", url: "https://example.com/audio.wav", mimeType: "audio/wav" },
] };
function fake(responses: Array<{ body: unknown; status?: number }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    assert.ok(next, "unexpected network call");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { ctx: { apiKey: key, fetch: transport } satisfies MediaAdapterContext, calls };
}

test("each model submits documented video/audio JSON and options", async () => {
  for (const [model, upstream] of [["sync/sync-lipsync-2", "lipsync-2"], ["sync/sync-lipsync-2-pro", "lipsync-2-pro"], ["sync/sync-lipsync-3", "sync-3"]]) {
    const { ctx, calls } = fake([{ body: { id: "job" }, status: 201 }]);
    assert.equal((await adapter.submit(ctx, { ...request, model: model!, vendorOptions: { sync_mode: "loop" } })).providerJobId, "job");
    assert.equal(calls[0]!.url, "https://api.sync.so/v2/generate");
    assert.equal(calls[0]!.init.method, "POST");
    assert.deepEqual(calls[0]!.init.headers, { "x-api-key": key, "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { model: upstream, input: [
      { type: "video", url: "https://example.com/video.mp4" }, { type: "audio", url: "https://example.com/audio.wav" },
    ], options: { sync_mode: "loop" } });
  }
});

test("polls pending, processing, completed and failure without leaking key", async () => {
  const { ctx, calls } = fake([{ body: { status: "PENDING" } }, { body: { status: "PROCESSING" } },
    { body: { status: "COMPLETED", outputUrl: "https://example.com/out.mp4" } },
    { body: { status: "FAILED", error: `bad ${key}`, errorCode: "generation_input_video_invalid" } },
    { body: { status: "NO_OP", error: "no face" } }]);
  const job = { providerJobId: "job" };
  assert.equal((await adapter.poll(ctx, job)).status, "queued");
  assert.equal((await adapter.poll(ctx, job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "video", url: "https://example.com/out.mp4", mimeType: "video/mp4" }] });
  const failed = await adapter.poll(ctx, job);
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") { assert.match(failed.error.code, /^SYNC_/); assert.ok(!failed.error.message.includes(key)); }
  assert.equal((await adapter.poll(ctx, job)).status, "failed");
  assert.equal(calls[0]!.url, "https://api.sync.so/v2/generate/job");
  assert.equal(calls[0]!.init.method, "GET");
  assert.deepEqual(calls[0]!.init.headers, { "x-api-key": key });
});

test("HTTP errors classify and redact echoed secrets", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [402, "quota", false], [429, "rate-limit", true], [500, "upstream", true]] as const) {
    const { ctx } = fake([{ body: { message: `bad ${key}` }, status }]);
    await assert.rejects(adapter.submit(ctx, request), (error: unknown) => {
      const normalized = adapter.normalizeError(error);
      assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable);
      assert.match(normalized.code, /^SYNC_/); assert.ok(!String(error).includes(key)); assert.ok(!normalized.message.includes(key)); return true;
    });
  }
});

test("validateKey uses free models endpoint and handles authentication failure", async () => {
  const good = fake([{ body: [] }]); assert.deepEqual(await adapter.validateKey(good.ctx), { ok: true });
  assert.equal(good.calls[0]!.url, "https://api.sync.so/v2/models");
  assert.equal(good.calls[0]!.init.method, "GET"); assert.deepEqual(good.calls[0]!.init.headers, { "x-api-key": key });
  for (const status of [401, 403]) { const bad = fake([{ body: { message: key }, status }]); assert.equal((await adapter.validateKey(bad.ctx)).ok, false); }
});

test("rejects unknown models, options and unsupported parameters before transport", async () => {
  const { ctx } = fake([]);
  await assert.rejects(adapter.submit(ctx, { ...request, model: "sync/unknown" }));
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { invented: true } }));
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { sync_mode: "invented" } }));
  await assert.rejects(adapter.submit(ctx, { ...request, model: "sync/sync-lipsync-3", vendorOptions: { temperature: 0.2 } }));
  await assert.rejects(adapter.submit(ctx, { ...request, durationSec: 3 }));
});
