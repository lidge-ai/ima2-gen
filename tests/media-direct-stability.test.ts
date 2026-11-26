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
    assert.ok(response, `unexpected fetch ${String(url)}`);
    return response;
  }) as typeof fetch;
  return { calls, ctx: { apiKey: KEY, fetch: fetcher } satisfies MediaAdapterContext };
}

const bytes = (type: string, finish = "SUCCESS") =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type, "finish-reason": finish } });
const input = { role: "source-image" as const, bytes: new Uint8Array([1, 2]), mimeType: "image/png" };
const accept = (init: RequestInit) => (init.headers as Record<string, string>)["accept"];

test("core sends multipart, asks for image bytes and returns them", async () => {
  const f = fake([bytes("image/webp")]);
  const job = await adapter.submit(f.ctx, req({ aspectRatio: "16:9", seed: 4, vendorOptions: { output_format: "webp" } }));
  const call = f.calls[0]!;
  assert.equal(call.url, "https://api.stability.ai/v2beta/stable-image/generate/core");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { authorization: `Bearer ${KEY}`, accept: "image/*" });
  const body = call.init.body as FormData;
  assert.equal(body.get("prompt"), "a fox");
  assert.equal(body.get("aspect_ratio"), "16:9");
  assert.equal(body.get("seed"), "4");
  assert.equal(body.get("output_format"), "webp");
  const state = await adapter.poll(f.ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status !== "succeeded") return;
  assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(state.outputs[0]?.mimeType, "image/webp");
  assert.equal((await adapter.poll(f.ctx, job)).status, "succeeded", "a repeat poll sees the same result");
});

test("SD3 and Ultra edits send the file and strength; a public URL input is fetched without the key", async () => {
  const f = fake([new Response(new Uint8Array([7]), { headers: { "content-type": "image/png" } }), bytes("image/png"), bytes("image/png")]);
  await adapter.submit(f.ctx, req({
    model: "stability/sd3.5-large", task: "image-to-image", vendorOptions: { strength: 0.5 },
    inputs: [{ role: "source-image", url: "https://cdn.example/in.png", mimeType: "image/png" }],
  }));
  assert.equal(f.calls[0]!.url, "https://cdn.example/in.png");
  assert.equal(f.calls[0]!.init.headers, undefined);
  const sd3 = f.calls[1]!.init.body as FormData;
  assert.deepEqual([...new Uint8Array(await (sd3.get("image") as Blob).arrayBuffer())], [7]);
  assert.equal(sd3.get("model"), "sd3.5-large");
  assert.equal(sd3.get("mode"), "image-to-image");
  assert.equal(sd3.get("strength"), "0.5");
  await adapter.submit(f.ctx, req({ model: "stability/stable-image-ultra", task: "image-to-image", inputs: [input], vendorOptions: { strength: 0.3 } }));
  assert.ok((f.calls[2]!.init.body as FormData).get("image") instanceof Blob);
});

test("creative upscale and Stable Audio 3 submit for JSON ids and poll their own result routes", async () => {
  const f = fake([
    Response.json({ id: "abc" }, { status: 202 }), new Response(null, { status: 202 }), bytes("image/png"),
    Response.json({ id: "def" }, { status: 202 }), bytes("audio/mpeg"),
  ]);
  const a = await adapter.submit(f.ctx, req({ model: "stability/upscale-creative", task: "image-upscale", inputs: [input] }));
  assert.equal(f.calls[0]!.url, "https://api.stability.ai/v2beta/stable-image/upscale/creative");
  assert.equal(accept(f.calls[0]!.init), "application/json");
  assert.deepEqual(await adapter.poll(f.ctx, a), { status: "running" });
  const upscaled = await adapter.poll(f.ctx, a);
  assert.equal(f.calls[1]!.url, "https://api.stability.ai/v2beta/results/abc");
  assert.equal(accept(f.calls[1]!.init), "*/*");
  assert.equal(upscaled.status === "succeeded" && upscaled.outputs[0]?.mimeType, "image/png");
  const b = await adapter.submit(f.ctx, req({ model: "stability/stable-audio-3", task: "text-to-audio", durationSec: 30 }));
  assert.equal(f.calls[3]!.url, "https://api.stability.ai/v2beta/audio/stable-audio/text-to-audio");
  assert.equal((f.calls[3]!.init.body as FormData).get("duration"), "30");
  const audio = await adapter.poll(f.ctx, b);
  assert.equal(f.calls[4]!.url, "https://api.stability.ai/v2beta/audio/results/def");
  assert.equal(audio.status === "succeeded" && audio.outputs[0]?.kind, "audio");
});

