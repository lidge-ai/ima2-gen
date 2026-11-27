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
  route: "direct" | "aggregator" | "local";
  consoleUrl: string;
  extraFields?: CatalogProvider["extraFields"];
  /** A route on the person's own machine (ComfyUI): no key, no provider price. */
  keyless?: boolean;
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
  pixverse: { label: "PixVerse", route: "direct", consoleUrl: "https://pixverse.ai/" },
  recraft: { label: "Recraft", route: "direct", consoleUrl: "https://www.recraft.ai/" },
  heygen: { label: "HeyGen", route: "direct", consoleUrl: "https://www.heygen.com/" },
  elevenlabs: { label: "ElevenLabs", route: "direct", consoleUrl: "https://elevenlabs.io/app/settings/api-keys" },
  fal: { label: "fal", route: "aggregator", consoleUrl: "https://fal.ai/dashboard/keys" },
  replicate: { label: "Replicate", route: "aggregator", consoleUrl: "https://replicate.com/account/api-tokens" },
  "comfy-local": { label: "ComfyUI (your server)", route: "local", consoleUrl: "", keyless: true },
};

type Params = MediaModelSpec["params"];
/** [id, label, kind, tasks, params, routes as providerId:usd-per-unit, params of single routes when they differ] */
type ModelRow = [string, string, MediaKind, MediaTask[], Params, Record<string, number | null>, Record<string, Params>?];

/** The one clip an edit, extend or upscale works on. */
const SOURCE = { role: "source-video", min: 1, max: 1 } as const;
/** Routes that serve fewer tasks than their model lists. */
const ROUTE_TASKS: Readonly<Record<string, Readonly<Record<string, readonly MediaTask[]>>>> = {
  "bytedance/seedance-2": { fal: ["text-to-video", "image-to-video"] },
};

