import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/pixverse.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const request: MediaSubmitRequest = {
  model: "pixverse/pixverse-v6",
  task: "text-to-video",
  prompt: "hello",
  durationSec: 5,
  resolution: "720p",
  aspectRatio: "16:9",
  audio: true,
  inputs: [],
};
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = {
    apiKey: "secret-key-123",
    baseUrl: "https://fake.test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status });
    },
  };
  return { ctx, calls };
}
test("V6 and C1 use documented text generation wire format", async () => {
  for (const model of ["v6", "c1"]) {
    const { ctx, calls } = fake({ ErrCode: 0, Resp: { video_id: 123 } });
    assert.equal(
      (await adapter.submit(ctx, { ...request, model: `pixverse/pixverse-${model}` })).providerJobId,
      "123",
    );
    assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/video/text/generate");
    assert.equal(calls[0]?.init.method, "POST");
    const headers = new Headers(calls[0]?.init.headers);
    assert.equal(headers.get("API-KEY"), "secret-key-123");
    assert.match(headers.get("Ai-trace-id") ?? "", /^[a-f0-9-]{36}$/);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      model,
      prompt: "hello",
      duration: 5,
      quality: "720p",
      aspect_ratio: "16:9",
      generate_audio_switch: true,
    });
  }
});
test("image upload and image generation use image id", async () => {
  const { ctx, calls } = fake({ ErrCode: 0, Resp: { img_id: 42, video_id: 123 } });
  const uploaded = await adapter.uploadInput!(ctx, {
    role: "first-frame",
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2]),
  });
  assert.equal(uploaded.url, "pixverse:image:42");
  assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/image/upload");
  assert.ok(calls[0]?.init.body instanceof FormData);
  await adapter.submit(ctx, {
    ...request,
    task: "image-to-video",
    aspectRatio: undefined,
    inputs: [{ role: "first-frame", mimeType: "image/png", url: uploaded.url }],
  });
  assert.equal(calls[1]?.url, "https://fake.test/openapi/v2/video/img/generate");
  assert.equal(JSON.parse(String(calls[1]?.init.body)).img_id, 42);
});
test("poll processes status and validates result", async () => {
  for (const [status, expected] of [
    [5, "running"],
    [1, "succeeded"],
    [7, "failed"],
    [8, "failed"],
  ] as const) {
    const { ctx, calls } = fake({ ErrCode: 0, Resp: { status, url: "https://cdn.test/a.mp4" } });
    const result = await adapter.poll(ctx, { providerJobId: "123" });
    assert.equal(result.status, expected);
    assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/video/result/123");
    if (result.status === "succeeded")
      assert.deepEqual(result.outputs, [
        { kind: "video", mimeType: "video/mp4", url: "https://cdn.test/a.mp4" },
      ]);
    if (result.status === "failed")
      assert.equal(result.error.category, status === 7 ? "moderation" : "upstream");
  }
});
test("HTTP and vendor errors are classified and redact secrets", async () => {
  for (const [status, category] of [
    [401, "auth"],
    [403, "auth"],
    [429, "rate-limit"],
    [500, "upstream"],
  ] as const) {
    const { ctx } = fake({ message: "secret-key-123" }, status);
    await assert.rejects(adapter.submit(ctx, request), (e) => {
      const error = adapter.normalizeError(e);
      assert.equal(error.category, category);
      assert.equal(error.code, `PIXVERSE_HTTP_${status}`);
      assert.equal(error.retryable, status === 429 || status === 500);
      assert.ok(!error.message.includes(ctx.apiKey));
      return true;
    });
  }
  for (const [code, category] of [
    [10004, "auth"],
    [400017, "invalid-request"],
    [500044, "rate-limit"],
    [500090, "quota"],
  ] as const) {
    const { ctx } = fake({ ErrCode: code, ErrMsg: "secret-key-123" });
    await assert.rejects(adapter.submit(ctx, request), (e) => {
      const error = adapter.normalizeError(e);
      assert.equal(error.category, category);
      assert.equal(error.code, `PIXVERSE_VENDOR_${code}`);
      assert.equal(error.retryable, code === 500044);
      assert.ok(!error.message.includes(ctx.apiKey));
      return true;
    });
  }
});
test("rejects unknown options and unsupported parameters", async () => {
  const { ctx } = fake({ ErrCode: 0 });
  for (const bad of [
    { vendorOptions: { bad: true } },
    { task: "image-upscale" as const },
    { durationSec: 16 },
    { negativePrompt: "bad" },
    { count: 2 },
  ])
    await assert.rejects(adapter.submit(ctx, { ...request, ...bad }));
});
test("catalog and free key validation conform to contract", async () => {
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^[a-z0-9-]+\/[a-z0-9-]+$/);
    for (const price of model.pricing) {
      assert.match(price.source, /^https:\/\//);
      assert.match(price.checkedAt, /^\d{4}-\d\d-\d\d$/);
    }
  }
  const { ctx, calls } = fake({ ErrCode: 0, Resp: { credit_package: 1 } });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/account/balance");
  assert.equal(calls[0]?.init.method, "GET");
});

test("normalizing unknown errors cannot expose credentials", () => {
  for (const error of ["secret-key-123", new Error("secret-key-123")])
    assert.ok(!adapter.normalizeError(error).message.includes("secret-key-123"));
});

