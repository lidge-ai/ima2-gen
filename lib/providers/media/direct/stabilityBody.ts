import type { MediaModelSpec, MediaSubmitRequest } from "../contract.js";
import { fail } from "./_l4kit/errors.js";
import { extensionFor, readVendorOptions, refuseUnsupportedFields, requireBytes, requireOneInput, requirePrompt, requireSingleOutput, requireTask, toBlob } from "./_l4kit/request.js";

const PREFIX = "STABILITY";
const STYLES = ["enhance", "anime", "photographic", "digital-art", "comic-book", "fantasy-art", "line-art", "analog-film", "neon-punk", "isometric", "low-poly", "origami", "modeling-compound", "cinematic", "3d-model", "pixel-art", "tile-texture"];
function option(form: FormData, key: string, value: unknown, allowed: readonly string[] | [number, number], integer = false): void {
  if (value === undefined) return;
  const valid = typeof allowed[0] === "number"
    ? typeof value === "number" && Number.isFinite(value) && value >= (allowed[0] as number) && value <= (allowed[1] as number) && (!integer || Number.isInteger(value))
    : typeof value === "string" && (allowed as readonly string[]).includes(value);
  if (!valid) fail(PREFIX, "INVALID_OPTION", `Invalid ${key}`, { category: "invalid-request" });
  form.set(key, String(value));
}
function endpoint(model: MediaModelSpec): string {
  const id = model.id.split("/")[1];
  if (id === "stable-audio-3") return "/v2beta/audio/stable-audio/text-to-audio";
  if (id === "stable-audio-2.5") return "/v2beta/audio/stable-audio-2/text-to-audio";
  if (id === "sd3.5-large") return "/v2beta/stable-image/generate/sd3";
  if (id?.startsWith("upscale-")) return `/v2beta/stable-image/upscale/${model.upstreamId}`;
  return `/v2beta/stable-image/generate/${model.upstreamId}`;
}
function putInput(form: FormData, request: MediaSubmitRequest): void {
  const input = requireOneInput(PREFIX, request, ["source-image", "reference-image"]);
  const bytes = requireBytes(PREFIX, input);
  form.set("image", toBlob(input, bytes), `input.${extensionFor(input.mimeType)}`);
}
function validateInputs(request: MediaSubmitRequest): boolean {
  const needsImage = request.task === "image-to-image" || request.task === "image-upscale";
  if ((!needsImage && request.inputs.length) || (needsImage && request.inputs.length !== 1)) {
    fail(PREFIX, "UNEXPECTED_INPUT", "Unexpected input count or role", { category: "invalid-request" });
  }
  return needsImage;
}
function optionsFor(id: string): string[] {
  if (id.startsWith("stable-audio")) return ["output_format", "steps", "cfg_scale"];
  if (id === "upscale-fast") return ["output_format"];
  const options = ["output_format", "style_preset"];
  if (id === "sd3.5-large") options.push("strength", "cfg_scale");
  if (id === "stable-image-ultra") options.push("strength");
  if (id === "upscale-creative") options.push("creativity");
  return options;
}
function fillOptions(form: FormData, options: Record<string, unknown>, audio: boolean): string {
  option(form, "output_format", options["output_format"], audio ? ["mp3", "wav"] : ["png", "jpeg", "webp"]);
  option(form, "style_preset", options["style_preset"], STYLES);
  option(form, "strength", options["strength"], [0, 1]);
  option(form, "creativity", options["creativity"], [0.1, 0.5]);
  option(form, "steps", options["steps"], [4, 8], true);
  option(form, "cfg_scale", options["cfg_scale"], audio ? [1, 25] : [1, 10]);
  return typeof options["output_format"] === "string" ? options["output_format"] : audio ? "mp3" : "png";
}
export function buildStabilityBody(model: MediaModelSpec, request: MediaSubmitRequest): { body: FormData; path: string; format: string; async: boolean } {
  requireTask(PREFIX, model, request); refuseUnsupportedFields(PREFIX, model, request); requireSingleOutput(PREFIX, request);
  const id = model.id.split("/")[1] ?? "";
  const options = readVendorOptions(PREFIX, request, optionsFor(id));
  const hasImage = validateInputs(request);
  const form = new FormData();
  if (hasImage) putInput(form, request);
  if (id !== "upscale-fast") form.set("prompt", requirePrompt(PREFIX, request));
  else if (request.prompt !== undefined) fail(PREFIX, "UNSUPPORTED_PARAM", "Fast upscale does not accept a prompt", { category: "invalid-request" });
  if (request.task === "image-to-image" && options["strength"] === undefined) fail(PREFIX, "STRENGTH_REQUIRED", "Image-to-image requires strength", { category: "invalid-request" });
  if (request.task !== "image-to-image" && options["strength"] !== undefined) fail(PREFIX, "UNSUPPORTED_PARAM", "strength requires image-to-image", { category: "invalid-request" });
  if (id === "sd3.5-large" && hasImage && request.aspectRatio !== undefined) fail(PREFIX, "UNSUPPORTED_PARAM", "SD3 image-to-image does not accept aspect ratio", { category: "invalid-request" });
  if (id === "sd3.5-large") { form.set("model", model.upstreamId); form.set("mode", request.task); }
  if (id.startsWith("stable-audio")) form.set("model", model.upstreamId);
  if (request.negativePrompt !== undefined) form.set("negative_prompt", request.negativePrompt);
  if (request.aspectRatio !== undefined) form.set("aspect_ratio", request.aspectRatio);
  if (request.durationSec !== undefined) form.set("duration", String(request.durationSec));
  if (request.seed !== undefined) option(form, "seed", request.seed, [0, 4294967294], true);
  const format = fillOptions(form, options, model.kind === "audio");
  return { body: form, path: endpoint(model), format, async: id === "stable-audio-3" || id === "upscale-creative" };
}
