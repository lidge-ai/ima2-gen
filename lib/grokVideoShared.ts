/**
 * Types, config, and transport helpers shared by the Grok video adapter and its poll loop.
 *
 * This module exists to keep the dependency one-way. `videoEndpoint`/`withTimeoutSignal`
 * are used by the planner and start calls in `grokVideoAdapter.ts` AND by the poll loop in
 * `grokVideoPoll.ts`; leaving them in the adapter would force the poll module to import
 * the adapter that imports it back.
 *
 * MUST stay a leaf: it may import runtime/config/model helpers, never the adapter or the
 * poll loop.
 */
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { getGrokEndpoint, type GrokCredential } from "./grokRuntime.js";
import { grokError } from "./grokImageCore.js";
import { GROK_FALLBACK_VIDEO_MODEL } from "./imageModels.js";
import type { VideoAspectRatio, VideoMode, VideoResolution } from "./imageModels.js";
import type { VideoContinuityLineage } from "./videoContinuity.js";
import { DEFAULT_GROK_PLANNER_MODEL } from "../config.js";

export type GrokVideoPhase = "planning" | "submitted" | "progress";

export interface GrokVideoEvent {
  phase: GrokVideoPhase;
  xaiVideoRequestId?: string | undefined;
  requestedModel?: string | undefined;
  effectiveModel?: string | undefined;
  modelFallback?: { from: string; to: string } | null;
  progress?: number | undefined;
  stalled?: boolean | undefined;
}

export interface GrokVideoPollResult {
  status: "pending" | "done" | "failed" | "expired";
  progress?: number | undefined;
  videoUrl?: string | undefined;
  duration?: number | null | undefined;
  respectModeration?: boolean | undefined;
  usage?: Record<string, number> | null | undefined;
  failedCode?: string | undefined;
}

export interface GrokVideoOptions {
  model?: string | undefined;
  mode?: VideoMode | undefined;
  duration?: number | undefined;
  resolution?: VideoResolution | undefined;
  aspectRatio?: VideoAspectRatio | undefined;
  sourceImage?: string | undefined;
  sourceMime?: string | null | undefined;
  referenceImages?: string[] | undefined;
  /** Preset voice ids (grok-imagine-video-1.5 only, max 3). */
  referenceAudios?: string[] | undefined;
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  plannedPrompt?: string | undefined;
  webSearchCalls?: number | undefined;
  continuityLineage?: VideoContinuityLineage | null | undefined;
  plannerModel?: string | undefined;
  credential?: GrokCredential | undefined;
  onEvent?: (ev: GrokVideoEvent) => void | undefined;
  storyboardActive?: boolean | undefined;
  backgroundConstraint?: string | undefined;
}

export interface VideoConfig {
  model: string;
  startTimeoutMs: number;
  pollIntervalMs: number;
  totalTimeoutMs: number;
  pollMaxConsecutiveErrors: number;
  plannerModel: string;
  plannerTimeoutMs: number;
  /** Own bound for the degradable web-search brief; smaller than the planner budget. */
  searchTimeoutMs: number;
  /** Ceiling on search + planner combined, so the two stages cannot sum unbounded. */
  planTotalTimeoutMs: number;
}

export const STALE_PROGRESS_MS = 180_000;

export const FAILED_CODE_MAP: Record<string, { code: string; status: number }> = {
  invalid_argument: { code: "GROK_VIDEO_REQUEST_FAILED", status: 400 },
  permission_denied: { code: "GROK_VIDEO_REQUEST_FAILED", status: 403 },
  failed_precondition: { code: "GROK_VIDEO_REQUEST_FAILED", status: 412 },
  service_unavailable: { code: "GROK_VIDEO_POLL_FAILED", status: 502 },
  internal_error: { code: "GROK_VIDEO_FAILED", status: 502 },
};

export function videoConfig(ctx: RouteRuntimeContext): VideoConfig {
  const g = ctx.config?.grokProvider || {};
  const plannerTimeoutMs = g.plannerTimeoutMs || 900_000;
  const searchTimeoutMs = g.searchTimeoutMs || 300_000;
  // The planning ceiling must stay STRICTLY greater than the two stages it contains, or a
  // slow search plus a stalled planner lands both timers together and the fatal ceiling
  // preempts the planner fallback. Operator config can violate that, so clamp at runtime
  // rather than trusting the defaults to survive an env override.
  // devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
  const configuredPlanTotal = g.videoPlanTotalTimeoutMs || 1_500_000;
  const minimumPlanTotal = searchTimeoutMs + plannerTimeoutMs + 60_000;
  return {
    model: g.defaultVideoModel || GROK_FALLBACK_VIDEO_MODEL,
    startTimeoutMs: g.videoStartTimeoutMs || 300_000,
    pollIntervalMs: g.videoPollIntervalMs || 5_000,
    totalTimeoutMs: g.videoTimeoutMs || 1_800_000,
    pollMaxConsecutiveErrors: g.videoPollMaxConsecutiveErrors || 5,
    plannerModel: g.plannerModel || DEFAULT_GROK_PLANNER_MODEL,
    plannerTimeoutMs,
    searchTimeoutMs,
    planTotalTimeoutMs: Math.max(configuredPlanTotal, minimumPlanTotal),
  };
}

/** Same endpoint builder as images; kept under the video name so the poll loop stays a leaf. */
export function videoEndpoint(_ctx: RouteRuntimeContext, path: string, credential?: GrokCredential) {
  if (!credential) throw grokError("Grok credential was not resolved before the request", 500, "GROK_CREDENTIAL_UNRESOLVED");
  return getGrokEndpoint(path, credential);
}

export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  return { combinedSignal, timer };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(grokError("Generation canceled", 499, "GENERATION_CANCELED"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(grokError("Generation canceled", 499, "GENERATION_CANCELED"));
      },
      { once: true },
    );
  });
}

/** Raw xAI video poll JSON; the upstream omits fields depending on the job status. */
export interface XaiVideoPollJson {
  status?: string;
  progress?: unknown;
  video?: { url?: string; duration?: number | null; respect_moderation?: boolean };
  usage?: { cost_in_usd_ticks?: number };
  error?: { code?: string };
}

export function normalizeVideoPoll(data: XaiVideoPollJson | null | undefined): GrokVideoPollResult {
  const status = data?.status as GrokVideoPollResult["status"];
  return {
    status,
    progress: typeof data?.progress === "number" ? data.progress : undefined,
    videoUrl: data?.video?.url,
    duration: data?.video?.duration ?? null,
    respectModeration: data?.video?.respect_moderation,
    usage: data?.usage ? { grok_cost_usd_ticks: data.usage.cost_in_usd_ticks ?? 0 } : null,
    failedCode: data?.error?.code,
  };
}
