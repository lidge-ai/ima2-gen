// BytePlus ModelArk direct adapter (Seedance video, Seedream image). Every case
// drives the adapter through a fake ctx.fetch and checks the wire shape the
// official API reference describes (docs.byteplus.com/en/docs/ModelArk, 2026-11-26).
import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/byteplus/index.ts";
import { HOST, KEY, ctxWith, png, rejection, req, type Call } from "./_byteplusFixture.ts";
import type { MediaSubmitRequest } from "../lib/providers/media/contract.ts";

test("catalog covers the Sume Seedance and Seedream ids with ModelArk wire ids and cited prices", () => {
  const byId = new Map(adapter.listModels().map((m) => [m.id, m]));
  assert.deepEqual([...byId.keys()].sort(), [
    "bytedance/seedance-2",
    "bytedance/seedance-2-fast",
    "bytedance/seedance-2-mini",
    "bytedance/seedance-2.5",
    "bytedance/seedance-2.5-flash",
    "bytedance/seedream-4-5-edit",
    "bytedance/seedream-5-lite",
    "bytedance/seedream-5-pro",
    "bytedance/seedream-5.5",
    "bytedance/seedream-5.5-layers",
    "bytedance/seedream-v4",
  ]);
  assert.equal(byId.get("bytedance/seedance-2.5")?.upstreamId, "dreamina-seedance-2-5-260628");
  assert.equal(byId.get("bytedance/seedance-2.5-flash")?.upstreamId, "dreamina-seedance-2-5-flash-261115");
  assert.equal(byId.get("bytedance/seedance-2-mini")?.upstreamId, "dreamina-seedance-2-0-mini-260615");
  assert.equal(byId.get("bytedance/seedream-5.5-layers")?.upstreamId, "dola-seedream-5-5-261028");
  for (const m of byId.values()) {
    assert.equal(m.vendor, "bytedance");
    assert.ok(m.pricing.length > 0, m.id + " has an official price");
    for (const p of m.pricing) {
      assert.equal(p.source, "https://docs.byteplus.com/en/docs/ModelArk/model-pricing");
      assert.equal(p.checkedAt, "2026-11-26");
    }
  }
  const s25 = byId.get("bytedance/seedance-2.5")!;
  assert.deepEqual(s25.pricing.find((p) => p.variant?.startsWith("720p"))?.usd, 0.231);
});

test("Seedance text-to-video posts the documented task body with the bearer key", async () => {
  const calls: Call[] = [];
  const ref = await adapter.submit(
    ctxWith([{ body: { id: "cgt-20261126-abc" } }], calls),
    req({
      model: "bytedance/seedance-2.5",
      task: "text-to-video",
      prompt: "a kitten yawns",
      durationSec: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      audio: false,
    }),
  );
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, HOST + "/contents/generations/tasks");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("authorization"), "Bearer " + KEY);
  assert.deepEqual(call.body, {
    model: "dreamina-seedance-2-5-260628",
    content: [{ type: "text", text: "a kitten yawns" }],
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    generate_audio: false,
    watermark: false,
  });
  assert.equal(ref.providerJobId, "cgt-20261126-abc");
  assert.equal(ref.resume?.kind, "video");
});

test("first and last frames become image_url items with their roles; bytes travel as data URIs", async () => {
  const calls: Call[] = [];
  await adapter.submit(
    ctxWith([{ body: { id: "cgt-1" } }], calls),
    req({
      model: "bytedance/seedance-2",
      task: "image-to-video",
      prompt: "pan left",
      inputs: [png("first-frame"), { role: "last-frame", url: "https://example.com/end.png", mimeType: "image/png" }],
    }),
  );
  const body = calls[0]!.body as { content: unknown[] };
  assert.deepEqual(body.content, [
    { type: "text", text: "pan left" },
    { type: "image_url", image_url: { url: "data:image/png;base64,iVA=" }, role: "first_frame" },
    { type: "image_url", image_url: { url: "https://example.com/end.png" }, role: "last_frame" },
  ]);
});

