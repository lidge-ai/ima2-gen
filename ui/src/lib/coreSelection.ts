import type { ImageModel, Provider, VideoModel } from "../types";
import { CORE_PROVIDER_IDS, IMAGE_MODEL_IDS, isCoreProviderId, PROVIDER_MODELS } from "../generated/providers";
import { DEFAULT_IMAGE_MODEL, normalizeVideoModelValue } from "./imageModels";

export interface CoreSelectionState {
  provider: Provider;
  imageModel: ImageModel;
  videoModelSelected: VideoModel | false;
  comfyWorkflow: string | null;
  comfyVideoWorkflow: string | null;
}

export interface CoreSelectionInput {
  provider?: unknown;
  imageModel?: unknown;
  videoModelSelected?: unknown;
  comfyWorkflow?: unknown;
  comfyVideoWorkflow?: unknown;
}

export interface RememberedCoreSelection {
  image?: string;
  video?: string;
  kind: "image" | "video";
}

export type CoreSelectionMemory = Partial<Record<Provider, RememberedCoreSelection>>;

const staticIds: ReadonlySet<string> = new Set(IMAGE_MODEL_IDS);
const defaults: Record<Provider, ImageModel> = {
  oauth: DEFAULT_IMAGE_MODEL, api: "gpt-5.6-luna",
  grok: "grok-imagine-image-2.0", "grok-api": "grok-imagine-image-2.0",
  agy: "nano-banana-2", "gemini-api": "nano-banana-pro",
  atlascloud: "openai/gpt-image-2/text-to-image", minimax: "image-01",
  nai: "nai-diffusion-5-full", comfy: DEFAULT_IMAGE_MODEL,
};

/** GPT OAuth kept only GPT-6; a remembered pre-GPT-6 pick moves to its GPT-6 tier (server rule). */
const LEGACY_OAUTH_MODELS: Readonly<Record<string, ImageModel>> = {
  "gpt-5.6-sol": "gpt-6-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.6-terra": "gpt-6-luna",
  "gpt-5.5": "gpt-6-luna",
  "gpt-5.4": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-6-luna",
};

function staticImage(provider: Provider, value: unknown): value is ImageModel {
  return typeof value === "string" && staticIds.has(value)
    && (PROVIDER_MODELS[provider].image as readonly string[]).includes(value);
}

function workflow(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function inferProvider(model: unknown, video: unknown): Provider {
  if (normalizeVideoModelValue(video)) return "grok";
  for (const provider of ["grok", "agy", "atlascloud", "minimax", "nai"] as const) {
    if (staticImage(provider, model)) return provider;
  }
  return "oauth";
}

export function reconcileCoreSelection(input: CoreSelectionInput): CoreSelectionState {
  const provider = isCoreProviderId(input.provider)
    ? input.provider : inferProvider(input.imageModel, input.videoModelSelected);
  if (provider === "comfy") {
    const legacy = workflow(input.imageModel);
    return {
      provider,
      imageModel: typeof input.imageModel === "string" && staticIds.has(input.imageModel)
        ? input.imageModel as ImageModel : DEFAULT_IMAGE_MODEL,
      videoModelSelected: false,
      comfyWorkflow: workflow(input.comfyWorkflow)
        ?? (legacy && !staticIds.has(legacy) ? legacy : null),
      comfyVideoWorkflow: workflow(input.comfyVideoWorkflow),
    };
  }
  const imageModel = provider === "oauth" && typeof input.imageModel === "string"
    ? LEGACY_OAUTH_MODELS[input.imageModel] ?? input.imageModel
    : input.imageModel;
  return {
    provider,
    imageModel: staticImage(provider, imageModel) ? imageModel : defaults[provider],
    videoModelSelected: provider === "grok" || provider === "grok-api"
      ? normalizeVideoModelValue(input.videoModelSelected) : false,
    comfyWorkflow: null,
    comfyVideoWorkflow: null,
  };
}

export function providerForImageModel(current: Provider, model: ImageModel): Provider {
  if (isCoreProviderId(current) && staticImage(current, model)) return current;
  return inferProvider(model, false);
}

export function selectCoreProvider(
  current: CoreSelectionState, provider: Provider, remembered?: RememberedCoreSelection,
): CoreSelectionState {
  if (current.provider === provider) return current;
  if (!remembered) return reconcileCoreSelection({ provider, imageModel: current.imageModel });
  if (provider === "comfy") {
    return reconcileCoreSelection({
      provider, imageModel: current.imageModel,
      comfyWorkflow: remembered.image,
      comfyVideoWorkflow: remembered.kind === "video" ? remembered.video : null,
    });
  }
  return reconcileCoreSelection({
    provider, imageModel: remembered.image,
    videoModelSelected: remembered.kind === "video" ? remembered.video : false,
  });
}

export function rememberCoreSelection(current: CoreSelectionState): RememberedCoreSelection {
  if (current.provider === "comfy") {
    return {
      kind: current.comfyVideoWorkflow ? "video" : "image",
      ...(current.comfyWorkflow ? { image: current.comfyWorkflow } : {}),
      ...(current.comfyVideoWorkflow ? { video: current.comfyVideoWorkflow } : {}),
    };
  }
  return {
    kind: current.videoModelSelected ? "video" : "image",
    image: current.imageModel,
    ...(current.videoModelSelected ? { video: current.videoModelSelected } : {}),
  };
}

export function coreImageRequestModel(current: {
  provider: Provider; imageModel: ImageModel; comfyWorkflow?: string | null;
}): string | undefined {
  return current.provider === "comfy" ? current.comfyWorkflow ?? undefined : current.imageModel;
}

/** Storage allowlist: no catalogs or availability probes, and no implicit defaults. */
export function filterCoreSelectionMemory(value: unknown): CoreSelectionMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: CoreSelectionMemory = {};
  for (const provider of CORE_PROVIDER_IDS) {
    if (!Object.hasOwn(value, provider)) continue;
    const entry: unknown = (value as Record<string, unknown>)[provider];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (row.kind !== "image" && row.kind !== "video") continue;
    const image = provider === "comfy" ? workflow(row.image)
      : staticImage(provider, row.image) ? row.image : null;
    const video = provider === "comfy" ? workflow(row.video)
      : provider === "grok" || provider === "grok-api" ? normalizeVideoModelValue(row.video) : false;
    out[provider] = { kind: row.kind, ...(image ? { image } : {}), ...(video ? { video } : {}) };
  }
  return out;
}
