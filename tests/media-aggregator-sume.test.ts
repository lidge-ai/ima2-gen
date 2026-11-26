import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/sume.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "sume_live_test_0123456789";
const API = "https://api.sume.com";
const JOB = "job_7513b52d";

function ctx(fetchImpl: typeof fetch): MediaAdapterContext {
  return { apiKey: KEY, fetch: fetchImpl };
}

async function errorOf(pending: Promise<unknown>) {
  try {
    await pending;
  } catch (error) {
    return adapter.normalizeError(error);
  }
  throw new Error("expected a rejection");
}

function request(overrides: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest {
  return { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "steam rises from a cup", inputs: [], ...overrides };
}

const receipt = {
  data: {
    request_id: JOB, job: { id: JOB, status: "queued" },
    status_url: `${API}/v1/jobs/${JOB}/status`, result_url: `${API}/v1/jobs/${JOB}/result`,
    cancel_url: null, cancelable: false, next_poll_after_seconds: 2,
  },
};

const job = { providerJobId: JOB, resume: { kind: "video", statusUrl: `${API}/v1/jobs/${JOB}/status`, resultUrl: `${API}/v1/jobs/${JOB}/result` } };

test("sume catalog maps Sume ids to router wire names with rate-card prices", () => {
  const specs = adapter.listModels();
  assert.ok(specs.length >= 90);
  const seedance = specs.find((spec) => spec.id === "bytedance/seedance-2.5");
  assert.equal(seedance?.upstreamId, "seedance-2.5");
  assert.ok(seedance?.pricing.some((price) => price.variant === "720p" && price.unit === "second"));
  const image = specs.find((spec) => spec.id === "openai/gpt-image-2");
  assert.equal(image?.kind, "image");
  for (const spec of specs) for (const price of spec.pricing) assert.equal(price.checkedAt, "2026-11-26");
  assert.ok(!specs.some((spec) => spec.kind === "image" && spec.pricing.some((price) => price.unit === "second")));
});

test("sume submit posts to the video router with Bearer auth, an idempotency key and documented fields", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/v1/video-router/generate`, () => json(receipt, 202)]]);
  const ref = await adapter.submit(ctx(fetch), request({ durationSec: 5, resolution: "480p", aspectRatio: "16:9" }));
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.match(calls[0].headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0].body, { model: "seedance-2.5", prompt: "steam rises from a cup", duration: 5, resolution: "480p", aspect_ratio: "16:9" });
  assert.deepEqual([ref.providerJobId, ref.pollAfterMs, ref.resume?.statusUrl], [JOB, 2000, receipt.data.status_url]);
});

test("sume image models go to the image router with image_urls", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/v1/image-router/generate`, () => json(receipt, 202)]]);
  await adapter.submit(ctx(fetch), request({
    model: "openai/gpt-image-2", task: "image-to-image", prompt: "make it night",
    inputs: [{ role: "source-image", url: "https://x.test/a.png", mimeType: "image/png" }],
  }));
  assert.deepEqual(calls[0].body, { model: "gpt-image-2", prompt: "make it night", image_urls: ["https://x.test/a.png"] });
  await adapter.submit(ctx(fetch), request({ model: "openai/gpt-image-2", task: "text-to-image", prompt: "cup", resolution: "1K", count: 2, vendorOptions: { quality: "low" } }));
  assert.deepEqual(calls[1].body, { model: "gpt-image-2", prompt: "cup", resolution: "1K", num_images: 2, quality: "low" });
});

test("sume refuses unknown models, unsupported tasks and undocumented fields without calling", async () => {
  const { fetch, calls } = fakeFetch([]);
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ model: "nope/nope" })))).code, "SUME_MODEL_UNSUPPORTED");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "lipsync" })))).code, "SUME_TASK_UNSUPPORTED");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ negativePrompt: "x" })))).code, "SUME_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ vendorOptions: { webhook_url: "https://evil.test" } })))).code, "SUME_UNSUPPORTED_OPTION");
  assert.equal(calls.length, 0);
});

test("sume poll maps job states and reads artifacts from the result", async () => {
  const states = ["queued", "processing", "completed"];
  const { fetch } = fakeFetch([
    [`${API}/v1/jobs/${JOB}/status`, () => json({ data: { sume_status: states.shift(), next_poll_after_seconds: 3 } })],
    [`${API}/v1/jobs/${JOB}/result`, () => json({ data: { result: { artifacts: [{ id: "a1", type: "video", url: "https://cdn.sume.test/a1.mp4", content_type: "video/mp4" }] } } })],
  ]);
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "queued", pollAfterMs: 3000 });
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "succeeded", outputs: [{ kind: "video", url: "https://cdn.sume.test/a1.mp4", mimeType: "video/mp4" }] });
});

