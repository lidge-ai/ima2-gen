import type { ImageModel, OpenAIImageModel, GeminiImageModel, AtlasCloudImageModel, MinimaxImageModel, NaiImageModel, Provider, UnsupportedImageModel, VideoModel } from "../types";
import { PROVIDER_MODELS } from "../generated/providers";
import type { ImageToolModel, Quality } from "../types";

export const API_IMAGE_TOOL_MODEL_OPTIONS = [
  { value: "gpt-image-2.5-sunburst", label: "GPT Image2.5 Sunburst" },
  { value: "gpt-image-2.5-flare", label: "GPT Image2.5 Flare" },
] as const;

export function isImageToolModel(value: unknown): value is ImageToolModel {
  return API_IMAGE_TOOL_MODEL_OPTIONS.some((option) => option.value === value);
}

export function normalizeImageQuality(provider: unknown, imageToolModel: unknown, quality: Quality): Quality {
  if ((quality === "xhigh" || quality === "max") && (provider !== "api" || !isImageToolModel(imageToolModel))) {
    return "medium";
  }
  return quality;
}

export const DEFAULT_IMAGE_MODEL: ImageModel = "gpt-6-luna";
export const IMAGE_MODEL_STORAGE_KEY = "ima2.imageModel";

export const IMAGE_MODEL_OPTIONS: Array<{
  value: ImageModel;
  shortLabel: string;
  fullLabelKey: string;
  providerHint?: Provider;
}> = [
  { value: "gpt-6-luna", shortLabel: "6l", fullLabelKey: "settings.imageModel.gpt6Luna" },
  { value: "gpt-6-sol", shortLabel: "6s", fullLabelKey: "settings.imageModel.gpt6Sol" },
  { value: "gpt-6-astra", shortLabel: "6a", fullLabelKey: "settings.imageModel.gpt6Astra" },
  { value: "gpt-5.6-luna", shortLabel: "5.6l", fullLabelKey: "settings.imageModel.gpt56Luna", providerHint: "api" },
  { value: "gpt-5.6-terra", shortLabel: "5.6t", fullLabelKey: "settings.imageModel.gpt56Terra", providerHint: "api" },
  { value: "gpt-5.6-sol", shortLabel: "5.6s", fullLabelKey: "settings.imageModel.gpt56Sol", providerHint: "api" },
  { value: "gpt-5.5", shortLabel: "5.5", fullLabelKey: "settings.imageModel.gpt55", providerHint: "api" },
  { value: "gpt-5.4", shortLabel: "5.4", fullLabelKey: "settings.imageModel.gpt54", providerHint: "api" },
  { value: "gpt-5.4-mini", shortLabel: "5.4m", fullLabelKey: "settings.imageModel.gpt54Mini", providerHint: "api" },
  { value: "grok-imagine-image-2.0", shortLabel: "grok2", fullLabelKey: "settings.imageModel.grokImagine20" },
  { value: "grok-imagine-image-quality", shortLabel: "grok+", fullLabelKey: "settings.imageModel.grokImagineQuality" },
  { value: "grok-imagine-image", shortLabel: "grok", fullLabelKey: "settings.imageModel.grokImagine" },
  { value: "nano-banana-2", shortLabel: "nb2 agy", fullLabelKey: "settings.imageModel.nanoBanana2", providerHint: "agy" },
  { value: "nano-banana-2", shortLabel: "nb2 api", fullLabelKey: "settings.imageModel.nanoBanana2Api", providerHint: "gemini-api" },
  { value: "nano-banana-pro", shortLabel: "nbp agy", fullLabelKey: "settings.imageModel.nanoBananaPro", providerHint: "agy" },
  { value: "nano-banana-pro", shortLabel: "nbp api", fullLabelKey: "settings.imageModel.nanoBananaPro", providerHint: "gemini-api" },
  { value: "openai/gpt-image-2/text-to-image", shortLabel: "atlas", fullLabelKey: "settings.imageModel.atlasCloudGptImage2", providerHint: "atlascloud" },
  { value: "openai/gpt-image-2/edit", shortLabel: "atlas edit", fullLabelKey: "settings.imageModel.atlasCloudGptImage2Edit", providerHint: "atlascloud" },
  { value: "image-01", shortLabel: "minimax", fullLabelKey: "settings.imageModel.minimaxImage01", providerHint: "minimax" },
  { value: "image-01-live", shortLabel: "minimax live", fullLabelKey: "settings.imageModel.minimaxImage01Live", providerHint: "minimax" },
  { value: "nai-diffusion-5-full", shortLabel: "nai v5", fullLabelKey: "settings.imageModel.naiDiffusion5Full", providerHint: "nai" },
  { value: "nai-diffusion-5-curated", shortLabel: "nai v5 cur", fullLabelKey: "settings.imageModel.naiDiffusion5Curated", providerHint: "nai" },
  { value: "nai-diffusion-4-5-full", shortLabel: "nai v4.5", fullLabelKey: "settings.imageModel.naiDiffusion45Full", providerHint: "nai" },
  { value: "nai-diffusion-4-5-curated", shortLabel: "nai v4.5 cur", fullLabelKey: "settings.imageModel.naiDiffusion45Curated", providerHint: "nai" },
];

