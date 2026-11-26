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

test("provider codes and cancellation behavior", async () => {
  const { ctx } = fake({ state: "failed", err_code: "TaskPromptPolicyViolation" });
  const state = await adapter.poll(ctx, { providerJobId: "job" });
  assert.equal(state.status, "failed");
  if (state.status === "failed") { assert.equal(state.error.code, "VIDU_TASK_PROMPT_POLICY_VIOLATION"); assert.equal(state.error.category, "moderation"); assert.equal(state.error.retryable, false); }
  const canceled = fake({ state: "failed", err_code: "UserCancelled" });
  assert.equal((await adapter.poll(canceled.ctx, { providerJobId: "job" })).status, "canceled");
  const c = fake({});
  await adapter.cancel!(c.ctx, { providerJobId: "job" });
  assert.equal(c.calls[0]?.url, "https://test.invalid/ent/v2/tasks/job/cancel");
  assert.equal(c.calls[0]?.init.method, "POST");
  assert.deepEqual(JSON.parse(String(c.calls[0]?.init.body)), { id: "job" });
});

test("secret-bearing validation and network failures are redacted", async () => {
  const { ctx } = fake({});
  for (const req of [{ ...request("secret-key-1234", "text-to-video") }, { ...request("vidu/vidu-q3-pro", "text-to-video"), vendorOptions: { "secret-key-1234": true } }]) {
    await assert.rejects(adapter.submit(ctx, req), (err: unknown) => {
      assert.doesNotMatch(String(err), /secret-key-1234/);
      assert.doesNotMatch(adapter.normalizeError(err).message, /secret-key-1234/); return true;
    });
  }
  ctx.fetch = async () => { throw new TypeError("failed secret-key-1234"); };
  await assert.rejects(adapter.submit(ctx, request("vidu/vidu-q3-pro", "text-to-video")), (err: unknown) => {
    assert.doesNotMatch(String(err), /secret-key-1234/); assert.doesNotMatch(adapter.normalizeError(err).message, /secret-key-1234/); return true;
  });
});

test("Q4 image and reference send documented requests", async () => {
  const img = fake({ task_id: "q4-image" });
  await adapter.submit(img.ctx, { ...request("vidu/vidu-q4", "image-to-video", [{ ...image, role: "first-frame" }]), durationSec: 16, resolution: "4K", audio: false, seed: 9 });
  assert.equal(img.calls[0]?.url, "https://test.invalid/ent/v2/img2video");
  assert.equal(img.calls[0]?.init.method, "POST");
  assert.equal((img.calls[0]?.init.headers as Record<string, string>).Authorization, "Token secret-key-1234");
  assert.deepEqual(JSON.parse(String(img.calls[0]?.init.body)), { model: "viduq4-preview", images: [image.url], prompt: "test", duration: 16, resolution: "4K", audio: false, seed: 9, is_rec: false });
  const ref = fake({ task_id: "q4-ref" });
  const refs = Array.from({ length: 15 }, () => image);
  await adapter.submit(ref.ctx, { ...request("vidu/vidu-q4-reference", "reference-to-video", [...refs, { role: "reference-audio", mimeType: "audio/mpeg", url: "https://example.com/audio.mp3" }]), resolution: "2K", aspectRatio: "9:16", audio: true });
  assert.equal(ref.calls[0]?.url, "https://test.invalid/ent/v2/reference2video");
  const body = JSON.parse(String(ref.calls[0]?.init.body)) as Record<string, unknown>;
  assert.equal(body.model, "viduq4-preview"); assert.deepEqual(body.images, refs.map(() => image.url));
  assert.deepEqual(body.sounds, ["https://example.com/audio.mp3"]); assert.equal(body.aspect_ratio, "9:16"); assert.equal(body.resolution, "2K"); assert.equal(body.audio, true);
});

test("Q4 rejects undocumented tasks and out-of-range inputs before fetch", async () => {
  const { ctx, calls } = fake({ task_id: "job" });
  const first = { ...image, role: "first-frame" as const };
  const base = request("vidu/vidu-q4", "image-to-video", [first]);
  const ref = request("vidu/vidu-q4-reference", "reference-to-video", [image]);
  const invalid = [request("vidu/vidu-q4", "text-to-video"), { ...base, inputs: [first, { ...image, role: "last-frame" as const }] }, { ...base, durationSec: 2 }, { ...base, durationSec: 17 }, { ...base, resolution: "8K" }, { ...base, aspectRatio: "16:9" }, { ...ref, aspectRatio: "2:1" }, { ...ref, inputs: Array.from({ length: 16 }, () => image) }, { ...ref, inputs: [] }, { ...ref, vendorOptions: { unknown: true } }];
  for (const req of invalid) await assert.rejects(adapter.submit(ctx, req));
  assert.equal(calls.length, 0);
});

test("Q4 catalog has official USD prices and distinct task sets", () => {
  for (const id of ["vidu/vidu-q4", "vidu/vidu-q4-reference"]) {
    const model = adapter.listModels().find((m) => m.id === id);
    assert.ok(model); assert.equal(model.upstreamId, "viduq4-preview");
    assert.deepEqual(model.tasks, id.endsWith("reference") ? ["reference-to-video"] : ["image-to-video"]);
    assert.deepEqual(model.pricing.map((p) => [p.variant, p.usd]), [["540p", .045], ["720p", .095], ["1080p", .12], ["2K", .19], ["4K", .39]]);
    for (const p of model.pricing) { assert.equal(p.unit, "second"); assert.equal(p.source, "https://platform.vidu.com/pricing"); assert.equal(p.checkedAt, "2026-11-26"); }
  }
});

test("Q4 reference audio is bounded and requires a prompt", async () => {
  const { ctx, calls } = fake({ task_id: "job" });
  const base = request("vidu/vidu-q4-reference", "reference-to-video", [image]);
  const sound = { role: "reference-audio" as const, url: "https://example.com/a.mp3", mimeType: "audio/mpeg" };
  for (const req of [{ ...base, prompt: undefined }, { ...base, inputs: [image, ...Array.from({ length: 4 }, () => sound)] }, { ...base, inputs: [image, { ...sound, mimeType: "audio/wav" }] }]) await assert.rejects(adapter.submit(ctx, req));
  assert.equal(calls.length, 0);
});
