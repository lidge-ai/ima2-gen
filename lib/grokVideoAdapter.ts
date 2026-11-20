import { thrownFields } from "./errInfo.js";
import { logEvent, logWarn } from "./logger.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { grokError, searchGrokVisualContext } from "./grokImageAdapter.js";
import type { GrokChatResponse } from "./grokImageCore.js";
import { grokFetchWithRetry } from "./grokUpstreamRetry.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { downloadVideo } from "./grokVideoDownload.js";
import { buildGrokVideoPlannerSystemPrompt, composeFallbackVideoPrompt, formatDurationPacingGuidance, type VideoPlannerContext } from "./grokVideoPlannerPrompt.js";
import type { VideoAspectRatio, VideoMode, VideoResolution } from "./imageModels.js";
import {
  GROK_VIDEO_MODEL_15,
  GROK_VIDEO_MODEL_15_LITE,
  GROK_VIDEO_MODEL_BASE,
  canonicalGrokVideoModel,
} from "./imageModels.js";
import { buildVideoGenerationPayload } from "./grokVideoPayload.js";
import type { VideoFramePins } from "./grokVideoPins.js";
import { formatVideoContinuityForPlanner, type VideoContinuityLineage } from "./videoContinuity.js";
import { DEFAULT_GROK_PLANNER_MODEL } from "../config.js";
import { resolveGrokCredential, type GrokCredential } from "./grokRuntime.js";
import {
  videoConfig,
  videoEndpoint,
  withTimeoutSignal,
  type GrokVideoOptions,
} from "./grokVideoShared.js";
import { pollVideoUntilDone } from "./grokVideoPoll.js";

export { downloadVideo } from "./grokVideoDownload.js";

// routes/videoExtended.ts imports these from the adapter; keep that path working.
export type {
  GrokVideoEvent,
  GrokVideoOptions,
  GrokVideoPhase,
  GrokVideoPollResult,
} from "./grokVideoShared.js";
export { normalizeVideoPoll } from "./grokVideoShared.js";
export { isRecoverablePollError, pollVideoOnce, pollVideoUntilDone } from "./grokVideoPoll.js";

export interface GrokVideoPlan {
  prompt: string;
  mode: VideoMode;
  duration: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  webSearchCalls: number;
  /**
   * Set when the web-search brief was skipped because it timed out or failed. The plan is
   * still valid — the planner has the system prompt, the user prompt, the source image and
   * continuity context without a brief — but the caller can surface the degradation.
   */
  searchDegraded?: GrokVideoSearchDegradation | undefined;
  /** Set when the planner itself was unavailable and the prompt was composed locally. */
  plannerDegraded?: GrokVideoPlannerDegradation | undefined;
}

export interface GrokVideoSearchDegradation {
  reason: "timeout" | "failed";
  message: string;
}

export interface GrokVideoPlannerDegradation {
  reason: "timeout" | "failed" | "empty";
  message: string;
}

/**
 * A planner failure is degradable when retrying or waiting could plausibly have produced a
 * prompt: a stall, an upstream 5xx, or a network fault.
 *
 * A 4xx is NOT degradable — the request itself is malformed or unauthorized, and generating
 * a video anyway would spend the user's quota on a request the provider already rejected.
 *
 * Neither is a 200 that carries no usable tool call: the planner ANSWERED and declined or
 * malfunctioned, which is a judgment about the request rather than an availability problem.
 * Billing a video start on the back of a refusal is worse for the user than an honest error.
 */
export function isDegradablePlannerFailure(failure: unknown): { reason: GrokVideoPlannerDegradation["reason"]; message: string } | null {
  const err = thrownFields(failure);
  const message = typeof err?.message === "string" ? err.message : "planner unavailable";
  if (err?.name === "AbortError") return { reason: "timeout", message };
  const code = typeof err?.code === "string" ? err.code : "";
  if (code === "GROK_PLANNER_TIMEOUT") return { reason: "timeout", message };
  if (code === "GROK_PLANNER_NETWORK_FAILED") return { reason: "failed", message };
  const status = typeof err?.status === "number" ? err.status : 0;
  if (code === "GROK_PLANNER_BAD_REQUEST" && status >= 500) return { reason: "failed", message };
  // 429 is the same availability class as a stall: the upstream is saturated, not offended.
  if (code === "GROK_PLANNER_BAD_REQUEST" && status === 429) return { reason: "failed", message };
  return null;
}

