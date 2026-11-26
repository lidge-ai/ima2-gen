import { mingmou, pollVod, submitVod } from "./tencent/vod.js";
import type {
  MediaAdapterContext,
  MediaJobRef,
  MediaJobState,
  MediaModelSpec,
  MediaProviderAdapter,
  MediaSubmitRequest,
} from "../contract.js";
import {
  MediaAdapterError,
  categoryForStatus,
  contextSecrets,
  fail,
  mediaError,
  normalizeUnknownError,
  redactSecrets,
} from "./_l2/errors.js";
import { asRecord, asString, joinUrl, sendJson } from "./_l2/http.js";
import { urlOutput } from "./_l2/inputs.js";
import { assertKnownOptions, assertParams, assertTask, findModel } from "./_l2/validate.js";

const PREFIX = "TENCENT_";
const BASE = "https://tokenhub-intl.tencentcloudmaas.com";
const PATH = "/v1/wand/vega-videos/tasks";
const DOCS = "https://www.tencentcloud.com/document/product/1300/84930";
const models: readonly MediaModelSpec[] = [
  {
    id: "tencent/wand-vega-1.0-lite",
    upstreamId: "wand-vega-video-1.0-lite",
    vendor: "tencent",
    label: "WAND Vega Video 1.0 Lite",
    kind: "video",
    tasks: ["text-to-video", "image-to-video", "reference-to-video"],
    params: {
      durationsSec: Array.from({ length: 12 }, (_, i) => i + 4),
      resolutions: ["768P", "1080P", "2K", "4K"],
      aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
    },
    pricing: [],
    docsUrl: DOCS,
  },
  mingmou,
];

