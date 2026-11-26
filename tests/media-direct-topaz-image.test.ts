import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/topaz-image.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const key = "secret-topaz-key";
const request: MediaSubmitRequest = { model: "topaz-labs/topaz-upscale", task: "image-upscale", inputs: [{ role: "source-image", mimeType: "image/png", bytes: new Uint8Array([1, 2]) }], vendorOptions: { output_width: 2048, output_format: "png" } };
function context(handler: typeof fetch): MediaAdapterContext { return { apiKey: key, fetch: handler }; }
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status }); }

test("multipart submission for both endpoints and URL input", async () => {
  const calls: string[] = [];
  const ctx = context(async (url, init) => {
    calls.push(String(url)); assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-api-key"), key);
    assert.equal(new Headers(init?.headers).has("content-type"), false);
    const form = init?.body as FormData;
    assert.equal(form.get("output_width"), "2048"); assert.equal(form.get("output_format"), "png");
    assert.equal(form.get("model"), calls.length === 1 ? "Standard V2" : "Redefine");
    if (calls.length === 1) assert.deepEqual([...new Uint8Array(await (form.get("image") as Blob).arrayBuffer())], [1, 2]);
    else assert.equal(form.get("source_url"), "https://example.com/source.png");
    return json({ process_id: "abc" });
  });
  assert.equal((await adapter.submit(ctx, request)).providerJobId, "abc");
  await adapter.submit(ctx, { ...request, model: "topaz-labs/topaz-upscale-creative", inputs: [{ role: "source-image", mimeType: "image/png", url: "https://example.com/source.png" }] });
  assert.deepEqual(calls, ["https://api.topazlabs.com/image/v1/enhance/async", "https://api.topazlabs.com/image/v1/enhance-gen/async"]);
});

test("poll transitions, download and fail closed", async () => {
  let status = "Pending"; let downloadStatus = 200;
  const ctx = context(async (url, init) => {
    assert.equal(init?.method, "GET"); assert.equal(new Headers(init?.headers).get("x-api-key"), key);
    if (String(url).includes("/status/")) return json({ status, output_format: "png" });
    assert.equal(String(url), "https://api.topazlabs.com/image/v1/download/abc");
    return json({ download_url: "https://storage.example/signed", expiry: 2000000000 }, downloadStatus);
  });
  const job = { providerJobId: "abc" };
  assert.equal((await adapter.poll(ctx, job)).status, "queued");
  status = "Processing"; assert.equal((await adapter.poll(ctx, job)).status, "running");
  status = "Cancelled"; assert.equal((await adapter.poll(ctx, job)).status, "canceled");
  status = "Failed"; assert.equal((await adapter.poll(ctx, job)).status, "failed");
  status = key; const unknown = await adapter.poll(ctx, job); assert.equal(unknown.status, "failed");
  if (unknown.status === "failed") { assert.equal(unknown.error.code, "TOPAZ_IMAGE_UNEXPECTED_STATUS"); assert.ok(!JSON.stringify(unknown).includes(key)); }
  status = "Completed"; downloadStatus = 409; assert.equal((await adapter.poll(ctx, job)).status, "running");
  downloadStatus = 200; const done = await adapter.poll(ctx, job); assert.equal(done.status, "succeeded");
  if (done.status === "succeeded") { assert.equal(done.outputs[0]?.url, "https://storage.example/signed"); assert.equal(done.outputs[0]?.expiresAt, "2033-05-18T03:33:20.000Z"); assert.equal(done.outputs[0]?.downloadHeaders, undefined); }
});

test("error mapping and key redaction", async () => {
  for (const [status, category, retryable] of [[402, "quota", false], [412, "auth", false], [425, "upstream", true]] as const) {
    const ctx = context(async () => json({ message: `echo ${key}` }, status));
    await assert.rejects(adapter.submit(ctx, request), (error: unknown) => { const e = adapter.normalizeError(error); assert.equal(e.category, category); assert.equal(e.retryable, retryable); assert.ok(!e.message.includes(key)); return true; });
    const validation = await adapter.validateKey(ctx); assert.equal(validation.ok, false); assert.ok(!validation.reason?.includes(key));
  }
  await adapter.validateKey(context(async (url, init) => { assert.equal(String(url), "https://api.topazlabs.com/account/v1/credits/balance"); assert.equal(new Headers(init?.headers).get("x-api-key"), key); return json({ available_credits: 1 }); }));
});

test("invalid requests are rejected without fetch", async () => {
  const ctx = context(async () => { throw new Error("unexpected fetch"); });
  for (const patch of [{ vendorOptions: { surprise: 1 } }, { resolution: "2x" }, { inputs: [] }, { prompt: "ignored" }, { inputs: [...request.inputs, ...request.inputs] }, { vendorOptions: { model: "Wonder 4" } }]) {
    await assert.rejects(adapter.submit(ctx, { ...request, ...patch }));
  }
});

test("model-specific options are checked and serialized", async () => {
  const ctx = context(async (_url, init) => {
    const form = init?.body as FormData;
    assert.equal(form.get("model"), "Redefine");
    assert.equal(form.get("creativity"), "6");
    assert.equal(form.get("autoprompt"), "false");
    return json({ process_id: "abc" });
  });
  const creative = { ...request, model: "topaz-labs/topaz-upscale-creative" };
  await adapter.submit(ctx, { ...creative, vendorOptions: { creativity: 6, autoprompt: false } });
  await assert.rejects(adapter.submit(ctx, { ...creative, vendorOptions: { creativity: 7 } }));
  await assert.rejects(adapter.submit(ctx, { ...creative, vendorOptions: { model: "Wonder 4", creativity: 3 } }));
  assert.equal(adapter.cancel, undefined);
  assert.deepEqual(adapter.listModels().map((m) => m.pricing), [[], []]);
});

test("Redefine sends the request prompt; precision models refuse one", async () => {
  const forms: FormData[] = [];
  const ctx = context(async (_url, init) => {
    forms.push(init?.body as FormData);
    return json({ process_id: "abc" });
  });
  await adapter.submit(ctx, { ...request, model: "topaz-labs/topaz-upscale-creative", prompt: "sharp fur detail" });
  assert.equal(forms[0]?.get("prompt"), "sharp fur detail");
  await assert.rejects(adapter.submit(ctx, { ...request, prompt: "x" }),
    (error: unknown) => adapter.normalizeError(error).code === "TOPAZ_IMAGE_INVALID_REQUEST");
  assert.equal(forms.length, 1);
});

test("network failures stay retryable and never carry the key", async () => {
  const ctx = context(async () => { throw new TypeError(`fetch failed for ${key}`); });
  await assert.rejects(adapter.poll(ctx, { providerJobId: "abc" }), (error: unknown) => {
    const e = adapter.normalizeError(error);
    assert.equal(e.code, "TOPAZ_IMAGE_NETWORK");
    assert.equal(e.retryable, true);
    assert.ok(!e.message.includes(key));
    return true;
  });
});
