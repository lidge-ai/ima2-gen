import { randomUUID } from "node:crypto";
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec,
  MediaProviderAdapter, MediaProviderError, MediaSubmitRequest,
} from "../contract.js";
import {
  categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets,
} from "./_l2/errors.js";
import { asArray, asRecord, asString, joinUrl, sendJson } from "./_l2/http.js";
import { urlOrDataUri, urlOutput } from "./_l2/inputs.js";
import { assertKnownOptions, assertParams, assertTask, findModel } from "./_l2/validate.js";

const PREFIX = "ALIBABA_";
const WAN_DOC = "https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference/";
const HAPPY_DOC = "https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference";
const Z_DOC = "https://www.alibabacloud.com/help/en/model-studio/z-image-api-reference";
const PRICE_URL = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";
const duration = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

function prices(values: readonly [string, number][], unit: "second" | "image") {
  return values.map(([variant, usd]) => ({ unit, usd, variant, source: PRICE_URL, checkedAt: "2026-11-26" }));
}

const videoTasks = ["text-to-video", "image-to-video", "reference-to-video"] as const;
const wanParams = {
  durationsSec: duration(2, 30),
  resolutions: ["480P", "720P", "1080P"],
  aspectRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  maxReferenceImages: 10,
  maxReferenceVideos: 5,
  nativeAudio: true,
  seed: true,
};
const happyParams = {
  durationsSec: duration(3, 15),
  resolutions: ["720P", "1080P"],
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"],
  maxReferenceImages: 9,
  nativeAudio: true,
  seed: true,
};
const models: readonly MediaModelSpec[] = [
  {
    id: "alibaba/wan-3.0",
    upstreamId: "wan3.0-video",
    vendor: "alibaba",
    label: "Wan 3.0",
    kind: "video",
    tasks: videoTasks,
    params: wanParams,
    pricing: prices([
      ["Singapore International 480P input+output", 0.05],
      ["Singapore International 720P input+output", 0.1],
      ["Singapore International 1080P input+output", 0.2],
    ], "second"),
    docsUrl: WAN_DOC,
  },
  {
    id: "alibaba/wan-3.0-prime",
    upstreamId: "wan3.0-video-prime",
    vendor: "alibaba",
    label: "Wan 3.0 Prime",
    kind: "video",
    tasks: videoTasks,
    params: wanParams,
    pricing: prices([
      ["Singapore International 480P input+output", 0.068],
      ["Singapore International 720P input+output", 0.14],
      ["Singapore International 1080P input+output", 0.28],
    ], "second"),
    docsUrl: WAN_DOC,
  },
  {
    id: "alibaba/happy-horse-1.0",
    upstreamId: "happyhorse-1.0-t2v",
    vendor: "alibaba",
    label: "HappyHorse 1.0",
    kind: "video",
    tasks: videoTasks,
    params: happyParams,
    pricing: prices([
      ["Singapore International 720P", 0.14],
      ["Singapore International 1080P", 0.24],
    ], "second"),
    docsUrl: HAPPY_DOC,
  },
  {
    id: "alibaba/happy-horse-1.1",
    upstreamId: "happyhorse-1.1-t2v",
    vendor: "alibaba",
    label: "HappyHorse 1.1",
    kind: "video",
    tasks: videoTasks,
    params: { ...happyParams, resolutions: ["480P", "720P", "1080P"] },
    pricing: prices([
      ["Singapore International 480P", 0.07],
      ["Singapore International 720P", 0.14],
      ["Singapore International 1080P", 0.18],
    ], "second"),
    docsUrl: HAPPY_DOC,
  },
  {
    id: "alibaba/z-image",
    upstreamId: "z-image-turbo",
    vendor: "alibaba",
    label: "Z-Image Turbo",
    kind: "image",
    tasks: ["text-to-image"],
    params: { seed: true },
    pricing: prices([["Singapore International prompt_extend=false", 0.015]], "image"),
    docsUrl: Z_DOC,
  },
];

function base(ctx: MediaAdapterContext): string {
  if (ctx.baseUrl) return ctx.baseUrl;
  const region = ctx.extra?.region ?? "ap-southeast-1";
  if (region === "ap-southeast-1") return "https://dashscope-intl.aliyuncs.com";
  if (region === "us-east-1") return "https://dashscope-us.aliyuncs.com";
  return fail(PREFIX, "INVALID_REGION", "invalid-request", "Unsupported region; provide a workspace base URL");
}

function classify(code: string, status?: number): MediaProviderError["category"] {
  if (/InvalidApiKey|AccessDenied/i.test(code)) return "auth";
  if (/DataInspectionFailed|IPInfringementSuspect/i.test(code)) return "moderation";
  if (/Throttling|LimitRequests/i.test(code)) return "rate-limit";
  if (/BudgetLimitExceeded|BillOverdue|insufficient_quota/i.test(code)) return "quota";
  if (/ModelNotFound|NotFound/i.test(code)) return "not-found";
  if (/InvalidParameter/i.test(code)) return "invalid-request";
  return status ? categoryForStatus(status) : "upstream";
}

