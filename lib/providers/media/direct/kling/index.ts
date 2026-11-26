import type {
  MediaAdapterContext,
  MediaJobRef,
  MediaModelSpec,
  MediaProviderAdapter,
  MediaSubmitRequest,
} from "../../contract.js";
import { fail, normalizeUnknownError, MediaAdapterError } from "../_l2/errors.js";
import { asRecord, asString } from "../_l2/http.js";
import { bareBase64OrUrl } from "../_l2/inputs.js";
import { assertKnownOptions, assertParams, assertTask, findModel } from "../_l2/validate.js";

import { modernModels as models } from "./models.js";
import { request, poll } from "./shared.js";

const PREFIX = "KLING";
function pathFor(model: MediaModelSpec, req: MediaSubmitRequest): string {
  if (["kling/kling-4-omni", "kling/kling-3-omni", "kling/kling-o1"].includes(model.id))
    return `/omni-video/${model.upstreamId}`;
  return `/${req.task === "image-to-video" ? "image-to-video" : "text-to-video"}/${model.upstreamId}`;
}
function bodyFor(model: MediaModelSpec, req: MediaSubmitRequest): Record<string, unknown> {
  assertTask(PREFIX, model, req);
  assertParams(PREFIX, model, req);
  assertKnownOptions(PREFIX, req.vendorOptions, []);
  if (!req.prompt) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Prompt is required");
  if (req.seed !== undefined || (req.audio !== undefined && !model.params.nativeAudio))
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported parameter");
  if (
    req.count !== undefined &&
    (model.kind !== "image" || !Number.isInteger(req.count) || req.count < 1 || req.count > 9)
  )
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid count");
  if (model.kind === "image" && req.durationSec !== undefined)
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Duration is unsupported");
  if (req.task === "text-to-image" || req.task === "text-to-video") {
    if (req.inputs.length) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unexpected inputs");
  }
  if (
    req.task === "image-to-image" &&
    (!req.inputs.length || req.inputs.length > (model.params.maxReferenceImages ?? 1) || req.negativePrompt)
  )
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid image inputs");
  if (
    req.task === "image-to-video" &&
    (req.inputs.filter((i) => i.role === "first-frame").length !== 1 ||
      req.inputs.filter((i) => i.role === "last-frame").length > 1 ||
      req.inputs.some((i) => !["first-frame", "last-frame"].includes(i.role)))
  )
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "A first frame and optional last frame are required");
  return modernBody(model, req);
}
function modernOmniBody(req: MediaSubmitRequest): Record<string, unknown> {
  if (
    (!req.inputs.length && req.task !== "text-to-video") ||
    req.inputs.length > 15 ||
    req.inputs.some((i) => !["reference-image", "reference-video", "source-video"].includes(i.role))
  )
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid omni references");
  const counts = { image: 0, video: 0 };
  const contents: Record<string, string>[] = [{ type: "prompt", text: req.prompt! }];
  for (const i of req.inputs) {
    const image = i.role === "reference-image";
    const index = ++counts[image ? "image" : "video"];
    if (index > (image ? 10 : 5)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Too many references");
    contents.push({
      type: image ? "refer_image" : i.role === "source-video" ? "base_video" : "feature_video",
      url: bareBase64OrUrl(PREFIX, i),
      id: `${image ? "image" : "video"}${index}`,
    });
  }
  return {
    contents,
    settings: {
      ...(req.resolution ? { resolution: req.resolution } : {}),
      ...(req.audio !== undefined ? { audio: req.audio ? "native" : "off" } : {}),
      ...(req.durationSec ? { duration: req.durationSec } : {}),
      ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
    },
  };
}
function modernBody(model: MediaModelSpec, req: MediaSubmitRequest): Record<string, unknown> {
  if (req.negativePrompt) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported modern parameter");
  if (model.id.endsWith("turbo") && req.inputs.some((i) => i.role === "last-frame"))
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Turbo supports only a first frame");
  if (["kling/kling-4-omni", "kling/kling-3-omni", "kling/kling-o1"].includes(model.id))
    return modernOmniBody(req);
  if (req.task === "image-to-video" && req.aspectRatio)
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Aspect ratio is unsupported for image-to-video");
  const settings = {
    ...(req.resolution ? { resolution: req.resolution } : {}),
    ...(req.audio !== undefined ? { audio: req.audio ? "native" : "off" } : {}),
    ...(req.durationSec ? { duration: req.durationSec } : {}),
    ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
  };
  if (req.task === "text-to-video") return { prompt: req.prompt, settings };
  return {
    contents: [
      { type: "prompt", text: req.prompt },
      ...req.inputs.map((i, index) => ({
        type: i.role === "first-frame" ? "first_frame" : "last_frame",
        url: bareBase64OrUrl(PREFIX, i),
        ...(model.id === "kling/kling-4" ? { id: `image${index + 1}` } : {}),
      })),
    ],
    settings,
  };
}
async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, req.model);
  const path = pathFor(model, req);
  const modern = !path.startsWith("/v1/");
  const data = asRecord((await request(ctx, path, bodyFor(model, req), modern, PREFIX)).data);
  const id = asString(modern ? data.id : data.task_id);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing task ID");
  return {
    providerJobId: id,
    resume: { path: modern ? "/tasks" : path, kind: model.kind, ...(modern ? { auth: "apiKey" } : {}) },
  };
}

export const adapter: MediaProviderAdapter = {
  id: "kling",
  label: "Kling AI",
  route: "direct",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "kling",
    envVars: ["KLING_API_KEY"],
    configKey: "klingApiKey",
    consoleUrl: "https://kling.ai/dev/api-key",
  },
  inputTransport: "inline",
  listModels: () => models,
  async validateKey(ctx) {
    try {
      const result = await request(ctx, "/tasks?task_ids=0", undefined, true, PREFIX);
      if (result.code !== 0 || !Array.isArray(result.data))
        fail(PREFIX, "BAD_RESPONSE", "upstream", "Key validation unavailable");
      return { ok: true };
    } catch (error) {
      const detail = adapter.normalizeError(error);
      if (detail.category !== "auth") throw error;
      return { ok: false, reason: detail.message };
    }
  },
  submit,
  poll: (ctx, job) => poll(ctx, job, PREFIX, true),
  normalizeError(error) {
    return normalizeUnknownError(
      PREFIX,
      error instanceof MediaAdapterError ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
        ? error
        : new Error("Provider request failed"),
    );
  },
};
