import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/fal.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "fal-test-key-0123456789";
const T2V = "https://queue.fal.run/bytedance/seedance-2.5/us/text-to-video";
const APP = "https://queue.fal.run/bytedance/seedance-2.5/requests/req-1";

function ctx(fetchImpl: typeof fetch): MediaAdapterContext {
  return { apiKey: KEY, fetch: fetchImpl };
}

const receipt = { request_id: "req-1", status: "IN_QUEUE", status_url: `${APP}/status`, response_url: APP, cancel_url: `${APP}/cancel` };

async function errorOf(pending: Promise<unknown>) {
  try {
    await pending;
  } catch (error) {
    return adapter.normalizeError(error);
  }
  throw new Error("expected a rejection");
}

function request(overrides: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest {
  return { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "a fox in the snow", inputs: [], ...overrides };
}

test("fal catalog lists Sume-id models with per-task endpoints and sourced prices", () => {
  const specs = adapter.listModels();
  const ids = specs.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
  const seedance = specs.find((spec) => spec.id === "bytedance/seedance-2.5");
  assert.ok(seedance);
  assert.deepEqual([...seedance.tasks].sort(), ["image-to-video", "reference-to-video", "text-to-video"]);
  assert.equal(seedance.kind, "video");
  assert.ok(seedance.params.durationsSec?.includes(5));
  assert.ok(seedance.params.resolutions?.includes("720p"));
  for (const spec of specs) {
    for (const price of spec.pricing) {
      assert.match(price.source, /^https:\/\/fal\.ai\/models\//);
      assert.equal(price.checkedAt, "2026-11-26");
      assert.ok(price.usd > 0);
    }
  }
});

test("fal submit posts the schema-mapped body to the endpoint with Key auth and keeps queue URLs", async () => {
  const { fetch, calls } = fakeFetch([[T2V, () => json(receipt)]]);
  const job = await adapter.submit(ctx(fetch), request({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", audio: true }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, `Key ${KEY}`);
  assert.deepEqual(calls[0].body, { prompt: "a fox in the snow", duration: "5", resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
  assert.equal(job.providerJobId, "req-1");
  assert.equal(job.resume?.statusUrl, `${APP}/status`);
  assert.equal(job.resume?.responseUrl, APP);
});

test("fal image-to-video sends a first-frame data URI on image_url", async () => {
  const url = "https://queue.fal.run/bytedance/seedance-2.5/us/image-to-video";
  const { fetch, calls } = fakeFetch([[url, () => json(receipt)]]);
  const bytes = new Uint8Array([1, 2, 3]);
  await adapter.submit(ctx(fetch), request({ task: "image-to-video", inputs: [{ role: "first-frame", bytes, mimeType: "image/png" }] }));
  assert.equal(calls[0].body.image_url, "data:image/png;base64,AQID");
});

test("fal reference-to-video maps reference images and videos to array fields", async () => {
  const url = "https://queue.fal.run/bytedance/seedance-2.5/us/reference-to-video";
  const { fetch, calls } = fakeFetch([[url, () => json(receipt)]]);
  await adapter.submit(ctx(fetch), request({
    task: "reference-to-video",
    inputs: [
      { role: "reference-image", url: "https://x.test/a.png", mimeType: "image/png" },
      { role: "reference-image", url: "https://x.test/b.png", mimeType: "image/png" },
      { role: "reference-video", url: "https://x.test/c.mp4", mimeType: "video/mp4" },
    ],
  }));
  assert.deepEqual(calls[0].body.image_urls, ["https://x.test/a.png", "https://x.test/b.png"]);
  assert.deepEqual(calls[0].body.video_urls, ["https://x.test/c.mp4"]);
});

test("fal refuses values, inputs, options and tasks the endpoint does not declare, before any call", async () => {
  const { fetch, calls } = fakeFetch([]);
  const c = ctx(fetch);
  await assert.rejects(adapter.submit(c, request({ durationSec: 99 })), (e: any) => adapter.normalizeError(e).code === "FAL_UNSUPPORTED_OPTION");
  await assert.rejects(adapter.submit(c, request({ negativePrompt: "blur" })), (e: any) => adapter.normalizeError(e).code === "FAL_UNSUPPORTED_OPTION");
  await assert.rejects(adapter.submit(c, request({ vendorOptions: { not_a_field: 1 } })), (e: any) => adapter.normalizeError(e).code === "FAL_UNSUPPORTED_OPTION");
  await assert.rejects(
    adapter.submit(c, request({ inputs: [{ role: "mask", url: "https://x.test/m.png", mimeType: "image/png" }] })),
    (e: any) => adapter.normalizeError(e).code === "FAL_UNSUPPORTED_INPUT",
  );
  await assert.rejects(adapter.submit(c, request({ task: "lipsync" })), (e: any) => adapter.normalizeError(e).code === "FAL_TASK_UNSUPPORTED");
  await assert.rejects(adapter.submit(c, request({ task: "image-to-video" })), (e: any) => adapter.normalizeError(e).code === "FAL_MISSING_INPUT");
  assert.equal(calls.length, 0);
});

test("fal passes declared vendorOptions through", async () => {
  const { fetch, calls } = fakeFetch([[T2V, () => json(receipt)]]);
  await adapter.submit(ctx(fetch), request({ vendorOptions: { output_format: "mov" } }));
  assert.equal(calls[0].body.output_format, "mov");
});

test("fal poll walks queued, running and succeeded, reading media from response_url", async () => {
  const states = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
  const { fetch, calls } = fakeFetch([
    [`${APP}/status`, () => json({ status: states.shift() })],
    [APP, () => json({ video: { url: "https://v3.fal.media/out.mp4", content_type: "video/mp4" }, seed: 7, last_frame: { url: "https://v3.fal.media/last.png" } })],
  ]);
  const job = { providerJobId: "req-1", resume: { statusUrl: `${APP}/status`, responseUrl: APP, cancelUrl: `${APP}/cancel`, kind: "video" } };
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "queued");
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "running");
  const done = await adapter.poll(ctx(fetch), job);
  assert.deepEqual(done, { status: "succeeded", outputs: [{ kind: "video", url: "https://v3.fal.media/out.mp4", mimeType: "video/mp4" }] });
  assert.ok(calls.every((call) => call.headers.authorization === `Key ${KEY}`));
});

test("fal COMPLETED with an error or a failing result is a failure, never success", async () => {
  const job = { providerJobId: "req-1", resume: { statusUrl: `${APP}/status`, responseUrl: APP, cancelUrl: `${APP}/cancel`, kind: "video" } };
  const viaStatus = fakeFetch([[`${APP}/status`, () => json({ status: "COMPLETED", error: "flagged", error_type: "content_policy_violation" })]]);
  const a = await adapter.poll(ctx(viaStatus.fetch), job);
  assert.equal(a.status, "failed");
  assert.equal(a.status === "failed" && a.error.category, "moderation");

  const viaResult = fakeFetch([
    [`${APP}/status`, () => json({ status: "COMPLETED" })],
    [APP, () => json({ detail: [{ loc: ["body", "prompt"], msg: "violates policy", type: "content_policy_violation" }] }, 422)],
  ]);
  const b = await adapter.poll(ctx(viaResult.fetch), job);
  assert.equal(b.status === "failed" && b.error.code, "FAL_CONTENT_POLICY");

  const empty = fakeFetch([[`${APP}/status`, () => json({ status: "COMPLETED" })], [APP, () => json({ seed: 1 })]]);
  const c = await adapter.poll(ctx(empty.fetch), job);
  assert.equal(c.status === "failed" && c.error.code, "FAL_NO_OUTPUT");
});

test("fal errors are classified and never carry the API key", async () => {
  const echo = fakeFetch([[T2V, () => json({ detail: `Invalid key ${KEY}` }, 401)]]);
  const err = await errorOf(adapter.submit(ctx(echo.fetch), request()));
  assert.equal(err.category, "auth");
  assert.equal(err.code, "FAL_AUTH");
  assert.ok(!JSON.stringify(err).includes(KEY));

  const broke = fakeFetch([[T2V, () => json({ detail: "User is locked. Reason: Exhausted balance." }, 403)]]);
  const quota = await errorOf(adapter.submit(ctx(broke.fetch), request()));
  assert.equal(quota.category, "quota");

  const limited = fakeFetch([[T2V, () => json({ detail: "slow down" }, 429)]]);
  const rate = await errorOf(adapter.submit(ctx(limited.fetch), request()));
  assert.deepEqual([rate.category, rate.retryable], ["rate-limit", true]);

  const offline = fakeFetch([[T2V, () => { throw new TypeError("fetch failed"); }]]);
  const net = await errorOf(adapter.submit(ctx(offline.fetch), request()));
  assert.deepEqual([net.code, net.retryable], ["FAL_NETWORK", true]);
});

test("fal cancel PUTs the stored cancel_url and tolerates ALREADY_COMPLETED", async () => {
  const { fetch, calls } = fakeFetch([[`${APP}/cancel`, () => json({ status: "ALREADY_COMPLETED" }, 400)]]);
  const job = { providerJobId: "req-1", resume: { statusUrl: `${APP}/status`, responseUrl: APP, cancelUrl: `${APP}/cancel`, kind: "video" } };
  await adapter.cancel?.(ctx(fetch), job);
  assert.equal(calls[0].method, "PUT");
});

test("fal validateKey uses the authenticated pricing read, never a generation", async () => {
  const ok = fakeFetch([[/api\.fal\.ai\/v1\/models\/pricing/, () => json({ prices: [] })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  assert.ok(!ok.calls.some((call) => call.url.includes("queue.fal.run")));
  const bad = fakeFetch([[/pricing/, () => json({ error: { type: "authorization_error", message: "API key authentication required" } }, 401)]]);
  const result = await adapter.validateKey(ctx(bad.fetch));
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /401/);
});

test("fal discoverModels pages the platform catalog and adds uncurated media endpoints", async () => {
  const pages = [
    { models: [
      { endpoint_id: "bytedance/seedance-2.5/us/text-to-video", metadata: { category: "text-to-video", status: "active", display_name: "dup" } },
      { endpoint_id: "acme/new-video", metadata: { category: "text-to-video", status: "active", display_name: "Acme Video" } },
    ], has_more: true, next_cursor: "Mg" },
    { models: [{ endpoint_id: "acme/llm", metadata: { category: "llm", status: "active" } }], has_more: false },
  ];
  const { fetch, calls } = fakeFetch([[/api\.fal\.ai\/v1\/models\?/, () => json(pages.shift())]]);
  const specs = await adapter.discoverModels!(ctx(fetch));
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /cursor=Mg/);
  const extra = specs.filter((spec) => !adapter.listModels().includes(spec));
  assert.deepEqual(extra.map((spec) => [spec.id, spec.tasks[0], spec.kind]), [["acme/new-video", "text-to-video", "video"]]);
});

test("fal submits an uncurated endpoint after reading its published schema", async () => {
  const openapi = {
    paths: { "/acme/new-video": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AcmeInput" } } } } } } },
    components: { schemas: { AcmeInput: { properties: { prompt: { type: "string" }, duration: { type: "integer", minimum: 2, maximum: 8 } }, required: ["prompt"] } } },
  };
  const { fetch, calls } = fakeFetch([
    [/expand=openapi-3\.0/, () => json({ models: [{ endpoint_id: "acme/new-video", metadata: { category: "text-to-video" }, openapi }] })],
    ["https://queue.fal.run/acme/new-video", () => json({ ...receipt, status_url: undefined, response_url: undefined, cancel_url: undefined })],
  ]);
  const job = await adapter.submit(ctx(fetch), request({ model: "acme/new-video", durationSec: 4 }));
  assert.deepEqual(calls[1].body, { prompt: "a fox in the snow", duration: 4 });
  assert.equal(job.resume?.statusUrl, "https://queue.fal.run/acme/new-video/requests/req-1/status");
  await assert.rejects(adapter.submit(ctx(fetch), request({ model: "acme/new-video", durationSec: 20 })));
});

test("fal lists Ideogram 3 rendering speeds as its quality and sends the chosen one as rendering_speed", () => {
  const spec = adapter.listModels().find((model) => model.id === "ideogram/ideogram-v3")!;
  assert.deepEqual(spec.params.qualities, ["TURBO", "BALANCED", "QUALITY"]);
  assert.equal(adapter.listModels().find((model) => model.id === "ideogram/ideogram-vectorize")?.params.qualities, undefined);
});
