import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/alibaba.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const baseUrl = "https://workspace.ap-southeast-1.maas.aliyuncs.com";
const request = (model: string, task: MediaSubmitRequest["task"] = "text-to-video"): MediaSubmitRequest => ({ model: `alibaba/${model}`, task, prompt: "hello", inputs: [] });
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: "sk-private-test-key", baseUrl, fetch: async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  } };
  return { ctx, calls };
}

test("catalog and credential contract", () => {
  assert.equal(adapter.credential.configKey, "alibabaApiKey");
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^alibaba\/[a-z0-9.-]+$/);
    for (const price of model.pricing) { assert.match(price.source, /^https:\/\//); assert.equal(price.checkedAt, "2026-11-26"); }
  }
});

test("video models submit documented asynchronous wire requests", async () => {
  for (const [id, wire] of [["wan-3.0", "wan3.0-video"], ["wan-3.0-prime", "wan3.0-video-prime"], ["happy-horse-1.0", "happyhorse-1.0-t2v"], ["happy-horse-1.1", "happyhorse-1.1-t2v"]]) {
    const { ctx, calls } = fake({ output: { task_id: "abc", task_status: "PENDING" } });
    const job = await adapter.submit(ctx, { ...request(id!), durationSec: 5, resolution: "720P" });
    assert.equal(job.providerJobId, "abc");
    assert.equal(calls[0]?.url, `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`);
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal((calls[0]?.init.headers as Record<string, string>)["X-DashScope-Async"], "enable");
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${ctx.apiKey}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: wire, input: { prompt: "hello" }, parameters: { resolution: "720P", duration: 5 } });
  }
});

test("Z-Image synchronous response is carried through to poll", async () => {
  const { ctx, calls } = fake({ output: { choices: [{ message: { content: [{ image: "https://example.com/image.png" }] } }] } });
  const job = await adapter.submit(ctx, request("z-image", "text-to-image"));
  assert.equal(calls[0]?.url, `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`);
  assert.equal((calls[0]?.init.headers as Record<string, string>)["X-DashScope-Async"], undefined);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: "z-image-turbo", input: { messages: [{ role: "user", content: [{ text: "hello" }] }] }, parameters: {} });
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "image", url: "https://example.com/image.png", mimeType: "image/png" }] });
});

