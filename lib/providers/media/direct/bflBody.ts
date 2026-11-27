/**
 * Request bodies for the BFL families. Field names follow
 * https://api.bfl.ai/openapi.json (FluxKontextProInputs, Flux2Inputs,
 * Flux2FlexInputs, Flux3ImageInputs, Flux3ImageKleinInputs).
 */
import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import {
  inputsWithRoles, readVendorOptions, refuseUnsupportedFields, requirePrompt, requireSingleOutput, requireTask, toBase64,
} from "./_l4kit/request.js";
import { BFL_FAMILY, type BflFamily } from "./bflModels.js";

const PREFIX = "BFL";

const VENDOR_OPTIONS: Readonly<Record<BflFamily, readonly string[]>> = {
  kontext: ["output_format", "safety_tolerance", "prompt_upsampling"],
  flux2: ["output_format", "safety_tolerance", "disable_pup", "width", "height"],
  "flux2-flex": ["output_format", "safety_tolerance", "prompt_upsampling", "guidance", "steps", "width", "height"],
  flux3: ["safety_tolerance", "grounding", "width", "height"],
  "flux3-klein": ["output_format", "safety_tolerance", "steps", "width", "height"],
};

/** Default output format per family when the request does not set one; flux3 publishes none. */
const DEFAULT_FORMAT: Readonly<Record<BflFamily, string | undefined>> = {
  kontext: "png", flux2: "jpeg", "flux2-flex": "jpeg", flux3: undefined, "flux3-klein": "jpeg",
};

/** FLUX.2 takes width/height, not a ratio: sizes near 1 MP, multiples of 16, so the first-MP price applies. */
export const FLUX2_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  "21:9": [1536, 640], "16:9": [1344, 768], "3:2": [1216, 832], "4:3": [1152, 864], "1:1": [1024, 1024],
  "3:4": [864, 1152], "2:3": [832, 1216], "9:16": [768, 1344], "9:21": [640, 1536],
};

export interface BflBody { family: BflFamily; body: Record<string, unknown>; outputFormat: string | undefined }

function familyOf(model: MediaModelSpec): BflFamily {
  const family = BFL_FAMILY.get(model.upstreamId);
  if (!family) fail(PREFIX, "UNKNOWN_MODEL", `No request family for ${model.upstreamId}`, { category: "invalid-request" });
  return family;
}

function encode(input: MediaInput): string {
  return input.bytes ? toBase64(input.bytes) : input.url ?? "";
}

function checkInputs(request: MediaSubmitRequest, images: readonly MediaInput[]): void {
  // Anything else (a mask) was dropped without a word before; a job must not run as a different one.
  const other = request.inputs.find((input) => !images.includes(input));
  if (other) fail(PREFIX, "UNSUPPORTED_INPUT", "This model takes images only; a " + other.role + " input is not supported", { category: "invalid-request" });
  if (request.task === "image-to-image" && images.length === 0) {
    fail(PREFIX, "INPUT_REQUIRED", "image-to-image needs a source image", { category: "invalid-request" });
  }
  if (request.task === "text-to-image" && images.length > 0) {
    fail(PREFIX, "UNEXPECTED_INPUT", "text-to-image takes no input image; use image-to-image", { category: "invalid-request" });
  }
}

function placeImages(family: BflFamily, body: Record<string, unknown>, images: readonly MediaInput[]): void {
  if (images.length === 0) return;
  if (family === "flux3" || family === "flux3-klein") {
    body["images"] = images.map(encode);
    return;
  }
  images.forEach((input, index) => { body[index === 0 ? "input_image" : `input_image_${index + 1}`] = encode(input); });
}

function placeShape(family: BflFamily, body: Record<string, unknown>, request: MediaSubmitRequest): void {
  if (family === "flux2" || family === "flux2-flex") {
    const size = request.aspectRatio ? FLUX2_SIZES[request.aspectRatio] : undefined;
    if (size && body["width"] === undefined && body["height"] === undefined) [body["width"], body["height"]] = size;
  } else if (request.aspectRatio) {
    body["aspect_ratio"] = request.aspectRatio;
  }
  if (request.resolution) body["resolution"] = request.resolution;
  if (request.seed !== undefined) body["seed"] = request.seed;
}

export function buildBflBody(model: MediaModelSpec, request: MediaSubmitRequest): BflBody {
  requireTask(PREFIX, model, request);
  refuseUnsupportedFields(PREFIX, model, request);
  requireSingleOutput(PREFIX, request);
  const family = familyOf(model);
  const body: Record<string, unknown> = {
    prompt: requirePrompt(PREFIX, request),
    ...readVendorOptions(PREFIX, request, VENDOR_OPTIONS[family]),
  };
  const images = inputsWithRoles(request, ["source-image", "reference-image"]);
  checkInputs(request, images);
  placeImages(family, body, images);
  placeShape(family, body, request);
  const requested = typeof body["output_format"] === "string" ? body["output_format"] : undefined;
  return { family, body, outputFormat: requested ?? DEFAULT_FORMAT[family] };
}
