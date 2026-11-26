import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/google-image.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const KEY = "sk-test-SECRET-123456";
const base: MediaSubmitRequest = { model: "google/nano-banana-2.1", task: "text-to-image", prompt: "a lighthouse at dusk", inputs: [] };
const png = (role: "source-image" | "reference-image", byte: number) => ({ role, bytes: new Uint8Array([byte]), mimeType: "image/png" });
const done = (data = "iVBO") => ({ id: "i1", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "here" }, { type: "image", mime_type: "image/png", data }] }] });

function fake(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const ctx: MediaAdapterContext = { apiKey: KEY, fetch: (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    assert.ok(next, "unexpected network call");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch };
  return { ctx, calls };
}

test("text-to-image posts an interaction with the Gemini key and response_format", async () => {
  const f = fake([{ body: done() }]);
  const job = await adapter.submit(f.ctx, { ...base, aspectRatio: "16:9", resolution: "2K", vendorOptions: { mime_type: "image/jpeg" } });
  assert.equal(job.pollAfterMs, 0, "synchronous results are polled at once");
  assert.equal(f.calls[0]!.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  const headers = f.calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-goog-api-key"], KEY);
  assert.equal(headers["Api-Revision"], "2026-05-20");
  assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)), {
    model: "gemini-nano-banana-2.1", input: [{ type: "text", text: "a lighthouse at dusk" }],
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "2K" },
  });
  const state = await adapter.poll(f.ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") {
    assert.equal(state.outputs[0]!.kind, "image");
    assert.deepEqual(state.outputs[0]!.bytes, new Uint8Array(Buffer.from("iVBO", "base64")));
  }
  assert.equal((await adapter.poll(f.ctx, job)).status, "failed", "a parked result is handed out once");
});

test("image-to-image sends the source first, then references, then the prompt", async () => {
  const f = fake([{ body: done() }]);
  await adapter.submit(f.ctx, { ...base, model: "google/nano-banana-pro", task: "image-to-image",
    inputs: [png("reference-image", 2), png("source-image", 1), png("reference-image", 3)] });
  const sent = JSON.parse(String(f.calls[0]!.init.body));
  assert.equal(sent.model, "gemini-3-pro-image");
  assert.deepEqual(sent.input.map((p: { type: string; data?: string }) => p.data ?? p.type), ["AQ==", "Ag==", "Aw==", "text"]);
  assert.equal(sent.response_format, undefined);
});

test("model limits are enforced before any request", async () => {
  const f = fake([]);
  const fifteen = Array.from({ length: 15 }, (_, i) => png("reference-image", i));
  await assert.rejects(adapter.submit(f.ctx, { ...base, task: "image-to-image", inputs: fifteen }), /at most 14 images/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, task: "image-to-image", inputs: [png("source-image", 1), png("source-image", 2)] }), /at most one source-image/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, inputs: [png("reference-image", 1)] }), /use image-to-image/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, task: "image-to-image" }), /needs a source-image/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, model: "google/nano-banana-pro", aspectRatio: "8:1" }), /aspectRatio/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, model: "google/nano-banana", resolution: "2K" }), /fixed output size/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, count: 2 }), /one image per request/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, seed: 1 }), /seed is not supported/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, vendorOptions: { thinking: "high" } }), /Unknown vendorOptions/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, task: "image-to-image", inputs: [{ role: "source-image", url: "https://a.test/x.png", mimeType: "image/png" }] }), /must arrive as bytes/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, task: "image-to-image", inputs: [{ role: "source-image", bytes: new Uint8Array([1]), mimeType: "image/gif" }] }), /PNG, JPEG or WebP/);
  await assert.rejects(adapter.submit(f.ctx, { ...base, model: "google/nano-banana-2" }), /Unknown model/);
  assert.equal(f.calls.length, 0);
});

test("a text-only answer and a failed interaction become failures with the reason, not the key", async () => {
  const f = fake([
    { body: { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "I can't draw that. " + KEY }] }] } },
    { body: { status: "failed", error: { message: "quota for " + KEY } } },
  ]);
  const none = await adapter.poll(f.ctx, await adapter.submit(f.ctx, base));
  assert.equal(none.status, "failed");
  if (none.status === "failed") {
    assert.equal(none.error.code, "GOOGLE_IMAGE_NO_IMAGE");
    assert.match(none.error.message, /I can't draw that/);
    assert.ok(!none.error.message.includes(KEY));
  }
  const failed = await adapter.poll(f.ctx, await adapter.submit(f.ctx, base));
  assert.ok(failed.status === "failed" && !failed.error.message.includes(KEY) && /quota for/.test(failed.error.message));
});

test("HTTP errors are classified without the key; validateKey is a free model list", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [429, "rate-limit", true], [503, "upstream", true]] as const) {
    const f = fake([{ status, body: { error: { message: "bad key " + KEY } } }]);
    const error = await adapter.submit(f.ctx, base).catch((e: unknown) => e);
    const normalized = adapter.normalizeError(error);
    assert.equal(normalized.category, category);
    assert.equal(normalized.retryable, retryable);
    assert.match(normalized.code, /^GOOGLE_IMAGE_/);
    assert.ok(!normalized.message.includes(KEY));
  }
  const ok = fake([{ body: { models: [] } }, { status: 403, body: { error: { message: "denied" } } }]);
  assert.deepEqual(await adapter.validateKey(ok.ctx), { ok: true });
  assert.equal(ok.calls[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
  assert.equal((await adapter.validateKey(ok.ctx)).ok, false);
});
