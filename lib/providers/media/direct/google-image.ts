/**
 * Google Nano Banana image models over the Gemini Developer API, with ima2's existing
 * Gemini key. Interactions API (POST /v1beta/interactions), which answers image
 * requests synchronously; submit parks the result and returns pollAfterMs 0 so the
 * runner polls at once (L0 notice 2).
 *
 * Sources, checked 2026-11-26: https://aistudio.google.com/docs/image-generation,
 * https://aistudio.google.com/docs/pricing, https://aistudio.google.com/docs/deprecations,
 * model pages under https://aistudio.google.com/docs/models/. Notes: lanes/L3-notes/google-image.md.
 */
import { withImageForms, type ImageForm } from "./_l2/imageForm.js";
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import {
  MediaHttpError, assertAllowed, findModel, httpJson, invalidRequest, normalizeMediaError, parkSyncResult, protocolError,
  readVendorOptions, redact, takeSyncResult, toBase64,
} from "./l3-http.js";

const PREFIX = "GOOGLE_IMAGE";
const API = "https://generativelanguage.googleapis.com/v1beta";
const API_REVISION = "2026-05-20";
const PRICING = "https://aistudio.google.com/docs/pricing";
const CHECKED = "2026-11-26";
const WIDE_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const INPUT_MIME = ["image/png", "image/jpeg", "image/webp"];

function price(usd: number, variant: string, anchor: string): MediaModelSpec["pricing"][number] {
  return { unit: "image", usd, variant, source: PRICING + "#" + anchor, checkedAt: CHECKED };
}

const MODELS: readonly MediaModelSpec[] = [
  { id: "google/nano-banana-2.1", upstreamId: "gemini-nano-banana-2.1", vendor: "google", label: "Nano Banana 2.1", kind: "image",
    tasks: ["text-to-image", "image-to-image"],
    params: { resolutions: ["1K", "2K", "4K"], aspectRatios: WIDE_RATIOS, maxReferenceImages: 14 },
    pricing: [price(0.0336, "1K", "gemini-nano-banana-2.1"), price(0.0504, "2K", "gemini-nano-banana-2.1"), price(0.113, "4K", "gemini-nano-banana-2.1")],
    docsUrl: "https://aistudio.google.com/docs/models/gemini-nano-banana-2.1" },
  { id: "google/nano-banana-pro", upstreamId: "gemini-3-pro-image", vendor: "google", label: "Nano Banana Pro", kind: "image",
    tasks: ["text-to-image", "image-to-image"],
    params: { resolutions: ["1K", "2K", "4K"], aspectRatios: RATIOS, maxReferenceImages: 14 },
    pricing: [price(0.134, "1K", "gemini-3-pro-image"), price(0.134, "2K", "gemini-3-pro-image"), price(0.24, "4K", "gemini-3-pro-image")],
    docsUrl: "https://aistudio.google.com/docs/models/gemini-3-pro-image" },
  // Deprecated upstream, shut down 2027-03-15 (Google's replacement: gemini-3.1-flash-lite-image).
  { id: "google/nano-banana", upstreamId: "gemini-2.5-flash-image", vendor: "google", label: "Nano Banana (shuts down 2027-03-15)", kind: "image",
    tasks: ["text-to-image", "image-to-image"],
    params: { aspectRatios: RATIOS },
    pricing: [price(0.039, "1024px", "gemini-2.5-flash-image")],
    docsUrl: "https://aistudio.google.com/docs/models/gemini-2.5-flash-image" },
];

const OUTPUT_MIME = ["image/png", "image/jpeg"];

interface Content { type?: string; data?: string; mime_type?: string; text?: string }
interface Interaction { id?: string; status?: string; steps?: Array<{ type?: string; content?: Content[] }>; error?: { message?: string } }

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { "x-goog-api-key": ctx.apiKey, "Api-Revision": API_REVISION };
}

function imagePart(input: MediaInput): Content {
  if (!input.bytes) throw invalidRequest(input.role + " must arrive as bytes (inline transport)", "INPUT_NOT_INLINE");
  if (!INPUT_MIME.includes(input.mimeType)) throw invalidRequest(input.role + " must be PNG, JPEG or WebP", "UNSUPPORTED_INPUT");
  return { type: "image", data: toBase64(input.bytes), mime_type: input.mimeType };
}

function validate(request: MediaSubmitRequest, model: MediaModelSpec): void {
  if (!model.tasks.includes(request.task)) throw invalidRequest(model.id + " does not support " + request.task, "UNSUPPORTED_TASK");
  if (!request.prompt?.trim()) throw invalidRequest("A prompt is required", "MISSING_PROMPT");
  if (request.resolution !== undefined && !model.params.resolutions) throw invalidRequest(model.id + " has a fixed output size", "UNSUPPORTED_PARAM");
  assertAllowed("resolution", request.resolution, model.params.resolutions);
  assertAllowed("aspectRatio", request.aspectRatio, model.params.aspectRatios);
  const unsupported = { negativePrompt: request.negativePrompt, seed: request.seed, durationSec: request.durationSec, audio: request.audio };
  const used = Object.entries(unsupported).find(([, value]) => value !== undefined);
  if (used) throw invalidRequest(used[0] + " is not supported by Nano Banana", "UNSUPPORTED_PARAM");
  if (request.count !== undefined && request.count !== 1) throw invalidRequest("Nano Banana returns one image per request", "UNSUPPORTED_PARAM");
}

