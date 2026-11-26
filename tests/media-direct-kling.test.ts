import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/kling/index.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const base: MediaSubmitRequest = {
  model: "kling/kling-image-3",
  task: "text-to-image",
  prompt: "test",
  inputs: [],
};
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = {
    apiKey: "access-secret-test",
    extra: { secretKey: "secret-key-test" },
    baseUrl: "https://example.test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  };
  return { ctx, calls };
}
test("legacy image and video submission use signed requests", async () => {
  for (const [model, task, path, wire] of [
    ["kling/kling-image-3", "text-to-image", "/v1/images/generations", "kling-v3"],
    ["kling/kling-2.6", "text-to-video", "/v1/videos/text2video", "kling-v2-6"],
    ["kling/kling-3", "text-to-video", "/v1/videos/text2video", "kling-v3"],
  ] as const) {
    const { ctx, calls } = fake({ code: 0, data: { task_id: "id1" } });
    const job = await adapter.submit(ctx, { ...base, model, task });
    assert.equal(job.providerJobId, "id1");
    assert.equal(calls[0]?.url, `https://example.test${path}`);
    assert.equal(calls[0]?.init.method, "POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.match(headers.authorization, /^Bearer eyJ/);
    assert.equal(headers["content-type"], "application/json");
    assert.equal(JSON.parse(String(calls[0]?.init.body)).model_name, wire);
  }
});
test("poll transitions and outputs", async () => {
  for (const [state, expected] of [
    ["submitted", "queued"],
    ["processing", "running"],
    ["succeed", "succeeded"],
    ["failed", "failed"],
  ] as const) {
    const { ctx } = fake({
      code: 0,
      data: {
        task_status: state,
        task_status_msg: "failed",
        task_result: { images: [{ url: "https://example.test/a.png" }] },
      },
    });
    const result = await adapter.poll(ctx, {
      providerJobId: "id",
      resume: { path: "/v1/images/generations", kind: "image" },
    });
    assert.equal(result.status, expected);
    if (result.status === "succeeded")
      assert.deepEqual(result.outputs, [
        { kind: "image", url: "https://example.test/a.png", mimeType: "image/png" },
      ]);
  }
});
test("errors classify status and redact credentials", async () => {
  for (const [status, category] of [
    [401, "auth"],
    [403, "auth"],
    [429, "rate-limit"],
    [500, "upstream"],
  ] as const) {
    const { ctx } = fake(
      { message: "access-secret-test secret-key-test Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk" },
      status,
    );
    await assert.rejects(adapter.submit(ctx, base), (error) => {
      const result = adapter.normalizeError(error);
      assert.equal(result.category, category);
      assert.equal(result.retryable, status >= 429);
      assert.match(result.code, /^KLING_/);
      assert.doesNotMatch(result.message, /access-secret-test|secret-key-test|eyJabcdefghijk/);
      return true;
    });
  }
});
test("catalog metadata and invalid input", async () => {
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^kling\//);
    for (const price of model.pricing) {
      assert.match(price.source, /^https:/);
      assert.match(price.checkedAt, /^\d{4}-\d\d-\d\d$/);
    }
  }
  const { ctx } = fake({ code: 0 });
  await assert.rejects(adapter.submit(ctx, { ...base, vendorOptions: { unknown: true } }));
  await assert.rejects(adapter.submit(ctx, { ...base, task: "lipsync" }));
  await assert.rejects(adapter.submit(ctx, { ...base, seed: 5 }));
});
test("validateKey only queries tasks", async () => {
  const { ctx, calls } = fake({ code: 0, data: [] });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.init.method, "GET");
  assert.match(calls[0]?.url ?? "", /\/v1\/images\/generations\?/);
});
test("vendor service codes classify even when sent in an HTTP 200 envelope", async () => {
  for (const [code, category, retryable] of [
    [1002, "auth", false],
    [1102, "quota", false],
    [1201, "invalid-request", false],
    [1301, "moderation", false],
    [1302, "rate-limit", true],
    [5000, "upstream", true],
  ] as const) {
    const { ctx } = fake({ code, message: "secret-key-test access-secret-test" });
    await assert.rejects(adapter.submit(ctx, base), (error) => {
      const detail = adapter.normalizeError(error);
      assert.equal(detail.code, `KLING_VENDOR_${code}`);
      assert.equal(detail.category, category);
      assert.equal(detail.retryable, retryable);
      assert.doesNotMatch(detail.message, /secret-key-test|access-secret-test/);
      return true;
    });
  }
});

