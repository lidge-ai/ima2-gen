import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/vidu.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const image = { role: "reference-image" as const, url: "https://example.com/a.png", mimeType: "image/png" };
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: "secret-key-1234", baseUrl: "https://test.invalid", fetch: async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  } };
  return { ctx, calls };
}
function request(model: string, task: MediaSubmitRequest["task"], inputs: MediaSubmitRequest["inputs"] = []): MediaSubmitRequest {
  return { model, task, inputs, prompt: "test", durationSec: 5 };
}

test("all documented Q3 models send their endpoint, wire model and input", async () => {
  const cases = [
    ["vidu/vidu-q3-pro", "text-to-video", "viduq3-pro", "text2video", []],
    ["vidu/vidu-q3-turbo", "image-to-video", "viduq3-turbo", "img2video", [{ ...image, role: "first-frame" }]],
    ["vidu/vidu-q3", "reference-to-video", "viduq3", "reference2video", [image]],
    ["vidu/vidu-q3-mix", "reference-to-video", "viduq3-mix", "reference2video", [image]],
  ] as const;
  for (const [model, task, wire, endpoint, inputs] of cases) {
    const { ctx, calls } = fake({ task_id: "job" });
    assert.equal((await adapter.submit(ctx, request(model, task, inputs))).providerJobId, "job");
    assert.equal(calls[0]?.url, `https://test.invalid/ent/v2/${endpoint}`);
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Token secret-key-1234");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal(body.model, wire); assert.equal(body.prompt, "test"); assert.equal(body.duration, 5);
    if (inputs.length) assert.deepEqual(body.images, [image.url]);
  }
});

test("start and end frames use dedicated endpoint", async () => {
  const { ctx, calls } = fake({ task_id: "job" });
  await adapter.submit(ctx, request("vidu/vidu-q3-pro", "image-to-video", [{ ...image, role: "first-frame" }, { ...image, role: "last-frame" }]));
  assert.match(calls[0]!.url, /start-end2video$/);
});

test("poll states and provider failure", async () => {
  for (const [state, expected] of [["created", "queued"], ["queueing", "queued"], ["processing", "running"], ["success", "succeeded"], ["failed", "failed"]]) {
    const { ctx } = fake({ state, err_code: "CreditInsufficient", creations: [{ url: "https://example.com/a.mp4" }] });
    const result = await adapter.poll(ctx, { providerJobId: "job" });
    assert.equal(result.status, expected);
    if (result.status === "succeeded") assert.deepEqual(result.outputs, [{ url: "https://example.com/a.mp4", mimeType: "video/mp4", kind: "video" }]);
    if (result.status === "failed") { assert.equal(result.error.category, "quota"); assert.equal(result.error.code, "VIDU_CREDIT_INSUFFICIENT"); }
  }
});

test("HTTP and vendor errors are classified and redact the key", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [403, "auth", false], [429, "rate-limit", true], [500, "upstream", true]] as const) {
    const { ctx } = fake({ message: "secret-key-1234" }, status);
    await assert.rejects(adapter.submit(ctx, request("vidu/vidu-q3-pro", "text-to-video")), (err: unknown) => {
      const normalized = adapter.normalizeError(err);
      assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable);
      assert.match(normalized.code, /^VIDU_/); assert.doesNotMatch(normalized.message, /secret-key-1234/); return true;
    });
  }
});

test("validation rejects unknown options and unsupported parameters", async () => {
  const { ctx } = fake({ task_id: "job" });
  for (const req of [
    { ...request("vidu/vidu-q3-pro", "text-to-video"), vendorOptions: { strange: true } },
    request("vidu/vidu-q3", "text-to-video"),
    { ...request("vidu/vidu-q3-pro", "text-to-video"), negativePrompt: "no" },
  ]) await assert.rejects(adapter.submit(ctx, req));
});

test("catalog metadata and free key check", async () => {
  assert.ok(adapter.listModels().length);
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^vidu\//);
    for (const price of model.pricing) { assert.match(price.source, /^https:\/\//); assert.equal(price.checkedAt, "2026-11-26"); }
  }
  const { ctx, calls } = fake({ remains: [] });
  assert.equal((await adapter.validateKey(ctx)).ok, true);
  assert.equal(calls[0]?.url, "https://test.invalid/ent/v2/credits");
  assert.equal(calls[0]?.init.method, "GET");
});
