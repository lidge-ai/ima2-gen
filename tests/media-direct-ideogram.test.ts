import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/ideogram.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const KEY = "secret_ideogram_test_key";
const request = (overrides: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest => ({ model: "ideogram/ideogram-v3", task: "text-to-image", prompt: "a cat", inputs: [], ...overrides });
function fake(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const item = responses.shift();
    assert.ok(item);
    return new Response(JSON.stringify(item.body), { status: item.status ?? 200 });
  };
  return { calls, ctx: { apiKey: KEY, fetch: fetcher } satisfies MediaAdapterContext };
}
const image = { role: "source-image" as const, bytes: new Uint8Array([1, 2]), mimeType: "image/png" };
const mask = { role: "mask" as const, bytes: new Uint8Array([3]), mimeType: "image/png" };

test("async routes carry documented multipart fields and authenticate", async () => {
  for (const [req, path, fields] of [
    [request({ count: 2, aspectRatio: "1:1", seed: 4, negativePrompt: "dog", vendorOptions: { rendering_speed: "turbo" } }), "image/generate/ideogram-3", { aspect_ratio: "1x1", negative_prompt: "dog", num_images: "2", seed: "4", rendering_speed: "turbo" }],
    [request({ task: "image-to-image", inputs: [image] }), "image/remix/ideogram-3", {}],
    [request({ task: "image-to-image", inputs: [image, mask] }), "image/inpaint/ideogram-3", {}],
    [request({ model: "ideogram/ideogram-v4.5", task: "image-to-image", inputs: [image] }), "image/generate/ideogram-4-5", {}],
    [request({ model: "ideogram/ideogram-v4.5", task: "image-to-image", inputs: [image, mask] }), "image/precise-edit/ideogram-4-5", {}],
    [request({ model: "ideogram/ideogram-vectorize", task: "image-vectorize", prompt: undefined, inputs: [image] }), "svg/vectorize/ideogram-vector-1", {}],
  ] as const) {
    const { ctx, calls } = fake([{ body: { generation_id: "job_1" } }]);
    assert.equal((await adapter.submit(ctx, req)).providerJobId, "job_1");
    const call = calls[0]!;
    assert.equal(call.url, `https://api.ideogram.ai/v2/${path}`);
    assert.equal(call.init.method, "POST");
    assert.equal((call.init.headers as Record<string, string>)["Api-Key"], KEY);
    const form = call.init.body as FormData;
    assert.ok(form instanceof FormData);
    if (!path.startsWith("svg/")) assert.equal(form.get("async"), "true");
    for (const [key, value] of Object.entries(fields)) assert.equal(form.get(key), value);
    if (req.inputs.length) assert.ok(form.get(path.includes("generate/ideogram-4") ? "images" : "image") instanceof Blob);
    if (req.inputs.includes(mask)) assert.ok(form.get("mask") instanceof Blob);
  }
});

test("poll states, moderation, failure reason and unknown status are safe", async () => {
  const { ctx, calls } = fake([
    { body: { status: "pending" } },
    { body: { status: "completed", created: "2026-11-26T00:00:00Z", data: [{ url: "https://assets.example/a.png", is_image_safe: true }] } },
    { body: { status: "completed", data: [{ url: "", is_image_safe: false }] } },
    { body: { status: "failed", failure_reason: `bad ${KEY}` } },
    { body: { status: `unknown ${KEY}` } },
  ]);
  const job = { providerJobId: "abc", resume: { mimeType: "image/png" } };
  assert.equal((await adapter.poll(ctx, job)).status, "running");
  const ready = await adapter.poll(ctx, job);
  assert.equal(ready.status, "succeeded");
  if (ready.status === "succeeded") assert.equal(ready.outputs[0]?.expiresAt, "2026-11-27T00:00:00.000Z");
  for (const expected of ["IDEOGRAM_MODERATED", "IDEOGRAM_GENERATION_FAILED", "IDEOGRAM_UNEXPECTED_STATUS"]) {
    const result = await adapter.poll(ctx, job);
    assert.equal(result.status, "failed");
    if (result.status === "failed") { assert.equal(result.error.code, expected); assert.ok(!JSON.stringify(result).includes(KEY)); }
  }
  assert.equal(calls[0]?.url, "https://api.ideogram.ai/v2/generations/abc");
  assert.equal(calls[0]?.init.method, "GET");
});

test("rejects unsupported fields, URLs and options without fetching", async () => {
  const { ctx, calls } = fake([]);
  for (const req of [
    request({ vendorOptions: { surprise: true } }),
    request({ durationSec: 5 }),
    request({ task: "image-to-image", inputs: [{ role: "source-image", url: "http://insecure.example/a.png", mimeType: "image/png" }] }),
    request({ task: "image-to-image", inputs: [image], vendorOptions: { image_weight: 101 } }),
    request({ vendorOptions: { image_weight: 50 } }),
  ]) {
    await assert.rejects(adapter.submit(ctx, req));
  }
  assert.equal(calls.length, 0);
});

