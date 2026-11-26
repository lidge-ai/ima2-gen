import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/recraft.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const KEY = "recraft_test_secret_123";
interface Call { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> }
function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers: init?.headers as Record<string, string> };
    if (typeof init?.body === "string") call.body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch;
  return { calls, ctx: { apiKey: KEY, fetch: fetchImpl } satisfies MediaAdapterContext };
}
const req = (patch: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest => ({ model: "recraft/recraft-v4", task: "text-to-image", prompt: "fox", inputs: [], ...patch });
const generated = () => Response.json({ data: [{ url: "https://cdn.example/image" }] });
const processed = () => Response.json({ image: { url: "https://cdn.example/image" } });

test("generation sends documented JSON and completes synchronously", async () => {
  const { calls, ctx } = fakeFetch([generated]);
  const job = await adapter.submit(ctx, req({ aspectRatio: "16:9", count: 2, seed: 7 }));
  assert.equal(calls[0]?.url, "https://external.api.recraft.ai/v1/images/generations");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0]?.headers["content-type"], "application/json");
  assert.deepEqual(calls[0]?.body, { prompt: "fox", model: "recraftv4", response_format: "url", size: "16:9", n: 2, random_seed: 7 });
  assert.equal(job.pollAfterMs, 0);
  const state = await adapter.poll(ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") {
    assert.equal(state.outputs[0]?.mimeType, "image/webp");
    assert.equal(state.outputs[0]?.url, "https://cdn.example/image");
    assert.ok(state.outputs[0]?.expiresAt);
    assert.equal(state.outputs[0]?.downloadHeaders, undefined);
  }
  assert.equal(calls.length, 1);
});

test("image edit sends URL or bytes as data URL and SVG result", async () => {
  const { calls, ctx } = fakeFetch([generated, generated]);
  for (const input of [{ url: "https://example.com/a.png" }, { bytes: new Uint8Array([1, 2, 3]) }]) {
    const job = await adapter.submit(ctx, req({ model: "recraft/recraft-v4-vector", task: "image-to-image", inputs: [{ role: "source-image", mimeType: "image/png", ...input }], vendorOptions: { strength: 0.5 } }));
    const state = await adapter.poll(ctx, job);
    assert.equal(state.status === "succeeded" && state.outputs[0]?.mimeType, "image/svg+xml");
  }
  assert.equal(calls[0]?.url, "https://external.api.recraft.ai/v1/images/imageToImage");
  assert.deepEqual(calls[0]?.body, { model: "recraftv4_vector", prompt: "fox", image_url: "https://example.com/a.png", strength: 0.5, response_format: "url" });
  assert.equal(calls[1]?.body?.image_url, "data:image/png;base64,AQID");
});

test("utility endpoints use JSON image_url and their response image object", async () => {
  const { calls, ctx } = fakeFetch([processed, processed, processed]);
  const entries = [["recraft-vectorize", "image-vectorize", "vectorize", "image/svg+xml"], ["recraft-crisp-upscale", "image-upscale", "crispUpscale", "image/webp"], ["recraft-creative-upscale", "image-upscale", "creativeUpscale", "image/webp"]] as const;
  for (const [id, task, path, mime] of entries) {
    const job = await adapter.submit(ctx, req({ model: `recraft/${id}`, task, prompt: undefined, inputs: [{ role: "source-image", mimeType: "image/png", url: "https://example.com/a.png" }] }));
    const state = await adapter.poll(ctx, job);
    assert.equal(state.status === "succeeded" && state.outputs[0]?.mimeType, mime);
    assert.equal(calls.at(-1)?.url, `https://external.api.recraft.ai/v1/images/${path}`);
    assert.deepEqual(calls.at(-1)?.body, { image_url: "https://example.com/a.png", response_format: "url" });
  }
});

