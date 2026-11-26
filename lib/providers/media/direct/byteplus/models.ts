// BytePlus ModelArk catalog: Seedance (video) and Seedream (image).
// Wire ids, limits and parameters: https://docs.byteplus.com/en/docs/ModelArk/model-list
// and the create-video-generation-task / image-generation API references (read 2026-11-26).
// Prices: https://docs.byteplus.com/en/docs/ModelArk/model-pricing (read 2026-11-26).
import type { MediaModelSpec, MediaPrice } from "../../contract.js";

export const PRICE_SOURCE = "https://docs.byteplus.com/en/docs/ModelArk/model-pricing";
const CHECKED = "2026-11-26";
const VIDEO_DOCS = "https://docs.byteplus.com/en/docs/ModelArk/create-video-generation-task-api";
const IMAGE_DOCS = "https://docs.byteplus.com/en/docs/ModelArk/image-generation-api";

const VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"] as const;
const IMAGE_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Per-second prices from the official "Billing examples" (16:9, 5 s output, no video input). */
function perSecond(rows: ReadonlyArray<readonly [string, number]>): MediaPrice[] {
  return rows.map(([resolution, usd]): MediaPrice => ({
    unit: "second",
    usd,
    variant: resolution + " 16:9, no video input (official 5 s example)",
    source: PRICE_SOURCE,
    checkedAt: CHECKED,
  }));
}

function perImage(rows: ReadonlyArray<readonly [string, number]>): MediaPrice[] {
  return rows.map(([variant, usd]): MediaPrice => ({
    unit: "image",
    usd,
    variant,
    source: PRICE_SOURCE,
    checkedAt: CHECKED,
  }));
}

/** Seedance generation family; drives which request fields the API accepts. */
export type SeedanceFamily = "2.5" | "2.0";

export interface SeedanceLimits {
  family: SeedanceFamily;
  maxReferenceAudios: number;
}

export interface SeedreamTraits {
  /** Size table used to turn tier + aspect ratio into WxH. */
  sizeTable: "v5" | "v4";
  /** Supports sequential_image_generation (count > 1). */
  sequential: boolean;
  /** Supports layer_decomposition. */
  layers: boolean;
  /** Supports output_format. */
  outputFormat: boolean;
  /** Supports background (RGBA). */
  background: boolean;
}

function seedance(
  id: string,
  upstreamId: string,
  label: string,
  family: SeedanceFamily,
  limits: { resolutions: string[]; images: number; videos: number },
  pricing: MediaPrice[],
): MediaModelSpec {
  return {
    id,
    upstreamId,
    vendor: "bytedance",
    label,
    kind: "video",
    tasks: ["text-to-video", "image-to-video", "reference-to-video", "video-to-video", "video-extend"],
    params: {
      durationsSec: family === "2.5" ? range(4, 30) : range(4, 15),
      resolutions: limits.resolutions,
      aspectRatios: VIDEO_RATIOS,
      maxReferenceImages: limits.images,
      maxReferenceVideos: limits.videos,
      nativeAudio: true,
    },
    pricing,
    docsUrl: VIDEO_DOCS,
  };
}

function seedream(
  id: string,
  upstreamId: string,
  label: string,
  resolutions: string[],
  maxRefs: number,
  pricing: MediaPrice[],
  tasks: MediaModelSpec["tasks"] = ["text-to-image", "image-to-image"],
): MediaModelSpec {
  return {
    id,
    upstreamId,
    vendor: "bytedance",
    label,
    kind: "image",
    tasks,
    params: {
      resolutions,
      aspectRatios: tasks.includes("image-segment") ? [] : IMAGE_RATIOS,
      maxReferenceImages: maxRefs,
    },
    pricing,
    docsUrl: IMAGE_DOCS,
  };
}

const ALL_RES = ["480p", "720p", "1080p", "4k"];
const LOW_RES = ["480p", "720p"];
const S55_PRICES = perImage([
  ["output, P <= 2,601,124 px (up to 1.5K)", 0.02],
  ["output, P <= 4,624,220 px (2K)", 0.035],
  ["each input image", 0.008],
]);

export const SEEDANCE_LIMITS: Readonly<Record<string, SeedanceLimits>> = {
  "dreamina-seedance-2-5-260628": { family: "2.5", maxReferenceAudios: 10 },
  "dreamina-seedance-2-5-flash-261115": { family: "2.5", maxReferenceAudios: 5 },
  "dreamina-seedance-2-0-260128": { family: "2.0", maxReferenceAudios: 3 },
  "dreamina-seedance-2-0-fast-260128": { family: "2.0", maxReferenceAudios: 3 },
  "dreamina-seedance-2-0-mini-260615": { family: "2.0", maxReferenceAudios: 3 },
};

export const SEEDREAM_TRAITS: Readonly<Record<string, SeedreamTraits>> = {
  "bytedance/seedream-5.5": { sizeTable: "v5", sequential: false, layers: false, outputFormat: true, background: true },
  "bytedance/seedream-5.5-layers": {
    sizeTable: "v5",
    sequential: false,
    layers: true,
    outputFormat: true,
    background: false,
  },
  "bytedance/seedream-5-pro": {
    sizeTable: "v5",
    sequential: false,
    layers: false,
    outputFormat: true,
    background: true,
  },
  "bytedance/seedream-5-lite": {
    sizeTable: "v4",
    sequential: true,
    layers: false,
    outputFormat: true,
    background: false,
  },
  "bytedance/seedream-4-5-edit": {
    sizeTable: "v4",
    sequential: true,
    layers: false,
    outputFormat: false,
    background: false,
  },
  "bytedance/seedream-v4": { sizeTable: "v4", sequential: true, layers: false, outputFormat: false, background: false },
};