const GEMINI_MODEL_VALUES = new Set<string>(PROVIDER_MODELS["gemini-api"].image);
const ATLASCLOUD_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.atlascloud.image);
const MINIMAX_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.minimax.image);
const NAI_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.nai.image);

const OAUTH_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.oauth.image);
const API_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.api.image);

type OpenAIOption = { value: OpenAIImageModel; shortLabel: string; fullLabelKey: string };

/** GPT OAuth (the default GPT lane): GPT-6 sol / luna / astra. */
export const OAUTH_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is OpenAIOption => OAUTH_MODEL_VALUES.has(option.value),
);

/** OpenAI API key lane: the models the OpenAI API serves, its own default first. */
const API_PICKER_ORDER = ["gpt-5.6-luna", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
export const API_IMAGE_MODEL_OPTIONS = API_PICKER_ORDER
  .map((value) => IMAGE_MODEL_OPTIONS.find((option) => option.value === value))
  .filter((option): option is OpenAIOption => option !== undefined && API_MODEL_VALUES.has(option.value));

/** The GPT group in pickers that switch lanes by model: the OAuth lane's models. */
export const OPENAI_IMAGE_MODEL_OPTIONS = OAUTH_IMAGE_MODEL_OPTIONS;

export const GROK_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter((option) =>
  option.value.startsWith("grok-"),
);

export const GEMINI_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: GeminiImageModel; shortLabel: string; fullLabelKey: string; providerHint?: Provider } =>
    GEMINI_MODEL_VALUES.has(option.value),
);

export const ATLASCLOUD_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: AtlasCloudImageModel; shortLabel: string; fullLabelKey: string; providerHint?: Provider } =>
    ATLASCLOUD_MODEL_VALUES.has(option.value),
);

export const MINIMAX_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: MinimaxImageModel; shortLabel: string; fullLabelKey: string; providerHint?: Provider } =>
    MINIMAX_MODEL_VALUES.has(option.value),
);

export const NAI_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: NaiImageModel; shortLabel: string; fullLabelKey: string; providerHint?: Provider } =>
    NAI_MODEL_VALUES.has(option.value),
);

export const UNSUPPORTED_IMAGE_MODELS: Array<{
  value: UnsupportedImageModel;
  fullLabelKey: string;
}> = [];

export function isImageModel(value: unknown): value is ImageModel {
  return IMAGE_MODEL_OPTIONS.some((option) => option.value === value);
}

export function isGrokImageModel(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("grok-");
}

export function isGeminiImageModel(value: unknown): boolean {
  return typeof value === "string" && GEMINI_MODEL_VALUES.has(value);
}

export function isAtlasCloudImageModel(value: unknown): boolean {
  return typeof value === "string" && ATLASCLOUD_MODEL_VALUES.has(value);
}

export function isMinimaxImageModel(value: unknown): boolean {
  return typeof value === "string" && MINIMAX_MODEL_VALUES.has(value);
}

export function isNaiImageModel(value: unknown): boolean {
  return typeof value === "string" && NAI_MODEL_VALUES.has(value);
}

