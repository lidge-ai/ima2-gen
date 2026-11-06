/**
 * API-key lane execution through the OpenAI Image API.
 *
 * Images 2.6 documents its model and new fields on /v1/images/*; its Responses
 * image_generation support is listed in the reference schema but unconfirmed, and one
 * public report shows the tool rejecting 2.6 + complexity. So 2.6 tool models use this
 * path by default; `apiProvider.imageTransport` (IMA2_API_IMAGE_TRANSPORT) can force
 * "responses" or send every explicit API image model here with "images".
 *
 * The prompt goes straight to the image model: the outer reasoning model and web search
 * only exist on the Responses path.
 */
import { detectImageMimeFromB64 } from "../../refs.js";
import { isImage26Model } from "../../oauthNormalize.js";
import { postApiImages, type ApiImagesResult } from "../../imagesApiTransport.js";
import type { RouteRuntimeContext } from "../../runtimeContext.js";
import type { FinalImageHandler } from "../../responsesParse.js";

export type ApiImageTransport = "auto" | "images" | "responses";

export function apiImageTransport(ctx: RouteRuntimeContext): ApiImageTransport {
  const value = (ctx.config as { apiProvider?: { imageTransport?: unknown } } | undefined)?.apiProvider?.imageTransport;
  return value === "images" || value === "responses" ? value : "auto";
}

export function shouldUseImagesApi(ctx: RouteRuntimeContext, provider: string | undefined, imageToolModel: string | undefined): imageToolModel is string {
  if (provider !== "api" || !imageToolModel) return false;
  const transport = apiImageTransport(ctx);
  if (transport === "responses") return false;
  return transport === "images" || isImage26Model(imageToolModel);
}

export interface ImagesApiCall {
  ctx: RouteRuntimeContext;
  scope: string;
  requestId?: string | null | undefined;
  signal?: AbortSignal | null | undefined;
  model: string;
  prompt: string;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  complexity?: string | undefined;
  background?: string | undefined;
  outputFormat?: string | undefined;
  n?: number | undefined;
  /** Input images (base64, any of png/jpeg/webp). Present → /edits; the first is the edit target. */
  images?: string[] | undefined;
  /** OpenAI mask contract: alpha 0 = editable. Same size as the first image. */
  mask?: string | undefined;
  /** Markup layer for the first image (edits only; never combined with mask). */
  markup?: string | undefined;
  /** Additional request fields owned by later features (gif, svg, markup). */
  extra?: Record<string, unknown> | undefined;
}

function dataUrl(b64: string, fallbackMime = "image/png") {
  const mime = detectImageMimeFromB64(b64) ?? fallbackMime;
  return `data:${mime};base64,${b64}`;
}

export function imagesApiBody(call: ImagesApiCall): { kind: "generations" | "edits"; json: Record<string, unknown> } {
  const inputs = call.images?.filter((b64) => typeof b64 === "string" && b64.length > 0) ?? [];
  const json: Record<string, unknown> = {
    model: call.model,
    prompt: call.prompt,
    ...(call.quality ? { quality: call.quality } : {}),
    ...(call.size ? { size: call.size } : {}),
    ...(call.moderation ? { moderation: call.moderation } : {}),
    ...(call.complexity && isImage26Model(call.model) ? { complexity: call.complexity } : {}),
    ...(call.background ? { background: call.background } : {}),
    ...(call.outputFormat ? { output_format: call.outputFormat } : {}),
    ...(call.n && call.n > 1 ? { n: call.n } : {}),
    ...call.extra,
  };
  if (inputs.length === 0) return { kind: "generations", json };
  return {
    kind: "edits",
    json: {
      ...json,
      images: inputs.map((b64) => ({ image_url: dataUrl(b64) })),
      ...(call.mask ? { mask: { image_url: dataUrl(call.mask) } } : {}),
      ...(call.markup ? { markup: { image_url: dataUrl(call.markup) } } : {}),
    },
  };
}

export async function runImagesApi(call: ImagesApiCall, onFinalImage?: FinalImageHandler | null): Promise<ApiImagesResult> {
  const { kind, json } = imagesApiBody(call);
  const result = await postApiImages({
    ctx: call.ctx, scope: call.scope, kind, json, requestId: call.requestId, signal: call.signal,
  });
  if (result.images.length === 0) {
    throw Object.assign(new Error("OpenAI Images API returned no image data"), { status: 422, code: "EMPTY_RESPONSE" });
  }
  if (onFinalImage) {
    for (const [index, image] of result.images.entries()) await onFinalImage(image, index);
  }
  return result;
}

/** The single-image result shape the Responses path returns. */
export function singleImageResult(result: ApiImagesResult) {
  const image = result.images[0]!;
  return {
    b64: image.b64, usage: result.usage, webSearchCalls: 0, revisedPrompt: image.revisedPrompt, text: null,
    ...(result.outputFormat ? { outputFormat: result.outputFormat } : {}),
    ...(result.svgUsage ? { svgUsage: result.svgUsage } : {}),
  };
}