function providerError(ctx: MediaAdapterContext, value: unknown, status?: number): MediaProviderError {
  const obj = asRecord(value);
  const code = asString(obj.code) ?? (status ? `HTTP_${status}` : "FAILED");
  const safeCode = redactSecrets(code, contextSecrets(ctx));
  const reason = safeCode.includes("[redacted]")
    ? "PROVIDER_ERROR"
    : safeCode.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  const message = redactSecrets(asString(obj.message) ?? "Alibaba request failed", contextSecrets(ctx));
  return mediaError(PREFIX, reason, classify(code, status), message, { status });
}

async function call(
  ctx: MediaAdapterContext,
  path: string,
  body?: unknown,
  asyncRequest = false,
): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await sendJson(ctx, PREFIX, {
      url: joinUrl(base(ctx), path),
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        ...(asyncRequest ? { "X-DashScope-Async": "enable" } : {}),
      },
      ...(body === undefined ? {} : { body }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
    return fail(PREFIX, "TRANSPORT", "upstream", "Provider transport failed");
  }
  const result = asRecord(response.body);
  if (!response.ok || result.code) {
    const err = providerError(ctx, result, response.status);
    return fail(PREFIX, err.code.slice(PREFIX.length), err.category, err.message, {
      status: err.status,
      retryable: err.retryable,
    });
  }
  return result;
}

function validate(model: MediaModelSpec, req: MediaSubmitRequest): void {
  assertTask(PREFIX, model, req);
  assertKnownOptions(PREFIX, req.vendorOptions, []);
  assertParams(PREFIX, model, req);
  if (req.count !== undefined && req.count !== 1) {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Only one output is supported");
  }
  if (req.seed !== undefined && (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 2147483647)) {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid seed");
  }
  if (req.durationSec !== undefined && !model.params.durationsSec) {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Duration is unsupported");
  }
  if (req.resolution !== undefined && model.kind === "image") {
    const match = /^(\d+)\*(\d+)$/.exec(req.resolution);
    const area = match ? Number(match[1]) * Number(match[2]) : 0;
    if (!match || area < 512 * 512 || area > 2048 * 2048) {
      fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid image size");
    }
  }
  if (req.aspectRatio !== undefined && !model.params.aspectRatios) {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Aspect ratio is unsupported");
  }
  if (req.aspectRatio !== undefined && model.id.includes("happy-horse") && req.task === "image-to-video") {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Image-to-video inherits the first frame aspect ratio");
  }
  if (req.audio !== undefined && (!model.id.includes("wan-3.0"))) {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Audio toggle is unsupported");
  }
  if (!req.prompt && req.task !== "image-to-video") {
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Prompt is required");
  }
}

function videoInput(req: MediaSubmitRequest, happy: boolean): Record<string, unknown> {
  const allowed = req.task === "text-to-video"
    ? []
    : req.task === "image-to-video"
      ? (happy ? ["first-frame"] : ["first-frame", "last-frame"])
      : happy ? ["reference-image"] : ["reference-image", "reference-video", "reference-audio"];
  if (req.inputs.some((i) => !allowed.includes(i.role))) {
    fail(PREFIX, "INVALID_INPUT", "invalid-request", "Unsupported input role");
  }
  const counts = (role: string): number => req.inputs.filter((i) => i.role === role).length;
  if (
    (req.task === "image-to-video" && counts("first-frame") !== 1)
    || counts("last-frame") > 1
    || (req.task === "reference-to-video" && req.inputs.length === 0)
    || counts("reference-image") > (happy ? 9 : 10)
    || counts("reference-video") > 5
    || counts("reference-audio") > 5
  ) {
    fail(PREFIX, "INVALID_INPUT", "invalid-request", "Invalid number of inputs");
  }
  const media = req.inputs.map((i) => {
    if ((i.role === "reference-video" || i.role === "reference-audio") && !i.url) {
      fail(PREFIX, "INVALID_INPUT", "invalid-request", "Video and audio references require URLs");
    }
    return { type: i.role.replaceAll("-", "_"), url: urlOrDataUri(PREFIX, i) };
  });
  return { ...(req.prompt ? { prompt: req.prompt } : {}), ...(media.length ? { media } : {}) };
}

function parameters(req: MediaSubmitRequest, image: boolean): Record<string, unknown> {
  return {
    ...(req.resolution ? { [image ? "size" : "resolution"]: req.resolution } : {}),
    ...(req.aspectRatio ? { ratio: req.aspectRatio } : {}),
    ...(req.durationSec !== undefined ? { duration: req.durationSec } : {}),
    ...(req.audio !== undefined ? { audio: req.audio } : {}),
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
  };
}

