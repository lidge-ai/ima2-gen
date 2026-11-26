import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaProviderError, MediaSubmitRequest } from "../contract.js";
import { categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets } from "./_l2/errors.js";
import { asArray, asRecord, asString, joinUrl, sendJson } from "./_l2/http.js";
import { urlOrDataUri, urlOutput } from "./_l2/inputs.js";
import { assertKnownOptions, assertParams, assertTask, findModel } from "./_l2/validate.js";

const PREFIX = "VIDU_";
const DOC = "https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video";
const PRICE = "https://platform.vidu.com/pricing";
const seconds = Array.from({ length: 16 }, (_, i) => i + 1);
const refSeconds = seconds.slice(2);
const resolutions = ["540p", "720p", "1080p"];
const ratios = ["1:1", "9:16", "16:9", "3:4", "4:3"];
const price = (usd: number, variant: string) => ({ unit: "second" as const, usd, variant, source: PRICE, checkedAt: "2026-11-26" });
const q4Doc = "https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/";
const q4Prices = [price(.045, "540p"), price(.095, "720p"), price(.12, "1080p"), price(.19, "2K"), price(.39, "4K")];
// 이름 기준 매핑, Sume 공개 id 와 wire id 대응은 Vidu 문서에 명시 없음.
const models: MediaModelSpec[] = [
  { id: "vidu/vidu-q4", upstreamId: "viduq4-preview", vendor: "vidu", label: "Vidu Q4", kind: "video", tasks: ["image-to-video"], params: { durationsSec: refSeconds, resolutions: [...resolutions, "2K", "4K"], seed: true, nativeAudio: true }, pricing: q4Prices, docsUrl: `${q4Doc}image-to-video` },
  { id: "vidu/vidu-q4-reference", upstreamId: "viduq4-preview", vendor: "vidu", label: "Vidu Q4 Reference", kind: "video", tasks: ["reference-to-video"], params: { durationsSec: refSeconds, resolutions: [...resolutions, "2K", "4K"], aspectRatios: ratios, maxReferenceImages: 15, seed: true, nativeAudio: true }, pricing: q4Prices, docsUrl: `${q4Doc}reference-to-video` },
  { id: "vidu/vidu-q3-pro", upstreamId: "viduq3-pro", vendor: "vidu", label: "Vidu Q3 Pro", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: seconds, resolutions, aspectRatios: ratios, seed: true, nativeAudio: true }, pricing: [price(.05, "540p image/text/keyframe"), price(.10, "720p image/text/keyframe"), price(.12, "1080p image/text/keyframe")], docsUrl: DOC },
  { id: "vidu/vidu-q3-turbo", upstreamId: "viduq3-turbo", vendor: "vidu", label: "Vidu Q3 Turbo", kind: "video", tasks: ["text-to-video", "image-to-video", "reference-to-video"], params: { durationsSec: seconds, resolutions, aspectRatios: ratios, maxReferenceImages: 7, seed: true, nativeAudio: true }, pricing: [price(.04, "540p image/text/keyframe"), price(.06, "720p image/text/keyframe"), price(.07, "1080p image/text/keyframe"), price(.02, "540p reference"), price(.05, "720p reference"), price(.07, "1080p reference")], docsUrl: DOC },
  { id: "vidu/vidu-q3", upstreamId: "viduq3", vendor: "vidu", label: "Vidu Q3", kind: "video", tasks: ["reference-to-video"], params: { durationsSec: refSeconds, resolutions, aspectRatios: ratios, maxReferenceImages: 7, seed: true, nativeAudio: true }, pricing: [price(.04, "540p reference"), price(.06, "720p reference"), price(.08, "1080p reference")], docsUrl: DOC },
  { id: "vidu/vidu-q3-mix", upstreamId: "viduq3-mix", vendor: "vidu", label: "Vidu Q3 Mix", kind: "video", tasks: ["reference-to-video"], params: { durationsSec: refSeconds.slice(0, -1), resolutions: ["720p", "1080p"], aspectRatios: ratios, maxReferenceImages: 7, seed: true, nativeAudio: true }, pricing: [price(.10, "720p reference"), price(.12, "1080p reference")], docsUrl: DOC },
];

