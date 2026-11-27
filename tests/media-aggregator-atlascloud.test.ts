import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/aggregator/atlascloud.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { fakeFetch, json } from "./helpers/mediaFakeFetch.ts";

const KEY = "apikey-test-0123456789";
const API = "https://api.atlascloud.ai";

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
  return { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: "a golden retriever on a beach", inputs: [], ...overrides };
}

const job = { providerJobId: "pred-1", resume: { kind: "video" } };

test("atlas catalog serves Sume ids across video, image and audio with starting prices", () => {
  const specs = adapter.listModels();
  const seedance = specs.find((spec) => spec.id === "bytedance/seedance-2.5");
  assert.deepEqual([...(seedance?.tasks ?? [])].sort(), ["image-to-video", "reference-to-video", "text-to-video"]);
  assert.ok(seedance?.params.aspectRatios?.includes("16:9"));
  assert.ok(specs.some((spec) => spec.kind === "image"));
  for (const spec of specs) for (const price of spec.pricing) assert.match(price.variant ?? "", /starting price/);
  // Image prices are per image, as Atlas publishes them (model pages checked 2026-11-27).
  const imagePrice = (id: string) => specs.find((spec) => spec.id === id)?.pricing.map((price) => [price.unit, price.usd, price.variant]);
  assert.deepEqual(imagePrice("bytedance/seedream-5.5"), [["image", 0.016, "text-to-image: starting price"], ["image", 0.016, "image-to-image: starting price"]]);
  assert.deepEqual(imagePrice("openai/gpt-image-2.6-sunburst"), [["image", 0.007, "text-to-image: starting price"], ["image", 0.008, "image-to-image: starting price"]]);
  assert.deepEqual(imagePrice("google/nano-banana-pro"), [["image", 0.14, "text-to-image: starting price"], ["image", 0.14, "image-to-image: starting price"]]);
  // Atlas publishes a base price for every image endpoint it serves, so each task of each image model has one row, per image.
  for (const spec of specs.filter((entry) => entry.kind === "image")) {
    assert.deepEqual(spec.pricing.map((price) => price.variant).sort(), spec.tasks.map((task) => task + ": starting price").sort(), spec.id);
    for (const price of spec.pricing) assert.deepEqual([price.unit, price.usd > 0], ["image", true], spec.id);
  }
  // Every task Atlas serves has its published base price: video and audio by the second, except Hailuo 2.3, which Atlas bills per run.
  const perRun = new Set(["minimax/hailuo-2.3", "minimax/hailuo-2.3-fast"]);
  for (const spec of specs.filter((entry) => entry.kind !== "image")) {
    assert.deepEqual(spec.pricing.map((price) => price.variant).sort(), spec.tasks.map((task) => task + ": starting price").sort(), spec.id);
    for (const price of spec.pricing) assert.deepEqual([price.unit, price.usd > 0], [perRun.has(spec.id) ? "request" : "second", true], spec.id);
  }
  const rows = (id: string) => specs.find((spec) => spec.id === id)?.pricing.map((price) => [price.unit, price.usd, price.variant?.split(":")[0]]);
  assert.deepEqual(rows("kling/kling-4"), [["second", 0.11, "text-to-video"], ["second", 0.11, "image-to-video"], ["second", 0.11, "reference-to-video"], ["second", 0.11, "video-to-video"]]);
  assert.deepEqual(rows("minimax/hailuo-2.3"), [["request", 0.49, "text-to-video"], ["request", 0.49, "image-to-video"]]);
  assert.deepEqual(rows("minimax/hailuo-2.3-fast"), [["request", 0.19, "image-to-video"]]);
  assert.deepEqual(rows("pixverse/v6"), [["second", 0.025, "text-to-video"], ["second", 0.025, "image-to-video"], ["second", 0.025, "reference-to-video"]]);
  assert.equal(adapter.inputTransport, "upload");
  assert.equal(adapter.cancel, undefined);
});

