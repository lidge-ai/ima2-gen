import { grokError } from "./grokImageCore.js";
import {
  GROK_VIDEO_MODEL_15,
  MAX_REF2V_REFERENCES,
  MAX_REFERENCE_AUDIOS,
  canonicalGrokVideoModel,
  validateGrokVideoInputs,
  validateVideoDurationForRequest,
  validateVideoResolutionForRequest,
} from "./imageModels.js";
import { hasVideoPins, validateGenerateAudio, validateVideoPins, videoPinsPayload, type VideoFramePins } from "./grokVideoPins.js";
import type { GrokVideoPlan } from "./grokVideoAdapter.js";

export interface VideoPayloadOptions {
  model: string;
  sourceImageUrl?: string | undefined;
  referenceImageUrls?: string[] | undefined;
  referenceAudios?: string[] | undefined;
  pins?: VideoFramePins | undefined;
  generateAudio?: boolean | undefined;
}

type Check = { ok: true } | { error: string; code: string; status: number };
function assertOk(check: Check): void {
  if (!("ok" in check)) throw grokError(check.error, check.status, check.code);
}

function assertVoices(model: string, voices: string[]): void {
  if (voices.length === 0) return;
  // Preset voices exist only on 1.5. Attaching them to the base model earns a 400 from
  // xAI; dropping them earns a video without the voice the user asked for. Say no.
  if (model !== GROK_VIDEO_MODEL_15) throw grokError(`reference audio requires ${GROK_VIDEO_MODEL_15}`, 400, "GROK_VIDEO_AUDIO_UNSUPPORTED_MODEL");
  if (voices.length > MAX_REFERENCE_AUDIOS) throw grokError(`at most ${MAX_REFERENCE_AUDIOS} reference voices`, 400, "GROK_VIDEO_AUDIO_TOO_MANY");
}

function assertModeInputs(plan: GrokVideoPlan, model: string, opts: VideoPayloadOptions, voices: string[]): void {
  if (plan.mode === "image-to-video" && !opts.sourceImageUrl) throw grokError("image-to-video requires a source image", 400, "GROK_VIDEO_INVALID_MODE");
  if (plan.mode !== "reference-to-video") return;
  const refs = opts.referenceImageUrls ?? [];
  // One reference (or a voice, or a pinned frame) is a legitimate reference-to-video
  // request; nothing at all is text-to-video wearing the wrong name.
  if (refs.length < 1 && voices.length === 0 && !hasVideoPins(opts.pins)) throw grokError("reference-to-video requires at least 1 reference image, voice or frame pin", 400, "GROK_VIDEO_INVALID_MODE");
  if (refs.length > MAX_REF2V_REFERENCES) throw grokError(`reference-to-video allows at most ${MAX_REF2V_REFERENCES} reference images`, 400, "GROK_VIDEO_REF_TOO_MANY");
  // On 1.5 the source is the pinned first frame (<IMAGE_0>); older models refuse the pair.
  if (opts.sourceImageUrl && model !== GROK_VIDEO_MODEL_15) throw grokError("reference-to-video cannot be combined with a single source image", 400, "GROK_VIDEO_INVALID_MODE");
}

export function buildVideoGenerationPayload(plan: GrokVideoPlan, opts: VideoPayloadOptions): Record<string, unknown> {
  const model = canonicalGrokVideoModel(opts.model);
  const voices = opts.referenceAudios ?? [];
  const refs = opts.referenceImageUrls ?? [];
  assertOk(validateGrokVideoInputs(model, { referenceCount: refs.length, voiceCount: voices.length }));
  assertOk(validateVideoPins(model, opts.pins, plan.duration, plan.resolution));
  assertOk(validateGenerateAudio(model, opts.generateAudio));
  assertVoices(model, voices);
  assertModeInputs(plan, model, opts, voices);
  assertOk(validateVideoResolutionForRequest(model, plan.resolution, plan.mode));
  // Answered here as well as at the route because the agent path builds payloads without
  // going through routes/video.ts; both read the same rule.
  assertOk(validateVideoDurationForRequest(model, plan.duration, plan.mode));
  const payload: Record<string, unknown> = { model, prompt: plan.prompt, duration: plan.duration, resolution: plan.resolution };
  if (plan.aspectRatio && plan.aspectRatio !== "auto") payload.aspect_ratio = plan.aspectRatio;
  if (opts.sourceImageUrl && plan.mode !== "text-to-video") payload.image = { url: opts.sourceImageUrl };
  if (plan.mode === "reference-to-video" && refs.length > 0) payload.reference_images = refs.map((url) => ({ url }));
  if (voices.length > 0) payload.reference_audios = voices.map((voiceId) => ({ voice_id: voiceId }));
  if (opts.generateAudio === false) payload.generate_audio = false;
  return { ...payload, ...videoPinsPayload(opts.pins) };
}
