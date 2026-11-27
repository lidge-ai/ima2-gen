import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "./contract.js";
import { extFromMime } from "./mime.js";

/** Length of one input in seconds, or null when it cannot be read (a remote URL, no ffprobe, a broken file). */
export type InputLengthProbe = (input: MediaInput) => Promise<number | null>;

const PROBE_TIMEOUT_MS = 15_000;

function ffprobeSeconds(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        const seconds = error ? NaN : Number(String(stdout).trim());
        resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
      });
  });
}

/** Reads the length of an uploaded input with ffprobe. A URL input is never fetched for this. */
export const probeInputLength: InputLengthProbe = async (input) => {
  if (!input.bytes) return null;
  const dir = await mkdtemp(join(tmpdir(), "ima2-input-length-"));
  try {
    const file = join(dir, "input." + (extFromMime(input.mimeType) ?? "bin"));
    await writeFile(file, input.bytes);
    return await ffprobeSeconds(file);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
};

/**
 * Seconds a job is billed for when its price follows an input (spec.params.inputs[].billedLength).
 * The longest such input is used, so the result is an upper bound. Null when the spec has no such
 * input for this task or any of them cannot be measured: a length is never guessed.
 */
export async function billedInputSeconds(spec: MediaModelSpec, request: MediaSubmitRequest, probe: InputLengthProbe = probeInputLength): Promise<number | null> {
  const roles = new Set((spec.params.inputs ?? [])
    .filter((need) => need.billedLength && (!need.tasks || need.tasks.includes(request.task)))
    .map((need) => need.role));
  const billed = request.inputs.filter((input) => roles.has(input.role));
  if (billed.length === 0) return null;
  const lengths = await Promise.all(billed.map((input) => probe(input).catch(() => null)));
  if (lengths.some((seconds) => seconds === null)) return null;
  return Math.max(...(lengths as number[]));
}

/** The request as the price estimate should see it. The adapter keeps the original, which carries no duration. */
export function withBilledLength(request: MediaSubmitRequest, seconds: number | null): MediaSubmitRequest {
  return seconds === null || request.durationSec !== undefined ? request : { ...request, durationSec: seconds };
}