export const MODELS: readonly MediaModelSpec[] = [
  seedance(
    "bytedance/seedance-2.5",
    "dreamina-seedance-2-5-260628",
    "Seedance 2.5",
    "2.5",
    { resolutions: ALL_RES, images: 30, videos: 10 },
    perSecond([
      ["480p", 0.103],
      ["720p", 0.231],
      ["1080p", 0.569],
      ["4k", 0.914],
    ]),
  ),
  seedance(
    "bytedance/seedance-2.5-flash",
    "dreamina-seedance-2-5-flash-261115",
    "Seedance 2.5 Flash",
    "2.5",
    { resolutions: LOW_RES, images: 10, videos: 5 },
    perSecond([
      ["480p", 0.07],
      ["720p", 0.15],
    ]),
  ),
  seedance(
    "bytedance/seedance-2",
    "dreamina-seedance-2-0-260128",
    "Seedance 2.0",
    "2.0",
    { resolutions: ALL_RES, images: 9, videos: 3 },
    perSecond([
      ["480p", 0.07],
      ["720p", 0.15],
      ["1080p", 0.37],
      ["4k", 0.78],
    ]),
  ),
  seedance(
    "bytedance/seedance-2-fast",
    "dreamina-seedance-2-0-fast-260128",
    "Seedance 2.0 Fast",
    "2.0",
    { resolutions: LOW_RES, images: 9, videos: 3 },
    perSecond([
      ["480p", 0.06],
      ["720p", 0.12],
    ]),
  ),
  seedance(
    "bytedance/seedance-2-mini",
    "dreamina-seedance-2-0-mini-260615",
    "Seedance 2.0 Mini",
    "2.0",
    { resolutions: LOW_RES, images: 9, videos: 3 },
    perSecond([
      ["480p", 0.04],
      ["720p", 0.08],
    ]),
  ),
  seedream("bytedance/seedream-5.5", "dola-seedream-5-5-261028", "Seedream 5.5", ["1K", "1.5K", "2K"], 10, S55_PRICES),
  seedream(
    "bytedance/seedream-5.5-layers",
    "dola-seedream-5-5-261028",
    "Seedream 5.5 Layers",
    ["1K", "1.5K", "2K", "auto"],
    1,
    S55_PRICES,
    ["image-segment"],
  ),
  seedream(
    "bytedance/seedream-5-pro",
    "dola-seedream-5-0-pro-260628",
    "Seedream 5.0 Pro",
    ["1K", "1.5K", "2K"],
    10,
    perImage([
      ["output, up to 1.5K (P <= 2.61M px)", 0.045],
      ["output, above 1.5K", 0.09],
      ["input image from the second one", 0.003],
    ]),
  ),
  seedream(
    "bytedance/seedream-5-lite",
    "seedream-5-0-lite-260128",
    "Seedream 5.0 Lite",
    ["2K", "3K", "4K"],
    14,
    perImage([["output image", 0.035]]),
  ),
  seedream(
    "bytedance/seedream-4-5-edit",
    "seedream-4-5-251128",
    "Seedream 4.5",
    ["2K", "4K"],
    14,
    perImage([["output image", 0.04]]),
  ),
  seedream(
    "bytedance/seedream-v4",
    "seedream-4-0-250828",
    "Seedream 4.0",
    ["1K", "2K", "4K"],
    14,
    perImage([["output image", 0.03]]),
  ),
];

type SizeTable = Readonly<Record<string, Readonly<Record<string, string>>>>;

const RATIO_ORDER = IMAGE_RATIOS;
function rows(sizes: readonly string[]): Record<string, string> {
  return Object.fromEntries(RATIO_ORDER.map((ratio, i) => [ratio, sizes[i]!]));
}
const V5_2K = rows([
  "2048x2048",
  "2368x1776",
  "1776x2368",
  "2816x1584",
  "1584x2816",
  "2496x1664",
  "1664x2496",
  "3136x1344",
]);
const V4_2K = rows([
  "2048x2048",
  "2304x1728",
  "1728x2304",
  "2848x1600",
  "1600x2848",
  "2496x1664",
  "1664x2496",
  "3136x1344",
]);
const V4_4K = rows([
  "4096x4096",
  "4704x3520",
  "3520x4704",
  "5504x3040",
  "3040x5504",
  "4992x3328",
  "3328x4992",
  "6240x2656",
]);

/** Tier x aspect ratio -> WxH, copied from the image-generation API "size" tables. */
export const SIZE_TABLES: Readonly<Record<SeedreamTraits["sizeTable"], SizeTable>> = {
  v5: {
    "1K": rows(["1024x1024", "1152x864", "864x1152", "1424x800", "800x1424", "1248x832", "832x1248", "1568x672"]),
    "1.5K": rows([
      "1536x1536",
      "1792x1344",
      "1344x1792",
      "2048x1152",
      "1152x2048",
      "1872x1248",
      "1248x1872",
      "2352x1008",
    ]),
    "2K": V5_2K,
  },
  v4: {
    "1K": rows(["1024x1024", "1152x864", "864x1152", "1280x720", "720x1280", "1248x832", "832x1248", "1512x648"]),
    "2K": V4_2K,
    "3K": rows([
      "3072x3072",
      "3456x2592",
      "2592x3456",
      "4096x2304",
      "2304x4096",
      "3744x2496",
      "2496x3744",
      "4704x2016",
    ]),
    "4K": V4_4K,
  },
};