/** Forms the talking-video routes declare, shaped like the real catalog's. */
const LIPSYNC_FORM: Params = {
  inputs: [
    { role: "source-video", min: 1, max: 1, billedLength: true },
    { role: "source-audio", min: 1, max: 1, billedLength: true },
  ],
};
const AVATAR_FORM: Params = {
  resolutions: ["480p", "720p"],
  inputs: [
    { role: "source-image", min: 1, max: 1 },
    { role: "source-audio", min: 1, max: 1, billedLength: true },
  ],
};
/** Sound effects: a text request needs a length; sound for a video takes the video. */
const SOUND_FORM: Params = {
  durationRange: { minSec: 1, maxSec: 600, tasks: ["text-to-audio"], required: true },
  inputs: [{ role: "source-video", min: 1, max: 1, tasks: ["video-to-audio"], billedLength: true }],
};
const MUSIC_FORM: Params = { durationRange: { minSec: 3, maxSec: 600 }, options: [{ name: "force_instrumental", type: "boolean" }] };
/** Price units that differ from the kind's default, as the real catalog has them. */
const PRICE_UNITS: Readonly<Record<string, MediaPrice["unit"]>> = { "elevenlabs/eleven-v3": "character", "elevenlabs/elevenlabs-music-2.5": "minute" };
const DUBBING_FORM: Params = {
  inputs: [{ role: "source-video", min: 1, max: 1, billedLength: true }],
  options: [
    { name: "target_language", type: "enum", values: ["en", "es", "ja", "ko"], required: true },
    { name: "source_language", type: "enum", values: ["auto", "en", "es", "ja", "ko"] },
  ],
};

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
    [...T2V, "reference-to-video", "video-to-video"],
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
    // The direct route needs settings a form cannot fill, so only the aggregator declares a form.
    { topaz: {}, fal: { resolutions: ["1080p", "4k"], inputs: [{ ...SOURCE, tasks: ["video-upscale"], billedLength: true }], taskFields: { "video-upscale": { accepts: ["resolution"] } } } },
  ],
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
  ["pixverse/pixverse-v6", "PixVerse V6", "video", T2V, V_SHORT, { pixverse: 0.06, fal: 0.08 }],
  ["recraft/recraft-v4.1", "Recraft V4.1", "image", T2I, IMG, { recraft: 0.04, fal: 0.05 }],
  ["heygen/heygen-avatar-6", "HeyGen Avatar 6", "video", ["avatar"], V_SHORT, { heygen: null }],
  [
    "sync/sync-lipsync-3",
    "Sync Lipsync 3",
    "video",
    ["lipsync"],
    {},
    { sync: 0.08, fal: 0.1 },
    {
      sync: { ...LIPSYNC_FORM, options: [{ name: "sync_mode", type: "enum", values: ["bounce", "loop", "cut_off"] }] },
      fal: LIPSYNC_FORM,
    },
  ],
  // The direct route needs a session a form cannot make, so only the aggregator declares a form.
  ["kling/kling-lipsync", "Kling Lip Sync", "video", ["lipsync"], {}, { kling: null, fal: 0.05 }, { kling: {}, fal: LIPSYNC_FORM }],
  ["veed/veed-fabric-1.0", "VEED Fabric 1.0", "video", ["avatar"], { resolutions: ["480p", "720p"] }, { fal: 0.08 }, { fal: AVATAR_FORM }],
  ["veed/veed-dubbing", "VEED Dubbing", "video", ["dubbing"], {}, { fal: 0.11 }, { fal: DUBBING_FORM }],
  [
    "mirelo/mirelo-sfx-2.0",
    "Mirelo SFX 2.0",
    "audio",
    ["text-to-audio", "video-to-audio"],
    {},
    { mirelo: 0.01, fal: 0.012 },
    { mirelo: SOUND_FORM, fal: SOUND_FORM },
  ],
  [
    "elevenlabs/eleven-v3",
    "Eleven v3",
    "audio",
    ["text-to-audio"],
    {},
    { elevenlabs: 0.00008 },
    { elevenlabs: { options: [{ name: "voice_id", type: "voice", required: true }] } },
  ],
  [
    "elevenlabs/elevenlabs-music-2.5",
    "Eleven Music 2.5",
    "audio",
    ["text-to-audio"],
    {},
    { elevenlabs: 0.15, fal: 0.2 },
    { elevenlabs: MUSIC_FORM, fal: MUSIC_FORM },
  ],
  // An edit follows its source; an extension takes only the added length (as the real route declares).
  [
    "xai/grok-imagine-video", "Grok Imagine Video", "video", ["video-to-video", "video-extend"], V_SHORT, { xai: 0.05 },
    { xai: { ...V_SHORT, inputs: [{ ...SOURCE, tasks: ["video-to-video"], billedLength: true }, { ...SOURCE, tasks: ["video-extend"] }],
      taskFields: { "video-to-video": { accepts: ["prompt"], requires: ["prompt"] }, "video-extend": { accepts: ["prompt", "durationSec"], requires: ["prompt"] } } } },
  ],
  ["openai/gpt-image-2.6", "GPT Image 2.6", "image", T2I, IMG, { openai: 0.04, fal: 0.05 }],
  // Only the direct route edits; the aggregator route creates (ROUTE_TASKS).
  [
    "bytedance/seedance-2", "Seedance 2.0", "video", [...T2V, "video-to-video"], V_FULL, { byteplus: 0.06, fal: 0.075 },
    { byteplus: { ...V_FULL, inputs: [{ ...SOURCE, tasks: ["video-to-video"] }],
      taskFields: { "video-to-video": { accepts: ["prompt", "durationSec", "resolution", "aspectRatio", "audio"] } } } },
  ],
  [
    "bytedance/seedance-2-mini",
    "Seedance 2.0 Mini",
    "video",
    [...T2V, "video-to-video"],
    V_FULL,
    { byteplus: 0.03, fal: 0.04 },
  ],
  // A registered ComfyUI workflow, as the server lists it (comfy/<workflow id>, route "local", sizes as WIDTHxHEIGHT).
  [
    "comfy/klein",
    "FLUX.2 klein",
    "image",
    T2I,
    { resolutions: ["1024x1024", "1536x1024", "1024x1536"], seed: true },
    { "comfy-local": null },
  ],
];

/**
 * Routes that list a setting their own way, as real aggregator catalogs do: short clips appended
 * after the long ones, a size spelled in another case, provider upscale tiers ("720p-sr").
 */
const ROUTE_PARAMS: Readonly<Record<string, Readonly<Record<string, Params>>>> = {
  "bytedance/seedance-2.5": {
    fal: {
      ...V_FULL,
      durationsSec: [4, 5, 8, 10, 12, 15, 1, 2, 3],
      resolutions: ["480P", "720p", "1080p", "720p-sr", "1080p-esr & 60fps"],
    },
  },
  "openai/gpt-image-2": { fal: { aspectRatios: ["1:1", "3:2", "2:3"], resolutions: ["1k", "2k", "4k"] } },
};

