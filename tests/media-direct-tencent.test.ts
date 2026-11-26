import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/tencent.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const request: MediaSubmitRequest = { model: "tencent/wand-vega-1.0-lite", task: "text-to-video",
  prompt: "a cat", durationSec: 6, resolution: "768P", aspectRatio: "16:9", inputs: [] };
function context(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status });
  };
  const ctx: MediaAdapterContext = { apiKey: "sensitive-key-1234", baseUrl: "https://example.test", fetch: fetcher };
  return { ctx, calls };
}
test("error prefix satisfies the adapter contract", () => {
  assert.equal(adapter.errorPrefix, "TENCENT");
  assert.deepEqual(adapter.credential.envVars, ["TENCENT_TOKENHUB_API_KEY"]);
  assert.equal(adapter.credential.extraFields, undefined);
  assert.ok(adapter.normalizeError(new Error("x")).code.startsWith(adapter.errorPrefix + "_"));
});
test("catalog and exact submit wire request", async () => {
  const models = adapter.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.upstreamId, "wand-vega-video-1.0-lite");
  for (const m of models) {
    assert.match(m.id, /^[^/]+\/[^/]+$/);
    for (const p of m.pricing) { assert.match(p.source, /^https:\/\//); assert.match(p.checkedAt,
      /^\d{4}-\d{2}-\d{2}$/); }
  }
  const { ctx, calls } = context({ id: "job-1", status: "queued" });
  assert.equal((await adapter.submit(ctx, request)).providerJobId, "job-1");
  assert.equal(calls[0]?.url, "https://example.test/v1/wand/vega-videos/tasks");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${ctx.apiKey}`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: "wand-vega-video-1.0-lite", content: [{
    type: "text", text: "a cat" }], duration: 6, resolution: "768P", ratio: "16:9" });
});
test("frames and reference content follow documented wire shape", async () => {
  const { ctx, calls } = context({ id: "x" });
  await adapter.submit(ctx, { ...request, task: "image-to-video", inputs: [{ role: "first-frame",
    url: "https://example.test/a.png", mimeType: "image/png" }, { role: "last-frame",
    url: "https://example.test/b.png", mimeType: "image/png" }] });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).content.slice(1), [{ type: "image_url",
    image_url: { url: "https://example.test/a.png" }, role: "first_frame" }, { type: "image_url", image_url: {
    url: "https://example.test/b.png" }, role: "last_frame" }]);
});
test("poll transitions and task errors", async () => {
  for (const status of ["queued", "running"]) assert.equal((await adapter.poll(context({ status }).ctx, {
    providerJobId: "x" })).status, status);
  const done = await adapter.poll(context({ status: "succeeded", content: {
    video_url: "https://example.test/a.mp4" } }).ctx, { providerJobId: "x" });
  assert.deepEqual(done, { status: "succeeded", outputs: [{ kind: "video", url: "https://example.test/a.mp4",
    mimeType: "video/mp4" }] });
  const failed = await adapter.poll(context({ status: "failed", error: { code: "TaskTimeout",
    message: "sensitive-key-1234" } }).ctx, { providerJobId: "x" });
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") { assert.equal(failed.error.category, "timeout");
    assert.equal(failed.error.code, "TENCENT_TASK_TIMEOUT"); assert.ok(failed.error.retryable);
    assert.doesNotMatch(failed.error.message, /sensitive-key/); }
});
test("HTTP errors are classified and redacted", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [403, "auth", false], [429, "rate-limit",
    true], [500, "upstream", true]] as const) {
    const { ctx } = context({ error: { message: "sensitive-key-1234" } }, status);
    try { await adapter.submit(ctx, request); assert.fail("expected failure"); } catch (e) {
      const error = adapter.normalizeError(e); assert.equal(error.category, category);
        assert.equal(error.retryable, retryable); assert.equal(error.code, `TENCENT_HTTP_${status}`);
        assert.doesNotMatch(error.message, /sensitive-key/);
    }
  }
});
test("invalid parameters and unknown options are rejected before network", async () => {
  for (const patch of [{ vendorOptions: { surprise: true } }, { task: "video-upscale" as const }, {
    durationSec: 16 }, { seed: 1 }, { audio: true }, { count: 2 }]) {
    const { ctx, calls } = context({ id: "x" });
    await assert.rejects(adapter.submit(ctx, { ...request, ...patch })); assert.equal(calls.length, 0);
  }
});
test("key validation reads authenticated model list without generation", async () => {
  const { ctx, calls } = context({ object: "list", data: [] });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.url, "https://example.test/v1/models"); assert.equal(calls[0]?.init.method, "GET");
});
test("arbitrary errors and transport errors never expose the key", async () => {
  assert.doesNotMatch(adapter.normalizeError(new Error("sensitive-key-1234")).message, /sensitive-key/);
  const ctx: MediaAdapterContext = { apiKey: "sensitive-key-1234", fetch: async () => {
    throw new TypeError("sensitive-key-1234"); } };
  await assert.rejects(adapter.submit(ctx, request), (e: Error) => !e.message.includes(ctx.apiKey) &&
    !adapter.normalizeError(e).message.includes(ctx.apiKey));
});
test("documented vendor errors and reference requests", async () => {
  const { ctx, calls } = context({ id: "ref" });
  await adapter.submit(ctx, { ...request, task: "reference-to-video", inputs: [{ role: "reference-image",
    url: "https://example.test/ref.png", mimeType: "image/png" }] });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).content[1], { type: "image_url", image_url: {
    url: "https://example.test/ref.png" }, role: "reference_image" });
  const state = await adapter.poll(context({ status: "failed", error: { code: "InternalError",
    message: "failure" } }).ctx, { providerJobId: "ref" });
  assert.equal(state.status, "failed");
  if (state.status === "failed") { assert.equal(state.error.code, "TENCENT_INTERNAL_ERROR");
    assert.equal(state.error.category, "upstream"); assert.equal(state.error.retryable, true); }
  const bad = context({ error: { code: "invalid_request_error", message: "bad request" } }, 400);
  await assert.rejects(adapter.submit(bad.ctx, request),
    (e: Error) => adapter.normalizeError(e).category === "invalid-request");
});