test("poll translates documented states", async () => {
  for (const [state, expected] of [["PENDING", "queued"], ["RUNNING", "running"], ["CANCELED", "canceled"]]) {
    const { ctx } = fake({ output: { task_status: state } });
    assert.equal((await adapter.poll(ctx, { providerJobId: "id" })).status, expected);
  }
  const ok = fake({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/x.mp4" } });
  assert.deepEqual(await adapter.poll(ok.ctx, { providerJobId: "id" }), { status: "succeeded", outputs: [{ kind: "video", url: "https://example.com/x.mp4", mimeType: "video/mp4" }] });
  const failed = fake({ output: { task_status: "FAILED", code: "DataInspectionFailed", message: "sk-private-test-key" } });
  const state = await adapter.poll(failed.ctx, { providerJobId: "id" });
  assert.equal(state.status, "failed");
  if (state.status === "failed") { assert.equal(state.error.category, "moderation"); assert.doesNotMatch(state.error.message, /sk-private-test-key/); }
});

test("HTTP and provider errors are classified and redact keys", async () => {
  for (const [status, category, retry] of [[401, "auth", false], [403, "auth", false], [429, "rate-limit", true], [500, "upstream", true]] as const) {
    const { ctx } = fake({ code: "VendorError", message: "sk-private-test-key" }, status);
    await assert.rejects(adapter.submit(ctx, request("wan-3.0")), (err: unknown) => {
      const e = adapter.normalizeError(err); assert.equal(e.category, category); assert.equal(e.retryable, retry); assert.match(e.code, /^ALIBABA_/); assert.doesNotMatch(e.message, /sk-private-test-key/); return true;
    });
  }
});

test("rejects unknown options, unsupported tasks and parameters", async () => {
  const { ctx, calls } = fake({});
  for (const req of [{ ...request("wan-3.0"), vendorOptions: { invented: true } }, request("z-image", "image-to-image"), { ...request("wan-3.0"), negativePrompt: "bad" }, { ...request("z-image", "text-to-image"), audio: true }]) {
    await assert.rejects(adapter.submit(ctx, req));
  }
  assert.equal(calls.length, 0);
});

test("validateKey uses the documented model list on the shared Singapore host without generation", async () => {
  const { ctx, calls } = fake({ success: true, output: { models: [] } });
  const { baseUrl: _unused, ...sharedCtx } = ctx;
  assert.deepEqual(await adapter.validateKey(sharedCtx), { ok: true });
  assert.equal(calls[0]?.url, "https://dashscope-intl.aliyuncs.com/api/v1/models");
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${ctx.apiKey}`);
});

test("validateKey rejects HTTP errors and malformed successful responses", async () => {
  for (const [body, status] of [[{ code: "InvalidApiKey", message: "sk-private-test-key" }, 401], [{ code: "NotFound", message: "not found" }, 404], [{ success: true }, 200], [{}, 200]] as const) {
    const { ctx } = fake(body, status);
    const result = await adapter.validateKey(ctx);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /sk-private-test-key/);
  }
});

test("image and reference video map their media and task-specific HappyHorse wire IDs", async () => {
  for (const [id, task, role, wire] of [
    ["happy-horse-1.0", "image-to-video", "first-frame", "happyhorse-1.0-i2v"],
    ["happy-horse-1.1", "reference-to-video", "reference-image", "happyhorse-1.1-r2v"],
    ["wan-3.0", "image-to-video", "first-frame", "wan3.0-video"],
  ] as const) {
    const { ctx, calls } = fake({ output: { task_id: "job" } });
    await adapter.submit(ctx, { ...request(id, task), inputs: [{ role, bytes: new Uint8Array([1, 2]), mimeType: "image/png" }] });
    const body = JSON.parse(String(calls[0]?.init.body));
    assert.equal(body.model, wire);
    assert.deepEqual(body.input.media, [{ type: role.replaceAll("-", "_"), url: "data:image/png;base64,AQI=" }]);
  }
});

test("provider error codes and bad requests cannot leak secret data", async () => {
  for (const [code, category] of [["InvalidApiKey", "auth"], ["Throttling.RateQuota", "rate-limit"], ["InvalidParameter", "invalid-request"], ["DataInspectionFailed", "moderation"], ["BudgetLimitExceeded", "quota"]] as const) {
    const { ctx } = fake({ output: { task_status: "FAILED", code, message: "sk-private-test-key" } });
    const state = await adapter.poll(ctx, { providerJobId: "id" });
    assert.equal(state.status, "failed");
    if (state.status === "failed") { assert.equal(state.error.category, category); assert.match(state.error.code, /^ALIBABA_[A-Z0-9_]+$/); assert.doesNotMatch(JSON.stringify(state), /sk-private-test-key/); }
  }
  assert.doesNotMatch(adapter.normalizeError(new Error("Bearer sk-private-test-key")).message, /sk-private-test-key/);
});

test("region and signal are carried into network calls and poll resumes original base", async () => {
  const { ctx, calls } = fake({ output: { task_id: "one", task_status: "PENDING" } });
  const signal = new AbortController().signal;
  const job = await adapter.submit({ ...ctx, signal }, request("wan-3.0"));
  assert.equal(calls[0]?.init.signal, signal);
  await adapter.poll({ ...ctx, baseUrl: "https://other.example" }, job);
  assert.equal(calls[1]?.url, `${baseUrl}/api/v1/tasks/one`);
});

test("known signed URL expiry is exposed and arbitrary option names cannot leak the key", async () => {
  const { ctx } = fake({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/x.mp4?Expires=1800000000" } });
  const state = await adapter.poll(ctx, { providerJobId: "id" });
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") assert.equal(state.outputs[0]?.expiresAt, "2027-01-15T08:00:00.000Z");
  await assert.rejects(adapter.submit(ctx, { ...request("wan-3.0"), vendorOptions: { "sk-private-test-key": true } }), (error: unknown) => {
    assert.doesNotMatch(JSON.stringify(adapter.normalizeError(error)), /sk-private-test-key/); return true;
  });
});

test("HappyHorse image-to-video rejects ratio because output follows the first frame", async () => {
  const { ctx } = fake({ output: { task_id: "id" } });
  await assert.rejects(adapter.submit(ctx, { ...request("happy-horse-1.1", "image-to-video"), aspectRatio: "16:9", inputs: [{ role: "first-frame", url: "https://example.com/x.png", mimeType: "image/png" }] }));
});