test("a public https input is downloaded and uploaded as a file; remix takes image_weight", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const responses = [new Response(new Uint8Array([5, 6]), { headers: { "content-type": "image/png" } }), Response.json({ generation_id: "job_2" })];
  const ctx = { apiKey: KEY, fetch: (async (url: RequestInfo | URL, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return responses.shift()!; }) as typeof fetch };
  await adapter.submit(ctx, request({
    task: "image-to-image", vendorOptions: { image_weight: 40 },
    inputs: [{ role: "source-image", url: "https://cdn.example/a.png", mimeType: "image/png" }],
  }));
  assert.equal(calls[0]?.url, "https://cdn.example/a.png");
  assert.equal(calls[0]?.init.headers, undefined);
  assert.equal(calls[1]?.url, "https://api.ideogram.ai/v2/image/remix/ideogram-3");
  const form = calls[1]?.init.body as FormData;
  assert.deepEqual([...new Uint8Array(await (form.get("image") as Blob).arrayBuffer())], [5, 6]);
  assert.equal(form.get("image_weight"), "40");
});

test("HTTP classification and free key validation redact echoed secrets", async () => {
  for (const [status, category] of [[402, "quota"], [422, "moderation"], [429, "rate-limit"]] as const) {
    const { ctx } = fake([{ status, body: { error: KEY, reject_reason: status === 429 ? "inflight_limit" : "insufficient_funds" } }]);
    await assert.rejects(adapter.submit(ctx, request()), (err: unknown) => {
      const e = adapter.normalizeError(err);
      assert.equal(e.category, category);
      assert.ok(!e.message.includes(KEY));
      return true;
    });
  }
  const { ctx, calls } = fake([{ status: 401, body: { error: KEY } }]);
  const check = await adapter.validateKey(ctx);
  assert.equal(check.ok, false);
  assert.ok(!check.reason?.includes(KEY));
  assert.equal(calls[0]?.url, "https://api.ideogram.ai/v2/image/generate/ideogram-4-5?dry_run=true");
  assert.equal(calls[0]?.init.method, "POST");
});

test("vector results preserve SVG media type and the failed reason is retained", async () => {
  const { ctx } = fake([
    { body: { status: "completed", data: [{ object_type: "svg.generation", url: "https://assets.example/a.svg", mime_type: "image/svg+xml" }] } },
    { body: { status: "failed", failure_reason: "content_policy_violation" } },
  ]);
  const job = { providerJobId: "vector_1", resume: { mimeType: "image/svg+xml" } };
  const result = await adapter.poll(ctx, job);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") assert.equal(result.outputs[0]?.mimeType, "image/svg+xml");
  const failed = await adapter.poll(ctx, job);
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.match(failed.error.message, /content_policy_violation/);
});

test("short keys and transport failures are redacted; redirects are disabled", async () => {
  const { ctx, calls } = fake([{ status: 401, body: { error: "abc" } }]);
  ctx.apiKey = "abc";
  const result = await adapter.validateKey(ctx);
  assert.ok(!result.reason?.includes("abc"));
  assert.equal(calls[0]?.init.redirect, "error");
  const failing = { apiKey: "abc", fetch: (async () => { throw new Error("network abc"); }) as typeof fetch };
  await assert.rejects(adapter.submit(failing, request()), (error: Error) => !error.message.includes("abc"));
});

test("the tiers Ideogram prices by are a listed quality, sent on the field each model reads", async () => {
  const spec = (id: string) => adapter.listModels().find((model) => model.id === id)!;
  assert.deepEqual(spec("ideogram/ideogram-v3").params.qualities, ["turbo", "default", "quality"]);
  assert.deepEqual(spec("ideogram/ideogram-v4.5").params.qualities, ["very_low", "low", "medium", "high"]);
  assert.equal(spec("ideogram/ideogram-vectorize").params.qualities, undefined);
  // Each price row names its task and tier the way the estimate reads them.
  assert.deepEqual(spec("ideogram/ideogram-v4.5").pricing.map((price) => price.variant), ["text-to-image:low", "text-to-image:medium", "text-to-image:high",
    "image-to-image:very_low", "image-to-image:low", "image-to-image:medium", "image-to-image:high"]);
  const sent = async (req: MediaSubmitRequest) => { const { ctx, calls } = fake([{ body: { generation_id: "job_q" } }]); await adapter.submit(ctx, req); return calls[0]!.init.body as FormData; };
  assert.equal((await sent(request({ quality: "turbo" }))).get("rendering_speed"), "turbo");
  assert.equal((await sent(request({ model: "ideogram/ideogram-v4.5", quality: "high" }))).get("quality"), "high");
  const refused = async (req: MediaSubmitRequest) => { const { ctx, calls } = fake([]); await assert.rejects(adapter.submit(ctx, req)); assert.equal(calls.length, 0); };
  await refused(request({ quality: "high" }));
  await refused(request({ quality: "turbo", vendorOptions: { rendering_speed: "quality" } }));
  await refused(request({ model: "ideogram/ideogram-vectorize", task: "image-vectorize", prompt: undefined, inputs: [image], quality: "low" }));
});