test("invalid requests are rejected without network calls", async () => {
  const { calls, ctx } = fakeFetch([]);
  const cases: Array<[Partial<MediaSubmitRequest>, string]> = [
    [{ vendorOptions: { bogus: true } }, "RECRAFT_UNKNOWN_OPTION"],
    [{ count: 7 }, "RECRAFT_UNSUPPORTED_PARAM"],
    [{ negativePrompt: "no" }, "RECRAFT_UNSUPPORTED_PARAM"],
    [{ task: "image-to-image", inputs: [{ role: "source-image", url: "https://e/a", mimeType: "image/png" }] }, "RECRAFT_INVALID_OPTION"],
    [{ model: "recraft/recraft-v4.1-flash-v2", task: "image-to-image" }, "RECRAFT_UNSUPPORTED_TASK"],
    [{ inputs: [{ role: "mask", url: "https://e/a", mimeType: "image/png" }] }, "RECRAFT_UNEXPECTED_INPUT"],
  ];
  for (const [patch, code] of cases) await assert.rejects(() => adapter.submit(ctx, req(patch)), (error) => adapter.normalizeError(error).code === code);
  assert.equal(calls.length, 0);
});

test("HTTP errors and key validation redact echoed keys", async () => {
  const { calls, ctx } = fakeFetch([() => new Response(`request unauthorized ${KEY}`, { status: 401 }), () => Response.json({ detail: KEY }, { status: 429 }), () => Response.json({ id: "u" })]);
  const bad = await adapter.validateKey(ctx);
  assert.equal(bad.ok, false);
  assert.ok(!bad.reason?.includes(KEY));
  assert.equal(calls[0]?.url, "https://external.api.recraft.ai/v1/users/me");
  assert.equal(calls[0]?.method, "GET");
  await assert.rejects(() => adapter.submit(ctx, req()), (error) => {
    const result = adapter.normalizeError(error);
    assert.equal(result.code, "RECRAFT_RATE_LIMITED");
    assert.equal(result.category, "rate-limit");
    assert.ok(!result.message.includes(KEY));
    return true;
  });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
});

test("malformed responses and unknown job references fail closed", async () => {
  const { ctx } = fakeFetch([() => Response.json({ data: [] })]);
  await assert.rejects(() => adapter.submit(ctx, req()), (error) => adapter.normalizeError(error).code === "RECRAFT_BAD_RESPONSE");
  const state = await adapter.poll(ctx, { providerJobId: "x", resume: { sync: "other" } });
  assert.equal(state.status, "failed");
  if (state.status === "failed") assert.equal(state.error.code, "RECRAFT_UNEXPECTED_STATUS");
});

test("catalog exposes requested models and official dated prices", () => {
  assert.equal(adapter.inputTransport, "inline");
  assert.equal(adapter.listModels().length, 12);
  for (const model of adapter.listModels()) {
    assert.ok(model.pricing.length);
    for (const price of model.pricing) {
      assert.equal(price.source, "https://www.recraft.ai/docs/api-reference/pricing.md");
      assert.equal(price.checkedAt, "2026-11-26");
    }
  }
});

test("transport failures redact the key before normalization", async () => {
  const fetchImpl = (async () => { throw new TypeError(`fetch failed ${KEY}`); }) as typeof fetch;
  const ctx: MediaAdapterContext = { apiKey: KEY, fetch: fetchImpl };
  await assert.rejects(() => adapter.submit(ctx, req()), (error) => {
    const result = adapter.normalizeError(error);
    assert.equal(result.code, "RECRAFT_NETWORK");
    assert.ok(!result.message.includes(KEY));
    return true;
  });
});
test("catalog labels are readable names", () => {
  const labels = new Map(adapter.listModels().map((m) => [m.id, m.label]));
  assert.equal(labels.get("recraft/recraft-v4.1-pro-vector"), "Recraft V4.1 Pro Vector");
  assert.equal(labels.get("recraft/recraft-crisp-upscale"), "Recraft Crisp Upscale");
});