async function submitRequest(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, req.model);
  validate(model, req);
  if (model.kind === "image") {
    if (req.inputs.length) fail(PREFIX, "INVALID_INPUT", "invalid-request", "This model accepts no image inputs");
    const body = {
      model: model.upstreamId,
      input: { messages: [{ role: "user", content: [{ text: req.prompt }] }] },
      parameters: parameters(req, true),
    };
    const result = await call(ctx, "/api/v1/services/aigc/multimodal-generation/generation", body);
    const choice = asRecord(asArray(asRecord(result.output).choices)[0]);
    const content = asArray(asRecord(choice.message).content).map(asRecord);
    const url = content.map((item) => asString(item.image)).find(Boolean);
    if (!url) fail(PREFIX, "BAD_RESPONSE", "upstream", "Image response lacks an output URL");
    return { providerJobId: asString(result.request_id) ?? randomUUID(), resume: { imageUrl: url } };
  }
  const happy = model.id.includes("happy-horse");
  const suffix = req.task === "text-to-video" ? "t2v" : req.task === "image-to-video" ? "i2v" : "r2v";
  const wire = happy ? model.upstreamId.replace(/t2v$/, suffix) : model.upstreamId;
  const result = await call(ctx, "/api/v1/services/aigc/video-generation/video-synthesis", {
    model: wire,
    input: videoInput(req, happy),
    parameters: parameters(req, false),
  }, true);
  const id = asString(asRecord(result.output).task_id);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Provider response lacks a task ID");
  return { providerJobId: id, pollAfterMs: 15000, resume: { baseUrl: base(ctx) } };
}

async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  try {
    return await submitRequest(ctx, req);
  } catch (error) {
    const e = normalizeUnknownError(PREFIX, error);
    return fail(PREFIX, e.code.slice(PREFIX.length), e.category, redactSecrets(e.message, contextSecrets(ctx)), {
      status: e.status,
      retryable: e.retryable,
    });
  }
}

function expiryFromUrl(url: string): string | undefined {
  try {
    const expires = new URL(url).searchParams.get("Expires");
    if (!expires || !/^\d+$/.test(expires)) return undefined;
    const time = Number(expires) * 1000;
    return Number.isFinite(time) && time <= 8640000000000000 ? new Date(time).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  if (job.resume?.imageUrl) {
    return {
      status: "succeeded",
      outputs: [urlOutput(job.resume.imageUrl, "image", expiryFromUrl(job.resume.imageUrl))],
    };
  }
  const pollCtx = job.resume?.baseUrl ? { ...ctx, baseUrl: job.resume.baseUrl } : ctx;
  const result = await call(pollCtx, `/api/v1/tasks/${encodeURIComponent(job.providerJobId)}`);
  const out = asRecord(result.output);
  const status = asString(out.task_status);
  if (status === "PENDING") return { status: "queued", pollAfterMs: 15000 };
  if (status === "RUNNING") return { status: "running", pollAfterMs: 15000 };
  if (status === "CANCELED") return { status: "canceled" };
  if (status === "FAILED") return { status: "failed", error: providerError(ctx, out) };
  if (status === "SUCCEEDED") {
    const url = asString(out.video_url);
    if (!url) fail(PREFIX, "BAD_RESPONSE", "upstream", "Completed task lacks a video URL");
    return { status: "succeeded", outputs: [urlOutput(url, "video", expiryFromUrl(url))] };
  }
  return fail(PREFIX, "UNKNOWN_TASK", "not-found", "Provider task is unknown or expired");
}

export const adapter: MediaProviderAdapter = {
  id: "alibaba",
  label: "Alibaba Cloud Model Studio",
  route: "direct",
  errorPrefix: "ALIBABA",
  credential: {
    keyVocabulary: "alibaba",
    envVars: ["DASHSCOPE_API_KEY"],
    configKey: "alibabaApiKey",
    consoleUrl: "https://modelstudio.console.alibabacloud.com/",
    extraFields: [{ name: "region", envVar: "DASHSCOPE_REGION", secret: false, required: false }],
  },
  inputTransport: "inline",
  listModels: () => models,
  submit,
  poll,
  async validateKey(ctx) {
    try {
      const result = await call(ctx, "/api/v1/models");
      return result.success === true && Array.isArray(asRecord(result.output).models)
        ? { ok: true }
        : { ok: false, reason: "Unexpected model-list response" };
    } catch (error) {
      return { ok: false, reason: redactSecrets(normalizeUnknownError(PREFIX, error).message, contextSecrets(ctx)) };
    }
  },
  normalizeError(error) {
    const out = normalizeUnknownError(PREFIX, error);
    return { ...out, message: out.message.replace(/\bsk-[a-zA-Z0-9_-]+/g, "[redacted]") };
  },
};