function safeMessage(ctx: MediaAdapterContext, message: string): string {
  return redactSecrets(message, [...contextSecrets(ctx, ["secretId", "secretKey"]), ...[ctx.apiKey,
    ctx.extra?.secretId, ctx.extra?.secretKey].filter((v): v is string => Boolean(v))]);
}
function providerError(ctx: MediaAdapterContext, code: string, message: string, status?: number) {
  const category = code === "TaskTimeout" ? "timeout"
    : code === "InternalError" ? "upstream"
      : status ? categoryForStatus(status) : "unknown";
  const reason = code === "TaskTimeout" ? "TASK_TIMEOUT"
    : code === "InternalError" ? "INTERNAL_ERROR"
      : status ? `HTTP_${status}` : "TASK_FAILED";
  return mediaError(PREFIX, reason, category, safeMessage(ctx, message), { status });
}
async function call(ctx: MediaAdapterContext, path: string, body?: unknown) {
  try {
    const response = await sendJson(ctx, PREFIX, { url: joinUrl(ctx.baseUrl ?? BASE, path), headers: {
      authorization: `Bearer ${ctx.apiKey}` }, ...(body === undefined ? {} : { body }) });
    const data = asRecord(response.body);
    if (!response.ok) {
      const error = asRecord(data.error);
      const detail = providerError(ctx, asString(error.code) ?? "",
        asString(error.message) ?? asString(data.message) ?? `HTTP ${response.status}`, response.status);
      fail(PREFIX, detail.code.slice(PREFIX.length), detail.category, detail.message, {
        status: response.status, retryable: detail.retryable });
    }
    return data;
  } catch (error) {
    const detail = normalizeUnknownError(PREFIX, error);
    fail(PREFIX, detail.code.slice(PREFIX.length), detail.category, safeMessage(ctx, detail.message), {
      status: detail.status, retryable: detail.retryable });
  }
}
function contentFor(request: MediaSubmitRequest): unknown[] {
  if (!request.prompt?.trim()) fail(PREFIX, "INVALID_PARAM", "invalid-request", "A prompt is required");
  const content: unknown[] = [{ type: "text", text: request.prompt }];
  const roles: Record<string, string> = {
    "first-frame": "first_frame",
    "last-frame": "last_frame",
    "reference-image": "reference_image",
    "reference-video": "reference_video",
    "reference-audio": "reference_audio",
  };
  const counts: Record<string, number> = {};
  for (const input of request.inputs) {
    const role = roles[input.role];
    const allowed = request.task === "image-to-video"
      ? ["first-frame", "last-frame"]
      : request.task === "reference-to-video"
        ? ["reference-image", "reference-video", "reference-audio"]
        : [];
    if (!role || !allowed.includes(input.role) || !input.url || input.bytes) fail(PREFIX, "INVALID_INPUT",
      "invalid-request", "Unsupported input role or missing URL");
    counts[input.role] = (counts[input.role] ?? 0) + 1;
    const type = input.role.includes("image") ||
      input.role.includes("frame") ? "image_url" : input.role.includes("video") ? "video_url" : "audio_url";
    content.push({ type, [type]: { url: input.url }, role });
  }
  if (request.task === "image-to-video" && (counts["first-frame"] !== 1 ||
    (counts["last-frame"] ?? 0) > 1)) fail(PREFIX, "INVALID_INPUT", "invalid-request",
    "One first frame and at most one last frame are required");
  if (request.task === "reference-to-video" && (!(counts["reference-image"] || counts["reference-video"]) ||
    (counts["reference-image"] ?? 0) > 9 || (counts["reference-video"] ?? 0) > 3 ||
    (counts["reference-audio"] ?? 0) > 3 || request.inputs.length > 12)) fail(PREFIX, "INVALID_INPUT",
    "invalid-request", "Invalid reference inputs");
  return content;
}
function requestBody(request: MediaSubmitRequest) {
  const model = findModel(PREFIX, models, request.model);
  assertTask(PREFIX, model, request); assertParams(PREFIX, model, request);
  assertKnownOptions(PREFIX, request.vendorOptions, []);
  if (request.audio !== undefined || (request.count !== undefined && request.count !== 1)) fail(PREFIX,
    "INVALID_PARAM", "invalid-request", "Unsupported audio or count");
  return {
    model: model.upstreamId,
    content: contentFor(request),
    ...(request.durationSec === undefined ? {} : { duration: request.durationSec }),
    ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
    ...(request.aspectRatio === undefined ? {} : { ratio: request.aspectRatio }),
  };
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  try {
    if (request.model === mingmou.id || request.model === mingmou.upstreamId) return await submitVod(ctx, request);
    const data = await call(ctx, PATH, requestBody(request));
    const id = asString(data.id);
    if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing task id");
    return { providerJobId: id };
  } catch (error) {
    const detail = normalizeUnknownError(PREFIX, error);
    fail(PREFIX, detail.code.slice(PREFIX.length), detail.category, safeMessage(ctx, detail.message), {
      status: detail.status, retryable: detail.retryable });
  }
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  if (job.resume?.route === "vod") return pollVod(ctx, job);
  const data = await call(ctx, `${PATH}/${encodeURIComponent(job.providerJobId)}`);
  const status = asString(data.status);
  if (status === "queued" || status === "running") return { status };
  if (status === "failed") {
    const error = asRecord(data.error);
    return { status, error: providerError(ctx, asString(error.code) ?? "", asString(error.message) ?? "Task failed") };
  }
  if (status === "succeeded") {
    const url = asString(asRecord(data.content).video_url);
    if (!url) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing video URL");
    return { status, outputs: [urlOutput(url, "video")] };
  }
  return fail(PREFIX, "BAD_RESPONSE", "upstream", "Unknown task status");
}
export const adapter: MediaProviderAdapter = {
  id: "tencent",
  label: "Tencent Cloud TokenHub",
  route: "direct",
  errorPrefix: "TENCENT",
  credential: {
    keyVocabulary: "tencent",
    configKey: "tencentApiKey",
    envVars: ["TENCENT_TOKENHUB_API_KEY"],
    consoleUrl: "https://console.tencentcloud.com/lkeap",
    extraFields: [
      { name: "secretId", envVar: "TENCENTCLOUD_SECRET_ID", secret: true, required: false },
      { name: "secretKey", envVar: "TENCENTCLOUD_SECRET_KEY", secret: true, required: false },
      { name: "vodSubAppId", envVar: "TENCENT_VOD_SUBAPPID", secret: false, required: false },
      { name: "region", envVar: "TENCENTCLOUD_REGION", secret: false, required: false },
    ],
  },
  inputTransport: "url",
  listModels: () => models,
  async validateKey(ctx) {
    const data = await call(ctx, "/v1/models");
    if (data.object !== "list" || !Array.isArray(data.data)) fail(PREFIX, "BAD_RESPONSE", "upstream",
      "Invalid model list response");
    return { ok: true };
  },
  submit, poll, normalizeError: (error) => {
    const detail = normalizeUnknownError(PREFIX, error);
    return error instanceof MediaAdapterError ? detail : { ...detail, message: "Provider request failed" };
  },
};
