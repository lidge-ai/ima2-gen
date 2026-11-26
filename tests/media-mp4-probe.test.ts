import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configDir = await mkdtemp(join(tmpdir(), "ima2-mp4-probe-"));
process.env.IMA2_CONFIG_DIR = configDir;
const { probeMp4 } = await import("../lib/providers/media/mp4Probe.ts");
test.after(async () => { await rm(configDir, { recursive: true, force: true }); });

function box(type: string, ...parts: Uint8Array[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, body]);
}
function largeBox(type: string, body: Uint8Array): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1);
  header.write(type, 4, 4, "ascii");
  header.writeBigUInt64BE(BigInt(body.length + 16), 8);
  return Buffer.concat([header, body]);
}
function fixture(options: { version?: 0 | 1; brand?: string; audio?: boolean; compact?: boolean; variable?: boolean; large?: boolean } = {}): Buffer {
  const version = options.version ?? 0;
  const tkhd = Buffer.alloc(version ? 100 : 84);
  tkhd[0] = version;
  tkhd.writeUInt32BE(64 * 65536, version ? 88 : 76);
  tkhd.writeUInt32BE(48 * 65536, version ? 92 : 80);
  const mdhd = Buffer.alloc(version ? 36 : 24);
  mdhd[0] = version;
  mdhd.writeUInt32BE(1000, version ? 20 : 12);
  if (version) mdhd.writeBigUInt64BE(2000n, 24); else mdhd.writeUInt32BE(2000, 16);
  const hdlr = Buffer.alloc(12);
  hdlr.write(options.audio ? "soun" : "vide", 8);
  const stts = Buffer.alloc(options.variable ? 24 : 16);
  stts.writeUInt32BE(options.variable ? 2 : 1, 4);
  stts.writeUInt32BE(25, 8);
  stts.writeUInt32BE(40, 12);
  if (options.variable) { stts.writeUInt32BE(25, 16); stts.writeUInt32BE(41, 20); }
  const sizes = Buffer.alloc(options.compact ? 62 : 12);
  sizes.writeUInt32BE(options.compact ? 8 : 1, 4);
  sizes.writeUInt32BE(50, 8);
  const stbl = box("stbl", box("stts", stts), box(options.compact ? "stz2" : "stsz", sizes));
  const mdia = box("mdia", box("mdhd", mdhd), box("hdlr", hdlr), box("minf", stbl));
  const moov = box("moov", box("mvhd", Buffer.alloc(4)), box("trak", box("tkhd", tkhd), mdia));
  return Buffer.concat([box("ftyp", Buffer.from(options.brand ?? "isom"), Buffer.alloc(4)), options.large ? largeBox("mdat", Buffer.alloc(4)) : box("mdat", Buffer.alloc(4)), moov]);
}
const expected = { width: 64, height: 48, durationSec: 2, frameRate: 25, frameCount: 50, container: "mp4" };
const fails = (bytes: Uint8Array) => assert.throws(() => probeMp4(bytes), { code: "MEDIA_INPUT_PROBE_FAILED" });

test("reads a video track when moov follows mdat", () => { assert.deepEqual(probeMp4(fixture()), expected); });
test("reads version 1 metadata and 64-bit box sizes", () => { assert.deepEqual(probeMp4(fixture({ version: 1, large: true })), expected); });
test("detects QuickTime major brand", () => { assert.deepEqual(probeMp4(fixture({ brand: "qt  " })), { ...expected, container: "mov" }); });
test("rejects audio-only input, missing moov, and truncation", () => {
  fails(fixture({ audio: true }));
  fails(box("mdat", Buffer.alloc(4)));
  const bytes = fixture();
  for (let i = 0; i < bytes.length; i++) fails(bytes.subarray(0, i));
});
test("uses constant sample timing and falls back for variable timing", () => {
  const bytes = fixture();
  const stts = bytes.indexOf("stts");
  bytes.writeUInt32BE(50, stts + 16);
  assert.equal(probeMp4(bytes).frameRate, 20);
  assert.equal(probeMp4(fixture({ variable: true })).frameRate, 25);
});
test("reads compact sample count", () => { assert.equal(probeMp4(fixture({ compact: true })).frameCount, 50); });
test("supports size-zero boxes and Uint8Array views", () => {
  const bytes = fixture();
  const moov = bytes.indexOf("moov") - 4;
  bytes.writeUInt32BE(0, moov);
  const padded = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]);
  assert.deepEqual(probeMp4(padded.subarray(7, 7 + bytes.length)), expected);
});
test("probes an ffmpeg-generated clip when ffmpeg is available", async (t) => {
  const file = join(configDir, "clip.mp4");
  const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=64x48:r=25:d=1", "-c:v", "mpeg4", "-y", file], { encoding: "utf8" });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") return t.skip("ffmpeg not on PATH");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(probeMp4(await readFile(file)), { ...expected, durationSec: 1, frameCount: 25 });
});
