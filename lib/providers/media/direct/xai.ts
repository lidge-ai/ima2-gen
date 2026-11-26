/**
 * xAI Grok Imagine video, direct to api.x.ai with a bearer token. The same adapter
 * serves the API key lane ("xai" vocabulary) and the Grok subscription session route
 * (L0 sessionRoutes "xai-oauth" passes the OAuth access token as ctx.apiKey).
 *
 * Wire format follows docs.x.ai (lanes/L3-notes/xai.md, checked 2026-11-26) and the
 * rules ima2's grok lane already enforces (lib/grokVideoPins.ts, lib/grokVideoPayload.ts):
 * frame pins (last_frame, up to four keyframes on a 1/3 s grid strictly inside the
 * duration) exist on grok-imagine-video-1.5 only and make a reference-to-video request,
 * which is capped at 720p. Local bytes travel as data: URLs, as the grok lane sends them.
 *
 * xAI terms forbid building a competing service on the API; this adapter only makes
 * the user's own calls (BYOK or the user's own subscription).
 */
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import {
  MediaHttpError, assertAllowed, findModel, httpJson, invalidRequest, normalizeMediaError, protocolError, readVendorOptions,
  redact, toBase64,
} from "./l3-http.js";

const PREFIX = "XAI";
const DOCS = "https://docs.x.ai/developers/model-capabilities/video/generation";
const PRICES = "https://docs.x.ai/developers/pricing";
const CHECKED = "2026-11-26";
const V15 = "grok-imagine-video-1.5";
const LITE = "grok-imagine-video-1.5-lite";
const BASE = "grok-imagine-video";
const POLL_MS = 5000;
const MAX_KEYFRAMES = 4;
const DURATIONS = Array.from({ length: 15 }, (_, i) => i + 1);
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"];
/** reference-to-video duration ceilings per model (xAI answers 15 s on 1.5, 10 s on base). */
const R2V_MAX_SEC: Readonly<Record<string, number>> = { [V15]: 15, [BASE]: 10 };

function prices(values: readonly number[]): MediaModelSpec["pricing"] {
  return values.map((usd, i) => ({ unit: "second" as const, usd, variant: ["480p", "720p", "1080p"][i]!, source: PRICES, checkedAt: CHECKED }));
}

const MODELS: readonly MediaModelSpec[] = [
  { id: "xai/grok-imagine-video-1.5", upstreamId: V15, vendor: "xai", label: "Grok Imagine Video 1.5", kind: "video",
    tasks: ["text-to-video", "image-to-video", "reference-to-video"],
    params: { durationsSec: DURATIONS, resolutions: ["480p", "720p", "1080p"], aspectRatios: RATIOS, maxReferenceImages: 14, nativeAudio: true },
    pricing: prices([0.08, 0.14, 0.25]), docsUrl: DOCS },
  { id: "xai/grok-imagine-video-1.5-lite", upstreamId: LITE, vendor: "xai", label: "Grok Imagine Video 1.5 Lite", kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: { durationsSec: DURATIONS, resolutions: ["480p", "720p", "1080p"], aspectRatios: RATIOS, nativeAudio: true },
    pricing: prices([0.02, 0.03, 0.14]), docsUrl: DOCS },
  { id: "xai/grok-imagine-video", upstreamId: BASE, vendor: "xai", label: "Grok Imagine Video", kind: "video",
    tasks: ["text-to-video", "image-to-video", "reference-to-video", "video-to-video", "video-extend"],
    params: { durationsSec: DURATIONS, resolutions: ["480p", "720p"], aspectRatios: RATIOS, maxReferenceImages: 7, nativeAudio: true },
    pricing: prices([0.05, 0.07]), docsUrl: "https://docs.x.ai/developers/rest-api-reference/inference/videos" },
];

type Body = Record<string, unknown>;
interface Plan { path: string; body: Body }

const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? "https://api.x.ai").replace(/\/$/, "");
const headers = (ctx: MediaAdapterContext) => ({ Authorization: "Bearer " + ctx.apiKey });