function errorFor(ctx: MediaAdapterContext, value: unknown, status?: number): MediaProviderError {
  const data = asRecord(value);
  const rawReason = asString(data.reason) ?? asString(data.err_code);
  const reason = rawReason && redactSecrets(rawReason, contextSecrets(ctx));
  const categories: Record<string, MediaProviderError["category"]> = {
    CreditInsufficient: "quota", QuotaExceeded: "rate-limit", TooManyRequests: "rate-limit", SystemThrottling: "rate-limit",
    TaskPromptPolicyViolation: "moderation", CreationPolicyViolation: "moderation", AuditSubmitIllegal: "moderation",
    Unauthorized: "auth", Forbidden: "auth", TaskNotFound: "not-found", CreationNotFound: "not-found", NotFound: "not-found", InternalServiceFailure: "upstream",
    BadRequest: "invalid-request", FieldLacking: "invalid-request", FieldInvalid: "invalid-request", FieldUnwanted: "invalid-request", FieldItemCountOutOfRange: "invalid-request",
  };
  const category = (reason && categories[reason]) || (status ? categoryForStatus(status) : "unknown");
  const code = reason ? reason.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase() : `HTTP_${status ?? "ERROR"}`;
  const message = redactSecrets(asString(data.message) ?? reason ?? `Vidu request failed (HTTP ${status ?? "unknown"})`, contextSecrets(ctx));
  return mediaError(PREFIX, code, category, message, { status });
}

async function call(ctx: MediaAdapterContext, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await sendJson(ctx, PREFIX, { url: joinUrl(ctx.baseUrl ?? "https://api.vidu.com", path), headers: { Authorization: `Token ${ctx.apiKey}` }, ...(body === undefined ? {} : { body }) });
  } catch (error) {
    const safe = normalizeUnknownError(PREFIX, error);
    fail(PREFIX, "NETWORK", safe.category, redactSecrets(safe.message, contextSecrets(ctx)), { retryable: safe.retryable });
  }
  const result = asRecord(response.body);
  if (!response.ok || result.reason) {
    const detail = errorFor(ctx, result, response.status);
    fail(PREFIX, detail.code.slice(PREFIX.length), detail.category, detail.message, { status: response.status, retryable: detail.retryable });
  }
  return result;
}

function inputImages(req: MediaSubmitRequest, q4: boolean): { path: string; images: string[]; sounds: string[] } {
  const first = req.inputs.filter((i) => i.role === "first-frame" || i.role === "source-image");
  const last = req.inputs.filter((i) => i.role === "last-frame");
  const refs = req.inputs.filter((i) => i.role === "reference-image");
  const sounds = req.inputs.filter((i) => i.role === "reference-audio");
  const valid = req.task === "text-to-video" ? req.inputs.length === 0 : req.task === "reference-to-video" ? refs.length + sounds.length === req.inputs.length && refs.length >= 1 && refs.length <= (q4 ? 15 : 7) && (q4 ? sounds.length <= 3 && sounds.every((sound) => sound.mimeType === "audio/mpeg" || sound.mimeType === "audio/mp3") : sounds.length === 0) : first.length === 1 && last.length <= (q4 ? 0 : 1) && first.length + last.length === req.inputs.length;
  if (!valid) fail(PREFIX, "INVALID_INPUT", "invalid-request", "Invalid image inputs for task");
  const path = req.task === "text-to-video" ? "text2video" : req.task === "reference-to-video" ? "reference2video" : last.length ? "start-end2video" : "img2video";
  return { path, images: (refs.length ? refs : [...first, ...last]).map((input) => urlOrDataUri(PREFIX, input)), sounds: sounds.map((input) => urlOrDataUri(PREFIX, input)) };
}

