import test from "node:test";
import assert from "node:assert/strict";
import { adapter, STABILITY_IMAGE_SUNSET } from "../lib/providers/media/direct/stability.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const KEY = "stability_secret_key_123";
const req = (p: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest => ({ model: "stability/stable-image-core", task: "text-to-image", prompt: "a fox", inputs: [], ...p });
function fake(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const response = responses.shift();
    assert.ok(response, "unexpected fetch");
    return response;
  }) as typeof fetch;
  return { calls, ctx: { apiKey: KEY, fetch: fetcher } satisfies MediaAdapterContext };
}
const image = () => Response.json({ image: "AQID", finish_reason: "SUCCESS" });
const input = { role: "source-image" as const, bytes: new Uint8Array([1, 2]), mimeType: "image/png" };

test("core sends multipart and returns decoded synchronous image", async () => {
  const f = fake([image()]);
  const job = await adapter.submit(f.ctx, req({ aspectRatio: "16:9", seed: 4, vendorOptions: { output_format: "webp" } }));
  const call = f.calls[0]!;
  assert.equal(call.url, "https://api.stability.ai/v2beta/stable-image/generate/core");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { authorization: `Bearer ${KEY}`, accept: "application/json" });
  const body = call.init.body as FormData;
  assert.equal(body.get("prompt"), "a fox"); assert.equal(body.get("aspect_ratio"), "16:9");
  assert.equal(body.get("seed"), "4"); assert.equal(body.get("output_format"), "webp");
  const state = await adapter.poll(f.ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") { assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([1, 2, 3])); assert.equal(state.outputs[0]?.mimeType, "image/webp"); }
});

test("SD3 and ultra edits require file and strength", async () => {
  const f = fake([image(), image()]);
  for (const model of ["stability/sd3.5-large", "stability/stable-image-ultra"]) {
    await adapter.submit(f.ctx, req({ model, task: "image-to-image", inputs: [input], vendorOptions: { strength: 0.5 } }));
    const body = f.calls.at(-1)!.init.body as FormData;
    assert.ok(body.get("image") instanceof Blob); assert.equal(body.get("strength"), "0.5");
    if (model.includes("sd3")) { assert.equal(body.get("model"), "sd3.5-large"); assert.equal(body.get("mode"), "image-to-image"); }
  }
});

test("creative and audio 3 use distinct async result paths and HTTP transitions", async () => {
  const f = fake([Response.json({ id: "abc" }, { status: 202 }), new Response(null, { status: 202 }), image(), Response.json({ id: "def" }, { status: 202 }), Response.json({ audio: "AQID" })]);
  const a = await adapter.submit(f.ctx, req({ model: "stability/upscale-creative", task: "image-upscale", inputs: [input] }));
  assert.equal(f.calls[0]!.url, "https://api.stability.ai/v2beta/stable-image/upscale/creative");
  assert.deepEqual(await adapter.poll(f.ctx, a), { status: "running" });
  assert.equal((await adapter.poll(f.ctx, a)).status, "succeeded");
  assert.equal(f.calls[1]!.url, "https://api.stability.ai/v2beta/results/abc");
  const b = await adapter.submit(f.ctx, req({ model: "stability/stable-audio-3", task: "text-to-audio", durationSec: 30 }));
  assert.equal(f.calls[3]!.url, "https://api.stability.ai/v2beta/audio/stable-audio/text-to-audio");
  assert.equal((f.calls[3]!.init.body as FormData).get("duration"), "30");
  const state = await adapter.poll(f.ctx, b);
  assert.equal(f.calls[4]!.url, "https://api.stability.ai/v2beta/audio/results/def");
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") assert.equal(state.outputs[0]?.mimeType, "audio/mpeg");
});

test("audio 2.5 is synchronous and fast upscale sends file", async () => {
  const f = fake([Response.json({ audio: "AQID" }), image()]);
  const job = await adapter.submit(f.ctx, req({ model: "stability/stable-audio-2.5", task: "text-to-audio", vendorOptions: { output_format: "wav" } }));
  assert.equal(f.calls[0]!.url, "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio");
  const state = await adapter.poll(f.ctx, job); assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") assert.equal(state.outputs[0]?.mimeType, "audio/wav");
  await adapter.submit(f.ctx, req({ model: "stability/upscale-fast", task: "image-upscale", prompt: undefined, inputs: [input] }));
  assert.equal(f.calls[1]!.url, "https://api.stability.ai/v2beta/stable-image/upscale/fast");
  assert.ok((f.calls[1]!.init.body as FormData).get("image") instanceof Blob);
});

