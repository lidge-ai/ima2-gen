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
const IMAGE_DOC = "https://kling.ai/document-api/apiReference/model/imageGeneration";
const VIDEO_DOC = "https://kling.ai/document-api/api/video/3-0-omni/text-to-video/legacy";
const models: readonly MediaModelSpec[] = [
  { id: "kling/kling-image-3", upstreamId: "kling-v3", vendor: "kling", label: "Kling Image 3", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1k", "2k"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"], maxReferenceImages: 1, negativePrompt: true }, pricing: [], docsUrl: IMAGE_DOC },
  { id: "kling/kling-2.6", upstreamId: "kling-v2-6", vendor: "kling", label: "Kling 2.6", kind: "video", tasks: ["text-to-video"], params: { durationsSec: [5, 10], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: true, negativePrompt: true }, pricing: [], docsUrl: VIDEO_DOC },
  { id: "kling/kling-3", upstreamId: "kling-v3", vendor: "kling", label: "Kling 3", kind: "video", tasks: ["text-to-video"], params: { durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: true, negativePrompt: true }, pricing: [], docsUrl: VIDEO_DOC },
];
function token(ctx: MediaAdapterContext, now = Date.now()): string {
  const secret = ctx.extra?.secretKey;
  if (!ctx.apiKey || !secret) fail(PREFIX, "MISSING_CREDENTIAL", "auth", "Access key and secret key are required");
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
async function request(ctx: MediaAdapterContext, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await sendJson(ctx, PREFIX, { url: joinUrl(ctx.baseUrl ?? BASE, path), headers: { authorization: `Bearer ${token(ctx)}` }, ...(body === undefined ? {} : { body }) });
  } catch (error) {
    if (error instanceof MediaAdapterError) throw error;
    fail(PREFIX, "NETWORK", "upstream", "Provider request failed");
  }
  const envelope = asRecord(response.body);
  const code = asString(envelope.code);
  if (!response.ok || (code !== undefined && code !== "0")) {
    const status = response.status;
    const category = vendorCategory(code ?? "", status);
    const message = redactSecrets(asString(envelope.message) ?? `Provider returned HTTP ${status}`, contextSecrets(ctx, ["secretKey"]));
    fail(PREFIX, code && code !== "0" ? `VENDOR_${code.replace(/[^a-zA-Z0-9]/g, "_")}` : `HTTP_${status}`, category, message, { status });
  }
  return envelope;
}
function bodyFor(model: MediaModelSpec, req: MediaSubmitRequest): Record<string, unknown> {
  assertTask(PREFIX, model, req);
  assertParams(PREFIX, model, req);
  assertKnownOptions(PREFIX, req.vendorOptions, []);
  if (!req.prompt) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Prompt is required");
  if (req.seed !== undefined || (req.audio !== undefined && !model.params.nativeAudio)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported parameter");
  if (req.task === "image-to-image" && (req.inputs.length !== 1 || req.negativePrompt)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "One input and no negative prompt are required");
  if (req.task !== "image-to-image" && req.inputs.length) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Inputs are not supported for this task");
  if (req.task === "image-to-image" && !["source-image", "reference-image"].includes(req.inputs[0]!.role)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "An image input is required");
  if (model.kind === "video" && (req.resolution !== undefined || req.count !== undefined)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Video resolution and count are not supported");
  if (model.kind === "image" && (req.durationSec !== undefined || (req.count !== undefined && (!Number.isInteger(req.count) || req.count < 1 || req.count > 9)))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid image parameter");
  return { model_name: model.upstreamId, prompt: req.prompt, ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}), ...(req.resolution ? { resolution: req.resolution } : {}), ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}), ...(req.durationSec ? { duration: String(req.durationSec) } : {}), ...(req.audio !== undefined ? { sound: req.audio ? "on" : "off" } : {}), ...(req.count !== undefined ? { n: req.count } : {}), ...(req.task === "image-to-image" ? { image: bareBase64OrUrl(PREFIX, req.inputs[0]!) } : {}) };
}
async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, req.model);
  const path = model.kind === "image" ? IMAGE_PATH : VIDEO_PATH;
  const data = asRecord((await request(ctx, path, bodyFor(model, req))).data);
  const id = asString(data.task_id);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing task ID");
  return { providerJobId: id, resume: { path, kind: model.kind } };
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const path = job.resume?.path;
  const kind = job.resume?.kind;
  if (!((path === IMAGE_PATH && kind === "image") || (path === VIDEO_PATH && kind === "video"))) fail(PREFIX, "INVALID_JOB", "invalid-request", "Invalid job path");
  const data = asRecord((await request(ctx, `${path}/${encodeURIComponent(job.providerJobId)}`)).data);
  const state = asString(data.task_status);
  if (state === "submitted") return { status: "queued" };
  if (state === "processing") return { status: "running" };
  if (state === "failed") return { status: "failed", error: mediaError(PREFIX, "TASK_FAILED", "upstream", redactSecrets(asString(data.task_status_msg) ?? "Task failed", contextSecrets(ctx, ["secretKey"])), { retryable: false }) };
  if (state !== "succeed") fail(PREFIX, "BAD_RESPONSE", "upstream", "Unknown task status");
  const result = asRecord(data.task_result);
  const values = asArray(kind === "image" ? result.images : result.videos);
  const outputs = values.map(asRecord).map(v => asString(v.url)).filter((url): url is string => Boolean(url)).map(url => urlOutput(url, kind));
  if (!outputs.length) fail(PREFIX, "BAD_RESPONSE", "upstream", "Task returned no output");
  return { status: "succeeded", outputs };
}
export const adapter: MediaProviderAdapter = {
  id: "kling", label: "Kling AI", route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "kling", envVars: ["KLING_ACCESS_KEY"], configKey: "klingApiKey", consoleUrl: "https://kling.ai/dev/api-key", extraFields: [{ name: "secretKey", envVar: "KLING_SECRET_KEY", secret: true, required: true }] },
  inputTransport: "inline", listModels: () => models,
  async validateKey(ctx) {
    try { await request(ctx, `${IMAGE_PATH}?pageNum=1&pageSize=1`); return { ok: true }; }
    catch (error) { return { ok: false, reason: adapter.normalizeError(error).message }; }
  },
  submit, poll,
  normalizeError(error) { return normalizeUnknownError(PREFIX, error instanceof MediaAdapterError ? error : new Error("Provider request failed")); },
};
