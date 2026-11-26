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

test("validateKey uses a non-generation model-list request", async () => {
  const { ctx, calls } = fake({ success: true, output: { models: [] } });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.url, `${baseUrl}/api/v1/models`);
  assert.equal(calls[0]?.init.method, "GET");
});