export interface GrokVideoGenerateResult {
  videoBuffer: Buffer;
  contentType: string;
  url: string;
  duration: number | null;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  mode: VideoMode;
  usage: Record<string, number> | null;
  revisedPrompt: string;
  xaiVideoRequestId: string;
  webSearchCalls: number;
  requestedModel: string;
  effectiveModel: string;
  modelFallback: { from: string; to: string } | null;
  /** Present when the video was planned without a web-search brief. */
  searchDegraded?: GrokVideoSearchDegradation | undefined;
  /** Present when the video was generated from a locally composed prompt. */
  plannerDegraded?: GrokVideoPlannerDegradation | undefined;
}

const canonicalVideoModel = canonicalGrokVideoModel;

/**
 * Every video call carries an explicit credential. Callers that resolved one (the HTTP
 * routes, the extend operation) pass it down so a whole request uses a single bearer;
 * callers that did not — the agent surface — get the OAuth lane, which is exactly what
 * the removed proxy used to supply for them.
 */
async function videoCredential(ctx: RouteRuntimeContext, options: GrokVideoOptions): Promise<GrokCredential> {
  if (options.credential) return options.credential;
  return resolveGrokCredential(ctx, "grok", options.signal ? { signal: options.signal } : {});
}

function sourceImageUrl(image: string, mime?: string | null): string {
  if (image.startsWith("data:") || image.startsWith("http")) return image;
  const detected = mime || detectImageMimeFromB64(image) || "image/png";
  return `data:${detected};base64,${image}`;
}

export function buildGrokVideoPlannerPayload(
  prompt: string,
  opts: { model: string; mode: VideoMode; duration: number; resolution: VideoResolution; aspectRatio: VideoAspectRatio; plannerModel?: string | undefined; searchSummary?: string | undefined; sourceImageUrl?: string | undefined; referenceImageUrls?: string[] | undefined; referenceAudios?: string[] | undefined; continuityLineage?: VideoContinuityLineage | null | undefined; backgroundConstraint?: string | undefined },
) {
  const isI2V = opts.mode === "image-to-video";
  const isRef2V = opts.mode === "reference-to-video";
  const continuity = isRef2V
    ? "This is reference-to-video: use the provided reference images (referred to as <IMAGE_1>..<IMAGE_N>) as subject/style guidance and keep their subjects recognizable in the generated video."
    : isI2V
    ? "This is image-to-video: preserve subject identity and composition unless asked otherwise, and use the source image as the first frame / starting point."
    : "This is text-to-video: describe motion, camera, and action clearly.";
  // Voices only bind to a speaker if the prompt says where they go, and the planner
  // rewrites the prompt — so it has to know the tag convention.
  const voiceCount = opts.referenceAudios?.length ?? 0;
  const voiceGuidance = voiceCount > 0
    ? `${voiceCount} preset voice${voiceCount > 1 ? "s are" : " is"} attached, referred to as <AUDIO_0>..<AUDIO_${voiceCount - 1}>. Say who speaks with which voice in the prompt (for example "the person from <IMAGE_1> speaks with <AUDIO_0>"); a voice nobody is assigned to will not be used.`
    : "";
  const lineageText = formatVideoContinuityForPlanner(opts.continuityLineage);
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: string } }
  > = [
    {
      type: "text",
      text: [
        `Selected video model: ${opts.model}. Mode: ${opts.mode}.`,
        `Requested duration: ${opts.duration}s, resolution: ${opts.resolution}, aspect ratio: ${opts.aspectRatio}.`,
        continuity,
        lineageText ? `Authoritative continuation context:\n${lineageText}` : "Authoritative continuation context: none.",
        formatDurationPacingGuidance(opts.duration, opts.mode, opts.resolution),
        ...(voiceGuidance ? [voiceGuidance] : []),
        opts.searchSummary ? `Mandatory web-search brief:\n${opts.searchSummary}` : "Mandatory web-search brief: unavailable.",
        ...(opts.backgroundConstraint ? [opts.backgroundConstraint] : []),
        "Return the generate_video.prompt argument in English only, except for exact visible text the user explicitly requested.",
        "\nUser prompt:",
        prompt,
      ].join("\n"),
    },
  ];
  if (isI2V && opts.sourceImageUrl) {
    userContent.push({ type: "image_url", image_url: { url: opts.sourceImageUrl, detail: "high" } });
  }
  if (isRef2V) {
    for (const url of opts.referenceImageUrls ?? []) {
      userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
    }
  }
  return {
    model: opts.plannerModel || DEFAULT_GROK_PLANNER_MODEL,
    stream: false,
    parallel_tool_calls: false,
    messages: [
      {
        role: "system",
        content: buildGrokVideoPlannerSystemPrompt({ model: opts.model, mode: opts.mode, resolution: opts.resolution } satisfies VideoPlannerContext),
      },
      { role: "user", content: userContent },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_video",
          description: "Generate a single video through xAI Videos API.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Final video-generation prompt to send to xAI Videos API." },
              model: { type: "string", enum: [GROK_VIDEO_MODEL_BASE, GROK_VIDEO_MODEL_15, GROK_VIDEO_MODEL_15_LITE] },
              mode: { type: "string", enum: ["text-to-video", "image-to-video", "reference-to-video"] },
              duration: { type: "number" },
              aspect_ratio: { type: "string" },
              resolution: { type: "string", enum: ["480p", "720p", "1080p"] },
            },
            required: ["prompt"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "generate_video" } },
  };
}