test("Seedance 2.5 reference and edit tasks set the documented omni_reference_task_type", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith([{ body: { id: "cgt-r" } }, { body: { id: "cgt-e" } }], calls);
  await adapter.submit(
    ctx,
    req({
      model: "bytedance/seedance-2.5",
      task: "reference-to-video",
      prompt: "use @image1",
      inputs: [
        png("reference-image"),
        { role: "reference-video", url: "https://example.com/ref.mp4", mimeType: "video/mp4" },
        { role: "reference-audio", url: "https://example.com/voice.wav", mimeType: "audio/wav" },
      ],
    }),
  );
  const first = calls[0]!.body as Record<string, unknown>;
  assert.equal(first.omni_reference_task_type, "reference");
  assert.deepEqual((first.content as unknown[]).slice(1), [
    { type: "image_url", image_url: { url: "data:image/png;base64,iVA=" }, role: "reference_image" },
    { type: "video_url", video_url: { url: "https://example.com/ref.mp4" }, role: "reference_video" },
    { type: "audio_url", audio_url: { url: "https://example.com/voice.wav" }, role: "reference_audio" },
  ]);
  await adapter.submit(
    ctx,
    req({
      model: "bytedance/seedance-2.5",
      task: "video-to-video",
      prompt: "make it night",
      inputs: [{ role: "source-video", url: "https://example.com/src.mp4", mimeType: "video/mp4" }],
    }),
  );
  const edit = calls[1]!.body as Record<string, unknown>;
  assert.equal(edit.omni_reference_task_type, "edit");
  assert.equal(edit.ratio, "adaptive");
  assert.equal(edit.duration, -1);
});

test("region and baseUrl select the host", async () => {
  const calls: Call[] = [];
  await adapter.submit(
    ctxWith([{ body: { id: "cgt-eu" } }], calls, { region: "eu-west-1" }),
    req({ model: "bytedance/seedance-2-mini", task: "text-to-video", prompt: "x" }),
  );
  assert.equal(calls[0]!.url, "https://ark.eu-west.bytepluses.com/api/v3/contents/generations/tasks");
  const ctx = ctxWith([{ body: { id: "cgt-b" } }], calls);
  ctx.baseUrl = "https://proxy.example.com/api/v3/";
  await adapter.submit(ctx, req({ model: "bytedance/seedance-2-mini", task: "text-to-video", prompt: "x" }));
  assert.equal(calls[1]!.url, "https://proxy.example.com/api/v3/contents/generations/tasks");
  await assert.rejects(
    adapter.submit(
      ctxWith([], calls, { region: "mars-1" }),
      req({ model: "bytedance/seedance-2-mini", task: "text-to-video", prompt: "x" }),
    ),
    /region/,
  );
});

test("requests the model cannot take are refused before any network call", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith([], calls);
  const cases: Array<[MediaSubmitRequest, string]> = [
    [
      req({ model: "bytedance/seedance-2.5-flash", task: "text-to-video", prompt: "x", resolution: "1080p" }),
      "BYTEPLUS_INVALID_PARAM",
    ],
    [
      req({ model: "bytedance/seedance-2", task: "text-to-video", prompt: "x", durationSec: 20 }),
      "BYTEPLUS_INVALID_PARAM",
    ],
    [req({ model: "bytedance/seedance-2", task: "text-to-video", prompt: "x", seed: 7 }), "BYTEPLUS_INVALID_PARAM"],
    [req({ model: "bytedance/seedance-2", task: "text-to-video", prompt: "x", count: 2 }), "BYTEPLUS_INVALID_PARAM"],
    [
      req({ model: "bytedance/seedance-2", task: "text-to-video", prompt: "x", vendorOptions: { camera_fixed: true } }),
      "BYTEPLUS_UNKNOWN_OPTION",
    ],
    [req({ model: "bytedance/seedance-2", task: "image-to-video", prompt: "x" }), "BYTEPLUS_INPUT_MISSING"],
    [
      req({
        model: "bytedance/seedance-2",
        task: "reference-to-video",
        prompt: "x",
        inputs: [{ role: "reference-audio", url: "https://e/a.wav", mimeType: "audio/wav" }],
      }),
      "BYTEPLUS_INPUT_INVALID",
    ],
    [
      req({
        model: "bytedance/seedance-2",
        task: "reference-to-video",
        prompt: "x",
        inputs: Array.from({ length: 10 }, () => png("reference-image")),
      }),
      "BYTEPLUS_INPUT_INVALID",
    ],
    [
      req({
        model: "bytedance/seedance-2.5",
        task: "reference-to-video",
        prompt: "x",
        inputs: [{ role: "reference-video", bytes: new Uint8Array([0]), mimeType: "video/mp4" }],
      }),
      "BYTEPLUS_INPUT_URL_REQUIRED",
    ],
    [
      req({
        model: "bytedance/seedance-2.5",
        task: "video-to-video",
        prompt: "x",
        durationSec: 5,
        inputs: [{ role: "source-video", url: "https://e/v.mp4", mimeType: "video/mp4" }],
      }),
      "BYTEPLUS_INVALID_PARAM",
    ],
    [req({ model: "bytedance/seedance-2.5", task: "text-to-image", prompt: "x" }), "BYTEPLUS_UNSUPPORTED_TASK"],
    [req({ model: "bytedance/seedream-5.5", task: "text-to-image", prompt: "x", count: 2 }), "BYTEPLUS_INVALID_PARAM"],
    [req({ model: "bytedance/not-a-model", task: "text-to-video", prompt: "x" }), "BYTEPLUS_UNKNOWN_MODEL"],
  ];
  for (const [request, code] of cases) {
    const error = await rejection(adapter.submit(ctx, request));
    assert.equal(error.detail.code, code, JSON.stringify(request));
    assert.equal(error.detail.category, "invalid-request");
  }
  assert.equal(calls.length, 0);
});

