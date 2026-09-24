import type {
  CoreProviderId,
  ImageModelId,
  UnsupportedImageModelId,
  VideoModelId,
} from "./generated/providers";

export type UIMode = "classic" | "node" | "card-news" | "agent" | "assets" | "asset-gen" | "home";
export type AssetGenBackgroundPreset = "chroma-green" | "white" | "black" | "transparent";
export type SettingsSection = "providers" | "workspace" | "general";
export type HistoryStripLayout = "rail" | "horizontal" | "sidebar";
export type Provider = CoreProviderId;
export type Quality = "low" | "medium" | "high" | "xhigh" | "max";
export type ImageToolModel = "gpt-image-2.5-sunburst" | "gpt-image-2.5-flare";
export type Format = "png" | "jpeg" | "webp";
export type Moderation = "low" | "auto";
export type OpenAIImageModel = Extract<ImageModelId, `gpt-${string}`>;
export type GrokImageModel = Extract<ImageModelId, `grok-${string}`>;
export type GeminiImageModel = Extract<ImageModelId, `nano-${string}`>;
export type AtlasCloudImageModel = Extract<ImageModelId, `openai/${string}`>;
export type MinimaxImageModel = Extract<ImageModelId, `image-${string}`>;
export type NaiImageModel = Extract<ImageModelId, `nai-diffusion-${string}`>;
export type ImageModel = ImageModelId;
export type VideoModel = VideoModelId;
export type VideoResolutionUI = "480p" | "720p" | "1080p";
export type UnsupportedImageModel = UnsupportedImageModelId;
export type Count = number;

export type ComposerInsertedPromptSnapshot = {
  id: string;
  name: string;
  text: string;
  placement: "before" | "after";
};

export type VideoContinuityEntry = {
  id: string;
  ordinal: number;
  role: "start" | "ancestor" | "parent" | "current";
  filename: string | null;
  userPrompt: string | null;
  revisedPrompt: string;
  createdAt: number;
};

export type VideoContinuityLineage = {
  lineageId: string;
  parentFilename: string | null;
  sourceFrame: "last" | null;
  maxEntries: 4;
  retention: "keep-start-plus-latest-3";
  entries: VideoContinuityEntry[];
};

export type VideoLineage = {
  id: string;
  parentId: string;
  rootId: string;
  seriesId: string;
  sequenceIndex: number;
};

export type SizePreset =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "1360x1024"
  | "1024x1360"
  | "1824x1024"
  | "1024x1824"
  | "2048x2048"
  | "2048x1152"
  | "1152x2048"
  | "3840x2160"
  | "2160x3840"
  | "auto"
  | "custom";

export type GenerateItem = {
  image: string;
  url?: string;
  providerUrl?: string | null;
  mediaType?: "image" | "video" | string;
  video?: Record<string, unknown> | null;
  videoSeries?: { topic?: string; chainIndex?: number } | null;
  videoContinuity?: VideoContinuityLineage | null;
  videoLineage?: VideoLineage | null;
  canvasMergedAt?: number;
  canvasVersion?: boolean;
  canvasSourceFilename?: string | null;
  canvasEditableFilename?: string | null;
  annotationsBaked?: boolean;
  annotationSnapshot?: import("./types/canvas").SavedCanvasAnnotations | null;
  annotationOnly?: boolean;
  filename?: string;
  prompt?: string;
  userPrompt?: string | null;
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct" | null;
  composerPrompt?: string | null;
  composerInsertedPrompts?: ComposerInsertedPromptSnapshot[] | null;
  elapsed?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  provider?: string;
  quality?: string;
  size?: string;
  format?: string;
  moderation?: string;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  /**
   * Background preset the image was generated with. "transparent" means the
   * file carries a real alpha channel, so it needs a checkerboard preview and
   * must not be offered to the color-keying flow.
   */
  backgroundPreset?: AssetGenBackgroundPreset | null;
  /** Server-verified semantic alpha: at least one pixel with alpha < 255. */
  alphaVerified?: boolean;
  /** Why alpha verification did not pass (null/undefined when verified). */
  alphaReason?: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable" | null;
  usage?: { total_tokens?: number } & Record<string, unknown>;
  thumb?: string;
  createdAt?: number;
  sessionId?: string | null;
  nodeId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: string | null;
  requestId?: string | null;
  kind?: "classic" | "edit" | "generate" | "card-news-card" | "card-news-set" | "imported" | "agent" | null;
  setId?: string | null;
  cardId?: string | null;
  cardOrder?: number | null;
  headline?: string | null;
  body?: string | null;
  cards?: Array<{
    url?: string;
    headline?: string;
    body?: string;
    cardOrder?: number;
    imageFilename?: string;
    status?: string;
  }>;
  refsCount?: number;
  webSearchCalls?: number;
  isFavorite?: boolean;
  sequenceId?: string | null;
  sequenceIndex?: number | null;
  sequenceTotalRequested?: number | null;
  sequenceTotalReturned?: number | null;
  sequenceStatus?: "complete" | "partial" | "empty" | null;
};

