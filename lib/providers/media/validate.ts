import type { MediaModelSpec, MediaSubmitRequest, MediaTask } from "./contract.js";
import { MediaJobError } from "./errors.js";
import type { MediaInputRef } from "./inputs.js";

export const MEDIA_TASKS: readonly MediaTask[] = [
  "text-to-image", "image-to-image", "image-upscale", "image-vectorize", "image-segment",
  "text-to-video", "image-to-video", "reference-to-video", "video-to-video", "video-extend",
  "video-upscale", "lipsync", "avatar", "dubbing", "subtitles",
  "text-to-audio", "video-to-audio",
];

/** POST /api/media body after shape checks; inputs are still request pointers. */
export interface MediaJobBody extends Omit<MediaSubmitRequest, "inputs"> {
  adapter?: string;
  inputs: readonly MediaInputRef[];
}

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_INPUTS = 16;
export const MAX_SHORT_STRING = 200;

function invalid(message: string): MediaJobError {
  return new MediaJobError("MEDIA_INVALID_REQUEST", message);
}

function optString(body: Record<string, unknown>, key: string, max = MAX_SHORT_STRING): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max) throw invalid(`${key} must be a string up to ${max} characters`);
  return v;
}

function optNumber(body: Record<string, unknown>, key: string, integer = false): number | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || (integer && !Number.isInteger(v))) throw invalid(`${key} must be a ${integer ? "whole " : ""}number`);
  return v;
}

function optRecord(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw invalid(`${key} must be an object`);
  return v as Record<string, unknown>;
}

function parseInputs(raw: unknown): MediaInputRef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_INPUTS) throw invalid(`inputs must be an array of at most ${MAX_INPUTS}`);
  return raw as MediaInputRef[];
}

/** Shape checks only; model-specific limits are checked by validateAgainstSpec. */
export function parseMediaJobBody(raw: unknown): MediaJobBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("Body must be a JSON object");
  const body = raw as Record<string, unknown>;
  const model = optString(body, "model");
  if (!model) throw invalid("model is required");
  const task = body.task;
  if (typeof task !== "string" || !MEDIA_TASKS.includes(task as MediaTask)) throw invalid("task is required and must be a known media task");
  const audio = body.audio;
  if (audio !== undefined && audio !== null && typeof audio !== "boolean") throw invalid("audio must be a boolean");
  const parsed: Record<string, unknown> = {
    model,
    task: task as MediaTask,
    adapter: optString(body, "adapter"),
    prompt: optString(body, "prompt", MAX_PROMPT_CHARS),
    negativePrompt: optString(body, "negativePrompt", MAX_PROMPT_CHARS),
    durationSec: optNumber(body, "durationSec"),
    resolution: optString(body, "resolution"),
    aspectRatio: optString(body, "aspectRatio"),
    seed: optNumber(body, "seed", true),
    audio: typeof audio === "boolean" ? audio : undefined,
    count: optNumber(body, "count", true),
    vendorOptions: optRecord(body, "vendorOptions"),
    inputs: parseInputs(body.inputs),
  };
  // Drop absent fields so the body carries no explicit undefined (exactOptionalPropertyTypes).
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as unknown as MediaJobBody;
}

function checkListed(value: string | number | undefined, allowed: readonly (string | number)[] | undefined, what: string, model: string): void {
  if (value === undefined || !allowed || allowed.length === 0) return;
  if (!allowed.includes(value)) throw invalid(`${model} does not support ${what} ${value} (allowed: ${allowed.join(", ")})`);
}

function countRole(body: MediaJobBody, role: string): number {
  return body.inputs.filter((i) => i.role === role).length;
}

/** Refuses parameters the chosen route's spec does not list, instead of letting the vendor guess. */
export function validateAgainstSpec(spec: MediaModelSpec, body: MediaJobBody): void {
  const p = spec.params;
  checkListed(body.durationSec, p.durationsSec, "duration", spec.id);
  checkListed(body.resolution, p.resolutions, "resolution", spec.id);
  checkListed(body.aspectRatio, p.aspectRatios, "aspect ratio", spec.id);
  if (body.negativePrompt && !p.negativePrompt) throw invalid(`${spec.id} does not accept a negative prompt`);
  if (body.seed !== undefined && !p.seed) throw invalid(`${spec.id} does not accept a seed`);
  if (body.audio === true && !p.nativeAudio) throw invalid(`${spec.id} does not generate audio`);
  const refImages = countRole(body, "reference-image");
  if (refImages > (p.maxReferenceImages ?? 0)) {
    throw invalid(`${spec.id} accepts at most ${p.maxReferenceImages ?? 0} reference images`);
  }
  const refVideos = countRole(body, "reference-video");
  if (refVideos > (p.maxReferenceVideos ?? 0)) throw invalid(`${spec.id} accepts at most ${p.maxReferenceVideos ?? 0} reference videos`);
}
