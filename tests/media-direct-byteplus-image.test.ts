// BytePlus ModelArk Seedream (synchronous image API), key validation and credential names.
// https://docs.byteplus.com/en/docs/ModelArk/image-generation-api (read 2026-11-26).
import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/byteplus/index.ts";
import { HOST, KEY, ctxWith, png, rejection, req, type Call } from "./_byteplusFixture.ts";

test("Seedream generates synchronously and maps ratio and tier to the documented size", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith(
    [
      {
        body: {
          created: 1795000000,
          model: "dola-seedream-5-5-261028",
          data: [{ url: "https://ark-cdn/i.png", size: "2816x1584", output_format: "png" }],
          usage: { generated_images: 1 },
        },
      },
    ],
    calls,
  );
  const ref = await adapter.submit(
    ctx,
    req({
      model: "bytedance/seedream-5.5",
      task: "image-to-image",
      prompt: "make it red",
      resolution: "2K",
      aspectRatio: "16:9",
      inputs: [png("reference-image")],
    }),
  );
  assert.equal(calls[0]!.url, HOST + "/images/generations");
  assert.deepEqual(calls[0]!.body, {
    model: "dola-seedream-5-5-261028",
    prompt: "make it red",
    image: ["data:image/png;base64,iVA="],
    size: "2816x1584",
    response_format: "url",
    watermark: false,
  });
  const state = await adapter.poll(ctx, ref);
  assert.equal(calls.length, 1, "the synchronous result is not fetched again");
  assert.ok(state.status === "succeeded");
  assert.deepEqual(state.outputs, [
    {
      kind: "image",
      url: "https://ark-cdn/i.png",
      mimeType: "image/png",
      expiresAt: new Date((1795000000 + 86400) * 1000).toISOString(),
    },
  ]);
});

test("Seedream sequential generation and layer decomposition use their documented switches", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith(
    [
      {
        body: {
          created: 1,
          data: [
            { url: "https://c/1.jpeg" },
            { error: { code: "OutputImageSensitiveContentDetected", message: "m" } },
            { url: "https://c/3.jpeg" },
          ],
        },
      },
      {
        body: {
          created: 1,
          data: [
            { url: "https://c/base.png", z_index: 0 },
            { url: "https://c/l1.png", z_index: 1, name: "cat" },
          ],
        },
      },
    ],
    calls,
  );
  const seq = await adapter.submit(
    ctx,
    req({ model: "bytedance/seedream-v4", task: "text-to-image", prompt: "a storyboard", count: 3, resolution: "2K" }),
  );
  const seqBody = calls[0]!.body as Record<string, unknown>;
  assert.equal(seqBody.sequential_image_generation, "auto");
  assert.deepEqual(seqBody.sequential_image_generation_options, { max_images: 3 });
  assert.equal(seqBody.size, "2K");
  const seqState = await adapter.poll(ctx, seq);
  assert.ok(seqState.status === "succeeded");
  assert.equal(seqState.outputs.length, 2, "failed items are dropped, successes kept");
  const layers = await adapter.submit(
    ctx,
    req({
      model: "bytedance/seedream-5.5-layers",
      task: "image-segment",
      inputs: [png("source-image")],
      vendorOptions: { max_images: 8 },
    }),
  );
  assert.deepEqual(calls[1]!.body, {
    model: "dola-seedream-5-5-261028",
    image: "data:image/png;base64,iVA=",
    layer_decomposition: true,
    layer_decomposition_options: { max_images: 8 },
    response_format: "url",
    watermark: false,
  });
  const layerState = await adapter.poll(ctx, layers);
  assert.ok(layerState.status === "succeeded");
  assert.equal(layerState.outputs.length, 2);
});

test("Seedream fails the job when every image is rejected", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith(
    [{ body: { created: 1, data: [{ error: { code: "OutputImageSensitiveContentDetected", message: "m" } }] } }],
    calls,
  );
  const error = await rejection(
    adapter.submit(ctx, req({ model: "bytedance/seedream-4-5-edit", task: "text-to-image", prompt: "x" })),
  );
  assert.equal(error.detail.category, "moderation");
});

test("validateKey lists one task, a free read, and reports auth failures", async () => {
  const calls: Call[] = [];
  const ok = await adapter.validateKey(ctxWith([{ body: { items: [], total: 0 } }], calls));
  assert.deepEqual(ok, { ok: true });
  assert.equal(calls[0]!.url, HOST + "/contents/generations/tasks?page_num=1&page_size=1");
  assert.equal(calls[0]!.method, "GET");
  const bad = await adapter.validateKey(
    ctxWith([{ status: 401, body: { error: { code: "AuthenticationError", message: "bad " + KEY } } }], calls),
  );
  assert.equal(bad.ok, false);
  assert.ok(!String(bad.reason).includes(KEY));
});

test("credential names match the Ops key file", () => {
  assert.deepEqual(adapter.credential.envVars, ["ARK_API_KEY"]);
  assert.equal(adapter.credential.keyVocabulary, "byteplus");
  assert.equal(adapter.credential.configKey, "byteplusApiKey");
  assert.equal(adapter.errorPrefix, "BYTEPLUS");
  assert.equal(adapter.inputTransport, "inline");
});
