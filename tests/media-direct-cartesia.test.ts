import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/cartesia.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "cartesia/sonic-3.6", task: "text-to-audio", prompt: "Hello", inputs: [], vendorOptions: { voice_id: "voice-1" } };
function setup(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return status === 200 ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }) : new Response(JSON.stringify({ message: key }), { status });
  };
  return { calls, ctx: { apiKey: key, fetch: fake } satisfies MediaAdapterContext };
}

test("request and synchronous result", async () => {
  const { calls, ctx } = setup();
  const job = await adapter.submit(ctx, request);
  assert.equal(calls[0]?.url, "https://api.cartesia.ai/tts/bytes");
  assert.equal(calls[0]?.init.method, "POST");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], `Bearer ${key}`);
  assert.equal(headers["Cartesia-Version"], "2026-08-14");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model_id: "sonic-3.6", transcript: "Hello", voice: "voice-1", output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 } });
  const state = await adapter.poll(ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") { assert.equal(state.outputs[0]?.mimeType, "audio/wav"); assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([1, 2, 3])); }
  assert.equal((await adapter.poll(ctx, job)).status, "failed");
});

test("validates keys without generation", async () => {
  const ok = setup(); assert.equal((await adapter.validateKey(ok.ctx)).ok, true);
  assert.equal(ok.calls[0]?.init.method, "GET");
  assert.equal(ok.calls[0]?.url, "https://api.cartesia.ai/voices");
  for (const status of [401, 403]) assert.equal((await adapter.validateKey(setup(status).ctx)).ok, false);
});

test("rejects bad options and model", async () => {
  const { ctx } = setup();
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { voice_id: "x", extra: true } }), /Unknown vendorOptions/);
  await assert.rejects(adapter.submit(ctx, { ...request, model: "missing/model" }), /Unknown model/);
});

for (const [status, category, retryable] of [[401, "auth", false], [402, "quota", false], [429, "rate-limit", true], [500, "upstream", true]] as const) {
  test(`HTTP ${status} is classified and redacted`, async () => {
    const { ctx } = setup(status);
    try { await adapter.submit(ctx, request); assert.fail("expected error"); }
    catch (error) {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes(key));
      const normalized = adapter.normalizeError(error);
      assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable);
      assert.ok(normalized.code.startsWith("CARTESIA_")); assert.ok(!normalized.message.includes(key));
    }
  });
}


test("transport failures and hostile options cannot leak the key", async () => {
  const { ctx } = setup();
  const failing: MediaAdapterContext = { ...ctx, fetch: async () => { throw new TypeError(`network ${key}`); } };
  await assert.rejects(adapter.submit(failing, request), (error: Error) => !error.message.includes(key) && !adapter.normalizeError(error).message.includes(key));
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { [key]: true } }), (error: Error) => !error.message.includes(key));
  assert.ok(!adapter.normalizeError(new Error(key)).message.includes(key));
});