test("atlas submit posts { model, ...fields } to the schema's generate route", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/api/v1/model/generateVideo`, () => json({ code: 200, data: { id: "pred-1", status: "processing" } })]]);
  const ref = await adapter.submit(ctx(fetch), request({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", audio: false }));
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, {
    model: "bytedance/seedance-2.5/text-to-video", prompt: "a golden retriever on a beach",
    duration: 5, resolution: "720p", ratio: "16:9", generate_audio: false,
  });
  assert.deepEqual([ref.providerJobId, ref.resume?.kind], ["pred-1", "video"]);
});

test("atlas maps first and last frames to image/last_image and edits to images[]", async () => {
  const { fetch, calls } = fakeFetch([
    [`${API}/api/v1/model/generateVideo`, () => json({ data: { id: "p" } })],
    [`${API}/api/v1/model/generateImage`, () => json({ data: { id: "p" } })],
  ]);
  await adapter.submit(ctx(fetch), request({
    task: "image-to-video",
    inputs: [
      { role: "first-frame", url: "https://x.test/a.png", mimeType: "image/png" },
      { role: "last-frame", url: "https://x.test/b.png", mimeType: "image/png" },
    ],
  }));
  assert.equal(calls[0].body.image, "https://x.test/a.png");
  assert.equal(calls[0].body.last_image, "https://x.test/b.png");
  await adapter.submit(ctx(fetch), request({
    model: "openai/gpt-image-2", task: "image-to-image", prompt: "night",
    inputs: [{ role: "source-image", url: "https://x.test/c.png", mimeType: "image/png" }],
  }));
  assert.deepEqual(calls[1].body, { model: "openai/gpt-image-2/edit", prompt: "night", images: ["https://x.test/c.png"] });
});

test("atlas refuses what the schema does not declare and missing required inputs", async () => {
  const { fetch, calls } = fakeFetch([]);
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ resolution: "8k" })))).code, "ATLASCLOUD_UNSUPPORTED_OPTION");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "image-to-video" })))).code, "ATLASCLOUD_MISSING_INPUT");
  assert.equal((await errorOf(adapter.submit(ctx(fetch), request({ task: "lipsync" })))).code, "ATLASCLOUD_TASK_UNSUPPORTED");
  assert.equal(calls.length, 0);
});

test("atlas poll maps prediction states, outputs and moderation failures", async () => {
  const states = [
    { data: { status: "created" } },
    { data: { status: "processing" } },
    { data: { status: "completed", outputs: ["https://cdn.atlas.test/out.mp4"], error: null } },
  ];
  const { fetch, calls } = fakeFetch([[`${API}/api/v1/model/prediction/pred-1`, () => json(states.shift())]]);
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "queued");
  assert.equal((await adapter.poll(ctx(fetch), job)).status, "running");
  assert.deepEqual(await adapter.poll(ctx(fetch), job), { status: "succeeded", outputs: [{ kind: "video", url: "https://cdn.atlas.test/out.mp4", mimeType: "video/mp4" }] });
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);

  const blocked = fakeFetch([[/prediction/, () => json({ data: { status: "failed", error: "input flagged", error_code: 1039 } })]]);
  const state = await adapter.poll(ctx(blocked.fetch), job);
  assert.equal(state.status === "failed" && state.error.code, "ATLASCLOUD_CONTENT_POLICY");
  const timedOut = fakeFetch([[/prediction/, () => json({ data: { status: "timeout" } })]]);
  const late = await adapter.poll(ctx(timedOut.fetch), job);
  assert.equal(late.status === "failed" && late.error.category, "timeout");
  const empty = fakeFetch([[/prediction/, () => json({ data: { status: "completed", outputs: [] } })]]);
  const none = await adapter.poll(ctx(empty.fetch), job);
  assert.equal(none.status === "failed" && none.error.code, "ATLASCLOUD_NO_OUTPUT");
});

test("atlas errors are classified by status and never carry the key", async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { code: 401, msg: `unauthorized ${KEY}`, data: null }, "auth"],
    [402, { code: 402, msg: "insufficient balance", data: null }, "quota"],
    [429, { code: 429, msg: "rate limited", data: null }, "rate-limit"],
  ];
  for (const [status, body, category] of cases) {
    const { fetch } = fakeFetch([[/generateVideo/, () => json(body, status)]]);
    const error = await errorOf(adapter.submit(ctx(fetch), request()));
    assert.equal(error.category, category);
    assert.ok(!JSON.stringify(error).includes(KEY));
  }
});

test("atlas uploadInput sends multipart bytes and returns the hosted URL", async () => {
  const { fetch, calls } = fakeFetch([[`${API}/api/v1/model/uploadMedia`, () => json({ code: 200, data: { url: "https://cdn.atlas.test/u.png" } })]]);
  const out = await adapter.uploadInput!(ctx(fetch), { role: "first-frame", bytes: new Uint8Array([1, 2]), mimeType: "image/png" });
  assert.equal(out.url, "https://cdn.atlas.test/u.png");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.ok(!calls[0].headers["content-type"]?.includes("application/json"));
});

test("atlas validateKey reads the balance, never generates", async () => {
  const ok = fakeFetch([[`${API}/public/v1/balance`, () => json({ balance: 1 })]]);
  assert.deepEqual(await adapter.validateKey(ctx(ok.fetch)), { ok: true });
  const bad = fakeFetch([[`${API}/public/v1/balance`, () => json({ code: 401, msg: "unauthorized" }, 401)]]);
  assert.equal((await adapter.validateKey(ctx(bad.fetch))).ok, false);
});

test("atlas discoverModels adds media models outside the catalog and submits them via their schema", async () => {
  const listing = { code: "200", data: [
    { model: "bytedance/seedance-2.5/text-to-video", type: "Video", categories: ["TEXT-TO-VIDEO"] },
    { model: "acme/new/text-to-video", type: "Video", displayName: "Acme", categories: ["TEXT-TO-VIDEO"], schema: "https://static.atlas.test/acme.json" },
    { model: "acme/llm", type: "Text", categories: ["LLM"] },
  ] };
  const schema = {
    paths: { "/api/v1/model/generateVideo": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } } },
    components: { schemas: { Input: { required: ["model", "prompt"], properties: { model: { type: "string" }, prompt: { type: "string" }, duration: { type: "integer", enum: [5, 10] } } } } },
  };
  const { fetch, calls } = fakeFetch([
    [`${API}/api/v1/models`, () => json(listing)],
    ["https://static.atlas.test/acme.json", () => json(schema)],
    [`${API}/api/v1/model/generateVideo`, () => json({ data: { id: "p2" } })],
  ]);
  const specs = await adapter.discoverModels!(ctx(fetch));
  assert.deepEqual(specs.slice(adapter.listModels().length).map((spec) => spec.id), ["acme/new/text-to-video"]);
  await adapter.submit(ctx(fetch), request({ model: "acme/new/text-to-video", durationSec: 10 }));
  const post = calls.find((call) => call.url.endsWith("/generateVideo"));
  assert.deepEqual(post?.body, { model: "acme/new/text-to-video", prompt: "a golden retriever on a beach", duration: 10 });
  const schemaCall = calls.find((call) => new URL(call.url).origin === "https://static.atlas.test");
  assert.equal(schemaCall?.headers.authorization, undefined);
});