test("validation errors redact a key supplied as a model or option name", async () => {
  const { ctx } = fake({ ErrCode: 0 });
  for (const bad of [{ model: ctx.apiKey }, { vendorOptions: { [ctx.apiKey]: true } }]) {
    await assert.rejects(adapter.submit(ctx, { ...request, ...bad }), (error) => {
      assert.ok(!String(error).includes(ctx.apiKey));
      assert.ok(!adapter.normalizeError(error).message.includes(ctx.apiKey));
      return true;
    });
  }
});

test("lipsync accepts uploaded video and audio and supports TTS", async () => {
  const { ctx, calls } = fake({ ErrCode: 0, Resp: { video_id: 123, media_id: 42 } });
  const video = await adapter.uploadInput!(ctx, {
    role: "source-video",
    mimeType: "video/mp4",
    bytes: new Uint8Array([1]),
  });
  const audio = await adapter.uploadInput!(ctx, {
    role: "source-audio",
    mimeType: "audio/mpeg",
    url: "https://example.test/a.mp3",
  });
  assert.equal(video.url, "pixverse:media:42");
  assert.equal(audio.url, "pixverse:media:42");
  assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/media/upload");
  assert.ok((calls[0]?.init.body as FormData).get("file") instanceof Blob);
  assert.equal((calls[1]?.init.body as FormData).get("file_url"), "https://example.test/a.mp3");
  const base: MediaSubmitRequest = {
    model: "pixverse/pixverse-lipsync",
    task: "lipsync",
    inputs: [
      { role: "source-video", mimeType: "video/mp4", url: video.url },
      { role: "source-audio", mimeType: "audio/mpeg", url: audio.url },
    ],
  };
  await adapter.submit(ctx, base);
  assert.equal(calls[2]?.url, "https://fake.test/openapi/v2/video/lip_sync/generate");
  assert.deepEqual(JSON.parse(String(calls[2]?.init.body)), { video_media_id: 42, audio_media_id: 42 });
  await adapter.submit(ctx, {
    ...base,
    inputs: base.inputs.slice(0, 1),
    vendorOptions: { lip_sync_tts_speaker_id: "14", lip_sync_tts_content: "hello" },
  });
  assert.deepEqual(JSON.parse(String(calls[3]?.init.body)), {
    video_media_id: 42,
    lip_sync_tts_speaker_id: "14",
    lip_sync_tts_content: "hello",
  });
  for (const bad of [
    { inputs: [] },
    { vendorOptions: { lip_sync_tts_content: "hello" } },
    { vendorOptions: { lip_sync_tts_content: "hello", lip_sync_tts_speaker_id: "14" } },
    { durationSec: 5 },
  ])
    await assert.rejects(adapter.submit(ctx, { ...base, ...bad }));
});

test("extend is V6 only and uses a source video", async () => {
  const { ctx, calls } = fake({ ErrCode: 0, Resp: { video_id: 123 } });
  const req: MediaSubmitRequest = {
    model: "pixverse/pixverse-v6",
    task: "video-extend",
    prompt: "continue",
    durationSec: 5,
    resolution: "720p",
    inputs: [{ role: "source-video", mimeType: "video/mp4", url: "pixverse:media:42" }],
  };
  await adapter.submit(ctx, req);
  assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/video/extend/generate");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: "v6",
    prompt: "continue",
    duration: 5,
    quality: "720p",
    video_media_id: 42,
  });
  await assert.rejects(adapter.submit(ctx, { ...req, model: "pixverse/pixverse-c1" }));
  await assert.rejects(adapter.submit(ctx, { ...req, aspectRatio: "16:9" }));
});

test("fusion maps image and V6 video references to documented payloads", async () => {
  const { ctx, calls } = fake({ ErrCode: 0, Resp: { video_id: 123 } });
  const base: MediaSubmitRequest = {
    model: "pixverse/pixverse-c1",
    task: "reference-to-video",
    prompt: "scene",
    durationSec: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    inputs: [{ role: "reference-image", mimeType: "image/png", url: "pixverse:image:42" }],
  };
  await adapter.submit(ctx, base);
  assert.equal(calls[0]?.url, "https://fake.test/openapi/v2/video/fusion/generate");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: "c1",
    prompt: "scene",
    duration: 5,
    quality: "720p",
    aspect_ratio: "16:9",
    image_references: [{ img_id: 42 }],
  });
  await adapter.submit(ctx, {
    ...base,
    model: "pixverse/pixverse-v6",
    durationSec: 0,
    inputs: [{ role: "reference-video", mimeType: "video/mp4", url: "pixverse:media:77" }],
  });
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {
    model: "v6",
    prompt: "scene",
    duration: 0,
    quality: "720p",
    aspect_ratio: "16:9",
    video_references: [{ video_media_id: 77 }],
    reference_mode: "omni",
  });
  await assert.rejects(adapter.submit(ctx, { ...base, inputs: [] }));
  await assert.rejects(
    adapter.submit(ctx, {
      ...base,
      inputs: [{ role: "reference-video", mimeType: "video/mp4", url: "pixverse:media:77" }],
    }),
  );
});

test("error prefix matches the adapter contract", () => {
  assert.equal(adapter.errorPrefix, "PIXVERSE");
  assert.ok(adapter.normalizeError(new Error("x")).code.startsWith(adapter.errorPrefix + "_"));
});