function payload(req: MediaSubmitRequest): { path: string; body: Record<string, unknown> } {
  const model = findModel(PREFIX, models, req.model);
  assertTask(PREFIX, model, req); assertParams(PREFIX, model, req);
  const options = assertKnownOptions(PREFIX, req.vendorOptions, []);
  if (req.count !== undefined && req.count !== 1) fail(PREFIX, "INVALID_PARAM", "invalid-request", "count must be 1");
  if (req.aspectRatio && req.task === "image-to-video") fail(PREFIX, "INVALID_PARAM", "invalid-request", "aspectRatio is not supported for image-to-video");
  if (req.task === "reference-to-video" && req.durationSec !== undefined && req.durationSec < 3) fail(PREFIX, "INVALID_PARAM", "invalid-request", "reference duration must be at least 3 seconds");
  const q4 = model.id === "vidu/vidu-q4" || model.id === "vidu/vidu-q4-reference";
  if (q4 && req.task === "reference-to-video" && !req.prompt) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Q4 reference requires a prompt");
  const { path, images, sounds } = inputImages(req, q4);
  const body: Record<string, unknown> = { model: model.upstreamId, ...options };
  if (images.length) body.images = images;
  if (sounds.length) body.sounds = sounds;
  if (q4 && req.task === "image-to-video" && req.prompt) body.is_rec = false;
  for (const [key, value] of Object.entries({ prompt: req.prompt, duration: req.durationSec, resolution: req.resolution, aspect_ratio: req.aspectRatio, seed: req.seed, audio: req.audio })) if (value !== undefined) body[key] = value;
  return { path, body };
}

async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  let prepared: ReturnType<typeof payload>;
  try { prepared = payload(req); } catch (error) {
    const detail = normalizeUnknownError(PREFIX, error);
    const message = redactSecrets(detail.message, contextSecrets(ctx));
    const reason = redactSecrets(detail.code, contextSecrets(ctx)).replace(/^VIDU_/, "");
    fail(PREFIX, reason, detail.category, message, { retryable: detail.retryable });
  }
  const { path, body } = prepared;
  const result = await call(ctx, `/ent/v2/${path}`, body);
  const id = asString(result.task_id);
  if (!id) return fail(PREFIX, "BAD_RESPONSE", "upstream", "Vidu did not return a task id");
  return { providerJobId: id };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const data = await call(ctx, `/ent/v2/tasks/${encodeURIComponent(job.providerJobId)}/creations`);
  const state = asString(data.state);
  if (state === "created" || state === "queueing") return { status: "queued" };
  if (state === "processing") return { status: "running" };
  if (state === "failed") {
    if (data.err_code === "UserCancelled") return { status: "canceled" };
    return { status: "failed", error: errorFor(ctx, data) };
  }
  if (state === "success") {
    const outputs = asArray(data.creations).map((item) => asString(asRecord(item).url)).filter((url): url is string => !!url).map((url) => urlOutput(url, "video"));
    if (!outputs.length) return fail(PREFIX, "BAD_RESPONSE", "upstream", "Vidu returned no video URL");
    return { status: "succeeded", outputs };
  }
  return fail(PREFIX, "BAD_RESPONSE", "upstream", "Vidu returned an unknown task state");
}

export const adapter: MediaProviderAdapter = {
  id: "vidu", label: "Vidu", route: "direct", errorPrefix: PREFIX, inputTransport: "inline",
  credential: { keyVocabulary: "vidu", envVars: ["VIDU_API_KEY"], configKey: "viduApiKey", consoleUrl: "https://platform.vidu.com/" },
  listModels: () => models,
  async validateKey(ctx) { try { await call(ctx, "/ent/v2/credits"); return { ok: true }; } catch (error) { return { ok: false, reason: redactSecrets(normalizeUnknownError(PREFIX, error).message, contextSecrets(ctx)) }; } },
  submit, poll,
  async cancel(ctx, job) { await call(ctx, `/ent/v2/tasks/${encodeURIComponent(job.providerJobId)}/cancel`, { id: job.providerJobId }); },
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};
