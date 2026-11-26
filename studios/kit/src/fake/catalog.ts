/**
 * Development catalog. Model ids and labels follow public model names; every
 * price here is a fixture (source "fixture:fake") and must never be shown as a
 * real vendor price outside development.
 */
import type {
  Catalog,
  CatalogModel,
  CatalogProvider,
  MediaKind,
  MediaModelSpec,
  MediaPrice,
  MediaTask,
} from "../types.ts";

interface ProviderDef {
  label: string;
  route: "direct" | "aggregator";
  consoleUrl: string;
  extraFields?: CatalogProvider["extraFields"];
}

const PROVIDERS: Record<string, ProviderDef> = {
  byteplus: {
    label: "BytePlus ModelArk",
    route: "direct",
    consoleUrl: "https://console.byteplus.com/ark",
    extraFields: [{ name: "region", secret: false, required: false }],
  },
  kling: { label: "Kling API", route: "direct", consoleUrl: "https://app.klingai.com/global/dev" },
  google: { label: "Google Gemini API", route: "direct", consoleUrl: "https://aistudio.google.com/apikey" },
  minimax: { label: "MiniMax", route: "direct", consoleUrl: "https://www.minimax.io/platform" },
  alibaba: {
    label: "Alibaba Model Studio",
    route: "direct",
    consoleUrl: "https://modelstudio.console.alibabacloud.com/",
  },
  vidu: { label: "Vidu API", route: "direct", consoleUrl: "https://platform.vidu.com/" },
  xai: { label: "xAI API", route: "direct", consoleUrl: "https://console.x.ai/" },
  openai: { label: "OpenAI API", route: "direct", consoleUrl: "https://platform.openai.com/api-keys" },
  bfl: { label: "Black Forest Labs", route: "direct", consoleUrl: "https://dashboard.bfl.ai/" },
  ideogram: { label: "Ideogram API", route: "direct", consoleUrl: "https://ideogram.ai/manage-api" },
  topaz: { label: "Topaz Labs API", route: "direct", consoleUrl: "https://www.topazlabs.com/api" },
  sync: { label: "Sync Labs", route: "direct", consoleUrl: "https://sync.so/keys" },
  mirelo: { label: "Mirelo", route: "direct", consoleUrl: "https://mirelo.ai/" },
  fal: { label: "fal", route: "aggregator", consoleUrl: "https://fal.ai/dashboard/keys" },
  replicate: { label: "Replicate", route: "aggregator", consoleUrl: "https://replicate.com/account/api-tokens" },
};

type Params = MediaModelSpec["params"];
/** [id, label, kind, tasks, params, routes as providerId:usd-per-unit] */
type ModelRow = [string, string, MediaKind, MediaTask[], Params, Record<string, number | null>];