test("poll maps every documented task status", async () => {
  const calls: Call[] = [];
  const job = { providerJobId: "cgt-p", resume: { kind: "video", baseUrl: HOST } };
  const ctx = ctxWith(
    [
      { body: { id: "cgt-p", status: "queued" } },
      { body: { id: "cgt-p", status: "running" } },
      {
        body: {
          id: "cgt-p",
          status: "succeeded",
          updated_at: 1795000000,
          content: { video_url: "https://ark-cdn/x.mp4?sig=1", last_frame_url: "https://ark-cdn/last.jpeg" },
          usage: { completion_tokens: 102960, total_tokens: 102960 },
        },
      },
      {
        body: {
          id: "cgt-p",
          status: "failed",
          error: { code: "OutputVideoSensitiveContentDetected", message: "may contain sensitive information" },
        },
      },
      { body: { id: "cgt-p", status: "expired" } },
      { body: { id: "cgt-p", status: "cancelled" } },
    ],
    calls,
  );
  assert.deepEqual(await adapter.poll(ctx, job), { status: "queued" });
  assert.deepEqual(await adapter.poll(ctx, job), { status: "running" });
  const done = await adapter.poll(ctx, job);
  assert.equal(calls[0]!.url, HOST + "/contents/generations/tasks/cgt-p");
  assert.equal(calls[0]!.method, "GET");
  assert.ok(done.status === "succeeded");
  assert.deepEqual(done.outputs[0], {
    kind: "video",
    url: "https://ark-cdn/x.mp4?sig=1",
    mimeType: "video/mp4",
    expiresAt: new Date((1795000000 + 86400) * 1000).toISOString(),
  });
  assert.equal(done.outputs[1]?.kind, "image");
  assert.equal(done.outputs[1]?.mimeType, "image/jpeg");
  assert.deepEqual(done.billed, { units: 102.96, unit: "1k-tokens" });
  const failed = await adapter.poll(ctx, job);
  assert.ok(failed.status === "failed");
  assert.equal(failed.error.category, "moderation");
  assert.equal(failed.error.providerState, "OutputVideoSensitiveContentDetected");
  const expired = await adapter.poll(ctx, job);
  assert.ok(expired.status === "failed");
  assert.equal(expired.error.code, "BYTEPLUS_EXPIRED");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "canceled" });
});

test("cancel deletes the queued task", async () => {
  const calls: Call[] = [];
  await adapter.cancel!(ctxWith([{ body: null }], calls), {
    providerJobId: "cgt-c",
    resume: { kind: "video", baseUrl: HOST },
  });
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(calls[0]!.url, HOST + "/contents/generations/tasks/cgt-c");
});

test("HTTP errors map to categories without leaking the key", async () => {
  const cases: Array<[number, string, string, string, boolean]> = [
    [401, "AuthenticationError", "auth", "BYTEPLUS_AUTH", false],
    [403, "AccountOverdueError", "quota", "BYTEPLUS_QUOTA", false],
    [404, "ModelNotOpen", "auth", "BYTEPLUS_MODEL_NOT_ACTIVATED", false],
    [429, "ServerOverloaded", "rate-limit", "BYTEPLUS_RATE_LIMIT", true],
    [429, "SetLimitExceeded", "quota", "BYTEPLUS_QUOTA", false],
    [400, "InputImageSensitiveContentDetected.PrivacyInformation", "moderation", "BYTEPLUS_REAL_PERSON_BLOCKED", false],
    [400, "InputVideoSensitiveContentDetected.PrivacyInformation", "moderation", "BYTEPLUS_REAL_PERSON_BLOCKED", false],
    [400, "OutputVideoSensitiveContentDetected", "moderation", "BYTEPLUS_MODERATION", false],
    [400, "InvalidParameter", "invalid-request", "BYTEPLUS_INVALID_REQUEST", false],
    [500, "InternalServiceError", "upstream", "BYTEPLUS_UPSTREAM", true],
  ];
  for (const [status, code, category, ours, retryable] of cases) {
    const calls: Call[] = [];
    const ctx = ctxWith(
      [{ status, body: { error: { code, message: "rejected Bearer " + KEY + " key " + KEY, type: "X" } } }],
      calls,
    );
    const error = await rejection(
      adapter.submit(ctx, req({ model: "bytedance/seedance-2", task: "text-to-video", prompt: "x" })),
    );
    assert.equal(error.detail.category, category, code);
    assert.equal(error.detail.code, ours, code);
    assert.equal(error.detail.retryable, retryable, code);
    assert.equal(error.detail.status, status);
    assert.equal(error.detail.providerState, code);
    assert.ok(!error.detail.message.includes(KEY), "message leaks the key");
    assert.ok(!JSON.stringify(adapter.normalizeError(error)).includes(KEY));
  }
});

