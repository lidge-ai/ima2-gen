import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import { extensionFor, readVendorOptions, refuseUnsupportedFields, requireBytes, requirePrompt, requireTask, toBlob } from "./_l4kit/request.js";

const P = "IDEOGRAM";
function invalid(message: string): never { return fail(P, "UNSUPPORTED_PARAM", message, { category: "invalid-request" }); }
function file(form: FormData, name: string, input: MediaInput): void {
  form.append(name, toBlob(input, requireBytes(P, input)), `input.${extensionFor(input.mimeType)}`);
}
function optionFields(form: FormData, request: MediaSubmitRequest, allowed: readonly string[]): void {
  const values = readVendorOptions(P, request, allowed);
  const enums: Record<string, readonly string[]> = { rendering_speed: ["turbo", "default", "quality"], quality: ["very_low", "low", "medium", "high"], magic_prompt: ["auto", "on", "off"], style_type: ["auto", "general", "realistic", "design"], mode: ["auto", "simple", "detailed"] };
  for (const [key, value] of Object.entries(values)) {
    if (enums[key] && (typeof value !== "string" || !enums[key].includes(value))) invalid(`Invalid ${key}`);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") invalid(`Invalid ${key}`);
    form.append(key, String(value));
  }
}
function appendInputs(form: FormData, request: MediaSubmitRequest, route: string): void {
  const images = request.inputs.filter((i) => i.role === "source-image" || i.role === "reference-image");
  const masks = request.inputs.filter((i) => i.role === "mask");
  if (images.length + masks.length !== request.inputs.length || masks.length > 1) invalid("Unsupported inputs");
  if (request.task === "text-to-image" && (images.length || masks.length)) invalid("Text generation cannot include inputs");
  if (request.task !== "text-to-image" && !images.length) invalid("Source image required");
  if (masks.length && request.task !== "image-to-image") invalid("Mask requires an image edit");
  if (route.includes("precise-edit") && images.length > 5) invalid("Too many images");
  for (const [index, image] of images.entries()) file(form, route.includes("generate/ideogram-4-5") ? "images" : index ? "reference_images" : "image", image);
  if (masks[0]) file(form, "mask", masks[0]);
}
export function buildIdeogramBody(model: MediaModelSpec, request: MediaSubmitRequest): { path: string; form: FormData; mimeType: string } {
  requireTask(P, model, request);
  refuseUnsupportedFields(P, model, request);
  const v3 = model.upstreamId === "ideogram-3";
  const vector = request.task === "image-vectorize";
  if (vector && request.prompt !== undefined) invalid("Vectorization does not accept a prompt");
  const masked = request.inputs.some((input) => input.role === "mask");
  const operation = vector ? "svg/vectorize" : v3 && request.task === "image-to-image" ? `image/${masked ? "inpaint" : "remix"}` : masked ? "image/precise-edit" : "image/generate";
  const path = `${operation}/${model.upstreamId}`;
  const form = new FormData();
  if (!vector) { form.set("prompt", requirePrompt(P, request)); form.set("async", "true"); }
  if (request.count !== undefined) {
    if (vector || !Number.isInteger(request.count) || request.count < 1 || request.count > 8) invalid("Invalid count");
    form.set("num_images", String(request.count));
  }
  if (request.seed !== undefined) {
    if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 2147483647) invalid("Invalid seed");
    form.set("seed", String(request.seed));
  }
  if (masked && (request.aspectRatio !== undefined || request.negativePrompt !== undefined)) invalid("Mask endpoint does not support aspect ratio or negative prompt");
  if (request.aspectRatio !== undefined) form.set("aspect_ratio", request.aspectRatio.replace(":", "x"));
  if (request.negativePrompt !== undefined) form.set("negative_prompt", request.negativePrompt);
  appendInputs(form, request, path);
  const allowed = optionNames(vector, v3, masked, request.task === "image-to-image");
  optionFields(form, request, allowed);
  const weight = form.get("image_weight");
  if (weight !== null && !/^(?:[1-9]\d?|100)$/.test(String(weight))) invalid("image_weight must be an integer from 1 to 100");
  if (!v3 && !vector && !request.inputs.length && form.get("quality") === "very_low") invalid("very_low requires source images");
  return { path, form, mimeType: vector ? "image/svg+xml" : "application/octet-stream" };
}

/** vendorOptions per route, from the v2 OpenAPI request schemas. */
function optionNames(vector: boolean, v3: boolean, masked: boolean, edit: boolean): readonly string[] {
  if (vector) return ["mode", "shape_density", "color_variety", "use_gradient", "private"];
  if (v3) return edit && !masked ? ["rendering_speed", "magic_prompt", "style_type", "image_weight"] : ["rendering_speed", "magic_prompt", "style_type"];
  return masked ? ["quality", "context_window"] : ["quality", "magic_prompt", "background"];
}
