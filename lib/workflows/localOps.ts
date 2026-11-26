import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { concatVideos } from "../videoConcat.js";
import { extractVideoFrame } from "../videoFrameExtract.js";
import { WorkflowError } from "./errors.js";
import type { ProbeResult, WorkflowLocalOps } from "./types.js";

const exec = promisify(execFile);
const timeout = 5 * 60_000;
type ToolError = Error & { code?: string; stderr?: string };
interface Stream { codec_type?: string; width?: number; height?: number }
interface MediaInfo { streams?: Stream[]; format?: { duration?: string } }

function translate(error: unknown, signal: AbortSignal): never {
  const e = error as ToolError;
  if (e.name === "AbortError" || e.code === "ABORT_ERR") throw error;
  if (signal.aborted) throw signal.reason;
  if (e.code === "ENOENT" || e.code === "FFMPEG_UNAVAILABLE" || e.message === "FFMPEG_UNAVAILABLE") {
    throw new WorkflowError("WORKFLOW_FFMPEG_UNAVAILABLE", "ffmpeg is not installed or not on PATH", { status: 503 });
  }
  const message = (e.stderr || e.message || "Local media operation failed").trim().slice(-200);
  throw new WorkflowError("WORKFLOW_LOCAL_STEP_FAILED", message, { status: 500 });
}

async function run(bin: string, args: string[], signal: AbortSignal): Promise<string> {
  try {
    const result = await exec(bin, args, {
      signal, timeout, killSignal: process.platform === "win32" ? "SIGTERM" : "SIGKILL", maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    translate(error, signal);
  }
}

function unreadable(): WorkflowError {
  return new WorkflowError("WORKFLOW_MEDIA_UNREADABLE", "Media has no readable video or duration", { status: 400 });
}

async function inspect(path: string, signal: AbortSignal): Promise<MediaInfo> {
  let output: string;
  try {
    output = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], signal);
  } catch (error) {
    if (error instanceof WorkflowError && error.code === "WORKFLOW_LOCAL_STEP_FAILED" && /invalid data|moov atom not found/i.test(error.message)) throw unreadable();
    throw error;
  }
  try { return JSON.parse(output) as MediaInfo; } catch { throw unreadable(); }
}

async function probe(path: string, signal: AbortSignal): Promise<ProbeResult> {
  const info = await inspect(path, signal);
  const video = info.streams?.find((stream) => stream.codec_type === "video");
  const rawDuration = info.format?.duration;
  const durationSec = rawDuration === undefined || rawDuration.trim() === "" ? NaN : Number(rawDuration);
  if (!video || !Number.isFinite(durationSec) || !video.width || !video.height) throw unreadable();
  return { durationSec, width: video.width, height: video.height, hasAudio: !!info.streams?.some((s) => s.codec_type === "audio") };
}

async function frame(videoPath: string, outPath: string, position: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await extractVideoFrame(videoPath, outPath, position === "first" ? "0" : position, { signal });
  } catch (error) {
    translate(error, signal);
  }
}

async function muxAudio(videoPath: string, audioSource: string, outPath: string, signal: AbortSignal): Promise<void> {
  const info = await inspect(audioSource, signal);
  if (!info.streams?.some((stream) => stream.codec_type === "audio")) {
    throw new WorkflowError("WORKFLOW_SOURCE_HAS_NO_AUDIO", "Audio source has no audio stream", { status: 400 });
  }
  await run("ffmpeg", ["-y", "-i", videoPath, "-i", audioSource, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", outPath], signal);
}

async function normalize(paths: readonly string[], outPath: string, signal: AbortSignal): Promise<void> {
  const infos = await Promise.all(paths.map((path) => probe(path, signal)));
  const first = infos[0];
  if (!first) throw unreadable();
  const inputs = paths.flatMap((path) => ["-i", path]);
  const filters: string[] = [];
  for (const [i, info] of infos.entries()) {
    filters.push(`[${i}:v:0]scale=${first.width}:${first.height}:force_original_aspect_ratio=decrease,pad=${first.width}:${first.height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}]`);
    filters.push(info.hasAudio
      ? `[${i}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${info.durationSec},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${info.durationSec},asetpts=PTS-STARTPTS[a${i}]`);
  }
  filters.push(`${infos.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${infos.length}:v=1:a=1[v][a]`);
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", outPath], signal);
}

async function concat(paths: readonly string[], outPath: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await concatVideos([...paths], outPath, { signal });
  } catch (error) {
    if ((error as Error).message !== "CONCAT_NORMALIZE_REQUIRED") translate(error, signal);
    // Normalize mismatched clips and synthesize silence for missing audio before concatenation.
    await normalize(paths, outPath, signal);
  }
}

export function createFfmpegLocalOps(): WorkflowLocalOps {
  return { probe, frame, muxAudio, concat };
}