export function parseGrokVideoPlanPrompt(response: GrokChatResponse): string {
  const toolCalls = response?.choices?.[0]?.message?.tool_calls || [];
  const call = toolCalls.find((item) => item.type === "function" && item.function?.name === "generate_video");
  if (!call?.function?.arguments) {
    throw grokError("Grok planner did not call generate_video", 502, "GROK_PLANNER_EMPTY_TOOL_CALL");
  }
  let args: { prompt?: unknown };
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw grokError("Grok planner returned invalid tool arguments", 502, "GROK_PLANNER_INVALID_TOOL_ARGS");
  }
  if (typeof args?.prompt !== "string" || !args.prompt.trim()) {
    throw grokError("Grok planner returned an empty video prompt", 502, "GROK_PLANNER_INVALID_TOOL_ARGS");
  }
  return args.prompt.trim();
}

export async function planGrokVideo(prompt: string, ctx: RouteRuntimeContext, options: GrokVideoOptions = {}): Promise<GrokVideoPlan> {
  const cfg = videoConfig(ctx);
  const credential = await videoCredential(ctx, options);
  const mode: VideoMode = options.mode || (options.sourceImage ? "image-to-video" : "text-to-video");
  const duration = options.duration ?? 5;
  const resolution = options.resolution || "480p";
  const aspectRatio = options.aspectRatio || "auto";
  const plannerModel = options.plannerModel || cfg.plannerModel;
  const model = canonicalVideoModel(options.model || cfg.model);
  // One deadline for the whole planning phase. Both stages run under it, so search and
  // planner can never sum to two independent budgets (the shape of the 360 s failure).
  // devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
  const phase = withTimeoutSignal(options.signal, cfg.planTotalTimeoutMs);
  const phaseSignal = phase.combinedSignal;
  /** A phase-ceiling abort is fatal; it must never be mistaken for a degradable failure. */
  const phaseExpired = () => phaseSignal.aborted && !options.signal?.aborted;
  try {
  // The web-search brief is an enhancement, not a requirement: a slow or failing search
  // used to abort the whole video request (GROK_PLANNER_TIMEOUT / GROK_SEARCH_TIMEOUT).
  // Degrade instead, and keep the planner's own budget intact.
  // devlog/_plan/260817_grok_video_planner_timeout/020_search_resilience.md
  let searchSummary: string | undefined;
  let searchDegraded: GrokVideoSearchDegradation | undefined;
  try {
    // Pass the PHASE signal, never a locally wrapped search timer: searchGrokVisualContext
    // reports any abort of its `options.signal` as a user cancellation, so handing it our
    // own deadline would turn a slow search — the exact case 020 exists to degrade — into
    // GENERATION_CANCELED. The stage bound is applied inside that function via
    // getPlannerConfig().searchTimeoutMs.
    const search = await searchGrokVisualContext(prompt, ctx, { signal: phaseSignal, ...(options.requestId ? { requestId: options.requestId } : {}), credential, plannerModel });
    searchSummary = search.summary;
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    // A user cancellation is a real cancellation and must never be swallowed. Neither is
    // the planning-phase ceiling: searchGrokVisualContext reports an inherited abort as its
    // own cancellation, so without this check a ceiling hit would "degrade" and then start
    // the planner after the phase had already expired.
    if (options.signal?.aborted) throw e;
    if (phaseExpired()) throw grokError("Grok video planning timed out", 504, "GROK_VIDEO_PLAN_TIMEOUT");
    if (eFields.code === "GENERATION_CANCELED") throw e;
    searchDegraded = {
      reason: eFields.code === "GROK_SEARCH_TIMEOUT" ? "timeout" : "failed",
      message: typeof eFields.message === "string" ? eFields.message : "web search unavailable",
    };
    logWarn("grok", "video:search:degraded", {
      requestId: options.requestId,
      reason: searchDegraded.reason,
      error: searchDegraded.message,
    });
  }
  const referenceImageUrls = (options.referenceImages ?? []).map((img) => sourceImageUrl(img, undefined));
  const payload = buildGrokVideoPlannerPayload(prompt, {
    model,
    mode,
    duration,
    resolution,
    aspectRatio,
    plannerModel,
    searchSummary,
    sourceImageUrl: options.sourceImage ? sourceImageUrl(options.sourceImage, options.sourceMime) : undefined,
    referenceImageUrls,
    ...(options.referenceAudios?.length ? { referenceAudios: options.referenceAudios } : {}),
    continuityLineage: options.continuityLineage,
    backgroundConstraint: options.backgroundConstraint,
  });
  const { url, headers } = videoEndpoint(ctx, "/v1/chat/completions", credential);
  const { combinedSignal, timer } = withTimeoutSignal(phaseSignal, cfg.plannerTimeoutMs);
  logEvent("grok", "video:planner:start", { requestId: options.requestId, mode, duration, resolution });
  try {
    // Safe to replay: the planner produces no billable artifact, only a prompt.
    const res = await grokFetchWithRetry(
      () => fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: combinedSignal }),
      { signal: combinedSignal, label: "video-planner" },
    );
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw grokError(`Grok video planner failed: ${text || `HTTP ${res.status}`}`, res.status >= 500 ? 502 : res.status, "GROK_PLANNER_BAD_REQUEST");
    }
    const planPrompt = parseGrokVideoPlanPrompt(await res.json() as GrokChatResponse);
    logEvent("grok", "video:planner:done", { requestId: options.requestId, mode, promptChars: planPrompt.length });
    return {
      prompt: planPrompt,
      mode,
      duration,
      resolution,
      aspectRatio,
      // Honest accounting: no brief means no billable search call was completed.
      webSearchCalls: searchDegraded ? 0 : 1,
      ...(searchDegraded ? { searchDegraded } : {}),
    };
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    clearTimeout(timer);
    // Real cancellation and the planning-phase ceiling are always fatal.
    if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
    if (phaseExpired()) throw grokError("Grok video planning timed out", 504, "GROK_VIDEO_PLAN_TIMEOUT");
    const normalized = eFields.name === "AbortError"
      ? grokError("Grok video planner timed out", 504, "GROK_PLANNER_TIMEOUT")
      : (eFields.code && eFields.status ? e : grokError(`Grok video planner request failed: ${eFields.message}`, 502, "GROK_PLANNER_NETWORK_FAILED"));
    // A stalled or broken planner must not cost the user their video: the user's own
    // prompt is already usable, so compose one locally and continue. 4xx stays fatal.
    // devlog/_plan/260817_grok_video_planner_timeout/040_planner_fallback.md
    const degradable = isDegradablePlannerFailure(normalized);
    if (!degradable) throw normalized;
    const fallbackPrompt = composeFallbackVideoPrompt(prompt, {
      mode,
      duration,
      resolution,
      searchSummary,
      continuityText: formatVideoContinuityForPlanner(options.continuityLineage) || undefined,
      backgroundConstraint: options.backgroundConstraint,
    });
    logWarn("grok", "video:planner:degraded", {
      requestId: options.requestId,
      reason: degradable.reason,
      error: degradable.message,
      promptChars: fallbackPrompt.length,
    });
    return {
      prompt: fallbackPrompt,
      mode,
      duration,
      resolution,
      aspectRatio,
      webSearchCalls: searchDegraded ? 0 : 1,
      ...(searchDegraded ? { searchDegraded } : {}),
      plannerDegraded: degradable,
    };
  }
  } finally {
    clearTimeout(phase.timer);
  }
}