test("legacy JWT is deterministic HS256 with documented claims", async (t) => {
  const { createHmac } = await import("node:crypto");
  t.mock.method(Date, "now", () => 1_700_000_000_000);
  const { ctx, calls } = fake({ code: 0, data: { task_id: "1" } });
  await adapter.submit(ctx, base);
  const auth = (calls[0]!.init.headers as Record<string, string>).authorization!;
  const [header, payload, signature] = auth.slice(7).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload!, "base64url").toString()), {
    iss: ctx.apiKey,
    exp: 1700001800,
    nbf: 1699999995,
  });
  assert.equal(
    signature,
    createHmac("sha256", "secret-key-test").update(`${header}.${payload}`).digest("base64url"),
  );
});

test("all newly supported models use the expected endpoint and authentication", async () => {
  for (const [model, path, modern] of [
    ["kling/kling-4", "/text-to-video/kling-4.0", true],
    ["kling/kling-3-turbo", "/text-to-video/kling-3.0-turbo", true],
    ["kling/kling-o1", "/v1/videos/omni-video", false],
    ["kling/kling-3-omni", "/v1/videos/omni-video", false],
    ["kling/kling-image-o1", "/v1/images/omni-image", false],
    ["kling/kling-image-3-omni", "/v1/images/omni-image", false],
  ] as const) {
    const { ctx, calls } = fake({ code: 0, data: { task_id: "legacy", id: "modern" } });
    ctx.extra = { secretKey: "secret-key-test", apiKey: "modern-secret-test" };
    const image = model.includes("image-");
    await adapter.submit(ctx, { ...base, model, task: image ? "text-to-image" : "text-to-video" });
    assert.equal(calls[0]?.url, `https://example.test${path}`);
    const auth = (calls[0]!.init.headers as Record<string, string>).authorization!;
    if (modern) assert.equal(auth, "Bearer modern-secret-test");
    else assert.match(auth, /^Bearer eyJ/);
  }
});

