// Seedream image generation on ModelArk (synchronous).
// https://docs.byteplus.com/en/docs/ModelArk/image-generation-api (read 2026-11-26)
import type { MediaModelSpec, MediaOutput, MediaSubmitRequest } from "../../contract.js";
import { MediaAdapterError, fail } from "../_l2/errors.js";
import { asArray, asRecord, asString } from "../_l2/http.js";
import { urlOutput } from "../_l2/inputs.js";
import { assertKnownOptions, assertParams } from "../_l2/validate.js";
import { ERROR_PREFIX as P, arkError } from "./errors.js";
import { SEEDREAM_TRAITS, SIZE_TABLES, type SeedreamTraits } from "./models.js";
import { wireUrl } from "./video.js";

const OPTIONS = ["watermark", "output_format", "background", "safety_identifier", "max_images", "text_recognition"];
const MAX_SEQUENTIAL = 15;
const URL_DAY_SECONDS = 86_400;

function invalid(message: string): never {
  return fail(P, "INVALID_PARAM", "invalid-request", message);
}

function referenceUrls(model: MediaModelSpec, request: MediaSubmitRequest): string[] {
  const refs = request.inputs.filter((i) => i.role === "reference-image" || i.role === "source-image");
  if (refs.length !== request.inputs.length)
    fail(P, "INPUT_INVALID", "invalid-request", "Seedream takes reference or source images only");
  const max = model.params.maxReferenceImages ?? 0;
  if (request.task === "text-to-image" && refs.length > 0)
    fail(P, "INPUT_INVALID", "invalid-request", "text-to-image takes no images; use image-to-image");
  if (request.task !== "text-to-image" && refs.length === 0)
    fail(P, "INPUT_MISSING", "invalid-request", request.task + " needs an image");
  if (refs.length > max)
    fail(P, "INPUT_INVALID", "invalid-request", model.label + " takes at most " + String(max) + " image(s)");
  return refs.map((input) => wireUrl(input, true));
}

function size(traits: SeedreamTraits, request: MediaSubmitRequest): string | undefined {
  if (!request.aspectRatio) return request.resolution;
  const tier = request.resolution ?? "2K";
  return (
    SIZE_TABLES[traits.sizeTable][tier]?.[request.aspectRatio] ??
    invalid("No documented size for " + tier + " at " + request.aspectRatio)
  );
}

function applyOptions(body: Record<string, unknown>, traits: SeedreamTraits, options: Record<string, unknown>): void {
  const { max_images: maxImages, text_recognition: textRecognition, ...rest } = options;
  if ((maxImages !== undefined || textRecognition !== undefined) && !traits.layers)
    invalid("max_images and text_recognition apply to layer decomposition only");
  if ("output_format" in rest && (!traits.outputFormat || !["png", "jpeg"].includes(String(rest.output_format))))
    invalid("output_format is png or jpeg where supported");
  if (
    "background" in rest &&
    (!traits.background || !["auto", "transparent", "opaque"].includes(String(rest.background)))
  )
    invalid("background is not supported here");
  if ("watermark" in rest && typeof rest.watermark !== "boolean") invalid("watermark must be a boolean");
  if (traits.layers) {
    const layerOptions: Record<string, unknown> = {};
    if (maxImages !== undefined) {
      if (!(Number.isInteger(maxImages) && Number(maxImages) >= 2 && Number(maxImages) <= 100))
        invalid("max_images must be an integer 2-100");
      layerOptions.max_images = maxImages;
    }
    if (textRecognition !== undefined) layerOptions.text_recognition = textRecognition === true;
    body.layer_decomposition = true;
    if (Object.keys(layerOptions).length > 0) body.layer_decomposition_options = layerOptions;
  }
  body.response_format = "url";
  body.watermark = false;
  Object.assign(body, rest);
}

export function buildImageBody(model: MediaModelSpec, request: MediaSubmitRequest): Record<string, unknown> {
  const traits = SEEDREAM_TRAITS[model.id] ?? invalid("No Seedream traits for " + model.id);
  assertParams(P, model, request);
  if (traits.layers && request.aspectRatio)
    invalid("Layer decomposition keeps the source aspect ratio; omit aspectRatio");
  const count = request.count ?? 1;
  if (count > 1 && !traits.sequential) invalid(model.label + " returns one image per request");
  if (count > MAX_SEQUENTIAL) invalid("Seedream returns at most 15 images per request");
  if (!traits.layers && !request.prompt) fail(P, "INPUT_MISSING", "invalid-request", "Seedream needs a prompt");
  const options = assertKnownOptions(P, request.vendorOptions, OPTIONS);
  const images = referenceUrls(model, request);
  const body: Record<string, unknown> = { model: model.upstreamId };
  if (request.prompt) body.prompt = request.prompt;
  if (images.length > 0) body.image = traits.layers ? images[0] : images;
  const wireSize = size(traits, request);
  if (wireSize) body.size = wireSize;
  if (count > 1) {
    body.sequential_image_generation = "auto";
    body.sequential_image_generation_options = { max_images: count };
  }
  applyOptions(body, traits, options);
  return body;
}

/** Keeps every image that arrived; fails only when none did. */
export function imageOutputs(body: unknown, secrets: readonly string[] = []): MediaOutput[] {
  const response = asRecord(body);
  const created = Number(response.created);
  const expiresAt =
    Number.isFinite(created) && created > 0 ? new Date((created + URL_DAY_SECONDS) * 1000).toISOString() : undefined;
  const outputs: MediaOutput[] = [];
  let firstError: Record<string, unknown> | undefined;
  for (const item of asArray(response.data).map(asRecord)) {
    const url = asString(item.url);
    if (url) outputs.push(urlOutput(url, "image", expiresAt));
    else if (item.error) firstError ??= asRecord(item.error);
  }
  if (outputs.length > 0) return outputs;
  if (firstError)
    throw new MediaAdapterError(
      arkError(
        asString(firstError.code),
        asString(firstError.message) ?? "Image generation failed",
        undefined,
        secrets,
      ),
    );
  return fail(P, "BAD_RESPONSE", "upstream", "Image response had no images");
}
