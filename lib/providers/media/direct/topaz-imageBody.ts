/**
 * Multipart body for Topaz image enhancement. Model names and per-model
 * fields follow the model pages under developer.topazlabs.com/image-models
 * (the endpoint OpenAPI enums are older and incomplete).
 */
import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import {
  readVendorOptions, refuseUnsupportedFields, requireOneInput, requireSingleOutput, requireTask, toBlob,
} from "./_l4kit/request.js";

const PREFIX = "TOPAZ_IMAGE";
const PRECISION = ["Standard", "Standard V2", "Low Resolution", "Low Resolution V2", "CGI", "High Fidelity", "High Fidelity V2", "Upscale High Fidelity V3", "Text Refine"];
const CREATIVE = ["Bloom", "Bloom Realism", "Bloom 2", "Recover", "Recovery V2", "Recover 3", "Redefine", "Standard MAX", "Wonder", "Wonder 2", "Wonder 3", "Wonder 3.5", "Wonder 4", "Detail"];
const COMMON = ["model", "output_width", "output_height", "output_format", "crop_to_fill"];
const STANDARD_FIELDS = ["deblur_strength", "decompression_strength", "denoise_strength", "opacity"];
const CAMEL_FIELDS = ["deblurStrength", "decompressionStrength", "denoiseStrength", "opacity"];
const REDEFINE_FIELDS = ["autoprompt", "creativity", "creativityBoost", "detailLevel", "seed", "texture"];
const INPUT_EXTENSIONS: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/tiff": "tiff" };
const OUTPUT_FORMATS = ["jpeg", "jpg", "png", "tiff", "tif"];

function reject(message: string): never {
  return fail(PREFIX, "INVALID_REQUEST", message, { category: "invalid-request" });
}

function modelFields(model: string): readonly string[] {
  if (model === "Redefine") return REDEFINE_FIELDS;
  if (model === "Standard V2") return STANDARD_FIELDS;
  if (["High Fidelity V2", "Low Resolution V2", "Text Refine"].includes(model)) return CAMEL_FIELDS;
  if (model === "CGI") return ["deblurStrength", "denoiseStrength", "opacity"];
  if (model === "Upscale High Fidelity V3") return ["opacity", "recoveryStrength"];
  return [];
}

function checkInteger(key: string, value: unknown, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) reject(`Invalid ${key}`);
}

function validateOption(key: string, value: unknown): void {
  switch (key) {
    case "model": return;
    case "autoprompt":
    case "creativityBoost":
    case "crop_to_fill":
      if (typeof value !== "boolean") reject(`Invalid ${key}`);
      return;
    case "creativity": return checkInteger(key, value, 1, 6);
    case "detailLevel":
    case "texture": return checkInteger(key, value, 1, 5);
    case "seed": return checkInteger(key, value, 0, Number.MAX_SAFE_INTEGER);
    case "output_width":
    case "output_height": return checkInteger(key, value, 1, 32000);
    case "output_format":
      if (typeof value !== "string" || !OUTPUT_FORMATS.includes(value)) reject(`Invalid ${key}`);
      return;
    default:
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) reject(`Invalid ${key}`);
  }
}

function readInput(request: MediaSubmitRequest): MediaInput {
  if (request.inputs.length !== 1) reject("Exactly one input is required");
  const input = requireOneInput(PREFIX, request, ["source-image", "reference-image"]);
  if (Boolean(input.url) === Boolean(input.bytes)) reject("Exactly one URL or byte input is required");
  if (input.url) {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return reject("Invalid source URL");
    }
    if (url.protocol !== "https:") reject("Source URL must be https");
  }
  return input;
}

function selectModel(model: MediaModelSpec, request: MediaSubmitRequest): string {
  const selected = request.vendorOptions?.["model"] ?? model.upstreamId;
  const allowed = model.id.endsWith("-creative") ? CREATIVE : PRECISION;
  if (typeof selected !== "string" || !allowed.includes(selected)) reject("Unsupported Topaz model for endpoint");
  return selected;
}

function placeInput(form: FormData, input: MediaInput): void {
  if (input.url) {
    form.set("source_url", input.url);
    return;
  }
  const ext = INPUT_EXTENSIONS[input.mimeType];
  if (!ext || !input.bytes) reject("Unsupported input image type (jpeg, png or tiff)");
  form.set("image", toBlob(input, input.bytes), `input.${ext}`);
}

export function buildBody(model: MediaModelSpec, request: MediaSubmitRequest): FormData {
  requireTask(PREFIX, model, request);
  refuseUnsupportedFields(PREFIX, model, request);
  requireSingleOutput(PREFIX, request);
  const input = readInput(request);
  const selected = selectModel(model, request);
  // Only Redefine documents a prompt; elsewhere a prompt would be silently ignored, so it is refused.
  if (request.prompt !== undefined && selected !== "Redefine") reject(`${selected} does not take a prompt`);
  const options = readVendorOptions(PREFIX, request, [...COMMON, ...modelFields(selected)]);
  const form = new FormData();
  placeInput(form, input);
  form.set("model", selected);
  if (request.prompt !== undefined) form.set("prompt", request.prompt);
  for (const [key, value] of Object.entries(options)) {
    validateOption(key, value);
    if (key !== "model") form.set(key, String(value));
  }
  return form;
}
