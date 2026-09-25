import type { RouteRuntimeContext } from "./runtimeContext.js";
import { deriveModels, deriveSupportedImageModels, deriveUnsupportedImageModels } from "./providers/derive.js";

export const FALLBACK_IMAGE_MODEL = "gpt-6-luna";
const VALID_IMAGE_MODELS = deriveSupportedImageModels("oauth");
const VALID_API_IMAGE_MODELS = deriveSupportedImageModels("api");

/**
 * GPT OAuth keeps only GPT-6 (sol / luna / astra). Earlier OAuth ids stay usable in saved
 * defaults, sessions and scripts by mapping to the matching GPT-6 tier, inside the same lane
 * and billing. The API-key lane keeps its own list and is never remapped.
 */
export const LEGACY_OAUTH_IMAGE_MODELS: Readonly<Record<string, string>> = {
  "gpt-5.6-sol": "gpt-6-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.6-terra": "gpt-6-luna",
  "gpt-5.5": "gpt-6-luna",
  "gpt-5.4": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-6-luna",
};

/** Map a legacy OAuth image model id onto its GPT-6 replacement; anything else is unchanged. */
export function migrateOAuthImageModel(model: string): string {
  return LEGACY_OAUTH_IMAGE_MODELS[model] ?? model;
}
const UNSUPPORTED_IMAGE_MODELS = deriveUnsupportedImageModels();
const FALLBACK_REASONING_EFFORT = "none";
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export const GROK_FALLBACK_IMAGE_MODEL = "grok-imagine-image-2.0";

/**
 * Models that reject `reasoning.effort: "none"` upstream.
 *
 * GPT-6 Astra accepts low/medium/high/xhigh/max but not "none", while this app's
 * own default effort is "none". Without a coercion here, simply selecting Astra
 * in the UI would fail the request before an image is ever generated. OpenAI's
 * migration guidance names "low" as the replacement for "none"/"minimal", so
 * that is what a "none" request becomes for these models. Every other model is
 * untouched, and an explicit effort is never downgraded.
 */
const MODELS_WITHOUT_NONE_EFFORT = new Set(["gpt-6-astra"]);

/** Coerce only the unsupported pairing; any other model/effort passes through. */
export function coerceReasoningEffortForModel(model: string | undefined, effort: string | undefined): string | undefined {
  if (effort !== "none" || model === undefined) return effort;
  return MODELS_WITHOUT_NONE_EFFORT.has(model) ? "low" : effort;
}

// xAI's current flagship Imagine image model. The legacy "quality" knob used to
// swap in grok-imagine-image-quality; 2.0 supersedes it for high-quality work,
// so the knob now resolves here. An explicit user selection is never downgraded.
export const GROK_QUALITY_IMAGE_MODEL = "grok-imagine-image-2.0";
const VALID_GROK_IMAGE_MODELS = deriveModels("grok", "image");

/**
 * Resolve the Grok image model for a request, honoring the high-quality knob.
 * Returns the caller's model untouched unless quality === "high".
 */
export function resolveGrokQualityModel(model: string | undefined, quality: unknown): string {
  if (quality !== "high") return model ?? GROK_FALLBACK_IMAGE_MODEL;
  return GROK_QUALITY_IMAGE_MODEL;
}

const GEMINI_API_FALLBACK_IMAGE_MODEL = "nano-banana-2";
const VALID_GEMINI_API_MODELS = deriveModels("gemini-api", "image");
const ATLASCLOUD_FALLBACK_IMAGE_MODEL = "openai/gpt-image-2/text-to-image";
const VALID_ATLASCLOUD_IMAGE_MODELS = deriveModels("atlascloud", "image");
const MINIMAX_FALLBACK_IMAGE_MODEL = "image-01";
const VALID_MINIMAX_IMAGE_MODELS = deriveModels("minimax", "image");
const NAI_FALLBACK_IMAGE_MODEL = "nai-diffusion-5-full";
const VALID_NAI_IMAGE_MODELS = deriveModels("nai", "image");

export function normalizeReasoningEffort(ctx: RouteRuntimeContext | null | undefined, rawEffort: unknown) {
  const configured = (ctx?.config as { imageModels?: { reasoningEffort?: string; validReasoningEfforts?: Set<string> } } | undefined)?.imageModels;
  const fallback = configured?.reasoningEffort ?? FALLBACK_REASONING_EFFORT;
  const valid = configured?.validReasoningEfforts ?? VALID_REASONING_EFFORTS;

  if (typeof rawEffort !== "string" || rawEffort.length === 0) {
    return { effort: valid.has(fallback) ? fallback : FALLBACK_REASONING_EFFORT };
  }
  if (!valid.has(rawEffort)) {
    return {
      error: "reasoningEffort must be one of: none, low, medium, high, xhigh, max",
      code: "INVALID_REASONING_EFFORT",
      status: 400,
    };
  }
  return { effort: rawEffort };
}

