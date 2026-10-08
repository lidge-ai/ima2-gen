export type Api88VideoFamily = "grok" | "veo" | "omni" | "kling" | "wan" | "minimax" | "seedance" | "sd";
export type Api88VideoResolution = "480p" | "720p" | "768p" | "1080p" | "2k" | "4k";
export interface Api88VideoSpec {
  family: Api88VideoFamily;
  durations: readonly number[];
  defaultDuration: number;
  ratios: readonly string[];
  resolutions: readonly Api88VideoResolution[];
  fixedResolution: Api88VideoResolution | null;
  refs: { images: number; videos: number; audios: number; total: number | null };
  audio: "included" | "toggle" | "none";
  firstFrame: boolean;
  lastFrame: boolean;
  framesExclusive: boolean;
  veoBase64: boolean;
  referenceVideoSeconds: number | null;
  referenceAudioSeconds: number | null;
  referenceVideoMinimumSeconds: number | null;
  referenceTotalSeconds: number | null;
}

const range = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i);
const wide = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"];
const cinema = ["1:1", "21:9", "16:9", "9:16", "3:4", "4:3"];
const official = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

function fixed(
  family: Api88VideoFamily, resolution: Api88VideoResolution,
  max: number, defaultDuration: number, ratios: readonly string[],
  refs: Api88VideoSpec["refs"], overrides: Partial<Api88VideoSpec> = {},
): Api88VideoSpec {
  return {
    family, durations: range(4, max), defaultDuration, ratios,
    resolutions: [resolution], fixedResolution: resolution, refs,
    audio: "none", firstFrame: true, lastFrame: true, framesExclusive: true,
    veoBase64: false, referenceVideoSeconds: 15, referenceAudioSeconds: 15,
    referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
    ...overrides,
  };
}
const grok: Api88VideoSpec = {
  family: "grok", durations: range(1, 15), defaultDuration: 8, ratios: wide,
  resolutions: ["480p", "720p"], fixedResolution: null,
  refs: { images: 1, videos: 0, audios: 0, total: 1 }, audio: "included",
  // First-frame input is encoded as images[0], never metadata.firstFrame.
  firstFrame: true, lastFrame: false, framesExclusive: true, veoBase64: false,
  referenceVideoSeconds: null, referenceAudioSeconds: null,
  referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
};
const veo: Api88VideoSpec = {
  family: "veo", durations: [4, 6, 8], defaultDuration: 8, ratios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p"], fixedResolution: null,
  refs: { images: 3, videos: 0, audios: 0, total: 3 }, audio: "toggle",
  firstFrame: true, lastFrame: true, framesExclusive: true, veoBase64: true,
  referenceVideoSeconds: null, referenceAudioSeconds: null,
  referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
};
const small = { images: 9, videos: 3, audios: 3, total: null };
const large = { images: 30, videos: 10, audios: 10, total: null };
const wanRefs = { images: 10, videos: 5, audios: 5, total: null };
const sd2 = { ...small, total: 12 };

export const API88_VIDEO_SPECS = {
  "gemini-omni-flash": fixed("omni", "720p", 10, 5, ["16:9", "9:16"],
    { images: 10, videos: 1, audios: 0, total: null },
    { durations: range(3, 10), firstFrame: false, lastFrame: false, referenceVideoSeconds: 10 }),
  "grok-imagine-video": grok,
  "grok-imagine-video-1.5": grok,
  "kling-3.0-turbo-720p": fixed("kling", "720p", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-1080p": fixed("kling", "1080p", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-2k": fixed("kling", "2k", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-4k": fixed("kling", "4k", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "minimax-h3-768p": fixed("minimax", "768p", 15, 4, ["1:1", "16:9", "9:16"], wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null, framesExclusive: false }),
  "SD2.0 480P": fixed("sd", "480p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 720P": fixed("sd", "720p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 1080P": fixed("sd", "1080p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 4k": fixed("sd", "4k", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.5 480P": fixed("sd", "480p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "SD2.5 720P": fixed("sd", "720p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "SD2.5 1080P": fixed("sd", "1080p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "Seedance-2.0-720p官方版": fixed("seedance", "720p", 15, 4, official, small),
  "Seedance-2.0-fast-720p官方版": fixed("seedance", "720p", 15, 4, official, small),
  "Seedance-2.5-720p官方版": fixed("seedance", "720p", 30, 4, official, large,
    { referenceVideoSeconds: 30, referenceAudioSeconds: 30 }),
  "seedance-2.0-mini-480p": fixed("seedance", "480p", 15, 5, official, small,
    { firstFrame: false, lastFrame: false }),
  "seedance-2.0-mini-720p": fixed("seedance", "720p", 15, 5, official, small,
    { firstFrame: false, lastFrame: false }),
  "veo-3.1": veo,
  "veo-3.1-fast": veo,
  "wan3.0-video-480p": fixed("wan", "480p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null }),
  "wan3.0-video-720p": fixed("wan", "720p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceTotalSeconds: 15 }),
  "wan3.0-video-1080p": fixed("wan", "1080p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null }),
} satisfies Record<string, Api88VideoSpec>;
export type Api88VideoModel = keyof typeof API88_VIDEO_SPECS;
export const API88_DEFAULT_VIDEO_MODEL: Api88VideoModel = "grok-imagine-video-1.5";

export function api88VideoSpec(model: unknown): Api88VideoSpec {
  if (typeof model !== "string" || !Object.hasOwn(API88_VIDEO_SPECS, model)) {
    throw Object.assign(new Error("Unknown 88API video model"), { code: "API88_VIDEO_MODEL_INVALID", status: 400 });
  }
  return API88_VIDEO_SPECS[model as Api88VideoModel];
}
