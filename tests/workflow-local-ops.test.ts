import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFfmpegLocalOps } from "../lib/workflows/localOps.js";
import { WorkflowError } from "../lib/workflows/errors.js";

const dir = mkdtempSync(join(tmpdir(), "ima2-workflow-ops-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const ops = createFfmpegLocalOps();
const signal = new AbortController().signal;

function clip(name: string, size: string, duration: number, audio: boolean): string {
  const path = join(dir, name);
  const inputs = ["-f", "lavfi", "-i", `testsrc=size=${size}:rate=10:duration=${duration}`];
  if (audio) inputs.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`);
  execFileSync("ffmpeg", ["-y", ...inputs, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-shortest"] : []), path], { stdio: "ignore" });
  return path;
}

function isCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof WorkflowError && error.code === code && error.status === 400;
}

test("probe reports video dimensions, duration, and audio", { skip: !hasFfmpeg }, async () => {
  const withAudio = await ops.probe(clip("probe-a.mp4", "160x120", 1, true), signal);
  const silent = await ops.probe(clip("probe-b.mp4", "160x120", 1, false), signal);
  assert.deepEqual([withAudio.width, withAudio.height, withAudio.hasAudio], [160, 120, true]);
  assert.ok(withAudio.durationSec > 0.9);
  assert.equal(silent.hasAudio, false);
});

test("first and last frames are PNG files", { skip: !hasFfmpeg }, async () => {
  const video = clip("frames.mp4", "160x120", 1, false);
  for (const position of ["first", "last"]) {
    const output = join(dir, `${position}.png`);
    await ops.frame(video, output, position, signal);
    assert.deepEqual(readFileSync(output).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

test("mux audio uses the shorter source and rejects silent sources", { skip: !hasFfmpeg }, async () => {
  const video = clip("mux-video.mp4", "160x120", 2, false);
  const source = clip("mux-audio.mp4", "160x120", 0.8, true);
  const output = join(dir, "mux-output.mp4");
  await ops.muxAudio(video, source, output, signal);
  const result = await ops.probe(output, signal);
  assert.equal(result.hasAudio, true);
  assert.ok(result.durationSec >= 0.7 && result.durationSec < 1.3, `duration: ${result.durationSec}`);
  await assert.rejects(ops.muxAudio(video, video, output, signal), isCode("WORKFLOW_SOURCE_HAS_NO_AUDIO"));
});

test("concat copies compatible streams", { skip: !hasFfmpeg }, async () => {
  const a = clip("copy-a.mp4", "160x120", 0.6, true);
  const b = clip("copy-b.mp4", "160x120", 0.6, true);
  const output = join(dir, "copy-output.mp4");
  await ops.concat([a, b], output, signal);
  const result = await ops.probe(output, signal);
  assert.deepEqual([result.width, result.height, result.hasAudio], [160, 120, true]);
  assert.ok(result.durationSec > 1.1);
});

test("concat normalizes size and supplies missing audio", { skip: !hasFfmpeg }, async () => {
  const a = clip("norm-a.mp4", "160x120", 0.6, true);
  const b = clip("norm-b.mp4", "240x160", 0.6, false);
  const output = join(dir, "norm-output.mp4");
  await ops.concat([a, b], output, signal);
  const result = await ops.probe(output, signal);
  assert.deepEqual([result.width, result.height, result.hasAudio], [160, 120, true]);
  assert.ok(result.durationSec > 1.1);
});

test("probe rejects unreadable media", { skip: !hasFfmpeg }, async () => {
  const path = join(dir, "text.txt");
  writeFileSync(path, "not a video");
  await assert.rejects(ops.probe(path, signal), isCode("WORKFLOW_MEDIA_UNREADABLE"));
});
