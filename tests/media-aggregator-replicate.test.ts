import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/replicate.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "r8_test_0123456789abcdef";
const API = "https://api.replicate.com/v1";

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
  return { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "a lighthouse at dusk", inputs: [], ...overrides };
}

function prediction(id: string, extra: Record<string, unknown> = {}) {
  return { id, status: "starting", urls: { get: `${API}/predictions/${id}`, cancel: `${API}/predictions/${id}/cancel` }, ...extra };
}

test("replicate catalog exposes Sume ids on official and versioned models", () => {
  const specs = adapter.listModels();
  const seedance = specs.find((spec) => spec.id === "bytedance/seedance-2.5");
  assert.equal(seedance?.upstreamId, "bytedance/seedance-2.5");
  assert.ok(seedance?.params.durationsSec?.includes(5));
  assert.ok(!seedance?.params.durationsSec?.includes(-1));
  assert.ok(specs.some((spec) => spec.id === "bytedance/latentsync"));
  for (const spec of specs) for (const price of spec.pricing) assert.match(price.source, /replicate\.com/);
});

test("replicate official model posts { input } to the model predictions route", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/models/bytedance/seedance-2.5/predictions`, () => json(prediction("p1"), 201)]]);
  const ref = await adapter.submit(ctx(fetch), request({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", audio: true }));
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].headers.prefer, undefined);
  assert.deepEqual(calls[0].body, { input: { prompt: "a lighthouse at dusk", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true } });
  assert.equal(ref.resume?.getUrl, `${API}/predictions/p1`);
});

test("replicate versioned model posts { version, input } to /predictions", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/predictions`, () => json(prediction("p2"), 201)]]);
  await adapter.submit(ctx(fetch), request({
    model: "bytedance/latentsync", task: "lipsync", prompt: undefined,
    inputs: [
      { role: "source-video", url: "https://x.test/v.mp4", mimeType: "video/mp4" },
      { role: "source-audio", url: "https://x.test/a.wav", mimeType: "audio/wav" },
    ],
  }));
  assert.match(calls[0].body.version, /^[0-9a-f]{64}$/);
  assert.deepEqual(calls[0].body.input, { video: "https://x.test/v.mp4", audio: "https://x.test/a.wav" });
});

test("replicate maps first frame, last frame and image inputs onto the model's own names", async () => {
  const { fetch, calls } = fakeFetch([
    [`${API}/models/bytedance/seedance-2.5/predictions`, () => json(prediction("p3"), 201)],
    [`${API}/models/google/nano-banana/predictions`, () => json(prediction("p4"), 201)],
  ]);
  await adapter.submit(ctx(fetch), request({
    task: "image-to-video",
    inputs: [
      { role: "first-frame", url: "https://x.test/f.png", mimeType: "image/png" },
      { role: "last-frame", url: "https://x.test/l.png", mimeType: "image/png" },
    ],
  }));
  assert.equal(calls[0].body.input.image, "https://x.test/f.png");
  assert.equal(calls[0].body.input.last_frame_image, "https://x.test/l.png");
  await adapter.submit(ctx(fetch), request({
    model: "google/nano-banana", task: "image-to-image", prompt: "add snow",
    inputs: [{ role: "source-image", bytes: new Uint8Array([255]), mimeType: "image/jpeg" }],
  }));
  assert.deepEqual(calls[1].body.input, { prompt: "add snow", image_input: ["data:image/jpeg;base64,/w=="] });
});

test("replicate refuses undeclared options and unsupported tasks before calling", async () => {
  const { fetch, calls } = fakeFetch([]);
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ resolution: "4k" })))).code, "REPLICATE_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ durationSec: 31 })))).code, "REPLICATE_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "avatar" })))).code, "REPLICATE_TASK_UNSUPPORTED");
  assert.equal(calls.length, 0);
});

test("replicate poll maps statuses, collects output URLs and fails closed", async () => {
  const job = { providerJobId: "p1", resume: { kind: "video", getUrl: `${API}/predictions/p1`, cancelUrl: `${API}/predictions/p1/cancel` } };
  const states = [
    prediction("p1"),
    prediction("p1", { status: "processing" }),
    prediction("p1", { status: "succeeded", output: "https://replicate.delivery/xezq/out.mp4" }),
  ];
  const { fetch } = fakeFetch([[`${API}/predictions/p1`, () => json(states.shift())]]);
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "queued");
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "succeeded", outputs: [{ kind: "video", url: "https://replicate.delivery/xezq/out.mp4", mimeType: "video/mp4" }] });

  const images = fakeFetch([[/predictions\/p1$/, () => json(prediction("p1", { status: "succeeded", output: ["https://replicate.delivery/a.png", "https://api.replicate.com/v1/files/f1.png"] }))]]);
  const many = await adapter.poll(ctx(images.fetch), { ...job, resume: { ...job.resume, kind: "image" } });
  assert.equal(many.status, "succeeded");
  if (many.status === "succeeded") {
    assert.equal(many.outputs.length, 2);
    assert.equal(many.outputs[0].downloadHeaders, undefined);
    assert.equal(many.outputs[1].downloadHeaders?.authorization, `Bearer ${KEY}`);
  }

  const flagged = fakeFetch([[/predictions\/p1$/, () => json(prediction("p1", { status: "failed", error: "E005: The input or output was flagged as sensitive" }))]]);
  const moderated = await adapter.poll(ctx(flagged.fetch), job);
  assert.equal(moderated.status === "failed" && moderated.error.category, "moderation");
  const aborted = fakeFetch([[/predictions\/p1$/, () => json(prediction("p1", { status: "aborted" }))]]);
  const late = await adapter.poll(ctx(aborted.fetch), job);
  assert.equal(late.status === "failed" && late.error.category, "timeout");
  const canceled = fakeFetch([[/predictions\/p1$/, () => json(prediction("p1", { status: "canceled" }))]]);
  assert.deepEqual(await adapter.poll(ctx(canceled.fetch), job), { status: "canceled" });
  const empty = fakeFetch([[/predictions\/p1$/, () => json(prediction("p1", { status: "succeeded", output: null }))]]);
  const none = await adapter.poll(ctx(empty.fetch), job);
  assert.equal(none.status === "failed" && none.error.code, "REPLICATE_NO_OUTPUT");
});

