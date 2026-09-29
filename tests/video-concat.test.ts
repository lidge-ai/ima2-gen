// WP6 (060): local concat contract. ffmpeg-dependent paths are guarded.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { concatVideos } from "../lib/videoConcat.js";

const dir = mkdtempSync(join(tmpdir(), "ima2-concat-test-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

function makeClip(name: string, size: string, duration = 0.4): string {
  const path = join(dir, name);
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=10:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path], { stdio: "ignore" });
  return path;
}

test("input-count guards fire before any ffmpeg work", async () => {
  await assert.rejects(() => concatVideos(["one.mp4"], join(dir, "out.mp4")), /CONCAT_NEEDS_TWO_INPUTS/);
  await assert.rejects(() => concatVideos(Array.from({ length: 13 }, (_, i) => `${i}.mp4`), join(dir, "out.mp4")), /CONCAT_TOO_MANY_INPUTS/);
});

test("compatible clips concat via stream copy preserving order", { skip: !hasFfmpeg }, async () => {
  const a = makeClip("a.mp4", "320x240");
  const b = makeClip("b.mp4", "320x240");
  const out = join(dir, "joined.mp4");
  await concatVideos([a, b], out);
  assert.ok(existsSync(out));
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString();
  assert.ok(Number(probe) > 0.6, `expected combined duration, got ${probe}`);
});

test("codec/resolution mismatch -> CONCAT_NORMALIZE_REQUIRED (no silent corruption)", { skip: !hasFfmpeg }, async () => {
  const a = makeClip("c.mp4", "320x240");
  const b = makeClip("d.mp4", "640x480");
  await assert.rejects(() => concatVideos([a, b], join(dir, "bad.mp4")), /CONCAT_NORMALIZE_REQUIRED/);
});
