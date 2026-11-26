import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/topaz-video.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "topaz-labs/topaz-video", task: "video-upscale", inputs: [{ role: "source-video", mimeType: "video/mp4", bytes: new Uint8Array([1, 2]) }], vendorOptions: { source: { resolution: { width: 800, height: 448 }, container: "mp4", duration: 4, frameRate: 24, frameCount: 97 }, output: { resolution: { width: 1600, height: 896 } }, model: "prob-4" } };
function fixture(replies: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: key, fetch: async (url, init) => { calls.push({ url: String(url), init }); const response = replies.shift(); assert.ok(response); return response; } };
  return { ctx, calls };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("creates, accepts, uploads, completes and polls", async () => {
  const { ctx, calls } = fixture([json({ requestId: "job" }), json({ urls: ["https://upload.example/file"] }), new Response(null, { status: 200 }), json({}, 202), json({ status: "accepted" }), json({ status: "processing", progress: 50 }), json({ status: "complete", download: { url: "https://download.example/file", expiresAt: 1800000000000 } })]);
  const job = await adapter.submit(ctx, request);
  assert.deepEqual(calls.map(c => [c.init?.method, c.url]), [["POST", "https://api.topazlabs.com/video/"], ["PATCH", "https://api.topazlabs.com/video/job/accept"], ["PUT", "https://upload.example/file"], ["PATCH", "https://api.topazlabs.com/video/job/complete-upload/"]]);
  assert.equal((calls[0]!.init!.headers as Record<string, string>)["X-API-Key"], key);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { source: { ...request.vendorOptions!.source as object, size: 2 }, output: request.vendorOptions!.output, filters: [{ model: "prob-4", auto: "Auto" }] });
  assert.equal((calls[2]!.init!.headers as Record<string, string>)["X-API-Key"], undefined);
  assert.deepEqual(JSON.parse(String(calls[3]!.init!.body)), { uploadResults: [{ partNum: 1, eTag: "unused" }] });
  assert.equal((await adapter.poll(ctx, job)).status, "queued");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "running", progress: 0.5 });
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "video", url: "https://download.example/file", mimeType: "video/mp4", expiresAt: new Date(1800000000000).toISOString() }] });
});

test("HTTP classification and secret redaction", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [402, "quota", false], [429, "rate-limit", true], [503, "upstream", true]] as const) {
    const { ctx } = fixture([json({ message: key }, status)]);
    await assert.rejects(adapter.submit(ctx, request), error => { const normalized = adapter.normalizeError(error); assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable); assert.match(normalized.code, /^TOPAZ_VIDEO_/); assert.doesNotMatch(String(error), /sk-test-SECRET/); assert.doesNotMatch(normalized.message, /sk-test-SECRET/); return true; });
  }
});
test("failed status, key validation and invalid requests", async () => {
  let f = fixture([json({ status: "failed", errorCode: "INSUFFICIENT_CREDITS", message: key })]);
  const state = await adapter.poll(f.ctx, { providerJobId: "job" });
  assert.equal(state.status, "failed"); if (state.status === "failed") { assert.equal(state.error.category, "quota"); assert.doesNotMatch(state.error.message, /sk-test-SECRET/); }
  f = fixture([json({ available_credits: 10 }), json({}, 401), json({}, 403)]);
  assert.deepEqual(await adapter.validateKey(f.ctx), { ok: true });
  assert.equal((await adapter.validateKey(f.ctx)).ok, false);
  assert.equal((await adapter.validateKey(f.ctx)).ok, false);
  assert.equal(f.calls[0]!.url, "https://api.topazlabs.com/account/v1/credits/balance");
  await assert.rejects(adapter.submit(f.ctx, { ...request, model: "unknown" }));
  await assert.rejects(adapter.submit(f.ctx, { ...request, vendorOptions: { unknown: 1 } }));
});
test("cancellation uses the documented endpoint", async () => {
  const f = fixture([new Response(null, { status: 204 }), json({ status: "canceled" })]);
  await adapter.cancel!(f.ctx, { providerJobId: "job" });
  assert.equal(f.calls[0]!.url, "https://api.topazlabs.com/video/job");
  assert.equal(f.calls[0]!.init!.method, "DELETE");
  assert.equal((await adapter.poll(f.ctx, { providerJobId: "job" })).status, "canceled");
});
test("redacts transport errors and arbitrary normalized errors", async () => {
  const ctx: MediaAdapterContext = { apiKey: key, fetch: async () => { throw new TypeError(`transport ${key}`); } };
  await assert.rejects(adapter.submit(ctx, request), error => { assert.doesNotMatch(String(error), /sk-test-SECRET/); assert.doesNotMatch(adapter.normalizeError(error).message, /sk-test-SECRET/); return true; });
  assert.doesNotMatch(adapter.normalizeError(new Error(key)).message, /sk-test-SECRET/);
});
