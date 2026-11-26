import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/wavespeed.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "ws-test-0123456789abcdef";
const API = "https://api.wavespeed.ai/api/v3";

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
  return { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "a paper boat in the rain", inputs: [], ...overrides };
}

const job = { providerJobId: "pred_1", resume: { kind: "video" } };

test("wavespeed catalog serves Sume ids with per-task endpoints", () => {
  const specs = adapter.listModels();
  const seedance = specs.find((spec) => spec.id === "bytedance/seedance-2.5");
  assert.deepEqual([...(seedance?.tasks ?? [])].sort(), ["image-to-video", "reference-to-video", "text-to-video"]);
  assert.ok(seedance?.params.durationsSec?.includes(30));
  assert.equal(adapter.errorPrefix, "WAVESPEED");
  assert.equal(adapter.inputTransport, "upload");
});

test("wavespeed submit posts the mapped body to /api/v3/<model>", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/bytedance/seedance-2.5/text-to-video`, () => json({ code: 200, message: "success", data: { id: "pred_1", status: "created", urls: { get: `${API}/predictions/pred_1/result` } } })]]);
  const ref = await adapter.submit(ctx(fetch), request({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", audio: true }));
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, { prompt: "a paper boat in the rain", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
  assert.equal(ref.providerJobId, "pred_1");
});

test("wavespeed refuses uncatalogued models and undeclared values before calling", async () => {
  const { fetch, calls } = fakeFetch([]);
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ model: "acme/x" })))).code, "WAVESPEED_MODEL_UNSUPPORTED");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ durationSec: 40 })))).code, "WAVESPEED_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "image-to-video" })))).code, "WAVESPEED_MISSING_INPUT");
  assert.equal(calls.length, 0);
});

test("wavespeed poll maps states, outputs and task failures", async () => {
  const states = [
    { code: 200, data: { id: "pred_1", status: "created", outputs: [] } },
    { code: 200, data: { id: "pred_1", status: "processing", outputs: [] } },
    { code: 200, data: { id: "pred_1", status: "completed", outputs: ["https://d1q70pf5vjeyhc.cloudfront.net/out.mp4"] } },
  ];
  const { fetch } = fakeFetch([[`${API}/predictions/pred_1/result`, () => json(states.shift())]]);
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "queued");
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "succeeded", outputs: [{ kind: "video", url: "https://d1q70pf5vjeyhc.cloudfront.net/out.mp4", mimeType: "video/mp4" }] });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ status: "failed", code: 1002, error: "invalid image size" }, "invalid-request"],
    [{ status: "failed", code: 5001, error: "worker crashed" }, "upstream"],
    [{ status: "failed", code: 1010, error: "Content flagged as NSFW" }, "moderation"],
    [{ status: "timeout" }, "timeout"],
    [{ status: "deleted" }, "not-found"],
    [{ status: "completed", outputs: [] }, "upstream"],
  ];
  for (const [data, category] of cases) {
    const f = fakeFetch([[/result$/, () => json({ code: 200, data: { id: "pred_1", ...data } })]]);
    const state = await adapter.poll(ctx(f.fetch), job);
    assert.equal(state.status === "failed" && state.error.category, category, JSON.stringify(data));
  }
  const cancelled = fakeFetch([[/result$/, () => json({ code: 200, data: { status: "cancelled" } })]]);
  assert.deepEqual(await adapter.poll(ctx(cancelled.fetch), job), { status: "canceled" });
});

test("wavespeed errors are classified and never carry the key", async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { code: 401, message: `invalid key ${KEY}` }, "auth"],
    [429, { code: 429, message: "too many requests" }, "rate-limit"],
    [400, { code: 4006, message: "insufficient balance for this model" }, "invalid-request"],
  ];
  for (const [status, body, category] of cases) {
    const { fetch } = fakeFetch([[/text-to-video$/, () => json(body, status)]]);
    const error = await errorOf(adapter.submit(ctx(fetch), request()));
    assert.equal(error.category, category);
    assert.ok(!JSON.stringify(error).includes(KEY));
  }
});

test("wavespeed uploadInput gets a ticket, PUTs bytes without the key and returns the download URL", async () => {
  const { fetch, calls } = fakeFetch([
    [`${API}/media/uploads`, () => json({ code: 200, data: { upload: { url: "https://upload.wavespeed.test/abc?sig=1", headers: { "content-type": "image/png" } }, download_url: "https://cdn.wavespeed.test/abc.png" } })],
    ["https://upload.wavespeed.test/abc?sig=1", () => new Response(null, { status: 200 })],
  ]);
  const out = await adapter.uploadInput!(ctx(fetch), { role: "first-frame", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
  assert.equal(out.url, "https://cdn.wavespeed.test/abc.png");
  assert.deepEqual(calls[0].body, { filename: "first-frame.png", size: 3, content_type: "image/png" });
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].headers.authorization, undefined);
  assert.equal(calls[1].headers["content-type"], "image/png");
});

test("wavespeed validateKey reads the balance", async () => {
  const ok = fakeFetch([[`${API}/balance`, () => json({ code: 200, message: "success", data: { balance: 3.2 } })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  const bad = fakeFetch([[`${API}/balance`, () => json({ code: 401, message: "Unauthorized" }, 401)]]);
  assert.equal((await adapter.validateKey(ctx(bad.fetch))).ok, false);
});
