import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/kling/index.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const base: MediaSubmitRequest = {
  model: "kling/kling-4",
  task: "text-to-video",
  prompt: "test",
  inputs: [],
};
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = {
    apiKey: "modern-secret-test",
    baseUrl: "https://example.test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  };
  return { ctx, calls };
}
test("modern poll and secret redaction", async () => {
  const { ctx } = fake({
    code: 0,
    data: [
      { id: "1", status: "succeeded", outputs: [{ type: "video", url: "https://example.test/out.mp4" }] },
    ],
  });
  ctx.apiKey = "modern-secret-test";
  ctx.extra = { secretKey: "secret-key-test" };
  const result = await adapter.poll(ctx, {
    providerJobId: "1",
    resume: { path: "/tasks", kind: "video", auth: "apiKey" },
  });
  assert.deepEqual(result, {
    status: "succeeded",
    outputs: [{ kind: "video", url: "https://example.test/out.mp4", mimeType: "video/mp4" }],
  });
  const bad = fake(
    {
      code: 1002,
      message: "modern-secret-test secret-key-test Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk",
    },
    401,
  );
  bad.ctx.apiKey = ctx.apiKey;
  bad.ctx.extra = ctx.extra;
  await assert.rejects(
    adapter.submit(bad.ctx, { ...base, model: "kling/kling-4", task: "text-to-video" }),
    (error) => {
      assert.doesNotMatch(
        adapter.normalizeError(error).message,
        /modern-secret-test|secret-key-test|eyJabcdefghijk/,
      );
      return true;
    },
  );
});

test("Kling 4 omni sends reference contents to the documented endpoint", async () => {
  const { ctx, calls } = fake({ code: 0, data: { id: "id" } });
  ctx.apiKey = "modern-secret-test";
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

test("Kling 4 image-to-video identifies frames and rejects aspect ratio", async () => {
  const { ctx, calls } = fake({ code: 0, data: { id: "id" } });
  ctx.apiKey = "modern-secret-test";
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

test("modern validation sends a documented GET task query", async () => {
  const { ctx, calls } = fake({ code: 0, data: [] });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[0]?.url, "https://example.test/tasks?task_ids=0");
  assert.equal(calls[0]?.init.body, undefined);
});
test("modern model paths and authentication", async () => {
  for (const [model, path] of [
    ["kling/kling-4", "/text-to-video/kling-4.0"],
    ["kling/kling-3-turbo", "/text-to-video/kling-3.0-turbo"],
    ["kling/kling-2.6", "/text-to-video/kling-2.6"],
    ["kling/kling-3", "/text-to-video/kling-3.0"],
    ["kling/kling-o1", "/omni-video/kling-o1"],
    ["kling/kling-3-omni", "/omni-video/kling-3.0-omni"],
  ] as const) {
    const { ctx, calls } = fake({ code: 0, data: { id: "id" } });
    await adapter.submit(ctx, { ...base, model });
    assert.equal(calls[0]?.url, `https://example.test${path}`);
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>).authorization,
      "Bearer modern-secret-test",
    );
  }
});
test("missing modern key fails before transport", async () => {
  const { ctx, calls } = fake({});
  ctx.apiKey = "";
  await assert.rejects(adapter.submit(ctx, base), (error) => {
    const detail = adapter.normalizeError(error);
    assert.equal(detail.code, "KLING_CREDENTIAL_MISSING");
    assert.equal(detail.category, "auth");
    assert.equal(detail.retryable, false);
    assert.match(detail.message, /KLING_API_KEY/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("inconclusive task lookup does not claim key validity", async () => {
  const { ctx } = fake({ code: 1203, message: "not found" }, 404);
  await assert.rejects(adapter.validateKey(ctx));
});