test("sume failed jobs report the job error; canceled and unknown states are explicit", async () => {
  const failed = fakeFetch([
    [`${API}/v1/jobs/${JOB}/status`, () => json({ data: { sume_status: "failed" } })],
    [`${API}/v1/jobs/${JOB}`, () => json({ data: { job: { id: JOB, status: "failed", error: { code: "content_policy_violation", message: "blocked" } } } })],
  ]);
  const state = await adapter.poll(ctx(failed.fetch), job);
  assert.equal(state.status === "failed" && state.error.category, "moderation");
  const canceled = fakeFetch([[`${API}/v1/jobs/${JOB}/status`, () => json({ data: { sume_status: "canceled" } })]]);
  assert.deepEqual(await adapter.poll(ctx(canceled.fetch), job), { status: "canceled" });
  const odd = fakeFetch([[`${API}/v1/jobs/${JOB}/status`, () => json({ data: { sume_status: "mystery" } })]]);
  const unknown = await adapter.poll(ctx(odd.fetch), job);
  assert.equal(unknown.status === "failed" && unknown.error.code, "SUME_UNKNOWN_STATE");
});

test("sume error envelope is classified and the key never leaks", async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: { code: "unauthorized", message: `bad key ${KEY}`, category: "auth", retryable: false } }, "auth"],
    [402, { error: { code: "insufficient_funds", message: "add funds", retryable: false } }, "quota"],
    [429, { error: { code: "queue_full", message: "busy", retryable: true, retry_after_seconds: 5 } }, "rate-limit"],
    [400, { error: { code: "invalid_request", message: "bad duration", retryable: false } }, "invalid-request"],
  ];
  for (const [status, body, category] of cases) {
    const { fetch } = fakeFetch([[/generate$/, () => json(body, status)]]);
    const error = await errorOf(adapter.submit(ctx(fetch), request()));
    assert.equal(error.category, category);
    assert.equal(error.status, status);
    assert.ok(!JSON.stringify(error).includes(KEY));
  }
  const detailed = fakeFetch([[/generate$/, () => json({ error: { code: "invalid_request", message: "Invalid request body.", details: { errors: [
    { path: "image_size", message: "must be object" }, { path: "image_size", message: "must be object" },
  ] } } }, 400)]]);
  const withDetails = await errorOf(adapter.submit(ctx(detailed.fetch), request()));
  assert.equal(withDetails.message, "Invalid request body. (image_size: must be object)");
});

test("sume cancel posts to the job and surfaces 409 when generation already started", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/v1/jobs/${JOB}/cancel`, () => json({ error: { code: "job_generation_already_started", message: "too late" } }, 409)]]);
  const error = await errorOf(adapter.cancel!(ctx(fetch), job));
  assert.equal(calls[0].method, "POST");
  assert.equal(error.code, "SUME_JOB_GENERATION_ALREADY_STARTED");
});

test("sume validateKey reads the model list; a refused key reports why", async () => {
  const ok = fakeFetch([[`${API}/v1/video-router/models`, () => json({ data: [] })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  const scoped = fakeFetch([[`${API}/v1/video-router/models`, () => json({ error: { code: "open_key_route_not_allowed", message: "use a model API key" } }, 403)]]);
  const result = await adapter.validateKey(ctx(scoped.fetch));
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /model API key.*403/);
});

test("sume discoverModels adds router models the catalog does not name, routable by id", async () => {
  const { fetch } = fakeFetch([
    [`${API}/v1/video-router/models`, () => json({ data: [{ id: "seedance-2.5" }, { id: "brand-new-video" }] })],
    [`${API}/v1/image-router/models`, () => json({ data: [{ id: "gpt-image-2" }] })],
    [`${API}/v1/video-router/generate`, () => json(receipt, 202)],
  ]);
  const specs = await adapter.discoverModels!(ctx(fetch));
  const extra = specs.slice(adapter.listModels().length);
  assert.deepEqual(extra.map((spec) => spec.id), ["sume/video/brand-new-video"]);
  await adapter.submit(ctx(fetch), request({ model: "sume/video/brand-new-video" }));
});

test("sume image edits send the source first and its references after it in image_urls", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/v1/image-router/generate`, () => json(receipt, 202)]]);
  await adapter.submit(ctx(fetch), request({
    model: "bytedance/seedream-5.5", task: "image-to-image", prompt: "put image 2 into image 1",
    inputs: [
      { role: "reference-image", url: "https://x.test/ref.png", mimeType: "image/png" },
      { role: "source-image", url: "https://x.test/frame.png", mimeType: "image/png" },
    ],
  }));
  assert.deepEqual((calls[0].body as { image_urls: string[] }).image_urls, ["https://x.test/frame.png", "https://x.test/ref.png"]);
});
