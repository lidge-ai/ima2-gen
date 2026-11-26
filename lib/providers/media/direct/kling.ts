import { createHmac } from "node:crypto";
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets, MediaAdapterError } from "./_l2/errors.js";
import { asArray, asRecord, asString, joinUrl, sendJson } from "./_l2/http.js";
import { bareBase64OrUrl, urlOutput } from "./_l2/inputs.js";
import { assertKnownOptions, assertParams, assertTask, findModel } from "./_l2/validate.js";

const PREFIX = "KLING_";
const BASE = "https://api-singapore.klingai.com";
const IMAGE_PATH = "/v1/images/generations";
const VIDEO_PATH = "/v1/videos/text2video";
const IMAGE_TO_VIDEO = "/v1/videos/image2video";
const OMNI_VIDEO = "/v1/videos/omni-video";
const OMNI_IMAGE = "/v1/images/omni-image";
const LIP_SYNC = "/v1/videos/advanced-lip-sync";
const IMAGE_DOC = "https://kling.ai/document-api/apiReference/model/imageGeneration";
const VIDEO_DOC = "https://kling.ai/document-api/api/video/3-0-omni/text-to-video/legacy";
const models: readonly MediaModelSpec[] = [
  { id: "kling/kling-image-3", upstreamId: "kling-v3", vendor: "kling", label: "Kling Image 3", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1k", "2k"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"], maxReferenceImages: 1, negativePrompt: true }, pricing: [{ unit: "image", usd: 0.028, variant: "1k/2k: 8 units/image × $0.0035/unit", source: "https://kling.ai/dev/model/image", checkedAt: "2026-11-26" }], docsUrl: IMAGE_DOC },
  { id: "kling/kling-2.6", upstreamId: "kling-v2-6", vendor: "kling", label: "Kling 2.6", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: [5, 10], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: true, negativePrompt: true }, pricing: [], docsUrl: VIDEO_DOC },
  { id: "kling/kling-3", upstreamId: "kling-v3", vendor: "kling", label: "Kling 3", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: true, negativePrompt: true }, pricing: [], docsUrl: VIDEO_DOC },
  { id: "kling/kling-4", upstreamId: "kling-4.0", vendor: "kling", label: "Kling 4", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: Array.from({ length: 28 }, (_, i) => i + 3), resolutions: ["720p", "1080p", "4k"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] }, pricing: [{ unit: "second", usd: 0.15386, variant: "720p no input video: 1 unit/s × $0.15386/unit, flagship package 1", source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package", checkedAt: "2026-11-26" }, { unit: "second", usd: 0.23079, variant: "1080p no input video: 1.5 units/s × $0.15386/unit, flagship package 1", source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package", checkedAt: "2026-11-26" }], docsUrl: "https://kling.ai/document-api/api/usage-guide/kling-4-0" },
  { id: "kling/kling-3-turbo", upstreamId: "kling-3.0-turbo", vendor: "kling", label: "Kling 3 Turbo", kind: "video", tasks: ["text-to-video", "image-to-video"], params: { durationsSec: Array.from({ length: 13 }, (_, i) => i + 3), resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"] }, pricing: [], docsUrl: "https://kling.ai/document-api/api/video/3-0-turbo/text-to-video" },
  ...([ ["kling-o1", "kling-video-o1"], ["kling-3-omni", "kling-v3-omni"] ] as const).map(([id, upstreamId]): MediaModelSpec => ({ id: `kling/${id}`, upstreamId, vendor: "kling", label: id, kind: "video", tasks: ["text-to-video", "reference-to-video", "video-to-video"], params: { durationsSec: Array.from({ length: id === "kling-o1" ? 8 : 13 }, (_, i) => i + 3), aspectRatios: ["16:9", "9:16", "1:1"], maxReferenceImages: 4, maxReferenceVideos: 1 }, pricing: [], docsUrl: "https://kling.ai/document-api/api/video/o1/video-omni/legacy" })),
  ...([ ["kling-image-o1", "kling-image-o1"], ["kling-image-3-omni", "kling-v3-omni"] ] as const).map(([id, upstreamId]): MediaModelSpec => ({ id: `kling/${id}`, upstreamId, vendor: "kling", label: id, kind: "image", tasks: ["text-to-image", "image-to-image"], params: { resolutions: id === "kling-image-3-omni" ? ["1k", "2k", "4k"] : ["1k", "2k"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"], maxReferenceImages: 10 }, pricing: [{ unit: "image", usd: 0.028, variant: "1k/2k: 8 units/image × $0.0035/unit", source: "https://kling.ai/dev/model/image", checkedAt: "2026-11-26" }, ...(id === "kling-image-3-omni" ? [{ unit: "image" as const, usd: 0.056, variant: "4k: 16 units/image × $0.0035/unit", source: "https://kling.ai/dev/model/image", checkedAt: "2026-11-26" }] : [])], docsUrl: "https://kling.ai/document-api/apiReference/model/OmniImage" })),
  { id: "kling/kling-4-omni", upstreamId: "kling-4.0", vendor: "kling", label: "Kling 4 Omni", kind: "video", tasks: ["reference-to-video", "video-to-video"], params: { durationsSec: Array.from({ length: 28 }, (_, i) => i + 3), resolutions: ["720p", "1080p", "4k"], maxReferenceImages: 10, maxReferenceVideos: 5 }, pricing: [{ unit: "second", usd: 0.15386, variant: "720p no input video: 1 unit/s × $0.15386/unit, flagship package 1", source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package", checkedAt: "2026-11-26" }, { unit: "second", usd: 0.23079, variant: "1080p no input video: 1.5 units/s × $0.15386/unit, flagship package 1", source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package", checkedAt: "2026-11-26" }], docsUrl: "https://kling.ai/document-api/api/video/4-0" },
  { id: "kling/kling-lipsync", upstreamId: "advanced-lip-sync", vendor: "kling", label: "Kling Lip Sync", kind: "video", tasks: ["lipsync"], params: {}, pricing: [], docsUrl: "https://kling.ai/document-api/api/video/lip-sync" },
];
function token(ctx: MediaAdapterContext, now = Date.now()): string {
  const secret = ctx.extra?.secretKey;
  if (!ctx.apiKey || !secret) fail(PREFIX, "CREDENTIAL_MISSING", "auth", "KLING_ACCESS_KEY and KLING_SECRET_KEY are required");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(now / 1000);
  const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: ctx.apiKey, exp: seconds + 1800, nbf: seconds - 5 })}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function vendorCategory(code: string, status: number) {
  if (["1000", "1001", "1002", "1003", "1004", "1103"].includes(code)) return "auth" as const;
  if (["1101", "1102"].includes(code)) return "quota" as const;
  if (["1200", "1201"].includes(code)) return "invalid-request" as const;
  if (["1202", "1203"].includes(code)) return "not-found" as const;
  if (["1300", "1301"].includes(code)) return "moderation" as const;
  if (["1302", "1303"].includes(code)) return "rate-limit" as const;
  if (code === "1304") return "auth" as const;
  if (["5000", "5001"].includes(code)) return "upstream" as const;
  if (code === "5002") return "timeout" as const;
  return categoryForStatus(status);
}
async function request(ctx: MediaAdapterContext, path: string, body?: unknown, modern = false): Promise<Record<string, unknown>> {
  const authorization = modern ? ctx.extra?.apiKey : token(ctx);
  if (!authorization) fail(PREFIX, "CREDENTIAL_MISSING", "auth", "KLING_API_KEY is required");
  let response;
  try {
    response = await sendJson(ctx, PREFIX, { url: joinUrl(ctx.baseUrl ?? BASE, path), headers: { authorization: `Bearer ${authorization}` }, ...(body === undefined ? {} : { body }) });
  } catch (error) {
    if (error instanceof MediaAdapterError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
    fail(PREFIX, "NETWORK", "upstream", "Provider request failed");
  }
  const envelope = asRecord(response.body);
  const code = asString(envelope.code);
  if (!response.ok || (code !== undefined && code !== "0")) {
    const status = response.status;
    const category = vendorCategory(code ?? "", status);
    const message = redactSecrets(asString(envelope.message) ?? `Provider returned HTTP ${status}`, contextSecrets(ctx, ["secretKey", "apiKey"]));
    fail(PREFIX, code && code !== "0" ? `VENDOR_${code.replace(/[^a-zA-Z0-9]/g, "_")}` : `HTTP_${status}`, category, message, { status });
  }
  return envelope;
}
function pathFor(model: MediaModelSpec, req: MediaSubmitRequest): string {
  if (model.id === "kling/kling-lipsync") return LIP_SYNC;
  if (model.id === "kling/kling-4-omni") return "/omni-video/kling-4.0";
  if (model.id === "kling/kling-4" || model.id === "kling/kling-3-turbo") return `/${req.task === "image-to-video" ? "image-to-video" : "text-to-video"}/${model.upstreamId}`;
  if (model.id === "kling/kling-o1" || model.id === "kling/kling-3-omni") return OMNI_VIDEO;
  if (model.id === "kling/kling-image-o1" || model.id === "kling/kling-image-3-omni") return OMNI_IMAGE;
  return model.kind === "image" ? IMAGE_PATH : req.task === "image-to-video" ? IMAGE_TO_VIDEO : VIDEO_PATH;
}
function bodyFor(model: MediaModelSpec, req: MediaSubmitRequest, path: string): Record<string, unknown> {
  assertTask(PREFIX, model, req); assertParams(PREFIX, model, req);
  if (path === LIP_SYNC) return lipBody(req);
  assertKnownOptions(PREFIX, req.vendorOptions, []);
  if (!req.prompt) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Prompt is required");
  if (req.seed !== undefined || (req.audio !== undefined && !model.params.nativeAudio)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported parameter");
  if (req.count !== undefined && (model.kind !== "image" || !Number.isInteger(req.count) || req.count < 1 || req.count > 9)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid count");
  if (model.kind === "image" && req.durationSec !== undefined) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Duration is unsupported");
  if (req.task === "text-to-image" || req.task === "text-to-video") { if (req.inputs.length) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unexpected inputs"); }
  if (req.task === "image-to-image" && (!req.inputs.length || req.inputs.length > (model.params.maxReferenceImages ?? 1) || req.negativePrompt)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid image inputs");
  if (req.task === "image-to-video" && (req.inputs.filter(i => i.role === "first-frame").length !== 1 || req.inputs.filter(i => i.role === "last-frame").length > 1 || req.inputs.some(i => !["first-frame", "last-frame"].includes(i.role)))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "A first frame and optional last frame are required");
  if (path.startsWith("/v1/")) return legacyBody(model, req, path);
  return modernBody(model, req);
}
function legacyBody(model: MediaModelSpec, req: MediaSubmitRequest, path: string): Record<string, unknown> {
  if (model.kind === "video" && req.resolution !== undefined) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Resolution is unsupported");
  const body: Record<string, unknown> = { model_name: model.upstreamId, prompt: req.prompt };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.resolution) body.resolution = req.resolution;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.durationSec) body.duration = String(req.durationSec);
  if (req.audio !== undefined) body.sound = req.audio ? "on" : "off";
  if (req.count !== undefined) body.n = req.count;
  if (path === IMAGE_PATH && req.inputs.length) body.image = bareBase64OrUrl(PREFIX, req.inputs[0]!);
  if (path === IMAGE_TO_VIDEO) for (const input of req.inputs) body[input.role === "first-frame" ? "image" : "image_tail"] = bareBase64OrUrl(PREFIX, input);
  if (path === OMNI_IMAGE) { if (req.inputs.some(i => !["source-image", "reference-image"].includes(i.role))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Image input required"); body.image_list = req.inputs.map(i => ({ image: bareBase64OrUrl(PREFIX, i) })); }
  if (path === OMNI_VIDEO) {
    if (req.inputs.some(i => !["reference-image", "reference-video", "source-video"].includes(i.role))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported reference input");
    const images = req.inputs.filter(i => i.role === "reference-image"); const videos = req.inputs.filter(i => i.role !== "reference-image");
    if (images.length > 4 || videos.length > 1 || (req.task !== "text-to-video" && !req.inputs.length)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid references");
    if (images.length) body.image_list = images.map(i => ({ image_url: bareBase64OrUrl(PREFIX, i) }));
    if (videos.length) { if (!videos[0]!.url) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Video URL required"); body.video_list = [{ video_url: videos[0]!.url, refer_type: req.task === "video-to-video" ? "base" : "feature" }]; }
  }
  return body;
}
function lipBody(req: MediaSubmitRequest): Record<string, unknown> {
  const opt = assertKnownOptions(PREFIX, req.vendorOptions, ["sessionId", "faceId", "soundStartTime", "soundEndTime", "soundInsertTime"]);
  const { sessionId, faceId, soundStartTime, soundEndTime, soundInsertTime } = opt;
  if (typeof sessionId !== "string" || !sessionId || typeof faceId !== "string" || !faceId || typeof soundStartTime !== "number" || typeof soundEndTime !== "number" || typeof soundInsertTime !== "number" || soundStartTime < 0 || soundInsertTime < 0 || soundEndTime - soundStartTime < 2000 || req.inputs.length !== 1 || req.inputs[0]?.role !== "source-audio") fail(PREFIX, "INVALID_PARAM", "invalid-request", "Face session, face ID, audio and valid times are required");
  if (req.prompt || req.negativePrompt || req.durationSec !== undefined || req.resolution || req.aspectRatio || req.seed !== undefined || req.audio !== undefined || req.count !== undefined) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported lip sync parameter");
  return { session_id: sessionId, face_choose: [{ face_id: faceId, sound_file: bareBase64OrUrl(PREFIX, req.inputs[0]!), sound_start_time: soundStartTime, sound_end_time: soundEndTime, sound_insert_time: soundInsertTime }] };
}
function modernBody(model: MediaModelSpec, req: MediaSubmitRequest): Record<string, unknown> {
  if (req.negativePrompt || req.audio !== undefined) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported modern parameter");
  if (model.id.endsWith("turbo") && req.inputs.some(i => i.role === "last-frame")) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Turbo supports only a first frame");
  if (model.id === "kling/kling-4-omni") {
    if (!req.inputs.length || req.inputs.length > 15 || req.inputs.some(i => !["reference-image", "reference-video", "source-video"].includes(i.role))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid omni references");
    const counts = { image: 0, video: 0 }; const contents: Record<string, string>[] = [{ type: "prompt", text: req.prompt! }];
    for (const i of req.inputs) { const image = i.role === "reference-image"; const index = ++counts[image ? "image" : "video"]; if (index > (image ? 10 : 5)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Too many references"); contents.push({ type: image ? "refer_image" : i.role === "source-video" ? "base_video" : "feature_video", url: bareBase64OrUrl(PREFIX, i), id: `${image ? "image" : "video"}${index}` }); }
    return { contents, settings: { ...(req.resolution ? { resolution: req.resolution } : {}), ...(req.durationSec ? { duration: req.durationSec } : {}), ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}) } };
  }
  if (req.task === "image-to-video" && req.aspectRatio) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Aspect ratio is unsupported for image-to-video");
  const settings = { ...(req.resolution ? { resolution: req.resolution } : {}), ...(req.durationSec ? { duration: req.durationSec } : {}), ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}) };
  if (req.task === "text-to-video") return { prompt: req.prompt, settings };
  return { contents: [{ type: "prompt", text: req.prompt }, ...req.inputs.map((i, index) => ({ type: i.role === "first-frame" ? "first_frame" : "last_frame", url: bareBase64OrUrl(PREFIX, i), ...(model.id === "kling/kling-4" ? { id: `image${index + 1}` } : {}) }))], settings };
}
async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, req.model); const path = pathFor(model, req); const modern = !path.startsWith("/v1/");
  const data = asRecord((await request(ctx, path, bodyFor(model, req, path), modern)).data);
  const id = asString(modern ? data.id : data.task_id);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing task ID");
  return { providerJobId: id, resume: { path: modern ? "/tasks" : path, kind: model.kind, ...(modern ? { auth: "apiKey" } : {}) } };
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const path = job.resume?.path; const kind = job.resume?.kind; const modern = path === "/tasks" && job.resume?.auth === "apiKey";
  if (!((kind === "image" && (path === IMAGE_PATH || path === OMNI_IMAGE)) || (kind === "video" && (path === VIDEO_PATH || path === IMAGE_TO_VIDEO || path === OMNI_VIDEO || path === LIP_SYNC || modern)))) fail(PREFIX, "INVALID_JOB", "invalid-request", "Invalid job path");
  const envelope = await request(ctx, modern ? `/tasks?task_ids=${encodeURIComponent(job.providerJobId)}` : `${path}/${encodeURIComponent(job.providerJobId)}`, undefined, modern);
  const data = modern ? asRecord(asArray(envelope.data).find(v => asString(asRecord(v).id) === job.providerJobId)) : asRecord(envelope.data);
  const state = asString(modern ? data.status : data.task_status);
  if (state === "submitted") return { status: "queued" }; if (state === "processing") return { status: "running" };
  if (state === "failed") return { status: "failed", error: mediaError(PREFIX, "TASK_FAILED", "upstream", redactSecrets(asString(modern ? data.message : data.task_status_msg) ?? "Task failed", contextSecrets(ctx, ["secretKey", "apiKey"])), { retryable: false }) };
  if (state !== (modern ? "succeeded" : "succeed")) fail(PREFIX, "BAD_RESPONSE", "upstream", "Unknown task status");
  const result = asRecord(data.task_result); const values = asArray(modern ? data.outputs : kind === "image" ? result.images : result.videos);
  const outputs = values.map(asRecord).map(v => asString(v.url)).filter((url): url is string => Boolean(url)).map(url => urlOutput(url, kind));
  if (!outputs.length) fail(PREFIX, "BAD_RESPONSE", "upstream", "Task returned no output");
  return { status: "succeeded", outputs };
}

export const adapter: MediaProviderAdapter = {
  id: "kling", label: "Kling AI", route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "kling", envVars: ["KLING_ACCESS_KEY"], configKey: "klingApiKey", consoleUrl: "https://kling.ai/dev/api-key", extraFields: [{ name: "secretKey", envVar: "KLING_SECRET_KEY", secret: true, required: false }, { name: "apiKey", envVar: "KLING_API_KEY", secret: true, required: false }] },
  inputTransport: "inline", listModels: () => models,
  async validateKey(ctx) {
    try { if (ctx.extra?.apiKey) await request(ctx, "/tasks", { limit: 1 }, true); else await request(ctx, `${IMAGE_PATH}?pageNum=1&pageSize=1`); return { ok: true }; }
    catch (error) { return { ok: false, reason: adapter.normalizeError(error).message }; }
  },
  submit, poll,
  normalizeError(error) { return normalizeUnknownError(PREFIX, error instanceof MediaAdapterError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ? error : new Error("Provider request failed")); },
};