export { buildVideoGenerationPayload } from "./grokVideoPayload.js";

export async function startVideoRequest(ctx: RouteRuntimeContext, payload: Record<string, unknown>, options: GrokVideoOptions): Promise<string> {
  const cfg = videoConfig(ctx);
  const { url, headers } = videoEndpoint(ctx, "/v1/videos/generations", await videoCredential(ctx, options));
  const { combinedSignal, timer } = withTimeoutSignal(options.signal, cfg.startTimeoutMs);
  try {
    // NOT wrapped in grokFetchWithRetry on purpose: a reset or 5xx here may follow a job
    // the origin already accepted, and no idempotency key exists to deduplicate it.
    // Retrying would create and bill a second video.
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: combinedSignal });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw grokError(`Grok video request failed: ${text || `HTTP ${res.status}`}`, res.status >= 500 ? 502 : res.status, "GROK_VIDEO_REQUEST_FAILED");
    }
    const data = await res.json() as { request_id?: string; id?: string };
    const requestId = data?.request_id || data?.id;
    if (!requestId) throw grokError("Grok video start returned no request id", 502, "GROK_VIDEO_REQUEST_FAILED");
    return requestId;
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    clearTimeout(timer);
    if (eFields.name === "AbortError") {
      if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
      throw grokError("Grok video start timed out", 504, "GROK_VIDEO_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw grokError(`Grok video start request failed: ${eFields.message}`, 502, "GROK_VIDEO_REQUEST_FAILED");
  }
}

