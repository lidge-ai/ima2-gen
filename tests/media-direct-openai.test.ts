import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
const previousConfigDir = process.env.IMA2_CONFIG_DIR;
const configDir = mkdtempSync(join(tmpdir(), "ima2-openai-test-"));
process.env.IMA2_CONFIG_DIR = configDir;
const { adapter } = await import("../lib/providers/media/direct/openai.ts");
const { fakeFetch, json } = await import("./helpers/mediaFakeFetch.ts");
test.after(() => {
  if (previousConfigDir === undefined) delete process.env.IMA2_CONFIG_DIR;
  else process.env.IMA2_CONFIG_DIR = previousConfigDir;
  rmSync(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const KEY = "openai_test_secret_123";
const baseUrl = "https://proxy.example";
const request = (patch: Partial<MediaSubmitRequest> = {}): MediaSubmitRequest => ({
  model: "openai/gpt-image-2", task: "text-to-image", prompt: "a fox", inputs: [], ...patch,
});
const image = { role: "source-image" as const, bytes: new Uint8Array([1, 2]), mimeType: "image/png" };
const reference = { role: "reference-image" as const, bytes: new Uint8Array([5, 6]), mimeType: "image/png" };
const mask = { role: "mask" as const, bytes: new Uint8Array([3, 4]), mimeType: "image/png" };

test("generations use the configured base URL and return decoded image bytes through poll", async () => {
  const f = fakeFetch([[`${baseUrl}/v1/images/generations`, () => json({ data: [{ b64_json: "AQID" }] })]]);
  const ctx: MediaAdapterContext = { apiKey: KEY, baseUrl, fetch: f.fetch };
  const job = await adapter.submit(ctx, request());
  assert.equal(f.calls[0]?.method, "POST");
  assert.equal(f.calls[0]?.headers.authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0]?.body.model, "gpt-image-2");
  assert.equal(f.calls[0]?.body.prompt, "a fox");
  const state = await adapter.poll(ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") {
    assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([1, 2, 3]));
    assert.equal(state.outputs[0]?.mimeType, "image/png");
  }
  assert.equal(f.calls.length, 1);
});

test("edits send source image and mask in their correct multipart roles", async () => {
  const f = fakeFetch([[`${baseUrl}/v1/images/edits`, () => json({ data: [{ b64_json: "AQID" }] })]]);
  const ctx: MediaAdapterContext = { apiKey: KEY, baseUrl, fetch: f.fetch };
  await adapter.submit(ctx, request({ task: "image-to-image", inputs: [reference, mask, image] }));
  const call = f.calls[0]!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.headers["content-type"], undefined);
  assert.ok(call.body instanceof FormData);
  assert.equal(call.body.get("model"), "gpt-image-2");
  assert.equal(call.body.get("prompt"), "a fox");
  const images = call.body.getAll("image[]");
  assert.equal(images.length, 2);
  const source = images[0];
  const sentReference = images[1];
  assert.ok(sentReference instanceof Blob);
  assert.deepEqual(new Uint8Array(await sentReference.arrayBuffer()), reference.bytes);
  const sentMask = call.body.get("mask");
  assert.ok(source instanceof Blob);
  assert.ok(sentMask instanceof Blob);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), image.bytes);
  assert.deepEqual(new Uint8Array(await sentMask.arrayBuffer()), mask.bytes);
});

test("unknown or expired synchronous job IDs fail without network", async () => {
  const f = fakeFetch([]);
  const state = await adapter.poll({ apiKey: KEY, baseUrl, fetch: f.fetch }, { providerJobId: "expired-id" });
  assert.equal(state.status, "failed");
  if (state.status === "failed") assert.equal(state.error.code, "OPENAI_RESULT_EXPIRED");
  assert.equal(f.calls.length, 0);
});

test("HTTP errors classify failures and redact credentials", async () => {
  for (const [status, category] of [[401, "auth"], [402, "quota"], [429, "rate-limit"], [400, "invalid-request"], [500, "upstream"]] as const) {
    const f = fakeFetch([[`${baseUrl}/v1/images/generations`, () => json({ error: { message: `failure ${KEY}` } }, status)]]);
    const ctx: MediaAdapterContext = { apiKey: KEY, baseUrl, fetch: f.fetch };
    await assert.rejects(() => adapter.submit(ctx, request()), (error: unknown) => {
      const result = adapter.normalizeError(error);
      assert.equal(result.category, category);
      assert.ok(!JSON.stringify(result).includes(KEY));
      return true;
    });
  }
});

test("key validation uses the configured base URL and redacts errors", async () => {
  const f = fakeFetch([[`${baseUrl}/v1/models`, () => json({ error: { message: KEY } }, 401)]]);
  const result = await adapter.validateKey({ apiKey: KEY, baseUrl, fetch: f.fetch });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.equal(f.calls[0]?.method, "GET");
  assert.equal(f.calls[0]?.headers.authorization, `Bearer ${KEY}`);
});

test("OpenAI error codes distinguish quota and moderation", async () => {
  for (const [status, code, category] of [[429, "insufficient_quota", "quota"], [400, "content_policy_violation", "moderation"]] as const) {
    const f = fakeFetch([[`${baseUrl}/v1/images/generations`, () => json({ error: { code, message: `failure ${KEY}` } }, status)]]);
    await assert.rejects(() => adapter.submit({ apiKey: KEY, baseUrl, fetch: f.fetch }, request()), (error: unknown) => {
      const result = adapter.normalizeError(error);
      assert.equal(result.category, category);
      assert.ok(!JSON.stringify(result).includes(KEY));
      return true;
    });
  }
});

test("parked results expire at thirty minutes", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const f = fakeFetch([[`${baseUrl}/v1/images/generations`, () => json({ data: [{ b64_json: "AQID" }] })]]);
  const ctx: MediaAdapterContext = { apiKey: KEY, baseUrl, fetch: f.fetch };
  const beforeExpiry = await adapter.submit(ctx, request());
  const atExpiry = await adapter.submit(ctx, request());
  now += 30 * 60 * 1000 - 1;
  assert.equal((await adapter.poll(ctx, beforeExpiry)).status, "succeeded");
  now += 1;
  const state = await adapter.poll(ctx, atExpiry);
  assert.equal(state.status, "failed");
  if (state.status === "failed") assert.equal(state.error.code, "OPENAI_RESULT_EXPIRED");
  assert.equal(f.calls.length, 2);
});
