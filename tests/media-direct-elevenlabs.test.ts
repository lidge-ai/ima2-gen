import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/elevenlabs.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "elevenlabs/eleven-v4", task: "text-to-audio", prompt: "Hello", inputs: [], vendorOptions: { voice_id: "voice-1" } };
function setup(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return status === 200 ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }) : new Response(JSON.stringify({ message: key }), { status });
  };
  return { calls, ctx: { apiKey: key, fetch: fake } satisfies MediaAdapterContext };
}

test("request and synchronous result", async () => {
  const { calls, ctx } = setup();
  const job = await adapter.submit(ctx, request);
  assert.equal(calls[0]?.url, "https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
  assert.equal(calls[0]?.init.method, "POST");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], key);
  
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { text: "Hello", model_id: "eleven_v4" });
  const state = await adapter.poll(ctx, job);
  assert.equal(state.status, "succeeded");
  if (state.status === "succeeded") { assert.equal(state.outputs[0]?.mimeType, "audio/mpeg"); assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([1, 2, 3])); }
  assert.equal((await adapter.poll(ctx, job)).status, "failed");
});

test("validates keys without generation", async () => {
  const ok = setup(); assert.equal((await adapter.validateKey(ok.ctx)).ok, true);
  assert.equal(ok.calls[0]?.init.method, "GET");
  assert.equal(ok.calls[0]?.url, "https://api.elevenlabs.io/v1/user");
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
      assert.ok(normalized.code.startsWith("ELEVENLABS_")); assert.ok(!normalized.message.includes(key));
    }
  });
}

test("music and sound effects send their documented bodies", async () => {
  const music = setup();
  await adapter.submit(music.ctx, { model: "elevenlabs/elevenlabs-music-2.5", task: "text-to-audio", prompt: "A song", inputs: [], durationSec: 5, vendorOptions: { force_instrumental: true } });
  assert.equal(music.calls[0]?.url, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
  assert.deepEqual(JSON.parse(String(music.calls[0]?.init.body)), { model_id: "music_v2_5", prompt: "A song", music_length_ms: 5000, force_instrumental: true });
  const sound = setup();
  await adapter.submit(sound.ctx, { model: "elevenlabs/eleven-text-to-sound-v3", task: "text-to-audio", prompt: "Rain", inputs: [], durationSec: 2, vendorOptions: { loop: true } });
  assert.equal(sound.calls[0]?.url, "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
  assert.deepEqual(JSON.parse(String(sound.calls[0]?.init.body)), { model_id: "eleven_text_to_sound_v3", text: "Rain", duration_seconds: 2, loop: true });
});


test("transport failures and hostile options cannot leak the key", async () => {
  const { ctx } = setup();
  const failing: MediaAdapterContext = { ...ctx, fetch: async () => { throw new TypeError(`network ${key}`); } };
  await assert.rejects(adapter.submit(failing, request), (error: Error) => !error.message.includes(key) && !adapter.normalizeError(error).message.includes(key));
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { [key]: true } }), (error: Error) => !error.message.includes(key));
  assert.ok(!adapter.normalizeError(new Error(key)).message.includes(key));
});