/** Source image first (the edit target), then references, then the instruction. */
function inputParts(request: MediaSubmitRequest, model: MediaModelSpec): Content[] {
  const stray = request.inputs.find((input) => input.role !== "source-image" && input.role !== "reference-image");
  if (stray) throw invalidRequest("Nano Banana does not take a " + stray.role + " input", "UNEXPECTED_INPUT");
  const sources = request.inputs.filter((input) => input.role === "source-image");
  const refs = request.inputs.filter((input) => input.role === "reference-image");
  if (sources.length > 1) throw invalidRequest("image-to-image takes at most one source-image", "UNEXPECTED_INPUT");
  if (request.task === "text-to-image" && request.inputs.length) throw invalidRequest("text-to-image takes no inputs; use image-to-image", "UNEXPECTED_INPUT");
  if (request.task === "image-to-image" && !request.inputs.length) throw invalidRequest("image-to-image needs a source-image or reference-image", "MISSING_INPUT");
  const limit = model.params.maxReferenceImages;
  if (limit !== undefined && request.inputs.length > limit) throw invalidRequest(model.id + " takes at most " + limit + " images", "TOO_MANY_INPUTS");
  return [...sources.map(imagePart), ...refs.map(imagePart), { type: "text", text: request.prompt! }];
}

function body(request: MediaSubmitRequest): Record<string, unknown> {
  const model = findModel(MODELS, request.model);
  validate(request, model);
  const options = readVendorOptions(request, ["mime_type"]);
  if (options.mime_type !== undefined && !OUTPUT_MIME.includes(String(options.mime_type))) {
    throw invalidRequest("mime_type must be image/png or image/jpeg", "UNSUPPORTED_PARAM");
  }
  const format: Record<string, unknown> = { type: "image" };
  if (options.mime_type !== undefined) format.mime_type = options.mime_type;
  if (request.aspectRatio !== undefined) format.aspect_ratio = request.aspectRatio;
  if (request.resolution !== undefined) format.image_size = request.resolution;
  const parts = inputParts(request, model);
  return { model: model.upstreamId, input: parts, ...(Object.keys(format).length > 1 ? { response_format: format } : {}) };
}

function finished(result: Interaction, ctx: MediaAdapterContext): MediaJobState {
  if (result.status === "failed") {
    const detail = result.error?.message ? ": " + redact(result.error.message, [ctx.apiKey]).slice(0, 300) : "";
    return { status: "failed", error: normalizeMediaError(PREFIX, new MediaHttpError({ message: "Nano Banana generation failed" + detail, reason: "GENERATION_FAILED", category: "upstream", retryable: false, providerState: "failed" })) };
  }
  if (result.status !== undefined && result.status !== "completed") throw protocolError("Unexpected interaction status", String(result.status));
  const contents = (result.steps ?? []).filter((step) => step.type === "model_output").flatMap((step) => step.content ?? []);
  const images = contents.filter((content) => content.type === "image" && typeof content.data === "string" && content.data);
  const last = images[images.length - 1];
  if (!last) {
    const said = contents.filter((content) => content.type === "text" && content.text).map((content) => content.text).join(" ").slice(0, 300);
    // The interaction carries no block reason, so the class stays unknown; the model's own words explain it.
    return { status: "failed", error: { code: PREFIX + "_NO_IMAGE", category: "unknown", retryable: false,
      message: "Nano Banana returned no image" + (said ? ": " + redact(said, [ctx.apiKey]) : "") } };
  }
  // The guide's output_image is "the last generated image block"; keep that one.
  return { status: "succeeded", outputs: [{ kind: "image", bytes: new Uint8Array(Buffer.from(last.data!, "base64")), mimeType: last.mime_type ?? "image/png" }] };
}

export const adapter: MediaProviderAdapter = {
  id: "google-image", label: "Google Nano Banana", route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "gemini", configKey: "geminiApiKey", envVars: ["GEMINI_API_KEY"], consoleUrl: "https://aistudio.google.com/apikey" },
  inputTransport: "inline",
  listModels: () => DECLARED,
  async validateKey(ctx) {
    try {
      await httpJson(ctx, "Google models", (ctx.baseUrl ?? API) + "/models?pageSize=1", { headers: headers(ctx) });
      return { ok: true };
    } catch (error) {
      if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized API key" };
      throw error;
    }
  },
  async submit(ctx, request): Promise<MediaJobRef> {
    const payload = body(request);
    const result = await httpJson<Interaction>(ctx, "Nano Banana", (ctx.baseUrl ?? API) + "/interactions", { method: "POST", headers: headers(ctx), json: payload });
    return parkSyncResult(PREFIX, finished(result, ctx));
  },
  async poll(_ctx, job) {
    return takeSyncResult(PREFIX, job);
  },
  normalizeError: (error) => normalizeMediaError(PREFIX, error),
};

const edit = (images: number, accepts: ImageForm["accepts"], more: Partial<ImageForm> = {}): ImageForm =>
  ({ task: "image-to-image", images, accepts: ["prompt", ...accepts], requires: ["prompt"], ...more });
// One image to edit; the 2.1 and Pro models also take up to 13 more to draw from.
const DECLARED = withImageForms(MODELS, {
  "google/nano-banana-2.1": edit(1, ["resolution", "aspectRatio"], { references: 13 }),
  "google/nano-banana-pro": edit(1, ["resolution", "aspectRatio"], { references: 13 }),
  "google/nano-banana": edit(1, ["aspectRatio"]),
});