test("legacy first and last frame are mapped", async () => {
  for (const model of ["kling/kling-2.6", "kling/kling-3"]) {
    const { ctx, calls } = fake({ code: 0, data: { task_id: "id" } });
    await adapter.submit(ctx, {
      model,
      task: "image-to-video",
      prompt: "go",
      inputs: [
        { role: "first-frame", url: "https://example.test/first.png", mimeType: "image/png" },
        { role: "last-frame", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
      ],
    });
    assert.equal(calls[0]?.url, "https://example.test/v1/videos/image2video");
    const body = JSON.parse(String(calls[0]?.init.body));
    assert.equal(body.image, "https://example.test/first.png");
    assert.equal(body.image_tail, "AQI=");
  }
});

test("missing credentials fail before network with stable code", async () => {
  for (const [model, extra, missing] of [
    ["kling/kling-4", {}, "KLING_API_KEY"],
    ["kling/kling-3", {}, "KLING_SECRET_KEY"],
  ] as const) {
    const { ctx, calls } = fake({});
    ctx.extra = extra;
    await assert.rejects(adapter.submit(ctx, { ...base, model, task: "text-to-video" }), (error) => {
      const d = adapter.normalizeError(error);
      assert.equal(d.code, "KLING_CREDENTIAL_MISSING");
      assert.equal(d.category, "auth");
      assert.equal(d.retryable, false);
      assert.match(d.message, new RegExp(missing));
      return true;
    });
    assert.equal(calls.length, 0);
  }
});

test("modern poll and secret redaction", async () => {
  const { ctx } = fake({
    code: 0,
    data: [
      { id: "1", status: "succeeded", outputs: [{ type: "video", url: "https://example.test/out.mp4" }] },
    ],
  });
  ctx.extra = { apiKey: "modern-secret-test", secretKey: "secret-key-test" };
  const result = await adapter.poll(ctx, {
    providerJobId: "1",
    resume: { path: "/tasks", kind: "video", auth: "apiKey" },
  });
  assert.deepEqual(result, {
    status: "succeeded",
    outputs: [{ kind: "video", url: "https://example.test/out.mp4", mimeType: "video/mp4" }],
  });
  const bad = fake({ code: 1002, message: "modern-secret-test secret-key-test access-secret-test" }, 401);
  bad.ctx.extra = ctx.extra;
  await assert.rejects(
    adapter.submit(bad.ctx, { ...base, model: "kling/kling-4", task: "text-to-video" }),
    (error) => {
      assert.doesNotMatch(
        adapter.normalizeError(error).message,
        /modern-secret-test|secret-key-test|access-secret-test/,
      );
      return true;
    },
  );
});

test("Kling 4 omni sends reference contents to the documented endpoint", async () => {
  const { ctx, calls } = fake({ code: 0, data: { id: "id" } });
  ctx.extra = { apiKey: "modern-secret-test" };
  await adapter.submit(ctx, {
    model: "kling/kling-4-omni",
    task: "reference-to-video",
    prompt: "Use @image1",
    inputs: [{ role: "reference-image", url: "https://example.test/a.png", mimeType: "image/png" }],
  });
  assert.equal(calls[0]?.url, "https://example.test/omni-video/kling-4.0");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).contents[1], {
    type: "refer_image",
    url: "https://example.test/a.png",
    id: "image1",
  });
});

test("lip sync uses an existing face recognition session", async () => {
  const { ctx, calls } = fake({ code: 0, data: { task_id: "id" } });
  await adapter.submit(ctx, {
    model: "kling/kling-lipsync",
    task: "lipsync",
    inputs: [{ role: "source-audio", url: "https://example.test/a.mp3", mimeType: "audio/mpeg" }],
    vendorOptions: {
      sessionId: "session",
      faceId: "0",
      soundStartTime: 0,
      soundEndTime: 3000,
      soundInsertTime: 0,
    },
  });
  assert.equal(calls[0]?.url, "https://example.test/v1/videos/advanced-lip-sync");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    session_id: "session",
    face_choose: [
      {
        face_id: "0",
        sound_file: "https://example.test/a.mp3",
        sound_start_time: 0,
        sound_end_time: 3000,
        sound_insert_time: 0,
      },
    ],
  });
});

test("Kling 4 image-to-video identifies frames and rejects aspect ratio", async () => {
  const { ctx, calls } = fake({ code: 0, data: { id: "id" } });
  ctx.extra = { apiKey: "modern-secret-test" };
  const req: MediaSubmitRequest = {
    model: "kling/kling-4",
    task: "image-to-video",
    prompt: "go",
    inputs: [{ role: "first-frame", url: "https://example.test/a.png", mimeType: "image/png" }],
  };
  await adapter.submit(ctx, req);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).contents[1], {
    type: "first_frame",
    url: "https://example.test/a.png",
    id: "image1",
  });
  await assert.rejects(adapter.submit(ctx, { ...req, aspectRatio: "1:1" }));
});

test("adapter error prefix follows the registry contract", () => {
  assert.equal(adapter.errorPrefix, "KLING");
  assert.ok(adapter.normalizeError(new Error("x")).code.startsWith(adapter.errorPrefix + "_"));
});
