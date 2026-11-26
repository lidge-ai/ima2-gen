import type { MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import { readVendorOptions, refuseUnsupportedFields, requireOneInput, requireSingleOutput, requireTask, toBlob } from "./_l4kit/request.js";

const PREFIX = "TOPAZ_IMAGE";
const PRECISION = ["Standard", "Standard V2", "Low Resolution", "Low Resolution V2", "CGI", "High Fidelity", "High Fidelity V2", "Upscale High Fidelity V3", "Text Refine"];
const CREATIVE = ["Bloom", "Bloom Realism", "Bloom 2", "Recover", "Recovery V2", "Recover 3", "Redefine", "Standard MAX", "Wonder", "Wonder 2", "Wonder 3", "Wonder 3.5", "Wonder 4", "Detail"];
const COMMON = ["model", "output_width", "output_height", "output_format", "crop_to_fill"];
const STANDARD_FIELDS = ["deblur_strength", "decompression_strength", "denoise_strength", "opacity"];
const CAMEL_FIELDS = ["deblurStrength", "decompressionStrength", "denoiseStrength", "opacity"];

function reject(message: string): never { return fail(PREFIX, "INVALID_REQUEST", message, { category: "invalid-request" }); }
function modelFields(model: string): readonly string[] {
  if (model === "Redefine") return ["autoprompt", "creativity", "creativityBoost", "detailLevel", "prompt", "seed", "texture"];
  if (model === "Standard V2") return STANDARD_FIELDS;
  if (["High Fidelity V2", "Low Resolution V2", "Text Refine"].includes(model)) return CAMEL_FIELDS;
  if (model === "CGI") return ["deblurStrength", "denoiseStrength", "opacity"];
  if (model === "Upscale High Fidelity V3") return ["opacity", "recoveryStrength"];
  return [];
}

function validateOption(key: string, value: unknown): void {
  if (key === "model") return;
  if (["autoprompt", "creativityBoost"].includes(key)) {
    if (typeof value !== "boolean") reject(`Invalid ${key}`);
    return;
  }
  if (key === "prompt") { if (typeof value !== "string") reject(`Invalid ${key}`); return; }
  if (["creativity", "detailLevel", "texture", "seed"].includes(key)) {
    const max = key === "creativity" ? 6 : key === "seed" ? Number.MAX_SAFE_INTEGER : 5;
    if (!Number.isSafeInteger(value) || (value as number) < (key === "seed" ? 0 : 1) || (value as number) > max) reject(`Invalid ${key}`);
    return;
  }
  if (key === "output_width" || key === "output_height") {
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 32000) reject(`Invalid ${key}`);
  } else if (key === "crop_to_fill") {
    if (typeof value !== "boolean") reject(`Invalid ${key}`);
  } else if (key === "output_format") {
    if (typeof value !== "string" || !["jpeg", "jpg", "png", "tiff", "tif"].includes(value)) reject(`Invalid ${key}`);
  } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) reject(`Invalid ${key}`);
}

export function buildBody(model: MediaModelSpec, request: MediaSubmitRequest): FormData {
  requireTask(PREFIX, model, request); refuseUnsupportedFields(PREFIX, model, request); requireSingleOutput(PREFIX, request);
  if (request.prompt !== undefined) reject("prompt is not supported; model-specific options must be explicitly supported");
  if (request.inputs.length !== 1) reject("Exactly one input is required");
  const input = requireOneInput(PREFIX, request, ["source-image", "reference-image"]);
  if (Boolean(input.url) === Boolean(input.bytes)) reject("Exactly one URL or byte input is required");
  if (input.url) {
    let url: URL;
    try { url = new URL(input.url); } catch { return reject("Invalid source URL"); }
    if (!["http:", "https:"].includes(url.protocol)) reject("Invalid source URL");
  }
  const creative = model.id.endsWith("-creative");
  const selected = request.vendorOptions?.["model"] ?? model.upstreamId;
  if (typeof selected !== "string" || !(creative ? CREATIVE : PRECISION).includes(selected)) reject("Unsupported Topaz model for endpoint");
  const options = readVendorOptions(PREFIX, request, [...COMMON, ...modelFields(selected)]);
  const form = new FormData();
  if (input.url) form.set("source_url", input.url);
  else if (input.bytes) {
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/tiff": "tiff" };
    const ext = extensions[input.mimeType]; if (!ext) reject("Unsupported input image type");
    form.set("image", toBlob(input, input.bytes), `input.${ext}`);
  }
  form.set("model", selected);
  for (const [key, value] of Object.entries(options)) {
    validateOption(key, value); if (key !== "model") form.set(key, String(value));
  }
  return form;
}
