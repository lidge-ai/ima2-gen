import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/kling.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const base: MediaSubmitRequest = { model: "kling/kling-image-3", task: "text-to-image", prompt: "test", inputs: [] };
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: "access-secret-test", extra: { secretKey: "secret-key-test" }, baseUrl: "https://example.test", fetch: async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  } };
  return { ctx, calls };
}
test("legacy image and video submission use signed requests", async () => {
  for (const [model, task, path, wire] of [["kling/kling-image-3", "text-to-image", "/v1/images/generations", "kling-v3"], ["kling/kling-2.6", "text-to-video", "/v1/videos/text2video", "kling-v2-6"], ["kling/kling-3", "text-to-video", "/v1/videos/text2video", "kling-v3"]] as const) {
    const { ctx, calls } = fake({ code: 0, data: { task_id: "id1" } });
    const job = await adapter.submit(ctx, { ...base, model, task });
    assert.equal(job.providerJobId, "id1");
    assert.equal(calls[0]?.url, `https://example.test${path}`);
    assert.equal(calls[0]?.init.method, "POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.match(headers.authorization, /^Bearer eyJ/);
    assert.equal(headers["content-type"], "application/json");
    assert.equal(JSON.parse(String(calls[0]?.init.body)).model_name, wire);
  }
});
test("poll transitions and outputs", async () => {
  for (const [state, expected] of [["submitted", "queued"], ["processing", "running"], ["succeed", "succeeded"], ["failed", "failed"]] as const) {
    const { ctx } = fake({ code: 0, data: { task_status: state, task_status_msg: "failed", task_result: { images: [{ url: "https://example.test/a.png" }] } } });
    const result = await adapter.poll(ctx, { providerJobId: "id", resume: { path: "/v1/images/generations", kind: "image" } });
    assert.equal(result.status, expected);
    if (result.status === "succeeded") assert.deepEqual(result.outputs, [{ kind: "image", url: "https://example.test/a.png", mimeType: "image/png" }]);
  }
});
test("errors classify status and redact credentials", async () => {
  for (const [status, category] of [[401, "auth"], [403, "auth"], [429, "rate-limit"], [500, "upstream"]] as const) {
    const { ctx } = fake({ message: "access-secret-test secret-key-test Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk" }, status);
    await assert.rejects(adapter.submit(ctx, base), error => {
      const result = adapter.normalizeError(error);
      assert.equal(result.category, category);
      assert.equal(result.retryable, status >= 429);
      assert.match(result.code, /^KLING_/);
      assert.doesNotMatch(result.message, /access-secret-test|secret-key-test|eyJabcdefghijk/);
      return true;
    });
  }
});
test("catalog metadata and invalid input", async () => {
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^kling\//);
    for (const price of model.pricing) { assert.match(price.source, /^https:/); assert.match(price.checkedAt, /^\d{4}-\d\d-\d\d$/); }
  }
  const { ctx } = fake({ code: 0 });
  await assert.rejects(adapter.submit(ctx, { ...base, vendorOptions: { unknown: true } }));
  await assert.rejects(adapter.submit(ctx, { ...base, task: "lipsync" }));
  await assert.rejects(adapter.submit(ctx, { ...base, seed: 5 }));
});
test("validateKey only queries tasks", async () => {
  const { ctx, calls } = fake({ code: 0, data: [] });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.init.method, "GET");
  assert.match(calls[0]?.url ?? "", /\/v1\/images\/generations\?/);
});
test("vendor service codes classify even when sent in an HTTP 200 envelope", async () => {
  for (const [code, category, retryable] of [[1002, "auth", false], [1102, "quota", false], [1201, "invalid-request", false], [1301, "moderation", false], [1302, "rate-limit", true], [5000, "upstream", true]] as const) {
    const { ctx } = fake({ code, message: "secret-key-test access-secret-test" });
    await assert.rejects(adapter.submit(ctx, base), error => {
      const detail = adapter.normalizeError(error);
      assert.equal(detail.code, `KLING_VENDOR_${code}`);
      assert.equal(detail.category, category);
      assert.equal(detail.retryable, retryable);
      assert.doesNotMatch(detail.message, /secret-key-test|access-secret-test/);
      return true;
    });
  }
});
