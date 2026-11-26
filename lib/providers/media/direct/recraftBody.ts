import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import { readVendorOptions, refuseUnsupportedFields, requireOneInput, requirePrompt, requireSingleOutput, requireTask, toBase64 } from "./_l4kit/request.js";

const PREFIX = "RECRAFT";
function invalid(message: string): never { return fail(PREFIX, "INVALID_OPTION", message, { category: "invalid-request" }); }
function imageValue(input: MediaInput): string {
  if (input.url && !input.bytes) return input.url;
  if (input.bytes && !input.url && input.mimeType) return `data:${input.mimeType};base64,${toBase64(input.bytes)}`;
  return fail(PREFIX, "INPUT_REQUIRED", "Provide exactly one image URL or byte input", { category: "invalid-request" });
}
function validateInputs(request: MediaSubmitRequest): void {
  const expected = request.task === "text-to-image" ? 0 : 1;
  if (request.inputs.some((input) => input.role !== "source-image" && input.role !== "reference-image") || (expected === 0 && request.inputs.length)) {
    fail(PREFIX, "UNEXPECTED_INPUT", "Unexpected input for this task", { category: "invalid-request" });
  }
}
function generationBody(model: MediaModelSpec, request: MediaSubmitRequest): Record<string, unknown> {
  const edit = request.task === "image-to-image";
  const options = readVendorOptions(PREFIX, request, edit ? ["strength", "image_format", "zdr"] : ["image_format", "zdr"]);
  if (options["image_format"] !== undefined && !["png", "webp"].includes(String(options["image_format"]))) invalid("Invalid image_format");
  if (options["zdr"] !== undefined && typeof options["zdr"] !== "boolean") invalid("Invalid zdr");
  if (request.count !== undefined && (!Number.isInteger(request.count) || request.count < 1 || request.count > 6)) fail(PREFIX, "UNSUPPORTED_PARAM", "count must be 1–6", { category: "invalid-request" });
  if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff)) invalid("random_seed must be a uint32");
  if (edit && request.aspectRatio !== undefined) fail(PREFIX, "UNSUPPORTED_PARAM", "imageToImage has no size field", { category: "invalid-request" });
  const body: Record<string, unknown> = { model: model.upstreamId, prompt: requirePrompt(PREFIX, request), response_format: "url" };
  if (request.count !== undefined) body["n"] = request.count;
  if (request.seed !== undefined) body["random_seed"] = request.seed;
  if (request.aspectRatio !== undefined) body["size"] = request.aspectRatio;
  if (edit) {
    const strength = options["strength"];
    if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 1) invalid("strength must be between 0 and 1");
    body["image_url"] = imageValue(requireOneInput(PREFIX, request, ["source-image", "reference-image"]));
  }
  return { ...body, ...options };
}
function utilityBody(model: MediaModelSpec, request: MediaSubmitRequest): Record<string, unknown> {
  requireSingleOutput(PREFIX, request);
  if (request.prompt !== undefined) fail(PREFIX, "UNSUPPORTED_PARAM", "This utility does not accept prompt", { category: "invalid-request" });
  const vector = model.upstreamId === "vectorize";
  const options = readVendorOptions(PREFIX, request, vector ? ["shape_stacking", "zdr"] : ["upscale", "image_format", "zdr"]);
  if (options["shape_stacking"] !== undefined && !["hierarchical", "cut_out"].includes(String(options["shape_stacking"]))) invalid("Invalid shape_stacking");
  if (options["upscale"] !== undefined && !["upscale4mp", "upscale16mp"].includes(String(options["upscale"]))) invalid("Invalid upscale");
  if (options["image_format"] !== undefined && !["webp", "png"].includes(String(options["image_format"]))) invalid("Invalid image_format");
  if (options["zdr"] !== undefined && typeof options["zdr"] !== "boolean") invalid("Invalid zdr");
  return { image_url: imageValue(requireOneInput(PREFIX, request, ["source-image", "reference-image"])), response_format: "url", ...options };
}
export function buildRecraftBody(model: MediaModelSpec, request: MediaSubmitRequest): Record<string, unknown> {
  requireTask(PREFIX, model, request);
  refuseUnsupportedFields(PREFIX, model, request);
  validateInputs(request);
  return request.task === "text-to-image" || request.task === "image-to-image" ? generationBody(model, request) : utilityBody(model, request);
}
