import { strict as assert } from "node:assert";
import { test } from "node:test";

import { adapter } from "../lib/providers/media/direct/veed.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const KEY = "sk-test-SECRET-123456";
type Call = { url: string; init: RequestInit };

function fakeCtx(responses: [number, unknown][]): { ctx: MediaAdapterContext; calls: Call[] } {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = responses.shift() ?? [500, { error: { code: "internal" } }];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { ctx: { apiKey: KEY, fetch: fakeFetch }, calls };
}

const input = (role: string, url: string) => ({ role, url, mimeType: "application/octet-stream" }) as MediaSubmitRequest["inputs"][number];
const accepted = [202, { data: { job_id: "job-1", status: "PROCESSING" } }] as [number, unknown];

test("Fabric submits image_url, audio_url and resolution with a bearer key", async () => {
  const { ctx, calls } = fakeCtx([accepted]);
  const job = await adapter.submit(ctx, {
    model: "veed/veed-fabric-1.0", task: "avatar", resolution: "480p",
    inputs: [input("source-image", "https://x/face.png"), input("source-audio", "https://x/a.mp3")],
  });
  assert.deepEqual(job, { providerJobId: "job-1", pollAfterMs: 10_000, resume: { path: "/v1/fabric-1.0" } });
  assert.equal(calls[0]!.url, "https://api.veed.io/v1/fabric-1.0");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer " + KEY);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { image_url: "https://x/face.png", audio_url: "https://x/a.mp3", resolution: "480p" });
});

test("Lipsync and Dubbing Pro hit their documented endpoints", async () => {
  const { ctx, calls } = fakeCtx([accepted, accepted]);
  await adapter.submit(ctx, { model: "veed/veed-lipsync", task: "lipsync",
    inputs: [input("source-video", "https://x/v.mp4"), input("source-audio", "https://x/a.mp3")] });
  assert.equal(calls[0]!.url, "https://api.veed.io/v1/lipsync-2.0");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { video_url: "https://x/v.mp4", audio_url: "https://x/a.mp3" });
  const job = await adapter.submit(ctx, { model: "veed/veed-dubbing", task: "dubbing",
    inputs: [input("source-video", "https://x/v.mp4")],
    vendorOptions: { tier: "pro", target_language: "ko", voice_cloning_strength: 5 } });
  assert.equal(calls[1]!.url, "https://api.veed.io/v1/dubbing-pro");
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { video_url: "https://x/v.mp4", target_language: "ko", voice_cloning_strength: 5 });
  assert.equal(job.resume?.path, "/v1/dubbing-pro");
});

test("bad requests are refused before any network call", async () => {
  const { ctx, calls } = fakeCtx([]);
  const base = { model: "veed/veed-dubbing", task: "dubbing", inputs: [input("source-video", "https://x/v.mp4")] } as MediaSubmitRequest;
  await assert.rejects(adapter.submit(ctx, base), /target_language/);
  await assert.rejects(adapter.submit(ctx, { ...base, vendorOptions: { target_language: "ko", voice_cloning_strength: 3 } }), /tier pro/);
  await assert.rejects(adapter.submit(ctx, { ...base, vendorOptions: { target_language: "ko", lipsync: true } }), /Unknown vendorOptions/);
  await assert.rejects(adapter.submit(ctx, { ...base, model: "veed/veed-subtitles" }), /Unknown model/);
  await assert.rejects(adapter.submit(ctx, { model: "veed/veed-fabric-1.0", task: "avatar", resolution: "1080p",
    inputs: [input("source-image", "https://x/i.png"), input("source-audio", "https://x/a.mp3")] }), /resolution/);
  await assert.rejects(adapter.submit(ctx, { model: "veed/veed-lipsync", task: "lipsync",
    inputs: [{ role: "source-video", bytes: new Uint8Array([1]), mimeType: "video/mp4" }, input("source-audio", "https://x/a.mp3")] }), /must arrive as a URL/);
  assert.equal(calls.length, 0);
});

test("poll walks PROCESSING to COMPLETED and maps job failures", async () => {
  const { ctx, calls } = fakeCtx([
    [200, { data: { status: "PROCESSING" } }],
    [200, { data: { status: "COMPLETED", result: { video: { url: "https://cdn/v.mp4", content_type: "video/mp4" } } } }],
    [200, { data: { status: "FAILED", error: { code: "content_moderation", message: "blocked" } } }],
    [200, { data: { status: "CANCELLED" } }],
  ]);
  const job = { providerJobId: "job-1", resume: { path: "/v1/lipsync-2.0" } };
  assert.equal((await adapter.poll(ctx, job)).status, "running");
  assert.equal(calls[0]!.url, "https://api.veed.io/v1/lipsync-2.0/job-1");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "video", url: "https://cdn/v.mp4", mimeType: "video/mp4" }] });
  const failed = await adapter.poll(ctx, job);
  assert.equal(failed.status === "failed" && failed.error.code, "VEED_CONTENT_MODERATION");
  assert.equal(failed.status === "failed" && failed.error.category, "moderation");
  assert.equal((await adapter.poll(ctx, job)).status, "canceled");
});

test("HTTP errors are classified from VEED error codes and never carry the key", async () => {
  const cases: [number, string, string, string, boolean][] = [
    [401, "unauthenticated", "VEED_AUTH", "auth", false],
    [402, "insufficient_tokens", "VEED_INSUFFICIENT_CREDIT", "quota", false],
    [429, "rate_limited", "VEED_RATE_LIMITED", "rate-limit", true],
    [503, "unavailable", "VEED_UNAVAILABLE", "upstream", true],
  ];
  for (const [status, code, expected, category, retryable] of cases) {
    const { ctx } = fakeCtx([[status, { error: { code, message: "key " + KEY + " rejected" } }]]);
    const error = await adapter.poll(ctx, { providerJobId: "j", resume: { path: "/v1/dubbing" } }).catch((e: unknown) => e);
    const normalized = adapter.normalizeError(error);
    assert.equal(normalized.code, expected);
    assert.equal(normalized.category, category);
    assert.equal(normalized.retryable, retryable);
    assert.ok(!normalized.message.includes(KEY));
    assert.ok(!String((error as Error).message).includes(KEY));
  }
});

test("validateKey treats 404 on a probe job as an accepted key and 401 as rejected", async () => {
  const ok = fakeCtx([[404, { error: { code: "not_found" } }]]);
  assert.deepEqual(await adapter.validateKey(ok.ctx), { ok: true });
  assert.equal(ok.calls[0]!.url, "https://api.veed.io/v1/lipsync-2.0/00000000-0000-0000-0000-000000000000");
  assert.equal(ok.calls[0]!.init.method, "GET");
  const bad = fakeCtx([[401, { error: { code: "unauthenticated", message: "bad " + KEY } }]]);
  const result = await adapter.validateKey(bad.ctx);
  assert.equal(result.ok, false);
  assert.ok(!String(result.reason).includes(KEY));
});
