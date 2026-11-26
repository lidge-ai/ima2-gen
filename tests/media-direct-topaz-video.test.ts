import { test } from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/topaz-video.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "topaz-labs/topaz-video", task: "video-upscale", inputs: [{ role: "source-video", mimeType: "video/mp4", bytes: new Uint8Array([1, 2]) }], vendorOptions: { source: { resolution: { width: 800, height: 448 }, container: "mp4", duration: 4, frameRate: 24, frameCount: 97 }, output: { resolution: { width: 1600, height: 896 } }, model: "prob-4" } };
function fixture(replies: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: key, fetch: async (url, init) => { calls.push({ url: String(url), init }); const response = replies.shift(); assert.ok(response); return response; } };
  return { ctx, calls };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("creates, accepts, uploads, completes and polls", async () => {
  const { ctx, calls } = fixture([json({ requestId: "job" }), json({ urls: ["https://upload.example/file"] }), new Response(null, { status: 200 }), json({}, 202), json({ status: "accepted" }), json({ status: "processing", progress: 50 }), json({ status: "complete", download: { url: "https://download.example/file", expiresAt: 1800000000000 } })]);
  const job = await adapter.submit(ctx, request);
  assert.deepEqual(calls.map(c => [c.init?.method, c.url]), [["POST", "https://api.topazlabs.com/video/"], ["PATCH", "https://api.topazlabs.com/video/job/accept"], ["PUT", "https://upload.example/file"], ["PATCH", "https://api.topazlabs.com/video/job/complete-upload/"]]);
  assert.equal((calls[0]!.init!.headers as Record<string, string>)["X-API-Key"], key);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { source: { ...request.vendorOptions!.source as object, size: 2 }, output: request.vendorOptions!.output, filters: [{ model: "prob-4", auto: "Auto" }] });
  assert.equal((calls[2]!.init!.headers as Record<string, string>)["X-API-Key"], undefined);
  assert.deepEqual(JSON.parse(String(calls[3]!.init!.body)), { uploadResults: [{ partNum: 1, eTag: "unused" }] });
  assert.equal((await adapter.poll(ctx, job)).status, "queued");
  assert.deepEqual(await adapter.poll(ctx, job), { status: "running", progress: 0.5 });
  assert.deepEqual(await adapter.poll(ctx, job), { status: "succeeded", outputs: [{ kind: "video", url: "https://download.example/file", mimeType: "video/mp4", expiresAt: new Date(1800000000000).toISOString() }] });
});

test("HTTP classification and secret redaction", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [402, "quota", false], [429, "rate-limit", true], [503, "upstream", true]] as const) {
    const { ctx } = fixture([json({ message: key }, status)]);
    await assert.rejects(adapter.submit(ctx, request), error => { const normalized = adapter.normalizeError(error); assert.equal(normalized.category, category); assert.equal(normalized.retryable, retryable); assert.match(normalized.code, /^TOPAZ_VIDEO_/); assert.doesNotMatch(String(error), /sk-test-SECRET/); assert.doesNotMatch(normalized.message, /sk-test-SECRET/); return true; });
  }
});
test("failed status, key validation and invalid requests", async () => {
  let f = fixture([json({ status: "failed", errorCode: "INSUFFICIENT_CREDITS", message: key })]);
  const state = await adapter.poll(f.ctx, { providerJobId: "job" });
  assert.equal(state.status, "failed"); if (state.status === "failed") { assert.equal(state.error.category, "quota"); assert.doesNotMatch(state.error.message, /sk-test-SECRET/); }
  f = fixture([json({ available_credits: 10 }), json({}, 401), json({}, 403)]);
  assert.deepEqual(await adapter.validateKey(f.ctx), { ok: true });
  assert.equal((await adapter.validateKey(f.ctx)).ok, false);
  assert.equal((await adapter.validateKey(f.ctx)).ok, false);
  assert.equal(f.calls[0]!.url, "https://api.topazlabs.com/account/v1/credits/balance");
  await assert.rejects(adapter.submit(f.ctx, { ...request, model: "unknown" }));
  await assert.rejects(adapter.submit(f.ctx, { ...request, vendorOptions: { unknown: 1 } }));
});
test("cancellation uses the documented endpoint", async () => {
  const f = fixture([new Response(null, { status: 204 }), json({ status: "canceled" })]);
  await adapter.cancel!(f.ctx, { providerJobId: "job" });
  assert.equal(f.calls[0]!.url, "https://api.topazlabs.com/video/job");
  assert.equal(f.calls[0]!.init!.method, "DELETE");
  assert.equal((await adapter.poll(f.ctx, { providerJobId: "job" })).status, "canceled");
});
test("redacts transport errors and arbitrary normalized errors", async () => {
  const ctx: MediaAdapterContext = { apiKey: key, fetch: async () => { throw new TypeError(`transport ${key}`); } };
  await assert.rejects(adapter.submit(ctx, request), error => { assert.doesNotMatch(String(error), /sk-test-SECRET/); assert.doesNotMatch(adapter.normalizeError(error).message, /sk-test-SECRET/); return true; });
  assert.doesNotMatch(adapter.normalizeError(new Error(key)).message, /sk-test-SECRET/);
});


function box(type: string, ...parts: Uint8Array[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, body]);
}
/** A minimal MP4 (64x48, 2 s, 25 fps, 50 frames), built like tests/media-mp4-probe.test.ts in L0. */
function tinyMp4(brand = "isom"): Uint8Array {
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(64 * 65536, 76);
  tkhd.writeUInt32BE(48 * 65536, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(2000, 16);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8);
  const stts = Buffer.alloc(16);
  stts.writeUInt32BE(1, 4); stts.writeUInt32BE(50, 8); stts.writeUInt32BE(40, 12);
  const stsz = Buffer.alloc(12);
  stsz.writeUInt32BE(1, 4); // fixed sample_size, so no per-sample size table follows
  stsz.writeUInt32BE(50, 8);
  const stbl = box("stbl", box("stts", stts), box("stsz", stsz));
  const mdia = box("mdia", box("mdhd", mdhd), box("hdlr", hdlr), box("minf", stbl));
  const moov = box("moov", box("mvhd", Buffer.alloc(4)), box("trak", box("tkhd", tkhd), mdia));
  return new Uint8Array(Buffer.concat([box("ftyp", Buffer.from(brand), Buffer.alloc(4)), box("mdat", Buffer.alloc(4)), moov]));
}

test("without vendorOptions.source the MP4 is probed for Topaz's source metadata", async () => {
  const bytes = tinyMp4();
  const { ctx, calls } = fixture([json({ requestId: "probe" }), json({ urls: ["https://upload.example/p"] }), new Response(null, { status: 200 }), json({}, 202)]);
  await adapter.submit(ctx, { ...request, inputs: [{ role: "source-video", mimeType: "video/mp4", bytes }], vendorOptions: { output: { resolution: { width: 128, height: 96 } } } });
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)).source, { resolution: { width: 64, height: 48 }, container: "mp4", size: bytes.byteLength, duration: 2, frameRate: 25, frameCount: 50 });
});

test("an unreadable or QuickTime source without metadata is refused before any request", async () => {
  const { ctx, calls } = fixture([]);
  const noSource = { output: { resolution: { width: 128, height: 96 } } };
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: noSource }), /Could not read the source MP4/);
  await assert.rejects(adapter.submit(ctx, { ...request, inputs: [{ role: "source-video", mimeType: "video/mp4", bytes: tinyMp4("qt  ") }], vendorOptions: noSource }), /QuickTime/);
  assert.equal(calls.length, 0);
});