function pinUrls(pins: VideoFramePins | undefined): VideoFramePins | undefined {
  return pins && { ...(pins.lastFrame ? { lastFrame: sourceImageUrl(pins.lastFrame, undefined) } : {}), ...(pins.keyframes ? { keyframes: pins.keyframes.map((k) => ({ ...k, image: sourceImageUrl(k.image, undefined) })) } : {}) };
}

export async function generateVideoViaGrok(prompt: string, ctx: RouteRuntimeContext, options: GrokVideoOptions = {}): Promise<GrokVideoGenerateResult> {
  const cfg = videoConfig(ctx);
  // Resolve once for the whole request: plan, start, and poll must all carry the same
  // bearer, and re-resolving per stage would refresh the OAuth session repeatedly.
  const effective: GrokVideoOptions = { ...options, credential: await videoCredential(ctx, options) };
  const model = canonicalVideoModel(options.model || cfg.model);
  const srcUrl = options.sourceImage ? sourceImageUrl(options.sourceImage, options.sourceMime) : undefined;
  const refUrls = (options.referenceImages ?? []).map((img) => sourceImageUrl(img, undefined));
  const voices = options.referenceAudios ?? [];
  options.onEvent?.({ phase: "planning" });
  const plan = options.plannedPrompt
    ? {
        prompt: options.plannedPrompt,
        mode: (options.mode || (options.sourceImage ? "image-to-video" : "text-to-video")) as VideoMode,
        duration: options.duration ?? 5,
        resolution: options.resolution || "480p",
        aspectRatio: options.aspectRatio || "auto",
        webSearchCalls: options.webSearchCalls ?? 1,
      }
    : await planGrokVideo(prompt, ctx, effective);
  // Native 1.5 T2V; a start 400 is surfaced, never retried on another model (plan G4).
  const xaiVideoRequestId = await startVideoRequest(ctx, buildVideoGenerationPayload(plan, { model, sourceImageUrl: srcUrl, referenceImageUrls: refUrls, ...(voices.length ? { referenceAudios: voices } : {}), pins: pinUrls(options.pins), generateAudio: options.generateAudio }), effective);
  const effectiveModel = model, modelFallback = null;
  options.onEvent?.({ phase: "submitted", xaiVideoRequestId, requestedModel: model, effectiveModel, modelFallback });
  logEvent("grok", "video:submitted", { requestId: options.requestId, xaiVideoRequestId, mode: plan.mode });
  const poll = await pollVideoUntilDone(ctx, xaiVideoRequestId, effective);
  if (!poll.videoUrl) throw grokError("Grok video done without a video url", 502, "GROK_VIDEO_EMPTY_RESPONSE");
  if (poll.respectModeration === false) throw grokError("Grok video blocked by moderation", 502, "GROK_VIDEO_MODERATION_BLOCKED");
  const { buffer, contentType } = await downloadVideo(ctx, poll.videoUrl, options.signal);
  logEvent("grok", "video:done", { requestId: options.requestId, xaiVideoRequestId, bytes: buffer.length });
  return {
    videoBuffer: buffer,
    contentType,
    url: poll.videoUrl,
    duration: poll.duration ?? plan.duration,
    resolution: plan.resolution,
    aspectRatio: plan.aspectRatio,
    mode: plan.mode,
    usage: poll.usage ?? null,
    revisedPrompt: plan.prompt,
    xaiVideoRequestId,
    webSearchCalls: plan.webSearchCalls,
    requestedModel: model,
    effectiveModel,
    modelFallback,
    ...(plan.searchDegraded ? { searchDegraded: plan.searchDegraded } : {}),
    ...(plan.plannerDegraded ? { plannerDegraded: plan.plannerDegraded } : {}),
  };
}
