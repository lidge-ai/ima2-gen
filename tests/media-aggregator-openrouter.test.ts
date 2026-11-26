import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/openrouter.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "sk-or-v1-test0123456789";
const API = "https://openrouter.ai/api/v1";

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
  return { model: "google/veo-3.1", task: "text-to-video", prompt: "a serene mountain at sunset", inputs: [], ...overrides };
}

test("openrouter catalog maps Sume ids to OpenRouter video ids with per-second SKUs", () => {
  const specs = adapter.listModels();
  assert.equal(specs.find((spec) => spec.id === "minimax/minimax-h3-max")?.upstreamId, "minimax/hailuo-3-max");
  const veo = specs.find((spec) => spec.id === "google/veo-3.1");
  assert.deepEqual(veo?.params.durationsSec, [4, 6, 8]);
  assert.ok(specs.every((spec) => spec.kind === "video"));
  for (const spec of specs) {
    for (const price of spec.pricing) assert.equal(price.unit, "second");
    // An unqualified SKU reads as "applies to all"; it must not sit next to qualified ones.
    const qualified = spec.pricing.some((price) => price.variant);
    const unqualified = spec.pricing.some((price) => !price.variant);
    assert.ok(!(qualified && unqualified), `${spec.id} mixes unqualified and qualified SKUs`);
  }
  assert.equal(specs.find((spec) => spec.id === "minimax/minimax-h3")?.pricing.length, 1, "a lone base SKU is kept");
});

test("openrouter submit sends the documented body with Bearer auth", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/videos`, () => json({ id: "job-abc123", polling_url: "/api/v1/videos/job-abc123", status: "pending" }, 202)]]);
  const ref = await adapter.submit(ctx(fetch), request({ durationSec: 8, resolution: "720p", aspectRatio: "16:9", audio: true, seed: 7 }));
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, {
    model: "google/veo-3.1", prompt: "a serene mountain at sunset", duration: 8, resolution: "720p", aspect_ratio: "16:9", seed: 7, generate_audio: true,
  });
  assert.equal(ref.providerJobId, "job-abc123");
});

test("openrouter frames and references become typed content parts", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/videos`, () => json({ id: "j", polling_url: "/x", status: "pending" }, 202)]]);
  await adapter.submit(ctx(fetch), request({
    task: "image-to-video",
    inputs: [
      { role: "first-frame", url: "https://x.test/a.png", mimeType: "image/png" },
      { role: "last-frame", url: "https://x.test/b.png", mimeType: "image/png" },
    ],
  }));
  assert.deepEqual(calls[0].body.frame_images, [
    { type: "image_url", image_url: { url: "https://x.test/a.png" }, frame_type: "first_frame" },
    { type: "image_url", image_url: { url: "https://x.test/b.png" }, frame_type: "last_frame" },
  ]);
  await adapter.submit(ctx(fetch), request({
    model: "bytedance/seedance-2", task: "reference-to-video",
    inputs: [{ role: "reference-video", url: "https://x.test/r.mp4", mimeType: "video/mp4" }],
  }));
  assert.deepEqual(calls[1].body.input_references, [{ type: "video_url", video_url: { url: "https://x.test/r.mp4" } }]);
});

test("openrouter refuses values outside the catalog capability lists without calling", async () => {
  const { fetch, calls } = fakeFetch([]);
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ durationSec: 5 })))).code, "OPENROUTER_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ resolution: "480p" })))).code, "OPENROUTER_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ negativePrompt: "x" })))).code, "OPENROUTER_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ model: "minimax/hailuo-2.3", audio: true })))).code, "OPENROUTER_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ inputs: [{ role: "reference-image", url: "https://x.test/a.png", mimeType: "image/png" }] })))).code, "OPENROUTER_UNSUPPORTED_INPUT");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "image-to-video" })))).code, "OPENROUTER_MISSING_INPUT");
  assert.equal(calls.length, 0);
});

