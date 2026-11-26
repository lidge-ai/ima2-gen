import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { assertAllowed, contextSecrets, findModel, httpJson, inputsByRole, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, requireInput, requireUrl } from "./l3-http.js";

const docsUrl = "https://docs.x.ai/developers/model-capabilities/video/generation";
const priceUrl = "https://docs.x.ai/developers/pricing";
const durations = Array.from({ length: 15 }, (_, i) => i + 1);
const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"];
const prices = (values: number[]) => values.map((usd, i) => ({ unit: "second" as const, usd, variant: ["480p", "720p", "1080p"][i]!, source: priceUrl, checkedAt: "2026-11-26" }));
const models: MediaModelSpec[] = [
  { id: "xai/grok-imagine-video-1.5", upstreamId: "grok-imagine-video-1.5", vendor: "xai", label: "Grok Imagine Video 1.5", kind: "video", tasks: ["text-to-video", "image-to-video", "reference-to-video"], params: { durationsSec: durations, resolutions: ["480p", "720p", "1080p"], aspectRatios: ratios, maxReferenceImages: 14, nativeAudio: true }, pricing: prices([0.08, 0.14, 0.25]), docsUrl },
  { id: "xai/grok-imagine-video-1.5-lite", upstreamId: "grok-imagine-video-1.5-lite", vendor: "xai", label: "Grok Imagine Video 1.5 Lite", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: durations, resolutions: ["480p", "720p", "1080p"], aspectRatios: ratios, nativeAudio: true }, pricing: prices([0.02, 0.03, 0.14]), docsUrl },
  { id: "xai/grok-imagine-video", upstreamId: "grok-imagine-video", vendor: "xai", label: "Grok Imagine Video", kind: "video", tasks: ["text-to-video", "image-to-video", "reference-to-video", "video-to-video", "video-extend"], params: { durationsSec: durations, resolutions: ["480p", "720p"], aspectRatios: ratios, maxReferenceImages: 7, nativeAudio: true }, pricing: prices([0.05, 0.07]), docsUrl },
];
const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? "https://api.x.ai").replace(/\/$/, "");
const headers = (ctx: MediaAdapterContext) => ({ Authorization: `Bearer ${ctx.apiKey}` });

async function call(ctx: MediaAdapterContext, path: string, json?: unknown): Promise<Record<string, unknown>> {
  // httpJson scrubs the key from vendor error bodies, so the detail can reach the user.
  return await httpJson(ctx, "xAI", base(ctx) + path, { headers: headers(ctx), ...(json === undefined ? {} : { method: "POST" as const, json }) });
}
function validate(request: MediaSubmitRequest, model: MediaModelSpec): void {
  readVendorOptions(request, []);
  if (!model.tasks.includes(request.task)) throw invalidRequest("Unsupported task");
  if (!request.prompt?.trim()) throw invalidRequest("Prompt is required");
  assertAllowed("duration", request.durationSec, model.params.durationsSec);
  assertAllowed("resolution", request.resolution, model.params.resolutions);
  assertAllowed("aspectRatio", request.aspectRatio, model.params.aspectRatios);
  if (request.negativePrompt !== undefined || request.seed !== undefined || (request.count !== undefined && request.count !== 1)) throw invalidRequest("Unsupported parameter");
  if (request.audio === false && model.upstreamId === "grok-imagine-video") throw invalidRequest("Silent output is unsupported for this model");
  if (request.task === "image-to-video" && request.aspectRatio !== undefined) throw invalidRequest("Image-to-video derives its aspect ratio from the image");
  if (request.task === "reference-to-video" && (request.resolution === "1080p" || (model.upstreamId === "grok-imagine-video" && (request.durationSec ?? 0) > 10))) throw invalidRequest("Unsupported reference video configuration");
  if ((request.task === "video-to-video" || request.task === "video-extend") && (request.resolution !== undefined || request.aspectRatio !== undefined || request.audio !== undefined || (request.task === "video-to-video" && request.durationSec !== undefined))) throw invalidRequest("Unsupported video input configuration");
}
function payload(request: MediaSubmitRequest, model: MediaModelSpec): { path: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { model: model.upstreamId, prompt: request.prompt };
  if (request.durationSec !== undefined) body.duration = request.durationSec;
  if (request.resolution !== undefined) body.resolution = request.resolution;
  if (request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (request.audio === false) body.generate_audio = false;
  let roles: string[] = [];
  let path = "/v1/videos/generations";
  if (request.task === "image-to-video") { roles = ["first-frame"]; body.image = { url: requireUrl(requireInput(request, "first-frame")) }; }
  if (request.task === "reference-to-video") {
    roles = ["reference-image"];
    const refs = inputsByRole(request, "reference-image");
    if (!refs.length || refs.length > (model.params.maxReferenceImages ?? 0)) throw invalidRequest("Invalid reference image count");
    body.reference_images = refs.map((input) => ({ url: requireUrl(input) }));
  }
  if (request.task === "video-to-video" || request.task === "video-extend") {
    roles = ["source-video"]; body.video = { url: requireUrl(requireInput(request, "source-video")) };
    path = request.task === "video-to-video" ? "/v1/videos/edits" : "/v1/videos/extensions";
  }
  if (request.inputs.some((input) => !roles.includes(input.role))) throw invalidRequest("Unexpected input role");
  return { path, body };
}
function state(ctx: MediaAdapterContext, data: Record<string, unknown>): MediaJobState {
  if (data.status === "pending") return { status: "running", pollAfterMs: 5000 };
  if (data.status === "failed") return { status: "failed", error: { code: "XAI_GENERATION_FAILED", message: "xAI video generation failed", category: "upstream", retryable: false, providerState: "failed" } };
  if (data.status !== "done") throw protocolError("Unknown xAI video status");
  const video = data.video as { url?: unknown; respect_moderation?: unknown } | undefined;
  if (video?.respect_moderation === false) return { status: "failed", error: { code: "XAI_MODERATION", message: "xAI video was blocked by moderation", category: "moderation", retryable: false } };
  if (typeof video?.url !== "string" || !video.url) throw protocolError("xAI video result has no URL");
  if (video.url.includes(ctx.apiKey) && ctx.apiKey) throw protocolError("xAI video result contained a credential");
  return { status: "succeeded", outputs: [{ kind: "video", url: video.url, mimeType: "video/mp4" }] };
}
export const adapter: MediaProviderAdapter = {
  id: "xai-video", label: "xAI Video", route: "direct", errorPrefix: "XAI",
  credential: { keyVocabulary: "xai", configKey: "xaiApiKey", envVars: ["XAI_API_KEY"], consoleUrl: "https://console.x.ai/" }, inputTransport: "url",
  listModels: () => models,
  async validateKey(ctx) {
    try { await call(ctx, "/v1/models"); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized API key" }; throw error; }
  },
  async submit(ctx, request) {
    try {
      const model = findModel(models, request.model); validate(request, model);
      const { path, body } = payload(request, model);
      const response = await call(ctx, path, body);
      if (typeof response.request_id !== "string" || !response.request_id) throw protocolError("xAI returned no request ID");
      return { providerJobId: response.request_id, pollAfterMs: 5000 };
    } catch (error) {
      const normalized = normalizeMediaError("XAI", error, contextSecrets(ctx));
      throw new MediaHttpError({ ...normalized, reason: normalized.code.slice(4) });
    }
  },
  async poll(ctx, job: MediaJobRef) { return state(ctx, await call(ctx, `/v1/videos/${encodeURIComponent(job.providerJobId)}`)); },
  normalizeError(error) {
    return normalizeMediaError("XAI", error);
  },
};