/** A public URL or data: URL as given, or local bytes as a data: URL (the grok lane's transport). */
function inputUrl(input: MediaInput): string {
  if (input.bytes) return "data:" + input.mimeType + ";base64," + toBase64(input.bytes);
  if (input.url && (/^https:\/\//i.test(input.url) || input.url.startsWith("data:"))) return input.url;
  throw invalidRequest(input.role + " must be bytes, an https URL or a data: URL", "INPUT_NOT_URL");
}

function call(ctx: MediaAdapterContext, path: string, json?: unknown): Promise<Body> {
  // httpJson scrubs the bearer from vendor error bodies, so the detail can reach the user.
  return httpJson<Body>(ctx, "xAI", base(ctx) + path, { headers: headers(ctx), ...(json === undefined ? {} : { method: "POST" as const, json }) });
}

function validateCommon(request: MediaSubmitRequest, model: MediaModelSpec): void {
  if (!model.tasks.includes(request.task)) throw invalidRequest(model.id + " does not support " + request.task, "UNSUPPORTED_TASK");
  if (!request.prompt?.trim()) throw invalidRequest("A prompt is required", "MISSING_PROMPT");
  assertAllowed("durationSec", request.durationSec, model.params.durationsSec);
  assertAllowed("resolution", request.resolution, model.params.resolutions);
  assertAllowed("aspectRatio", request.aspectRatio, model.params.aspectRatios);
  if (request.negativePrompt !== undefined || request.seed !== undefined || (request.count !== undefined && request.count !== 1)) {
    throw invalidRequest("negativePrompt, seed and count > 1 are not supported by xAI video", "UNSUPPORTED_PARAM");
  }
  if (request.audio === false && model.upstreamId === BASE) throw invalidRequest("Silent output needs grok-imagine-video-1.5 or -1.5-lite", "UNSUPPORTED_PARAM");
}

function generationBase(request: MediaSubmitRequest, model: MediaModelSpec): Body {
  const body: Body = { model: model.upstreamId, prompt: request.prompt };
  if (request.durationSec !== undefined) body.duration = request.durationSec;
  if (request.resolution !== undefined) body.resolution = request.resolution;
  if (request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (request.audio === false) body.generate_audio = false;
  return body;
}

interface KeyframeOption { inputIndex: number; timestampS: number }

function parseKeyframes(raw: unknown): KeyframeOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw invalidRequest("vendorOptions.keyframes must be an array", "INVALID_KEYFRAMES");
  return raw.map((entry: unknown) => {
    const item = entry as Partial<KeyframeOption> | null;
    if (!item || !Number.isInteger(item.inputIndex) || typeof item.timestampS !== "number" || !Number.isFinite(item.timestampS)) {
      throw invalidRequest("each keyframe needs an integer inputIndex and a numeric timestampS", "INVALID_KEYFRAMES");
    }
    return { inputIndex: item.inputIndex!, timestampS: item.timestampS };
  });
}

/** Keyframes as xAI wants them, after the rules of lib/grokVideoPins.ts. */
function keyframesPayload(request: MediaSubmitRequest, keyframes: readonly KeyframeOption[]): Body[] {
  if (keyframes.length > MAX_KEYFRAMES) throw invalidRequest("at most " + MAX_KEYFRAMES + " keyframes", "INVALID_KEYFRAMES");
  const duration = request.durationSec;
  if (duration === undefined) throw invalidRequest("keyframes need durationSec so their timestamps can be checked", "INVALID_KEYFRAMES");
  const slots = new Set<number>();
  const used = new Set<number>();
  return keyframes.map(({ inputIndex, timestampS }) => {
    const input = request.inputs[inputIndex];
    if (!input || input.role !== "reference-image") throw invalidRequest("keyframe inputIndex " + inputIndex + " must point at a reference-image input", "INVALID_KEYFRAMES");
    if (used.has(inputIndex)) throw invalidRequest("two keyframes use input " + inputIndex, "INVALID_KEYFRAMES");
    if (!(timestampS > 0 && timestampS < duration)) throw invalidRequest("keyframe timestamps must lie strictly inside the duration", "INVALID_KEYFRAMES");
    const slot = Math.round(timestampS * 3);
    if (slots.has(slot)) throw invalidRequest("two keyframes fall on the same 1/3 s slot", "INVALID_KEYFRAMES");
    slots.add(slot);
    used.add(inputIndex);
    return { image: { url: inputUrl(input) }, timestamp_s: timestampS };
  });
}

function onlyRoles(request: MediaSubmitRequest, roles: readonly string[]): void {
  const stray = request.inputs.find((input) => !roles.includes(input.role));
  if (stray) throw invalidRequest(request.task + " does not take a " + stray.role + " input", "UNEXPECTED_INPUT");
}

function single(request: MediaSubmitRequest, role: MediaInput["role"]): MediaInput | undefined {
  const found = request.inputs.filter((input) => input.role === role);
  if (found.length > 1) throw invalidRequest(request.task + " takes at most one " + role + " input", "UNEXPECTED_INPUT");
  return found[0];
}

function referencePlan(request: MediaSubmitRequest, model: MediaModelSpec, keyframes: readonly KeyframeOption[]): Plan {
  const is15 = model.upstreamId === V15;
  onlyRoles(request, is15 ? ["reference-image", "first-frame", "last-frame"] : ["reference-image"]);
  if ((request.durationSec ?? 0) > (R2V_MAX_SEC[model.upstreamId] ?? 0)) {
    throw invalidRequest("reference-to-video on " + model.upstreamId + " allows at most " + R2V_MAX_SEC[model.upstreamId] + " seconds", "UNSUPPORTED_PARAM");
  }
  if (request.resolution === "1080p") throw invalidRequest("reference-to-video is capped at 720p", "UNSUPPORTED_PARAM");
  if (keyframes.length && !is15) throw invalidRequest("keyframes need grok-imagine-video-1.5", "INVALID_KEYFRAMES");
  const body = generationBase(request, model);
  const pinned = keyframesPayload(request, keyframes);
  const pinnedIndexes = new Set(keyframes.map((k) => k.inputIndex));
  const refs = request.inputs.filter((input, index) => input.role === "reference-image" && !pinnedIndexes.has(index));
  if (refs.length > (model.params.maxReferenceImages ?? 0)) throw invalidRequest("too many reference images for " + model.upstreamId, "TOO_MANY_INPUTS");
  const first = single(request, "first-frame");
  const last = single(request, "last-frame");
  if (!refs.length && !pinned.length && !last) throw invalidRequest("reference-to-video needs a reference image, a keyframe or a last frame", "MISSING_INPUT");
  if (first) body.image = { url: inputUrl(first) };
  if (refs.length) body.reference_images = refs.map((input) => ({ url: inputUrl(input) }));
  if (last) body.last_frame = { url: inputUrl(last) };
  if (pinned.length) body.keyframes = pinned;
  return { path: "/v1/videos/generations", body };
}

function videoInputPlan(request: MediaSubmitRequest, model: MediaModelSpec): Plan {
  onlyRoles(request, ["source-video"]);
  const source = single(request, "source-video");
  if (!source) throw invalidRequest(request.task + " needs one source-video input", "MISSING_INPUT");
  const extend = request.task === "video-extend";
  if (request.resolution !== undefined || request.aspectRatio !== undefined || request.audio !== undefined || (!extend && request.durationSec !== undefined)) {
    throw invalidRequest(extend ? "video-extend takes only durationSec" : "video-to-video follows the source's duration, size and sound", "UNSUPPORTED_PARAM");
  }
  const body: Body = { model: model.upstreamId, prompt: request.prompt, video: { url: inputUrl(source) } };
  if (extend && request.durationSec !== undefined) body.duration = request.durationSec;
  return { path: extend ? "/v1/videos/extensions" : "/v1/videos/edits", body };
}

function plan(request: MediaSubmitRequest): Plan {
  const model = findModel(MODELS, request.model);
  validateCommon(request, model);
  const keyframes = parseKeyframes(readVendorOptions(request, ["keyframes"]).keyframes);
  if (keyframes.length && request.task !== "reference-to-video") throw invalidRequest("keyframes make a reference-to-video request", "INVALID_KEYFRAMES");
  switch (request.task) {
    case "text-to-video":
      onlyRoles(request, []);
      return { path: "/v1/videos/generations", body: generationBase(request, model) };
    case "image-to-video": {
      onlyRoles(request, ["first-frame"]);
      const first = single(request, "first-frame");
      if (!first) throw invalidRequest("image-to-video needs one first-frame input", "MISSING_INPUT");
      if (request.aspectRatio !== undefined) throw invalidRequest("image-to-video takes its aspect ratio from the image", "UNSUPPORTED_PARAM");
      return { path: "/v1/videos/generations", body: { ...generationBase(request, model), image: { url: inputUrl(first) } } };
    }
    case "reference-to-video": return referencePlan(request, model, keyframes);
    default: return videoInputPlan(request, model);
  }
}

function state(ctx: MediaAdapterContext, data: Body): MediaJobState {
  if (data.status === "pending") return { status: "running", pollAfterMs: POLL_MS };
  if (data.status === "failed") return { status: "failed", error: { code: PREFIX + "_GENERATION_FAILED", message: "xAI video generation failed", category: "upstream", retryable: false, providerState: "failed" } };
  if (data.status === "expired") return { status: "failed", error: { code: PREFIX + "_EXPIRED", message: "xAI video request expired", category: "upstream", retryable: false, providerState: "expired" } };
  if (data.status !== "done") throw protocolError("Unknown xAI video status", String(data.status));
  const video = data.video as { url?: unknown; respect_moderation?: unknown } | undefined;
  if (video?.respect_moderation === false) return { status: "failed", error: { code: PREFIX + "_MODERATION", message: "xAI video was blocked by moderation", category: "moderation", retryable: false } };
  if (typeof video?.url !== "string" || !video.url) throw protocolError("xAI video result has no URL");
  if (ctx.apiKey && video.url.includes(ctx.apiKey)) throw protocolError("xAI video result contained a credential");
  return { status: "succeeded", outputs: [{ kind: "video", url: video.url, mimeType: "video/mp4" }] };
}

export const adapter: MediaProviderAdapter = {
  id: "xai-video", label: "xAI Video", route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "xai", configKey: "xaiApiKey", envVars: ["XAI_API_KEY"], consoleUrl: "https://console.x.ai/" },
  inputTransport: "inline",
  listModels: () => MODELS,
  async validateKey(ctx) {
    try {
      await call(ctx, "/v1/models");
      return { ok: true };
    } catch (error) {
      if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized API key" };
      throw error;
    }
  },
  async submit(ctx, request): Promise<MediaJobRef> {
    let planned: Plan;
    try {
      planned = plan(request);
    } catch (error) {
      // Validation messages echo caller values (a model id, an option); scrub the bearer from them.
      if (!(error instanceof MediaHttpError)) throw error;
      throw new MediaHttpError({ message: redact(error.message, [ctx.apiKey]), reason: error.reason, category: error.category, retryable: false });
    }
    const { path, body } = planned;
    const response = await call(ctx, path, body);
    if (typeof response.request_id !== "string" || !response.request_id) throw protocolError("xAI returned no request ID");
    return { providerJobId: response.request_id, pollAfterMs: POLL_MS };
  },
  async poll(ctx, job) {
    return state(ctx, await call(ctx, "/v1/videos/" + encodeURIComponent(job.providerJobId)));
  },
  normalizeError: (error) => normalizeMediaError(PREFIX, error),
};