test("asset:// ids pass through untouched as the official real-person route", async () => {
  const calls: Call[] = [];
  await adapter.submit(
    ctxWith([{ body: { id: "cgt-a" } }], calls),
    req({
      model: "bytedance/seedance-2.5",
      task: "reference-to-video",
      prompt: "the character waves",
      inputs: [
        { role: "reference-image", url: "asset://asset-20260410114236-8cdfz", mimeType: "image/png" },
        { role: "reference-video", url: "asset://asset-20260410114236-v1dx0", mimeType: "video/mp4" },
      ],
    }),
  );
  const content = (calls[0]!.body as { content: unknown[] }).content;
  assert.deepEqual(content.slice(1), [
    { type: "image_url", image_url: { url: "asset://asset-20260410114236-8cdfz" }, role: "reference_image" },
    { type: "video_url", video_url: { url: "asset://asset-20260410114236-v1dx0" }, role: "reference_video" },
  ]);
  const error = await rejection(
    adapter.submit(
      ctxWith([], calls),
      req({
        model: "bytedance/seedance-2.5",
        task: "reference-to-video",
        prompt: "x",
        inputs: [{ role: "reference-image", url: "ftp://example.com/a.png", mimeType: "image/png" }],
      }),
    ),
  );
  assert.equal(error.detail.code, "BYTEPLUS_INPUT_INVALID");
});

test("a real-person block names the official alternatives, on submit and on a failed task", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith(
    [
      {
        status: 400,
        body: {
          error: {
            code: "InputImageSensitiveContentDetected.PrivacyInformation",
            message: "The request failed because the input image may contain real person.",
          },
        },
      },
      {
        body: {
          id: "cgt-f",
          status: "failed",
          error: { code: "InputVideoSensitiveContentDetected.PrivacyInformation", message: "may contain real person" },
        },
      },
    ],
    calls,
  );
  const submitError = await rejection(
    adapter.submit(
      ctx,
      req({ model: "bytedance/seedance-2", task: "reference-to-video", prompt: "x", inputs: [png("reference-image")] }),
    ),
  );
  for (const detail of [submitError.detail]) {
    assert.equal(detail.code, "BYTEPLUS_REAL_PERSON_BLOCKED");
    assert.equal(detail.category, "moderation");
    assert.equal(detail.retryable, false);
    assert.match(detail.message, /asset:\/\//);
    assert.match(detail.message, /30 days/);
    assert.match(detail.message, /seedance-portrait-asset-guide/);
  }
  const state = await adapter.poll(ctx, { providerJobId: "cgt-f", resume: { kind: "video", baseUrl: HOST } });
  assert.ok(state.status === "failed");
  assert.equal(state.error.code, "BYTEPLUS_REAL_PERSON_BLOCKED");
});

test("upstream text that echoes the key is masked on failed tasks and per-image errors", async () => {
  const calls: Call[] = [];
  const ctx = ctxWith(
    [
      {
        body: {
          id: "cgt-k",
          status: "failed",
          error: { code: "Weird." + KEY, message: "task failed for Bearer " + KEY + " key=" + KEY },
        },
      },
      {
        body: {
          created: 1,
          data: [{ error: { code: "OutputImageSensitiveContentDetected", message: "denied " + KEY } }],
        },
      },
    ],
    calls,
  );
  const state = await adapter.poll(ctx, { providerJobId: "cgt-k", resume: { kind: "video", baseUrl: HOST } });
  assert.ok(state.status === "failed");
  assert.ok(!JSON.stringify(state).includes(KEY), "failed task state leaks the key");
  const error = await rejection(
    adapter.submit(ctx, req({ model: "bytedance/seedream-v4", task: "text-to-image", prompt: "x" })),
  );
  assert.ok(!JSON.stringify(error.detail).includes(KEY), "per-image error leaks the key");
  assert.ok(!JSON.stringify(adapter.normalizeError(error)).includes(KEY));
});