export function getImageModelOptionsForProvider(provider: Provider) {
  if (provider === "grok" || provider === "grok-api") return GROK_IMAGE_MODEL_OPTIONS;
  // The two Gemini lanes share catalog values, so the family list carries one
  // row per lane ("nbp agy" vs "nbp api"). Returning it whole would list each
  // value twice and label the stored model with whichever row sorts first —
  // each lane gets its own hinted rows plus any lane-agnostic ones, matching
  // the resolver pickers use for the stored value.
  if (provider === "agy" || provider === "gemini-api") {
    return GEMINI_IMAGE_MODEL_OPTIONS.filter(
      (option) => !option.providerHint || option.providerHint === provider,
    );
  }
  if (provider === "atlascloud") return ATLASCLOUD_IMAGE_MODEL_OPTIONS;
  if (provider === "minimax") return MINIMAX_IMAGE_MODEL_OPTIONS;
  if (provider === "nai") return NAI_IMAGE_MODEL_OPTIONS;
  // Comfy has no static option rows: its models are workflows fetched from
  // /api/models at runtime. Falling through to the OpenAI list would show
  // gpt-5.6-luna under a ComfyUI selection and send a model the lane cannot
  // execute.
  if (provider === "comfy") return [];
  if (provider === "api") return API_IMAGE_MODEL_OPTIONS;
  return OAUTH_IMAGE_MODEL_OPTIONS;
}

export function getImageModelShortLabel(value: string | null | undefined, provider?: string | null): string | null {
  if (!value) return null;
  if (GEMINI_MODEL_VALUES.has(value)) {
    const suffix = provider === "gemini-api" ? "gemini-api" : provider === "agy" ? "agy" : provider || "agy";
    return `${value} ${suffix}`;
  }
  if (ATLASCLOUD_MODEL_VALUES.has(value)) return provider === "atlascloud" ? "gpt-image-2 atlas" : value;
  if (MINIMAX_MODEL_VALUES.has(value)) return provider === "minimax" ? `${value} minimax` : value;
  if (NAI_MODEL_VALUES.has(value)) {
    return IMAGE_MODEL_OPTIONS.find((option) => option.value === value)?.shortLabel ?? value;
  }
  return IMAGE_MODEL_OPTIONS.find((option) => option.value === value)?.shortLabel ?? value;
}

// ── Grok video model (separate kind from image models) ───────────────────
export const GROK_VIDEO_MODEL_BASE = "grok-imagine-video";
export const GROK_VIDEO_MODEL_15 = "grok-imagine-video-1.5";
export const GROK_VIDEO_MODEL_15_PREVIEW_ALIAS = "grok-imagine-video-1.5-preview";
// GET /v1/video-generation-models reports this alias alongside -preview. Kept in sync
// with lib/imageModels.ts by tests/xai-video-model-alias-contract.test.ts: the two
// files cannot import each other across the build boundary, so a test holds the seam.
export const GROK_VIDEO_MODEL_15_DATED_ALIAS = "grok-imagine-video-1.5-2026-05-30";

// reference-to-video's ceiling depends on the model. See lib/imageModels.ts for the
// measurements; the same numbers live here so the slider cannot offer a duration the
// server will reject.
export const MAX_REF2V_DURATION_15_UI = 15;
export const MAX_REF2V_DURATION_BASE_UI = 10;
export const MAX_VIDEO_DURATION_UI = 15;

export const VIDEO_MODEL_OPTIONS: Array<{ value: VideoModel; shortLabel: string; fullLabelKey: string }> = [
  { value: GROK_VIDEO_MODEL_BASE, shortLabel: "grokv", fullLabelKey: "settings.videoModel.grokImagine" },
  { value: GROK_VIDEO_MODEL_15, shortLabel: "grokv1.5", fullLabelKey: "settings.videoModel.grokImagine15" },
];

export function isVideoModelValue(v: unknown): v is VideoModel {
  return v === GROK_VIDEO_MODEL_BASE
    || v === GROK_VIDEO_MODEL_15
    || v === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS
    || v === GROK_VIDEO_MODEL_15_DATED_ALIAS;
}