test("rejects invalid fields before fetch", async () => {
  const f = fake([]);
  for (const [p, code] of [
    [{ vendorOptions: { surprise: true } }, "STABILITY_UNKNOWN_OPTION"],
    [{ model: "stability/upscale-fast", task: "image-upscale", inputs: [{ role: "source-image", url: "https://x", mimeType: "image/png" }] }, "STABILITY_INPUT_BYTES_REQUIRED"],
    [{ task: "image-to-image", model: "stability/sd3.5-large", inputs: [input] }, "STABILITY_STRENGTH_REQUIRED"],
    [{ durationSec: 2 }, "STABILITY_UNSUPPORTED_PARAM"],
  ] as Array<[Partial<MediaSubmitRequest>, string]>) {
    await assert.rejects(() => adapter.submit(f.ctx, req(p)), (e) => adapter.normalizeError(e).code === code);
  }
  assert.equal(f.calls.length, 0);
});

test("moderation and HTTP errors redact credentials", async () => {
  const f = fake([Response.json({ errors: [`echo ${KEY}`] }, { status: 403 }), Response.json({ errors: [`echo ${KEY}`] }, { status: 402 }), Response.json({ image: "AQID", finish_reason: "CONTENT_FILTERED" })]);
  for (const category of ["moderation", "quota"]) await assert.rejects(() => adapter.submit(f.ctx, req()), (e) => {
    const error = adapter.normalizeError(e); assert.equal(error.category, category); assert.ok(!error.message.includes(KEY)); return true;
  });
  const job = await adapter.submit(f.ctx, req()); const state = await adapter.poll(f.ctx, job);
  assert.equal(state.status, "failed"); if (state.status === "failed") assert.equal(state.error.category, "moderation");
});

test("unknown successful HTTP status fails closed, key validation redacts", async () => {
  const f = fake([new Response(null, { status: 202 }), Response.json({ errors: [KEY] }, { status: 401 })]);
  const state = await adapter.poll(f.ctx, { providerJobId: "x", resume: { kind: "image", format: "png" } });
  assert.equal(state.status, "running");
  const result = await adapter.validateKey(f.ctx); assert.equal(f.calls[1]!.url, "https://api.stability.ai/v1/user/balance");
  assert.equal(result.ok, false); assert.ok(!result.reason?.includes(KEY));
  const weird = fake([new Response(null, { status: 204 })]);
  const unexpected = await adapter.poll(weird.ctx, { providerJobId: "x", resume: { kind: "image", format: "png" } });
  assert.equal(unexpected.status, "failed"); if (unexpected.status === "failed") assert.equal(unexpected.error.code, "STABILITY_UNEXPECTED_STATUS");
});

test("catalog prices and sunset are sourced", () => {
  assert.equal(STABILITY_IMAGE_SUNSET, "2026-12-10"); assert.equal(adapter.listModels().length, 7);
  for (const model of adapter.listModels()) for (const price of model.pricing) {
    assert.equal(price.source, "https://docs.stability.ai/pricing.md"); assert.equal(price.checkedAt, "2026-11-26");
  }
  assert.equal(adapter.listModels().find((m) => m.id.endsWith("stable-audio-3"))?.pricing.length, 0);
});

test("unknown response states and unsafe job ids fail closed", async () => {
  const f = fake([Response.json({ status: "mystery", image: "AQID" })]);
  const state = await adapter.poll(f.ctx, { providerJobId: "abc", resume: { kind: "image", format: "png" } });
  assert.equal(state.status, "failed");
  if (state.status === "failed") assert.equal(state.error.code, "STABILITY_UNEXPECTED_STATUS");
  await assert.rejects(() => adapter.poll(f.ctx, { providerJobId: "..", resume: { kind: "image", format: "png" } }),
    (error) => adapter.normalizeError(error).code === "STABILITY_BAD_JOB_REF");
  assert.equal(f.calls.length, 1);
});