test("openrouter poll maps statuses, progress, cost and authenticated output URLs", async () => {
  const states = [
    { id: "j1", status: "pending" },
    { id: "j1", status: "in_progress", progress: 40 },
    { id: "j1", status: "completed", unsigned_urls: ["https://openrouter.ai/api/v1/videos/j1/content?index=0"], usage: { cost: 1.6 } },
  ];
  const { fetch } = fakeFetch([[`${API}/videos/j1`, () => json(states.shift())]]);
  const job = { providerJobId: "j1" };
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "queued");
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "running", pollAfterMs: 5000, progress: 0.4 });
  const done = await adapter.poll(ctx(fetch), job);
  assert.equal(done.status, "succeeded");
  if (done.status === "succeeded") {
    assert.equal(done.outputs[0].downloadHeaders?.authorization, `Bearer ${KEY}`);
    assert.deepEqual(done.billed, { usd: 1.6 });
  }
  const failed = fakeFetch([[/videos\/j1$/, () => json({ id: "j1", status: "failed", error: "provider rejected prompt" })]]);
  const f = await adapter.poll(ctx(failed.fetch), job);
  assert.equal(f.status === "failed" && f.error.message, "provider rejected prompt");
  const expired = fakeFetch([[/videos\/j1$/, () => json({ id: "j1", status: "expired" })]]);
  const e = await adapter.poll(ctx(expired.fetch), job);
  assert.equal(e.status === "failed" && e.error.code, "OPENROUTER_EXPIRED");
  const cancelled = fakeFetch([[/videos\/j1$/, () => json({ id: "j1", status: "cancelled" })]]);
  assert.deepEqual(await adapter.poll(ctx(cancelled.fetch), job), { status: "canceled" });
});

test("openrouter errors are classified and the key never leaks", async () => {
  const cases: Array<[number, string]> = [[401, "auth"], [402, "quota"], [429, "rate-limit"], [400, "invalid-request"]];
  for (const [status, category] of cases) {
    const { fetch } = fakeFetch([[`${API}/videos`, () => json({ error: { code: status, message: `nope ${KEY}` } }, status)]]);
    const error = await errorOf(adapter.submit(ctx(fetch), request()));
    assert.equal(error.category, category);
    assert.ok(!JSON.stringify(error).includes(KEY));
  }
});

test("openrouter validateKey uses GET /key", async () => {
  const ok = fakeFetch([[`${API}/key`, () => json({ data: { label: "k" } })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  const bad = fakeFetch([[`${API}/key`, () => json({ error: { code: 401, message: "Missing Authentication header" } }, 401)]]);
  assert.equal((await adapter.validateKey(ctx(bad.fetch))).ok, false);
});

test("openrouter discoverModels adds live video models and can submit them", async () => {
  const listing = { data: [
    { id: "google/veo-3.1", name: "Veo", supported_durations: [4, 6, 8] },
    { id: "runway/gen-4.5", name: "Runway: Gen-4.5", supported_resolutions: ["720p"], supported_durations: [2, 5, 10], supported_aspect_ratios: ["16:9"], supported_frame_images: ["first_frame"], generate_audio: false, seed: true },
  ] };
  const { fetch, calls } = fakeFetch([
    [`${API}/videos/models`, () => json(listing)],
    [`${API}/videos`, () => json({ id: "j2", polling_url: "/x", status: "pending" }, 202)],
  ]);
  const specs = await adapter.discoverModels!(ctx(fetch));
  const extra = specs.slice(adapter.listModels().length);
  assert.deepEqual(extra.map((spec) => [spec.id, [...spec.tasks]]), [["runway/gen-4.5", ["text-to-video", "image-to-video"]]]);
  await adapter.submit(ctx(fetch), request({ model: "runway/gen-4.5", durationSec: 5 }));
  assert.deepEqual(calls.at(-1)?.body, { model: "runway/gen-4.5", prompt: "a serene mountain at sunset", duration: 5 });
});