test("replicate errors are classified and the token never leaks", async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { title: "Unauthenticated", detail: `Invalid token ${KEY}`, status: 401 }, "auth"],
    [402, { title: "Payment required", detail: "You have insufficient credit", status: 402 }, "quota"],
    [429, { detail: "Request was throttled. Expected available in 1 second." }, "rate-limit"],
    [422, { detail: [{ loc: ["body", "input", "duration"], msg: "must be <= 30", type: "value_error" }] }, "invalid-request"],
  ];
  for (const [status, body, category] of cases) {
    const { fetch } = fakeFetch([[/predictions$/, () => json(body, status)]]);
    const error = await errorOf(adapter.submit(ctx(fetch), request()));
    assert.equal(error.category, category);
    assert.ok(!JSON.stringify(error).includes(KEY));
  }
});

test("replicate cancel posts to the prediction's cancel URL", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/predictions/p1/cancel`, () => json(prediction("p1", { status: "canceled" }))]]);
  await adapter.cancel!(ctx(fetch), { providerJobId: "p1", resume: { cancelUrl: `${API}/predictions/p1/cancel` } });
  assert.equal(calls[0].method, "POST");
});

test("replicate validateKey reads /account and never predicts", async () => {
  const ok = fakeFetch([[`${API}/account`, () => json({ type: "user", username: "jun" })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  const bad = fakeFetch([[`${API}/account`, () => json({ title: "Unauthenticated", detail: "bad token", status: 401 }, 401)]]);
  const result = await adapter.validateKey(ctx(bad.fetch));
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /401/);
});

test("replicate discoverModels reads collections, skips missing ones and routed models", async () => {
  const { fetch } = fakeFetch([
    [`${API}/collections/text-to-video`, () => json({ slug: "text-to-video", models: [{ owner: "bytedance", name: "seedance-2.5" }, { owner: "acme", name: "clip" }] })],
    [`${API}/collections/image-to-video`, () => json({ slug: "image-to-video", models: [{ owner: "acme", name: "clip" }] })],
    [`${API}/collections/text-to-image`, () => json({ title: "Not found", status: 404 }, 404)],
  ]);
  const specs = await adapter.discoverModels!(ctx(fetch));
  const extra = specs.slice(adapter.listModels().length);
  assert.deepEqual(extra.map((spec) => [spec.id, [...spec.tasks]]), [["acme/clip", ["text-to-video", "image-to-video"]]]);
});

test("replicate submits an uncurated model through its latest version schema with dereferenced enums", async () => {
  const model = {
    owner: "acme", name: "clip",
    latest_version: {
      id: "v123",
      openapi_schema: { components: { schemas: {
        Input: { required: ["prompt"], properties: { prompt: { type: "string" }, aspect_ratio: { allOf: [{ $ref: "#/components/schemas/aspect_ratio" }] } } },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16"] },
      } } },
    },
  };
  const { fetch, calls } = fakeFetch([
    [`${API}/models/acme/clip`, () => json(model)],
    [`${API}/predictions`, () => json(prediction("p9"), 201)],
  ]);
  await adapter.submit(ctx(fetch), request({ model: "acme/clip", aspectRatio: "9:16" }));
  assert.deepEqual(calls[1].body, { version: "v123", input: { prompt: "a lighthouse at dusk", aspect_ratio: "9:16" } });
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ model: "acme/clip", aspectRatio: "1:1" })))).code, "REPLICATE_UNSUPPORTED_OPTION");
});

test("replicate mode tiers and rendering speeds are listed as qualities and sent on their own field", async () => {
  const spec = (id: string) => adapter.listModels().find((model) => model.id === id)!;
  assert.deepEqual(spec("kling/kling-3").params.qualities, ["standard", "pro", "4k"]);
  assert.deepEqual(spec("kling/kling-o1").params.qualities, ["std", "pro"]);
  assert.deepEqual(spec("openai/gpt-image-2").params.qualities, ["low", "medium", "high", "auto"]);
  // A mode that is not a price tier is not a quality.
  assert.equal(spec("bytedance/seedance-2.5").params.qualities, undefined);
  const { fetch, calls } = fakeFetch([[/predictions/, () => json(prediction("p-mode"), 201)]]);
  await adapter.submit(ctx(fetch), request({ model: "kling/kling-3", task: "text-to-video", quality: "pro" }));
  assert.equal(((calls[0].body as { input: Record<string, unknown> }).input).mode, "pro");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ model: "kling/kling-3", task: "text-to-video", quality: "ultra" })))).code, "REPLICATE_UNSUPPORTED_OPTION");
});
