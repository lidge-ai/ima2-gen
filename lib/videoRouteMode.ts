import { hasVideoPins, type VideoFramePins } from "./grokVideoPins.js";
import { canonicalGrokVideoModel, deriveVideoMode, GROK_VIDEO_MODEL_15, type VideoMode } from "./imageModels.js";

export interface RouteVideoModeInput {
  model: string;
  isComfy: boolean;
  composerRefCount: number;
  resolvedCount: number;
  voiceCount: number;
  providerUrl: string | null;
  requestedMode: string | null;
  pins: VideoFramePins | undefined;
}

const NAMED_MODES = new Set<string>(["reference-to-video", "image-to-video", "text-to-video"]);

// Which slot an image arrived in is the caller's intent: a composer reference guides the
// video even alone, a node/continuity image is the start frame. A voice alone selects
// reference-to-video upstream ("at least one reference of either kind selects the
// reference-to-video mode", xAI OpenAPI GenerateVideoRequest.reference_audios); calling
// it text-to-video would let a 15s base request through past xAI's 10s r2v ceiling.
// devlog/_plan/260820_grok15_multi_reference_video/030_single_ref_mode_choice.md
function intentMode(input: RouteVideoModeInput): VideoMode {
  if (input.composerRefCount > 0 || input.voiceCount > 0) return "reference-to-video";
  return deriveVideoMode(input.resolvedCount);
}

// Frame pins make a reference-to-video request whose source is the pinned first frame
// (xAI guide; plan R4-F1), whatever mode the caller named. On 1.5 a provider URL beside
// a voice or composer reference is that pinned first frame too, so the r2v caps are
// checked before planning rather than by xAI after it (PR #434 review #2). Elsewhere a
// provider URL keeps meaning "start from this frame".
export function resolveRouteVideoMode(input: RouteVideoModeInput): VideoMode {
  const derived = intentMode(input);
  if (hasVideoPins(input.pins)) return "reference-to-video";
  if (input.providerUrl) {
    const is15 = !input.isComfy && canonicalGrokVideoModel(input.model) === GROK_VIDEO_MODEL_15;
    return is15 && derived === "reference-to-video" ? "reference-to-video" : "image-to-video";
  }
  if (input.requestedMode && NAMED_MODES.has(input.requestedMode)) return input.requestedMode as VideoMode;
  return derived;
}
