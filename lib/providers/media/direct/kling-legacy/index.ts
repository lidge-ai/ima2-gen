import { withImageForms, type ImageForm } from "../_l2/imageForm.js";
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

import { legacyModels as models } from "../kling/models.js";
import { request, poll } from "../kling/shared.js";

const PREFIX = "KLING_LEGACY";
const IMAGE_PATH = "/v1/images/generations";
const VIDEO_PATH = "/v1/videos/text2video";
const IMAGE_TO_VIDEO = "/v1/videos/image2video";
const OMNI_VIDEO = "/v1/videos/omni-video";
const OMNI_IMAGE = "/v1/images/omni-image";
const LIP_SYNC = "/v1/videos/advanced-lip-sync";
function pathFor(model: MediaModelSpec, req: MediaSubmitRequest): string {
  if (model.id === "kling/kling-lipsync") return LIP_SYNC;
  if (model.id === "kling/kling-o1" || model.id === "kling/kling-3-omni") return OMNI_VIDEO;
  if (model.id === "kling/kling-image-o1" || model.id === "kling/kling-image-3-omni") return OMNI_IMAGE;
  return model.kind === "image" ? IMAGE_PATH : req.task === "image-to-video" ? IMAGE_TO_VIDEO : VIDEO_PATH;
}
function bodyFor(model: MediaModelSpec, req: MediaSubmitRequest, path: string): Record<string, unknown> {
  assertTask(PREFIX, model, req);
  assertParams(PREFIX, model, req);
  if (path === LIP_SYNC) return lipBody(req);
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
  if (path.startsWith("/v1/")) return legacyBody(model, req, path);
  return legacyBody(model, req, path);
}
function legacyBody(model: MediaModelSpec, req: MediaSubmitRequest, path: string): Record<string, unknown> {
  if (model.kind === "video" && req.resolution !== undefined)
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Resolution is unsupported");
  const body: Record<string, unknown> = { model_name: model.upstreamId, prompt: req.prompt };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.resolution) body.resolution = req.resolution;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.durationSec) body.duration = String(req.durationSec);
  if (req.audio !== undefined) body.sound = req.audio ? "on" : "off";
  if (req.count !== undefined) body.n = req.count;
  if (path === IMAGE_PATH && req.inputs.length) body.image = bareBase64OrUrl(PREFIX, req.inputs[0]!);
  if (path === IMAGE_TO_VIDEO)
    for (const input of req.inputs)
      body[input.role === "first-frame" ? "image" : "image_tail"] = bareBase64OrUrl(PREFIX, input);
  if (path === OMNI_IMAGE) {
    if (req.inputs.some((i) => !["source-image", "reference-image"].includes(i.role)))
      fail(PREFIX, "INVALID_PARAM", "invalid-request", "Image input required");
    body.image_list = req.inputs.map((i) => ({ image: bareBase64OrUrl(PREFIX, i) }));
  }
  if (path === OMNI_VIDEO) {
    if (req.inputs.some((i) => !["reference-image", "reference-video", "source-video"].includes(i.role)))
      fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported reference input");
    const images = req.inputs.filter((i) => i.role === "reference-image");
    const videos = req.inputs.filter((i) => i.role !== "reference-image");
    if (images.length > 4 || videos.length > 1 || (req.task !== "text-to-video" && !req.inputs.length))
      fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid references");
    if (images.length) body.image_list = images.map((i) => ({ image_url: bareBase64OrUrl(PREFIX, i) }));
    if (videos.length) {
      if (!videos[0]!.url) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Video URL required");
      body.video_list = [
        { video_url: videos[0]!.url, refer_type: req.task === "video-to-video" ? "base" : "feature" },
      ];
    }
  }
  return body;
}
function assertLipParams(req: MediaSubmitRequest): void {
  if (
    req.prompt ||
    req.negativePrompt ||
    req.durationSec !== undefined ||
    req.resolution ||
    req.aspectRatio ||
    req.seed !== undefined ||
    req.audio !== undefined ||
    req.count !== undefined
  )
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Unsupported lip sync parameter");
}
function lipBody(req: MediaSubmitRequest): Record<string, unknown> {
  const opt = assertKnownOptions(PREFIX, req.vendorOptions, [
    "sessionId",
    "faceId",
    "soundStartTime",
    "soundEndTime",
    "soundInsertTime",
  ]);
  const { sessionId, faceId, soundStartTime, soundEndTime, soundInsertTime } = opt;
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof faceId !== "string" ||
    !faceId ||
    typeof soundStartTime !== "number" ||
    typeof soundEndTime !== "number" ||
    typeof soundInsertTime !== "number" ||
    soundStartTime < 0 ||
    soundInsertTime < 0 ||
    soundEndTime - soundStartTime < 2000 ||
    req.inputs.length !== 1 ||
    req.inputs[0]?.role !== "source-audio"
  )
    fail(
      PREFIX,
      "INVALID_PARAM",
      "invalid-request",
      "Face session, face ID, audio and valid times are required",
    );
  assertLipParams(req);
  return {
    session_id: sessionId,
    face_choose: [
      {
        face_id: faceId,
        sound_file: bareBase64OrUrl(PREFIX, req.inputs[0]!),
        sound_start_time: soundStartTime,
        sound_end_time: soundEndTime,
        sound_insert_time: soundInsertTime,
      },
    ],
  };
}
async function submit(ctx: MediaAdapterContext, req: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, req.model);
  const path = pathFor(model, req);
  const modern = !path.startsWith("/v1/");
  const data = asRecord((await request(ctx, path, bodyFor(model, req, path), modern, PREFIX)).data);
  const id = asString(modern ? data.id : data.task_id);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing task ID");
  return {
    providerJobId: id,
    resume: { path: modern ? "/tasks" : path, kind: model.kind, ...(modern ? { auth: "apiKey" } : {}) },
  };
}

export const adapter: MediaProviderAdapter = {
  id: "kling-legacy",
  label: "Kling AI (Access Key)",
  route: "direct",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "kling-legacy",
    envVars: ["KLING_ACCESS_KEY"],
    configKey: "klingLegacyApiKey",
    consoleUrl: "https://kling.ai/dev/api-key",
    extraFields: [{ name: "secretKey", envVar: "KLING_SECRET_KEY", secret: true, required: true }],
  },
  inputTransport: "inline",
  listModels: () => DECLARED,
  async validateKey(ctx) {
    try {
      await request(ctx, `${IMAGE_PATH}?pageNum=1&pageSize=1`, undefined, false, PREFIX);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: adapter.normalizeError(error).message };
    }
  },
  submit,
  poll: (ctx, job) => poll(ctx, job, PREFIX, false),
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

const edit = (images: number, accepts: ImageForm["accepts"], more: Partial<ImageForm> = {}): ImageForm =>
  ({ task: "image-to-image", images, accepts: ["prompt", ...accepts], requires: ["prompt"], ...more });
const DECLARED = withImageForms(models, {
  "kling/kling-image-3": edit(1, ["resolution", "aspectRatio", "count"]),
  "kling/kling-image-o1": edit(10, ["resolution", "aspectRatio", "count"]),
  "kling/kling-image-3-omni": edit(10, ["resolution", "aspectRatio", "count"]),
});