export type MultimodeSequenceStatus = "pending" | "partial" | "complete" | "empty" | "error" | "canceled";

export type EmbeddedGenerationMetadata = {
  schema: "ima2.generation.v1";
  app: "ima2-gen";
  version?: string | null;
  createdAt?: number | null;
  kind?: string | null;
  canvasVersion?: boolean;
  canvasSourceFilename?: string | null;
  canvasEditableFilename?: string | null;
  canvasMergedAt?: number | null;
  prompt?: string | null;
  userPrompt?: string | null;
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct" | null;
  composerPrompt?: string | null;
  composerInsertedPrompts?: ComposerInsertedPromptSnapshot[] | null;
  quality?: string | null;
  size?: string | null;
  format?: string | null;
  moderation?: string | null;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  provider?: string | null;
  providerUrl?: string | null;
  sessionId?: string | null;
  nodeId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: string | null;
  requestId?: string | null;
  refsCount?: number;
  webSearchCalls?: number;
  elapsed?: number | null;
  reasoningEffort?: string | null;
};

export type GenerateSingleResponse = {
  image: string;
  elapsed: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  filename: string;
  requestId?: string | null;
  alphaVerified?: boolean;
  alphaReason?: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable" | null;
  usage?: GenerateItem["usage"];
  provider: string;
  quality?: string;
  size?: string;
  moderation?: string;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct";
  providerUrl?: string | null;
  createdAt?: number;
};

export type GenerateMultiResponse = {
  images: Array<{ image: string; filename: string; providerUrl?: string | null; createdAt?: number }>;
  elapsed: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  count: number;
  requestId?: string | null;
  usage?: GenerateItem["usage"];
  provider: string;
  quality?: string;
  size?: string;
  moderation?: string;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct";
};

export type GenerateResponse = GenerateSingleResponse | GenerateMultiResponse;

export function isMultiResponse(r: GenerateResponse): r is GenerateMultiResponse {
  return Array.isArray((r as GenerateMultiResponse).images);
}

export type GenerateRequest = {
  prompt: string;
  quality: Quality;
  size: string;
  format: Format;
  moderation: Moderation;
  provider: Provider;
  n: number;
  imageToolModel?: ImageToolModel;
  model?: string; // wire model id, including runtime Comfy workflow ids
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  image?: string;
  mask?: string;
  references?: string[];
  requestId?: string;
  mode?: "auto" | "direct";
  webSearchEnabled?: boolean;
  composerPrompt?: string;
  composerInsertedPrompts?: ComposerInsertedPromptSnapshot[];
  providerUrl?: string;
  backgroundPreset?: AssetGenBackgroundPreset;
  // NovelAI tuning; emitted only for the nai lane (see naiPayloadFields).
  negativePrompt?: string;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  sampler?: string;
  noiseSchedule?: string;
  seed?: number;
  straightAlpha?: boolean;
  varietyPlus?: boolean;
  ucPresetId?: string;
  qualityPresetId?: string;
};

export type MultimodeGenerateRequest = Omit<GenerateRequest, "n"> & {
  maxImages: number;
};

export type MultimodeGenerateResponse = {
  ok: boolean;
  requestId: string;
  sequenceId: string;
  requested: number;
  returned: number;
  status: "complete" | "partial" | "empty";
  elapsed: string;
  images: GenerateItem[];
  usage?: GenerateItem["usage"];
  provider: string;
  quality?: string;
  size?: string;
  moderation?: string;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  webSearchCalls?: number;
  promptMode?: "auto" | "direct";
  extraIgnored?: number;
};

export type ProviderAuthStatus = {
  provider: "gpt" | "grok";
  loggedIn: boolean;
  health: "healthy" | "warning" | "reauth_required" | "not_logged_in";
  reason?: string;
  source?: string;
  email?: string;
  plan?: string;
  accountId?: string;
  expiresAt?: string;
  refreshable: boolean;
  action?: string;
  note?: string;
};

export type OAuthStatus = {
  status: "ready" | "auth_required" | "offline" | "starting";
  models?: string[];
  auth?: ProviderAuthStatus;
  grokAuth?: ProviderAuthStatus;
};

export type BillingResponse = {
  credits?: { total_granted?: number; total_used?: number };
  costs?: { data?: Array<{ results: Array<{ amount?: { value?: number } }> }> };
  oauth?: boolean;
  apiKeyValid?: boolean;
  apiKeySource?: "none" | "env" | "config";
};