export function normalizeVideoModelValue(v: unknown): VideoModel | false {
  if (!isVideoModelValue(v)) return false;
  return v === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS || v === GROK_VIDEO_MODEL_15_DATED_ALIAS
    ? GROK_VIDEO_MODEL_15
    : v;
}

/**
 * The longest duration this model and mode will actually accept.
 *
 * Only reference-to-video has a model-specific ceiling; everything else is bounded by
 * the shared 15s. A model this UI does not recognize (a comfy workflow, say) gets the
 * shared bound rather than Grok's, for the same reason the server returns null there:
 * xAI's rule says nothing about a lane it does not run.
 */
export function maxVideoDurationUI(model: string | false, mode: string): number {
  if (mode !== "reference-to-video") return MAX_VIDEO_DURATION_UI;
  const normalized = normalizeVideoModelValue(model);
  if (!normalized) return MAX_VIDEO_DURATION_UI;
  return normalized === GROK_VIDEO_MODEL_15 ? MAX_REF2V_DURATION_15_UI : MAX_REF2V_DURATION_BASE_UI;
}

// Two or more attachments can only be references — that is the only shape the API
// takes. Exactly one is ambiguous, so the caller passes the user's choice; treating
// a lone attachment as a reference by fiat is what broke first-frame workflows in
// v3.8.0 (issue #164).
export function deriveVideoModeUI(
  refCount: number,
  singleRefMode: "image-to-video" | "reference-to-video" = "image-to-video",
): "text-to-video" | "image-to-video" | "reference-to-video" {
  if (refCount >= 2) return "reference-to-video";
  if (refCount === 1) return singleRefMode;
  return "text-to-video";
}

export function supportsVideoResolutionUI(model: string | false, resolution: string, mode: string): boolean {
  if (resolution !== "1080p") return true;
  return model === GROK_VIDEO_MODEL_15 && (mode === "text-to-video" || mode === "image-to-video");
}

// ── Model-select display value ───────────────────────────────────────────
// Encodings the model Select uses to tell three kinds of selection apart in one
// control. They live here rather than in the component because the resolver
// below and the component's option rows must agree on them; two copies is how
// a value stops matching its own option.
export const COMFY_VIDEO_VALUE_PREFIX = "comfy-video:";
export const VIDEO_VALUE_PREFIX = "video:";

/**
 * The value the model Select shows as selected, gated by the lane that is
 * actually offering options.
 *
 * `Select` finds its trigger label by matching this value against the option
 * rows it rendered; an unmatched value falls through to an empty label, so a
 * control that says "GPT" ends up naming no model at all. That is exactly what
 * happened: the previous inline version preferred `comfyVideoWorkflow` and then
 * `videoModel` over `imageModel` REGARDLESS of provider, so a comfy video
 * workflow left over from the comfy lane (which `setProviderImpl` did not clear
 * on the way out, and which persists in generation defaults) kept winning under
 * GPT — where no `comfy-video:` row exists.
 *
 * Gating every lane-specific value means the resolver can only ever return
 * something the current lane also lists. That holds even if the store state is
 * inconsistent, which makes the display safe independently of whether the state
 * layer is: two separate defenses, not one restated twice.
 */
export function resolveCoreModelValue(input: {
  provider: Provider;
  imageModel: string;
  // Widened to match what the store selectors actually hand over: these slices
  // are optional on the persisted-defaults type, so a caller can legally read
  // undefined before a value has ever been stored.
  videoModel: string | false | null | undefined;
  comfyWorkflow?: string | null;
  comfyVideoWorkflow: string | null | undefined;
}): string {
  const { provider, imageModel, videoModel, comfyWorkflow, comfyVideoWorkflow } = input;
  if (provider === "comfy") {
    return comfyVideoWorkflow ? `${COMFY_VIDEO_VALUE_PREFIX}${comfyVideoWorkflow}` : comfyWorkflow ?? "";
  }
  // Grok video rows are the only ones `video:` values are rendered for, because
  // selectVideoModel normalizes to a Grok id and would drag the provider along.
  if (provider === "grok" || provider === "grok-api") {
    return videoModel ? `${VIDEO_VALUE_PREFIX}${videoModel}` : imageModel;
  }
  return imageModel;
}