test("Stable Audio 2.5 is synchronous and asks for audio bytes", async () => {
  const f = fake([bytes("audio/wav")]);
  const job = await adapter.submit(f.ctx, req({ model: "stability/stable-audio-2.5", task: "text-to-audio", vendorOptions: { output_format: "wav" } }));
  assert.equal(f.calls[0]!.url, "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio");
  assert.equal(accept(f.calls[0]!.init), "audio/*");
  const state = await adapter.poll(f.ctx, job);
  assert.equal(state.status === "succeeded" && state.outputs[0]?.mimeType, "audio/wav");
});

test("invalid requests are refused before any upstream call", async () => {
  const f = fake([]);
  for (const [p, code] of [
    [{ vendorOptions: { surprise: true } }, "STABILITY_UNKNOWN_OPTION"],
    [{ model: "stability/upscale-fast", task: "image-upscale", prompt: undefined, inputs: [{ role: "source-image", url: "http://insecure/x.png", mimeType: "image/png" }] }, "STABILITY_INPUT_URL_INVALID"],
    [{ task: "image-to-image", model: "stability/sd3.5-large", inputs: [input] }, "STABILITY_STRENGTH_REQUIRED"],
    [{ durationSec: 2 }, "STABILITY_UNSUPPORTED_PARAM"],
  ] as Array<[Partial<MediaSubmitRequest>, string]>) {
    await assert.rejects(() => adapter.submit(f.ctx, req(p)), (e) => adapter.normalizeError(e).code === code);
  }
  assert.equal(f.calls.length, 0);
});

test("moderation, credit and malformed results are reported without the key", async () => {
  const f = fake([
    Response.json({ errors: [`echo ${KEY}`] }, { status: 403 }),
    Response.json({ errors: [`echo ${KEY}`] }, { status: 402 }),
    bytes("image/png", "CONTENT_FILTERED"),
    Response.json({ image: "AQID" }),
  ]);
  for (const [category, code] of [["moderation", "STABILITY_MODERATED"], ["quota", "STABILITY_INSUFFICIENT_CREDIT"], ["moderation", "STABILITY_MODERATED"], ["upstream", "STABILITY_BAD_RESPONSE"]]) {
    await assert.rejects(() => adapter.submit(f.ctx, req()), (e) => {
      const error = adapter.normalizeError(e);
      assert.equal(error.category, category);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(KEY));
      return true;
    });
  }
});

test("polling fails closed on unknown HTTP status and bad job references; validateKey redacts", async () => {
  const weird = fake([new Response(null, { status: 204 })]);
  const unexpected = await adapter.poll(weird.ctx, { providerJobId: "x", resume: { kind: "image" } });
  assert.equal(unexpected.status === "failed" && unexpected.error.code, "STABILITY_UNEXPECTED_STATUS");
  await assert.rejects(() => adapter.poll(weird.ctx, { providerJobId: "..", resume: { kind: "image" } }),
    (error) => adapter.normalizeError(error).code === "STABILITY_BAD_JOB_REF");
  const f = fake([Response.json({ errors: [KEY] }, { status: 401 })]);
  const result = await adapter.validateKey(f.ctx);
  assert.equal(f.calls[0]!.url, "https://api.stability.ai/v1/user/balance");
  assert.equal(result.ok, false);
  assert.ok(!result.reason?.includes(KEY));
});

test("network failures stay retryable", async () => {
  const f = { ctx: { apiKey: KEY, fetch: (async () => { throw new TypeError(`fetch failed ${KEY}`); }) as typeof fetch } };
  await assert.rejects(() => adapter.submit(f.ctx, req()), (e) => {
    const error = adapter.normalizeError(e);
    return error.code === "STABILITY_NETWORK" && error.retryable && !error.message.includes(KEY);
  });
});

test("catalog prices are sourced and the image sunset is exported", () => {
  assert.equal(STABILITY_IMAGE_SUNSET, "2026-12-10");
  assert.equal(adapter.listModels().length, 7);
  for (const model of adapter.listModels()) {
    assert.ok(model.pricing.length > 0, model.id);
    for (const price of model.pricing) {
      assert.equal(price.source, "https://docs.stability.ai/pricing.md");
      assert.equal(price.checkedAt, "2026-11-26");
    }
  }
  assert.deepEqual(adapter.listModels().find((m) => m.id === "stability/stable-audio-3")?.pricing.map((p) => [p.unit, p.usd]), [["request", 0.08]]);
});