export function normalizeImageModel(
  ctx: RouteRuntimeContext | null | undefined,
  rawModel: unknown,
  provider: "oauth" | "api" = "oauth",
) {
  const configured = (ctx?.config as { imageModels?: { default?: string; valid?: Set<string>; unsupported?: Set<string> } } | undefined)?.imageModels;
  const oauth = provider === "oauth";
  const fallback = oauth ? migrateOAuthImageModel(configured?.default ?? FALLBACK_IMAGE_MODEL) : FALLBACK_IMAGE_MODEL;
  const valid = oauth ? (configured?.valid ?? VALID_IMAGE_MODELS) : VALID_API_IMAGE_MODELS;
  const unsupported = configured?.unsupported ?? UNSUPPORTED_IMAGE_MODELS;

  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: valid.has(fallback) ? fallback : FALLBACK_IMAGE_MODEL };
  }

  const model = oauth ? migrateOAuthImageModel(rawModel) : rawModel;
  if (unsupported.has(model)) {
    return {
      error: `model does not support image generation: ${model}`,
      code: "IMAGE_MODEL_UNSUPPORTED",
      status: 400,
    };
  }

  if (!valid.has(model)) {
    return {
      error: `model must be one of: ${[...valid].join(", ")}`,
      code: "INVALID_IMAGE_MODEL",
      status: 400,
    };
  }

  return { model };
}

