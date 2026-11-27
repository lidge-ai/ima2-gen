import { randomUUID } from "node:crypto";
import type {
  MediaAdapterContext,
  MediaInput,
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

const PREFIX = "PIXVERSE";
const BASE = "https://app-api.pixverse.ai";
const DOCS = "https://docs.platform.pixverse.ai/text-to-video-13016634e0";
const PRICE = "https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0";
const resolutions = ["360p", "540p", "720p", "1080p"];
const ratios = ["16:9", "9:16", "4:3", "3:4", "1:1", "2:3", "3:2", "21:9"];
const durations = Array.from({ length: 15 }, (_, i) => i + 1);
function model(id: "v6" | "c1", rates: readonly number[]): MediaModelSpec {
  return {
    id: `pixverse/pixverse-${id}`,
    upstreamId: id,
    vendor: "pixverse",
    label: `PixVerse ${id.toUpperCase()}`,
    kind: "video",
    tasks:
      id === "v6"
        ? ["text-to-video", "image-to-video", "video-extend", "reference-to-video"]
        : ["text-to-video", "image-to-video", "reference-to-video"],
    params: {
      durationsSec: durations,
      resolutions,
      aspectRatios: ratios,
      maxReferenceImages: 10,
      ...(id === "v6" ? { maxReferenceVideos: 2 } : {}),
      nativeAudio: true,
      seed: true,
      ...(id === "v6"
        ? {
            // Extend keeps the source's ratio and sound.
            inputs: [{ role: "source-video" as const, min: 1, max: 1, tasks: ["video-extend" as const] }],
            taskFields: {
              "video-extend": { accepts: ["prompt", "durationSec", "resolution", "seed"], requires: ["prompt", "durationSec", "resolution"] },
            } satisfies MediaModelSpec["params"]["taskFields"],
          }
        : {}),
    },
    pricing: [
      ...rates.map((credits, i) => ({
        unit: "second" as const,
        usd: credits / 225,
        variant: `${resolutions[i % 4]} audio ${i < 4 ? "off" : "on"}, no video references; ` +
          `${credits} credits/s, 225 credits/USD`,
        source: PRICE,
        checkedAt: "2026-11-26",
      })),
      ...(id === "v6"
        ? rates.map((rate, i) => ({
            unit: "second" as const,
            usd: (rate * 2) / 225,
            variant: `${resolutions[i % 4]} audio ${i < 4 ? "off" : "on"}, video references; ` +
              `${rate * 2} credits/s, 225 credits/USD`,
            source: PRICE,
            checkedAt: "2026-11-26",
          }))
        : []),
    ],
    docsUrl: DOCS,
  };
}
const models: MediaModelSpec[] = [
  model("v6", [5, 7, 9, 18, 7, 9, 12, 23]),
  model("c1", [6, 8, 10, 19, 8, 10, 13, 24]),
  {
    // Endpoint-based identifier; PixVerse does not specify a wire model ID for lipsync.
    id: "pixverse/pixverse-lipsync",
    upstreamId: "lipsync",
    vendor: "pixverse",
    label: "PixVerse Lip Sync",
    kind: "video",
    tasks: ["lipsync"],
    params: {
      inputs: [
        { role: "source-video", min: 1, max: 1 },
        { role: "source-audio", min: 1, max: 1, billedLength: true },
      ],
    },
    pricing: [
      {
        unit: "second",
        usd: 4 / 225,
        variant: "uploaded audio; 4 credits per audio second rounded up; 225 credits/USD",
        source: PRICE,
        checkedAt: "2026-11-26",
      },
    ],
    docsUrl: "https://docs.platform.pixverse.ai/lipsync-43051219e0.md",
  },
];
function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { "API-KEY": ctx.apiKey, "Ai-trace-id": randomUUID() };
}
function category(code: string, status: number) {
  if (["10001", "10002", "10003", "10004", "10005", "400009", "500020"].includes(code))
    return "auth" as const;
  if (code === "500090") return "quota" as const;
  if (code === "500044" || code === "712008") return "rate-limit" as const;
  if (code === "500008") return "not-found" as const;
  if (["500010", "500069", "500100"].includes(code)) return "upstream" as const;
  if (["500052", "500054", "500063"].includes(code)) return "moderation" as const;
  if (code.startsWith("400")) return "invalid-request" as const;
  return categoryForStatus(status);
}
function readResponse(
  ctx: MediaAdapterContext,
  status: number,
  ok: boolean,
  value: unknown,
): Record<string, unknown> {
  const body = asRecord(value);
  const code = asString(body.ErrCode);
  if (!ok || (code !== undefined && code !== "0")) {
    const reason = code && code !== "0" ? `VENDOR_${code.replace(/\W/g, "_")}` : `HTTP_${status}`;
    const message =
      asString(body.ErrMsg) ?? asString(body.message) ?? `PixVerse request failed (HTTP ${status})`;
    fail(PREFIX, reason, category(code ?? "", status), redactSecrets(message, contextSecrets(ctx)), {
      status,
    });
  }
  if (code !== "0") fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse response is missing ErrCode");
  return asRecord(body.Resp);
}
async function json(
  ctx: MediaAdapterContext,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await sendJson(ctx, PREFIX, {
      url: joinUrl(ctx.baseUrl ?? BASE, path),
      headers: headers(ctx),
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    return fail(PREFIX, "NETWORK", "upstream", "PixVerse request failed");
  }
  return readResponse(ctx, response.status, response.ok, response.body);
}
async function upload(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }> {
  const image = input.mimeType.startsWith("image/");
  const media = input.mimeType.startsWith("video/") || input.mimeType.startsWith("audio/");
  if (!image && !media)
    fail(PREFIX, "INPUT_TYPE", "invalid-request", "Expected an image, video, or audio input");
  if (Boolean(input.url) === Boolean(input.bytes))
    fail(PREFIX, "INPUT_MISSING", "invalid-request", "Provide one image URL or file");
  const form = new FormData();
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4", "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
  };
  if (!extensions[input.mimeType]) invalid("Unsupported PixVerse media format");
  if (input.bytes)
    form.set(
      image ? "image" : "file",
      new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }),
      `upload.${extensions[input.mimeType]}`,
    );
  else form.set(image ? "image_url" : "file_url", input.url!);
  let res: Response;
  try {
    res = await ctx.fetch(
      joinUrl(ctx.baseUrl ?? BASE, image ? "/openapi/v2/image/upload" : "/openapi/v2/media/upload"),
      { method: "POST", headers: headers(ctx), body: form, ...(ctx.signal ? { signal: ctx.signal } : {}) },
    );
  } catch {
    return fail(PREFIX, "NETWORK", "upstream", "PixVerse upload failed");
  }
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    return fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse upload returned invalid JSON", {
      status: res.status,
    });
  }
  const id = asString(readResponse(ctx, res.status, res.ok, value)[image ? "img_id" : "media_id"]);
  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse upload returned an invalid image ID");
  // Runner passes uploaded IDs in MediaInput.url; this is an opaque adapter-local reference, not a downloadable URL.
  return { url: `pixverse:${image ? "image" : "media"}:${id}` };
}
function invalid(message: string): never {
  return fail(PREFIX, "INVALID_PARAM", "invalid-request", message);
}
function validate(request: MediaSubmitRequest, spec: MediaModelSpec): void {
  assertTask(PREFIX, spec, request);
  const lipsync = request.task === "lipsync";
  const options = assertKnownOptions(
    PREFIX,
    request.vendorOptions,
    lipsync ? ["lip_sync_tts_speaker_id", "lip_sync_tts_content"] : [],
  );
  const videoRefs = request.inputs.filter((i) => i.role === "reference-video");
  if (request.task === "reference-to-video" && videoRefs.length && request.durationSec === 0) {
    assertParams(PREFIX, { ...spec, params: { ...spec.params, durationsSec: [0] } }, request);
  } else assertParams(PREFIX, spec, request);
  if (request.count !== undefined && request.count !== 1) invalid("Only one output is supported");
  if (lipsync) {
    validateLipsync(request, options);
    return;
  }
  if (
    !request.prompt ||
    request.prompt.length > 2048 ||
    request.durationSec === undefined ||
    !request.resolution
  )
    invalid("Prompt, duration and resolution are required");
  if (
    request.seed !== undefined &&
    (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 2147483647)
  )
    invalid("Invalid seed");
  if (request.task === "text-to-video" && (!request.aspectRatio || request.inputs.length))
    invalid("Text generation requires aspect ratio and no inputs");
  if (
    request.task === "image-to-video" &&
    (request.aspectRatio ||
      request.inputs.length !== 1 ||
      !["first-frame", "source-image"].includes(request.inputs[0]!.role) ||
      !request.inputs[0]!.mimeType.startsWith("image/"))
  )
    invalid("Image generation requires one image and no aspect ratio");
  if (
    request.task === "video-extend" &&
    (request.aspectRatio ||
      request.audio !== undefined ||
      request.inputs.length !== 1 ||
      request.inputs[0]!.role !== "source-video" ||
      !request.inputs[0]!.mimeType.startsWith("video/"))
  )
    invalid("Extend requires one source video and no aspect ratio or audio switch");
  if (request.task === "reference-to-video") validateFusion(request, videoRefs.length);
}
function validateLipsync(request: MediaSubmitRequest, opts: Record<string, unknown>): void {
  if (
    request.prompt !== undefined ||
    request.durationSec !== undefined ||
    request.resolution !== undefined ||
    request.aspectRatio !== undefined ||
    request.audio !== undefined
  )
    invalid("Lipsync does not accept generation parameters");
  const videos = request.inputs.filter((i) => i.role === "source-video" && i.mimeType.startsWith("video/"));
  const audios = request.inputs.filter((i) => i.role === "source-audio" && i.mimeType.startsWith("audio/"));
  const speaker = opts.lip_sync_tts_speaker_id;
  const text = opts.lip_sync_tts_content;
  const tts =
    typeof speaker === "string" && speaker.length > 0 && typeof text === "string" && text.length > 0;
  if (
    videos.length !== 1 ||
    audios.length > 1 ||
    request.inputs.length !== videos.length + audios.length ||
    (audios.length === 1 ? Object.keys(opts).length > 0 : !tts)
  )
    invalid("Lipsync requires one video and either audio or both TTS fields");
}
function validateFusion(request: MediaSubmitRequest, videoCount: number): void {
  const images = request.inputs.filter(
    (i) => i.role === "reference-image" && i.mimeType.startsWith("image/"),
  );
  const videos = request.inputs.filter(
    (i) => i.role === "reference-video" && i.mimeType.startsWith("video/"),
  );
  if (
    !request.aspectRatio ||
    !request.inputs.length ||
    request.inputs.length !== images.length + videos.length ||
    images.length > 10 ||
    videos.length > 2
  )
    invalid("Invalid fusion references");
  if (
    videoCount &&
    ((request.model !== "pixverse/pixverse-v6" && request.model !== "v6") || request.durationSec !== 0)
  )
    invalid("Video references require V6 and duration zero");
  if (!videoCount && !images.length) invalid("Fusion needs image references");
}
async function inputId(
  ctx: MediaAdapterContext,
  input: MediaInput,
  kind: "image" | "media",
): Promise<number> {
  const prefix = `pixverse:${kind}:`;
  const ref = input.url?.startsWith(prefix) ? input.url : (await upload(ctx, input)).url;
  const id = ref.startsWith(prefix) ? ref.slice(prefix.length) : "";
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) invalid("Invalid uploaded media ID");
  return Number(id);
}
async function buildBody(
  ctx: MediaAdapterContext,
  request: MediaSubmitRequest,
  spec: MediaModelSpec,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (request.task === "lipsync") {
    body.video_media_id = await inputId(
      ctx,
      request.inputs.find((i) => i.role === "source-video")!,
      "media",
    );
    const audio = request.inputs.find((i) => i.role === "source-audio");
    if (audio) body.audio_media_id = await inputId(ctx, audio, "media");
    else Object.assign(body, request.vendorOptions);
    return body;
  }
  Object.assign(body, {
    model: spec.upstreamId,
    prompt: request.prompt,
    duration: request.durationSec,
    quality: request.resolution,
  });
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.audio !== undefined) body.generate_audio_switch = request.audio;
  if (request.task === "text-to-video" || request.task === "reference-to-video")
    body.aspect_ratio = request.aspectRatio;
  if (request.task === "image-to-video") body.img_id = await inputId(ctx, request.inputs[0]!, "image");
  if (request.task === "video-extend") body.video_media_id = await inputId(ctx, request.inputs[0]!, "media");
  if (request.task === "reference-to-video") await addReferences(ctx, request, body);
  return body;
}
async function addReferences(
  ctx: MediaAdapterContext,
  request: MediaSubmitRequest,
  body: Record<string, unknown>,
): Promise<void> {
  const images: { img_id: number }[] = [];
  const videos: { video_media_id: number }[] = [];
  for (const input of request.inputs) {
    if (input.role === "reference-image") images.push({ img_id: await inputId(ctx, input, "image") });
    else videos.push({ video_media_id: await inputId(ctx, input, "media") });
  }
  if (images.length) body.image_references = images;
  if (videos.length) {
    body.video_references = videos;
    body.reference_mode = "omni";
  }
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest) {
  const spec = findModel(PREFIX, models, request.model);
  validate(request, spec);
  const body = await buildBody(ctx, request, spec);
  const paths: Partial<Record<MediaSubmitRequest["task"], string>> = {
    "text-to-video": "text",
    "image-to-video": "img",
    "video-extend": "extend",
    "reference-to-video": "fusion",
    lipsync: "lip_sync",
  };
  const result = await json(ctx, `/openapi/v2/video/${paths[request.task]}/generate`, body);
  const id = asString(result.video_id);
  if (!id || !/^[1-9]\d*$/.test(id))
    fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse response has no valid video ID");
  return { providerJobId: id, pollAfterMs: 3000 };
}
async function poll(ctx: MediaAdapterContext, job: { providerJobId: string }) {
  if (!/^[1-9]\d*$/.test(job.providerJobId))
    fail(PREFIX, "INVALID_PARAM", "invalid-request", "Invalid video ID");
  const result = await json(ctx, `/openapi/v2/video/result/${job.providerJobId}`);
  if (result.status === 5) return { status: "running" as const, pollAfterMs: 3000 };
  if (result.status === 1) {
    const url = asString(result.url);
    if (!url || !/^https?:\/\//i.test(url))
      fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse result has no valid URL");
    return { status: "succeeded" as const, outputs: [urlOutput(url, "video")] };
  }
  if (result.status === 7 || result.status === 8)
    return {
      status: "failed" as const,
      error: mediaError(
        PREFIX,
        `STATUS_${result.status}`,
        result.status === 7 ? "moderation" : "upstream",
        "PixVerse generation failed",
        { providerState: String(result.status), retryable: false },
      ),
    };
  return fail(PREFIX, "BAD_RESPONSE", "upstream", "PixVerse returned an unknown task status");
}
async function protect<T>(ctx: MediaAdapterContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MediaAdapterError)
      throw new MediaAdapterError({
        ...error.detail,
        message: redactSecrets(error.detail.message, contextSecrets(ctx)),
      });
    throw error;
  }
}
export const adapter: MediaProviderAdapter = {
  id: "pixverse",
  label: "PixVerse",
  route: "direct",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "pixverse",
    envVars: ["PIXVERSE_API_KEY"],
    configKey: "pixverseApiKey",
    consoleUrl: "https://platform.pixverse.ai/",
  },
  inputTransport: "upload",
  listModels: () => models,
  uploadInput: (ctx, input) => protect(ctx, () => upload(ctx, input)),
  submit: (ctx, request) => protect(ctx, () => submit(ctx, request)),
  poll: (ctx, job) => protect(ctx, () => poll(ctx, job)),
  async validateKey(ctx) {
    try {
      await json(ctx, "/openapi/v2/account/balance");
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: normalizeUnknownError(PREFIX, error).message };
    }
  },
  normalizeError(error) {
    return normalizeUnknownError(
      PREFIX,
      error instanceof MediaAdapterError ? error : new Error("PixVerse request failed"),
    );
  },
};