const V_FULL: Params = {
  durationsSec: [4, 5, 8, 10, 12],
  resolutions: ["480p", "720p", "1080p"],
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "21:9"],
  maxReferenceImages: 4,
  nativeAudio: true,
  seed: true,
  negativePrompt: true,
};
const V_SHORT: Params = {
  durationsSec: [5, 10],
  resolutions: ["720p", "1080p"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  seed: true,
};
const IMG: Params = { aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"], resolutions: ["1K", "2K"], seed: true };
const T2V = ["text-to-video", "image-to-video"] as MediaTask[];
const T2I = ["text-to-image", "image-to-image"] as MediaTask[];

const MODELS: ModelRow[] = [
  [
    "bytedance/seedance-2.5",
    "Seedance 2.5",
    "video",
    [...T2V, "reference-to-video"],
    V_FULL,
    { byteplus: 0.06, fal: 0.075, replicate: 0.08 },
  ],
  [
    "bytedance/seedance-2.5-flash",
    "Seedance 2.5 Flash",
    "video",
    T2V,
    { ...V_FULL, resolutions: ["480p", "720p"] },
    { byteplus: 0.025, fal: 0.03 },
  ],
  [
    "kling/kling-3",
    "Kling Video v3 Pro",
    "video",
    T2V,
    { ...V_SHORT, nativeAudio: true, negativePrompt: true },
    { kling: 0.11, fal: 0.125 },
  ],
  [
    "kling/kling-3-omni",
    "Kling 3.0 Omni",
    "video",
    [...T2V, "reference-to-video", "video-to-video"],
    { ...V_SHORT, maxReferenceImages: 7, maxReferenceVideos: 1 },
    { kling: 0.14, fal: 0.16 },
  ],
  [
    "google/veo-3.1",
    "Veo 3.1",
    "video",
    T2V,
    {
      durationsSec: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      nativeAudio: true,
      negativePrompt: true,
      seed: true,
    },
    { google: 0.4, fal: 0.4 },
  ],
  [
    "google/veo-3.1-fast",
    "Veo 3.1 Fast",
    "video",
    T2V,
    { durationsSec: [4, 6, 8], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16"], nativeAudio: true },
    { google: 0.15 },
  ],
  [
    "minimax/minimax-h3",
    "MiniMax H3",
    "video",
    T2V,
    { durationsSec: [6, 10], resolutions: ["768p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"] },
    { minimax: 0.045, fal: 0.05 },
  ],
  [
    "alibaba/wan-3.0",
    "Wan 3.0",
    "video",
    [...T2V, "video-to-video"],
    { ...V_SHORT, maxReferenceVideos: 1, negativePrompt: true },
    { alibaba: 0.05, replicate: 0.09 },
  ],
  [
    "vidu/vidu-q4",
    "Vidu Q4",
    "video",
    ["text-to-video", "image-to-video", "reference-to-video"],
    {
      durationsSec: [4, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxReferenceImages: 7,
    },
    { vidu: 0.05 },
  ],
  [
    "xai/grok-imagine-video-1.5",
    "Grok Imagine Video 1.5",
    "video",
    T2V,
    { durationsSec: [6, 10], resolutions: ["720p"], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: true },
    { xai: 0.05 },
  ],
  [
    "topaz-labs/topaz-video",
    "Topaz Video Upscale",
    "video",
    ["video-upscale"],
    { resolutions: ["1080p", "4k"] },
    { topaz: null, fal: 0.08 },
  ],
  ["sync/lipsync-3", "Sync Lipsync 3", "video", ["lipsync"], {}, { sync: 0.083, fal: 0.1 }],
  [
    "openai/gpt-image-2",
    "GPT Image 2",
    "image",
    T2I,
    { aspectRatios: ["1:1", "3:2", "2:3"], resolutions: ["1K", "2K"] },
    { openai: 0.04, fal: 0.05 },
  ],
  [
    "google/nano-banana-pro",
    "Nano Banana Pro",
    "image",
    T2I,
    { ...IMG, resolutions: ["1K", "2K", "4K"] },
    { google: 0.134, fal: 0.15, replicate: 0.15 },
  ],
  [
    "bytedance/seedream-5.5",
    "Seedream 5.5",
    "image",
    T2I,
    { ...IMG, resolutions: ["2K", "4K"] },
    { byteplus: 0.03, fal: 0.04 },
  ],
  ["black-forest-labs/flux-2-pro", "FLUX.2 Pro", "image", T2I, IMG, { bfl: 0.03, fal: 0.035, replicate: 0.04 }],
  [
    "ideogram/ideogram-v4",
    "Ideogram 4",
    "image",
    ["text-to-image"],
    { aspectRatios: ["1:1", "16:9", "9:16", "4:5"], negativePrompt: true, seed: true },
    { ideogram: 0.06 },
  ],
  [
    "xai/grok-imagine-image",
    "Grok Imagine Image",
    "image",
    T2I,
    { aspectRatios: ["1:1", "16:9", "9:16"] },
    { xai: 0.02 },
  ],
  [
    "topaz-labs/topaz-image-upscale",
    "Topaz Image Upscale",
    "image",
    ["image-upscale"],
    { resolutions: ["2x", "4x"] },
    { topaz: null },
  ],
  [
    "mirelo/mirelo-sfx-2",
    "Mirelo SFX 2",
    "audio",
    ["video-to-audio", "text-to-audio"],
    { durationsSec: [5, 10] },
    { mirelo: 0.01, fal: 0.012 },
  ],
];

function unitFor(kind: MediaKind, tasks: readonly MediaTask[]): MediaPrice["unit"] {
  if (kind === "image") return "image";
  return tasks.length > 0 ? "second" : "request";
}

function pricing(kind: MediaKind, tasks: readonly MediaTask[], usd: number | null): MediaPrice[] {
  if (usd === null) return [];
  return [{ unit: unitFor(kind, tasks), usd, source: "fixture:fake", checkedAt: "2026-11-26" }];
}

function toModel(row: ModelRow, keyed: ReadonlySet<string>): CatalogModel {
  const [id, label, kind, tasks, params, routes] = row;
  const entries = Object.entries(routes).map(([providerId, usd]) => ({
    providerId,
    route: PROVIDERS[providerId]!.route,
    label: PROVIDERS[providerId]!.label,
    upstreamId: providerId === "fal" || providerId === "replicate" ? providerId + ":" + id : id.split("/")[1]!,
    pricing: pricing(kind, tasks, usd),
    docsUrl: PROVIDERS[providerId]!.consoleUrl,
    keyConfigured: keyed.has(providerId),
  }));
  const rank = (r: (typeof entries)[number]) => (r.keyConfigured ? 0 : 2) + (r.route === "direct" ? 0 : 1);
  return {
    id,
    vendor: id.split("/")[0]!,
    label,
    kind,
    tasks,
    params,
    routes: entries.sort((a, b) => rank(a) - rank(b)),
  };
}

export function makeCatalog(keyed: ReadonlySet<string>): Catalog {
  const providers: CatalogProvider[] = Object.entries(PROVIDERS).map(([id, def]) => ({
    id,
    label: def.label,
    route: def.route,
    keyVocabulary: id,
    consoleUrl: def.consoleUrl,
    keyConfigured: keyed.has(id),
    ...(def.extraFields ? { extraFields: def.extraFields } : {}),
  }));
  return { providers, models: MODELS.map((row) => toModel(row, keyed)) };
}

/** Providers keyed at start unless the caller overrides it: one direct, one aggregator, so both UI states show. */
export const DEFAULT_KEYED: readonly string[] = ["openai", "fal"];