export function normalizeGrokImageModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GROK_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_GROK_IMAGE_MODELS.has(rawModel)) {
    return {
      error: `Grok image model must be one of: ${[...VALID_GROK_IMAGE_MODELS].join(", ")}`,
      code: "INVALID_GROK_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeGeminiApiModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GEMINI_API_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_GEMINI_API_MODELS.has(rawModel)) {
    return {
      error: `Gemini API image model must be one of: ${[...VALID_GEMINI_API_MODELS].join(", ")}`,
      code: "INVALID_GEMINI_API_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeNaiImageModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: NAI_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_NAI_IMAGE_MODELS.has(rawModel)) {
    return {
      error: `NovelAI image model must be one of: ${[...VALID_NAI_IMAGE_MODELS].join(", ")}`,
      code: "INVALID_NAI_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeAtlasCloudImageModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: ATLASCLOUD_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_ATLASCLOUD_IMAGE_MODELS.has(rawModel)) {
    return {
      error: `Atlas Cloud image model must be one of: ${[...VALID_ATLASCLOUD_IMAGE_MODELS].join(", ")}`,
      code: "INVALID_ATLASCLOUD_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeMinimaxImageModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: MINIMAX_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_MINIMAX_IMAGE_MODELS.has(rawModel)) {
    return {
      error: `MiniMax image model must be one of: ${[...VALID_MINIMAX_IMAGE_MODELS].join(", ")}`,
      code: "INVALID_MINIMAX_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

/**
 * The comfy lane has no compile-time model set: a "model" is a workflow the
 * user registered, so deriveModels("comfy", "image") is empty BY DESIGN and a
 * membership check would reject every valid id.
 *
 * This validates SHAPE only — the same closed alphabet the workflow store
 * enforces — and existence is checked in the pipeline, which can await the
 * store. Splitting it keeps this module synchronous and free of storage
 * dependencies.
 *
 * There is deliberately no fallback model. Every other lane defaults an empty
 * input to a sensible flagship; comfy has no such thing, because the order the
 * user registered workflows in carries no meaning. Picking "the first one"
 * would silently run a graph nobody asked for on a local GPU.
 */
const COMFY_WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeComfyWorkflowModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return {
      error: "provider 'comfy' requires an explicit workflow id as the model",
      code: "COMFY_WORKFLOW_REQUIRED" as const,
      status: 400 as const,
    };
  }
  if (!COMFY_WORKFLOW_ID_RE.test(rawModel)) {
    return {
      error: "ComfyUI workflow id must be 1-64 chars of lowercase letters, digits, '-' or '_'",
      code: "INVALID_COMFY_WORKFLOW_ID" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

// ── Grok video (T2V/I2V) ─────────────────────────────────────────────────
// Video is a separate generation kind, not an image model. Keep it out of the
// image model unions/helpers above so `grok-` image classification is unaffected.
export const GROK_VIDEO_MODEL_BASE = "grok-imagine-video";
export const GROK_VIDEO_MODEL_15 = "grok-imagine-video-1.5";
export const GROK_VIDEO_MODEL_15_PREVIEW_ALIAS = "grok-imagine-video-1.5-preview";
// GET /v1/video-generation-models lists this alongside -preview. Without it a legal
// model id is rejected locally with INVALID_GROK_VIDEO_MODEL before the request ever
// reaches xAI. Verified 2026-09-08: devlog/_plan/260908_xai_imagine_spec_resync.
export const GROK_VIDEO_MODEL_15_DATED_ALIAS = "grok-imagine-video-1.5-2026-05-30";
export const GROK_FALLBACK_VIDEO_MODEL = GROK_VIDEO_MODEL_15;
export const VALID_GROK_VIDEO_MODELS = new Set([
  ...deriveModels("grok", "video"),
  GROK_VIDEO_MODEL_15_PREVIEW_ALIAS,
  GROK_VIDEO_MODEL_15_DATED_ALIAS,
]);
export const VALID_VIDEO_RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
export const VALID_VIDEO_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "auto",
]);
export const MIN_VIDEO_DURATION = 1;
export const MAX_VIDEO_DURATION = 15;
// reference-to-video (xAI): up to 14 reference images, 720p max.
//
// The cap doubled from 7. 15 returns 400 "Too many reference images: 15. Maximum
// allowed is 14." and 30 names the same number, on BOTH video models, so it is a
// model-independent limit. @imagine announced it on 2026-09-02; the API docs still
// say 7, which is why the measurement is the source here and not the page.
// Re-verified against api.x.ai on 2026-09-08:
// devlog/_plan/260908_xai_imagine_spec_resync/000_research.md
export const MAX_REF2V_REFERENCES = 14;
// reference-to-video carries its own duration ceiling, and it differs by model. The
// same 16s request answers "maximum allowed for reference-to-video, which is 15s" on
// grok-imagine-video-1.5 and "... is 10s" on grok-imagine-video.
//
// This is NOT the ceiling removed in 260820. That one was invented locally and applied
// to every model against evidence. This one is the upstream's own per-model rule, and
// omitting it turns a legal-looking base-model request into an upstream 400 the user
// pays a planning round for.
export const MAX_REF2V_DURATION_15 = 15;
export const MAX_REF2V_DURATION_BASE = 10;
// reference_audios: preset voices, grok-imagine-video-1.5 only. 4 -> 400.
export const MAX_REFERENCE_AUDIOS = 3;

export type GrokVideoModel =
  | typeof GROK_VIDEO_MODEL_BASE
  | typeof GROK_VIDEO_MODEL_15
  | typeof GROK_VIDEO_MODEL_15_PREVIEW_ALIAS
  | typeof GROK_VIDEO_MODEL_15_DATED_ALIAS;
export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "auto";
export type VideoMode = "text-to-video" | "image-to-video" | "reference-to-video";

/**
 * Count-only fallback for callers that have lost track of WHICH slot each image
 * arrived in.
 *
 * A single image is ambiguous on its own: as a first frame it means image-to-video,
 * as a reference it means reference-to-video, and the count cannot tell them apart.
 * This returns the historical default (image-to-video) so old callers keep their
 * behavior — it is a fallback, not a ceiling. Callers that DO know the slot should
 * use `deriveVideoMode` in lib/videoGenerationRequest.ts, which reads intent from
 * the field the caller chose.
 */
export function deriveVideoMode(refCount: number): VideoMode {
  if (refCount >= 2) return "reference-to-video";
  if (refCount === 1) return "image-to-video";
  return "text-to-video";
}

export function isGrokVideoModel(value: unknown): value is GrokVideoModel {
  return typeof value === "string" && VALID_GROK_VIDEO_MODELS.has(value);
}

/**
 * Folds every alias onto the id xAI bills and validates against.
 *
 * Three call sites used to inline `model === PREVIEW_ALIAS ? GROK_VIDEO_MODEL_15 : model`,
 * which is exactly one alias' worth of knowledge duplicated three times. Adding the dated
 * alias would have had to find all three; one of them would have been missed.
 *
 * Passes non-Grok ids through unchanged: comfy hands a workflow id down this same
 * `model` field (routes/video.ts), and rewriting it would be worse than leaving it alone.
 */
export function canonicalGrokVideoModel(model: string): string {
  return model === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS || model === GROK_VIDEO_MODEL_15_DATED_ALIAS
    ? GROK_VIDEO_MODEL_15
    : model;
}

/**
 * The reference-to-video duration ceiling for a model, or null when the rule does not
 * apply to it.
 *
 * Null is not "unknown" and not "no limit": it means xAI's per-model r2v rule has no
 * jurisdiction here. A comfy workflow id arrives through the same `model` field, and
 * answering the base model's 10s for it would clamp a lane whose ceiling xAI does not
 * own. Callers must handle null explicitly rather than let it fall through to a number.
 */
export function maxRef2vDuration(model: string): number | null {
  if (!isGrokVideoModel(model)) return null;
  return canonicalGrokVideoModel(model) === GROK_VIDEO_MODEL_15
    ? MAX_REF2V_DURATION_15
    : MAX_REF2V_DURATION_BASE;
}

/**
 * Validates a duration against the ceiling its mode and model actually impose.
 *
 * Returns ok for every non-reference-to-video request: normalizeVideoDuration already
 * owns the shared 1-15 bound, and re-checking it here would give one rule two owners.
 */
export function validateVideoDurationForRequest(model: string, duration: number, mode: VideoMode) {
  if (mode !== "reference-to-video") return { ok: true as const };
  const ceiling = maxRef2vDuration(model);
  if (ceiling === null || duration <= ceiling) return { ok: true as const };
  return {
    error: `reference-to-video on ${model} allows at most ${ceiling} seconds`,
    code: "INVALID_VIDEO_DURATION" as const,
    status: 400 as const,
  };
}

export function normalizeGrokVideoModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GROK_FALLBACK_VIDEO_MODEL };
  }
  if (!VALID_GROK_VIDEO_MODELS.has(rawModel)) {
    return {
      error: `Grok video model must be one of: ${[...VALID_GROK_VIDEO_MODELS].join(", ")}`,
      code: "INVALID_GROK_VIDEO_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: canonicalGrokVideoModel(rawModel) };
}

export function normalizeVideoResolution(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { resolution: "480p" as const };
  if (typeof raw !== "string" || !VALID_VIDEO_RESOLUTIONS.has(raw)) {
    return {
      error: `resolution must be one of: ${[...VALID_VIDEO_RESOLUTIONS].join(", ")}`,
      code: "INVALID_VIDEO_RESOLUTION" as const,
      status: 400 as const,
    };
  }
  return { resolution: raw as VideoResolution };
}

export function usesGrokVideo15TextCanvasShim(model: string, mode: VideoMode): boolean {
  return canonicalGrokVideoModel(model) === GROK_VIDEO_MODEL_15 && mode === "text-to-video";
}

export function validateVideoResolutionForRequest(
  model: string,
  resolution: VideoResolution,
  mode: VideoMode,
  options: { allowTextCanvasShim?: boolean } = {},
) {
  if (resolution !== "1080p") return { ok: true as const };
  // A non-Grok model reaches this function too: comfy passes its workflow id through the
  // same field. xAI's 1080p rule says nothing about a locally-run workflow, so refusing
  // one here would be this codebase inventing a limit rather than enforcing a real one.
  if (!isGrokVideoModel(model)) return { ok: true as const };
  const canonicalModel = canonicalGrokVideoModel(model);
  if (canonicalModel === GROK_VIDEO_MODEL_15 && mode === "image-to-video") {
    return { ok: true as const };
  }
  if (options.allowTextCanvasShim && usesGrokVideo15TextCanvasShim(canonicalModel, mode)) {
    return { ok: true as const };
  }
  return {
    error: "1080p video resolution requires grok-imagine-video-1.5 text-to-video with the canvas shim or image-to-video",
    code: "INVALID_VIDEO_RESOLUTION" as const,
    status: 400 as const,
  };
}

export function normalizeVideoAspectRatio(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { aspectRatio: "auto" as const };
  if (typeof raw !== "string" || !VALID_VIDEO_ASPECT_RATIOS.has(raw)) {
    return {
      error: `aspectRatio must be one of: ${[...VALID_VIDEO_ASPECT_RATIOS].join(", ")}`,
      code: "INVALID_VIDEO_ASPECT_RATIO" as const,
      status: 400 as const,
    };
  }
  return { aspectRatio: raw as VideoAspectRatio };
}

export function normalizeVideoDuration(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { duration: 5 };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < MIN_VIDEO_DURATION || n > MAX_VIDEO_DURATION) {
    return {
      error: `duration must be an integer between ${MIN_VIDEO_DURATION} and ${MAX_VIDEO_DURATION} seconds`,
      code: "INVALID_VIDEO_DURATION" as const,
      status: 400 as const,
    };
  }
  return { duration: n };
}
