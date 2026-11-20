/**
 * Frame pins on grok-imagine-video-1.5 (xAI guide, 2026-11): \`last_frame\` and up to four
 * \`keyframes\` ({image, timestamp_s}, 0 < t < duration, snapped to a 1/3 s grid, two pins on
 * one slot rejected). A request with pins is reference-to-video with the source as its
 * pinned first frame, so the 720p reference-to-video cap applies. Both fields are
 * guide-documented and missing from the REST/OpenAPI request schema (plan R4-F2).
 */
import { canonicalGrokVideoModel, GROK_VIDEO_MODEL_15, GROK_VIDEO_MODEL_15_LITE } from "./imageModels.js";

export interface VideoKeyframe { image: string; timestampS: number }
export interface VideoFramePins { lastFrame?: string | undefined; keyframes?: VideoKeyframe[] | undefined }
export const MAX_VIDEO_KEYFRAMES = 4;

type PinError = { error: string; code: string; status: 400 };
const fail = (code: string, error: string): PinError => ({ error, code, status: 400 });
const invalid = (error: string) => fail("GROK_VIDEO_KEYFRAMES_INVALID", error);

export function hasVideoPins(pins: VideoFramePins | undefined): boolean {
  return !!pins && (!!pins.lastFrame || (pins.keyframes?.length ?? 0) > 0);
}

/** Reads \`lastFrame\` and \`keyframes\` from an untyped request body. */
export function parseVideoPins(body: Record<string, unknown> | undefined): { pins: VideoFramePins | undefined } | PinError {
  const lastFrame = body?.lastFrame;
  if (lastFrame != null && (typeof lastFrame !== "string" || !lastFrame.trim())) return invalid("lastFrame must be an image");
  const raw = body?.keyframes;
  if (raw != null && !Array.isArray(raw)) return invalid("keyframes must be an array");
  const keyframes: VideoKeyframe[] = [];
  for (const entry of (raw as unknown[] | undefined) ?? []) {
    const item = entry as { image?: unknown; timestampS?: unknown } | null;
    if (!item || typeof item.image !== "string" || typeof item.timestampS !== "number") return invalid("each keyframe needs an image and timestampS");
    keyframes.push({ image: item.image, timestampS: item.timestampS });
  }
  const pins: VideoFramePins = { ...(typeof lastFrame === "string" ? { lastFrame } : {}), ...(keyframes.length ? { keyframes } : {}) };
  return { pins: hasVideoPins(pins) ? pins : undefined };
}

export function validateVideoPins(model: string, pins: VideoFramePins | undefined, duration: number, resolution: string): { ok: true } | PinError {
  if (!hasVideoPins(pins)) return { ok: true };
  if (canonicalGrokVideoModel(model) !== GROK_VIDEO_MODEL_15) return fail("GROK_VIDEO_PINS_UNSUPPORTED_MODEL", `frame pins require ${GROK_VIDEO_MODEL_15}`);
  if (resolution === "1080p") return fail("INVALID_VIDEO_RESOLUTION", "frame pins make a reference-to-video request, which is capped at 720p");
  const keyframes = pins?.keyframes ?? [];
  if (keyframes.length > MAX_VIDEO_KEYFRAMES) return invalid(`at most ${MAX_VIDEO_KEYFRAMES} keyframes`);
  const slots = new Set<number>();
  for (const { timestampS } of keyframes) {
    if (!(timestampS > 0 && timestampS < duration)) return invalid("keyframe timestamps must lie strictly inside the duration");
    const slot = Math.round(timestampS * 3);
    if (slots.has(slot)) return invalid("two keyframes fall on the same 1/3 s slot");
    slots.add(slot);
  }
  return { ok: true };
}

/** \`generate_audio: false\` exists on 1.5 and 1.5-lite only (guide); elsewhere it is refused. */
export function validateGenerateAudio(model: string, generateAudio: boolean | undefined): { ok: true } | PinError {
  if (generateAudio !== false) return { ok: true };
  const canonical = canonicalGrokVideoModel(model);
  return canonical === GROK_VIDEO_MODEL_15 || canonical === GROK_VIDEO_MODEL_15_LITE
    ? { ok: true }
    : fail("GROK_VIDEO_AUDIO_TOGGLE_UNSUPPORTED", "turning sound off requires grok-imagine-video-1.5 or -1.5-lite");
}

export function videoPinsPayload(pins: VideoFramePins | undefined): Record<string, unknown> {
  if (!hasVideoPins(pins)) return {};
  return {
    ...(pins?.lastFrame ? { last_frame: { url: pins.lastFrame } } : {}),
    ...(pins?.keyframes?.length ? { keyframes: pins.keyframes.map(({ image, timestampS }) => ({ image: { url: image }, timestamp_s: timestampS })) } : {}),
  };
}

/** Route entry: parse pins and the sound toggle from a body and validate them together. */
export function readVideoPinRequest(body: Record<string, unknown> | undefined, model: string, duration: number, resolution: string):
  { pins: VideoFramePins | undefined; generateAudio: false | undefined } | PinError {
  const parsed = parseVideoPins(body);
  if ("error" in parsed) return parsed;
  const generateAudio = body?.generateAudio === false ? false : undefined;
  const pinCheck = validateVideoPins(model, parsed.pins, duration, resolution);
  if ("error" in pinCheck) return pinCheck;
  const audioCheck = validateGenerateAudio(model, generateAudio);
  return "error" in audioCheck ? audioCheck : { pins: parsed.pins, generateAudio };
}