function unitFor(kind: MediaKind, tasks: readonly MediaTask[]): MediaPrice["unit"] {
  if (kind === "image") return "image";
  return tasks.length > 0 ? "second" : "request";
}

function pricing(kind: MediaKind, tasks: readonly MediaTask[], usd: number | null, id?: string): MediaPrice[] {
  if (usd === null) return [];
  return [{ unit: PRICE_UNITS[id ?? ""] ?? unitFor(kind, tasks), usd, source: "fixture:fake", checkedAt: "2026-11-26" }];
}

function toModel(row: ModelRow, keyed: ReadonlySet<string>): CatalogModel {
  const [id, label, kind, tasks, params, routes, routeParams] = row;
  const entries = Object.entries(routes).map(([providerId, usd]) => ({
    providerId,
    route: PROVIDERS[providerId]!.route,
    label: PROVIDERS[providerId]!.label,
    upstreamId: providerId === "fal" || providerId === "replicate" ? providerId + ":" + id : id.split("/")[1]!,
    pricing: pricing(kind, tasks, usd, id),
    docsUrl: PROVIDERS[providerId]!.consoleUrl,
    keyConfigured: keyed.has(providerId) || !!PROVIDERS[providerId]!.keyless,
    ...(PROVIDERS[providerId]!.keyless ? { keyless: true } : {}),
    ...(ROUTE_TASKS[id]?.[providerId] ? { tasks: ROUTE_TASKS[id]![providerId]! } : {}),
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
    ...(routeParams ? { routeParams } : {}),
  };
}

export function makeCatalog(keyed: ReadonlySet<string>): Catalog {
  const providers: CatalogProvider[] = Object.entries(PROVIDERS).map(([id, def]) => ({
    id,
    label: def.label,
    route: def.route,
    keyVocabulary: id,
    consoleUrl: def.consoleUrl,
    keyConfigured: keyed.has(id) || !!def.keyless,
    ...(def.keyless ? { keyless: true } : {}),
    ...(def.extraFields ? { extraFields: def.extraFields } : {}),
  }));
  return { providers, models: MODELS.map((row) => toModel(row, keyed)) };
}

/** Providers keyed at start unless the caller overrides it: one direct, one aggregator, so both UI states show. */
export const DEFAULT_KEYED: readonly string[] = ["openai", "fal"];

/** Translate the reusable fixture data into L0's wire catalog. */
export function wireCatalog(keys: import("./keys.ts").Keys) {
  const catalog = makeCatalog(keys.keyed);
  const models = catalog.models.map((model) => ({
    id: model.id,
    label: model.label,
    vendor: model.vendor,
    kind: model.kind,
    tasks: model.tasks,
    routes: model.routes.map((route) => ({
      adapter: route.providerId,
      route: route.route,
      label: route.label,
      upstreamId: route.upstreamId,
      tasks: route.tasks ?? model.tasks,
      params: model.routeParams?.[route.providerId] ?? ROUTE_PARAMS[model.id]?.[route.providerId] ?? model.params,
      pricing: route.pricing,
      docsUrl: route.docsUrl,
      hasKey: route.keyConfigured,
      ...(route.keyless ? { keyless: true } : {}),
    })),
    defaultRoute: model.routes.find((route) => route.keyConfigured)?.providerId ?? null,
  }));
  const adapters = catalog.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    route: provider.route,
    keyVocabulary: provider.keyVocabulary,
    consoleUrl: provider.consoleUrl,
    keyPrefix: provider.keyPrefix ?? null,
    hasKey: provider.keyConfigured,
    ...(provider.keyless ? { keyless: true } : {}),
    keySource: keys.env.has(provider.id) ? "env" : provider.keyConfigured ? "config" : null,
    maskedKey: null,
    extraFields: (provider.extraFields ?? []).map((field) => ({
      ...field,
      configured: keys.extras.get(provider.id)?.has(field.name) ?? false,
    })),
    modelCount: models.filter((model) => model.routes.some((route) => route.adapter === provider.id)).length,
  }));
  return { models, adapters };
}
