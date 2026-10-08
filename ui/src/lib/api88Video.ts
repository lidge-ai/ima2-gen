import type { VideoModel, VideoResolutionUI } from "../types";
import { API88_VIDEO_SPECS, type Api88VideoModel } from "../generated/api88VideoSpecs";

export interface Api88UiVideoSpec {
  durations: readonly number[]; defaultDuration: number;
  ratios: readonly string[]; resolutions: readonly VideoResolutionUI[];
  imageLimit: number; veoBase64: boolean; imageMode: "source" | "both" | "reference";
}
export const API88_DEFAULT_VIDEO_MODEL: Api88VideoModel = "grok-imagine-video-1.5";
export function isApi88VideoModel(value: unknown): value is Api88VideoModel {
  return typeof value === "string" && Object.hasOwn(API88_VIDEO_SPECS, value);
}
export function api88UiVideoSpec(value: unknown): Api88UiVideoSpec | null {
  return isApi88VideoModel(value) ? API88_VIDEO_SPECS[value] : null;
}
export function api88VideoOptions(): Array<{ value: VideoModel; shortLabel: string }> {
  return (Object.keys(API88_VIDEO_SPECS) as Api88VideoModel[]).map((value) => ({ value, shortLabel: value }));
}
export function api88VideoAxes(state: {
  videoModelSelected?: string | false; videoDuration: number;
  videoResolution: VideoResolutionUI; videoAspectRatio: string;
}, hasImages = false): { duration: number; resolution: VideoResolutionUI; aspectRatio: string } {
  const spec: Api88UiVideoSpec = api88UiVideoSpec(state.videoModelSelected) ?? API88_VIDEO_SPECS[API88_DEFAULT_VIDEO_MODEL];
  return {
    duration: spec.veoBase64 && hasImages ? 8
      : spec.durations.includes(state.videoDuration) ? state.videoDuration : spec.defaultDuration,
    resolution: spec.resolutions.includes(state.videoResolution) ? state.videoResolution : spec.resolutions[0],
    aspectRatio: spec.ratios.includes(state.videoAspectRatio) ? state.videoAspectRatio : spec.ratios[0],
  };
}

export function api88AnimateFields(state: Parameters<typeof api88VideoAxes>[0] & { provider: string }): Partial<{
  duration: number; resolution: VideoResolutionUI; aspectRatio: string;
  mode: "image-to-video" | "reference-to-video";
}> {
  if (state.provider !== "88api") return {};
  const spec = api88UiVideoSpec(state.videoModelSelected) ?? API88_VIDEO_SPECS[API88_DEFAULT_VIDEO_MODEL];
  return { ...api88VideoAxes(state, true),
    mode: spec.imageMode === "reference" ? "reference-to-video" : "image-to-video" };
}
