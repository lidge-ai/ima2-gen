/**
 * Builds the OpenRouter POST /api/v1/videos body. Frames and references are
 * typed content parts, so this does not use the flat schema mapper; the
 * capability lists from the video catalog decide what is accepted.
 */
import type { MediaInput, MediaSubmitRequest } from "../../contract.js";
import { invalidRequest } from "../shared/errors.js";
import { inputToUrl } from "../shared/inputs.js";
import type { OpenRouterCatalogEntry } from "./types.js";

const PREFIX = "OPENROUTER_";

function refuse(message: string, reason = "UNSUPPORTED_OPTION"): never {
  throw invalidRequest(PREFIX, message, reason);
}

function checkListed(name: string, value: string | number, allowed: readonly (string | number)[]): void {
  if (allowed.length > 0 && !allowed.map(String).includes(String(value))) refuse(`${name} ${String(value)} is not offered (allowed: ${allowed.join(", ")})`);
}

function scalars(model: OpenRouterCatalogEntry, request: MediaSubmitRequest, body: Record<string, unknown>): void {
  if (request.negativePrompt) refuse("OpenRouter video does not take negativePrompt");
  if (request.count !== undefined && request.count !== 1) refuse("OpenRouter video returns one video per job");
  if (request.vendorOptions && Object.keys(request.vendorOptions).length > 0) refuse(`Unsupported vendorOptions: ${Object.keys(request.vendorOptions).join(", ")}`);
  if (request.prompt?.trim()) body.prompt = request.prompt.trim();
  if (request.durationSec !== undefined) {
    if (!(request.durationSec === -1 && model.allowAutoDuration)) checkListed("duration", request.durationSec, model.durations);
    body.duration = request.durationSec;
  }
  if (request.resolution) {
    checkListed("resolution", request.resolution, model.resolutions);
    body.resolution = request.resolution;
  }
  if (request.aspectRatio) {
    checkListed("aspect_ratio", request.aspectRatio, model.aspectRatios);
    body.aspect_ratio = request.aspectRatio;
  }
  if (request.seed !== undefined) {
    if (!model.seed) refuse(`${model.upstream} does not take a seed`);
    body.seed = request.seed;
  }
  if (request.audio !== undefined) {
    if (request.audio && !model.audio) refuse(`${model.upstream} does not generate audio`);
    if (model.audio) body.generate_audio = request.audio;
  }
}

const REFERENCE_TYPE: Partial<Record<MediaInput["role"], "image_url" | "video_url" | "audio_url">> = {
  "reference-image": "image_url", "reference-video": "video_url", "reference-audio": "audio_url",
  "source-image": "image_url", "source-video": "video_url", "source-audio": "audio_url",
};

function inputs(model: OpenRouterCatalogEntry, request: MediaSubmitRequest, body: Record<string, unknown>): void {
  const frames: unknown[] = [];
  const references: unknown[] = [];
  for (const input of request.inputs) {
    const url = inputToUrl(PREFIX, input);
    if (input.role === "first-frame" || input.role === "last-frame") {
      const frameType = input.role === "first-frame" ? "first_frame" : "last_frame";
      if (!model.frames.includes(frameType)) refuse(`${model.upstream} does not take a ${input.role}`, "UNSUPPORTED_INPUT");
      frames.push({ type: "image_url", image_url: { url }, frame_type: frameType });
      continue;
    }
    const type = REFERENCE_TYPE[input.role];
    if (!type || !(model.tasks.includes("reference-to-video") || model.tasks.includes("avatar"))) {
      refuse(`${model.upstream} does not take a ${input.role} input`, "UNSUPPORTED_INPUT");
    }
    references.push({ type, [type]: { url } });
  }
  if (frames.length > 0) body.frame_images = frames;
  if (references.length > 0) body.input_references = references;
}

export function buildVideoBody(model: OpenRouterCatalogEntry, request: MediaSubmitRequest): Record<string, unknown> {
  if (!model.tasks.includes(request.task)) refuse(`Model ${model.id} does not support ${request.task} on OpenRouter`, "TASK_UNSUPPORTED");
  const body: Record<string, unknown> = { model: model.upstream };
  scalars(model, request, body);
  inputs(model, request, body);
  if (request.task === "image-to-video" && !Array.isArray(body.frame_images)) refuse("image-to-video needs a first-frame input", "MISSING_INPUT");
  if (body.prompt === undefined && request.task !== "image-to-video" && request.task !== "avatar") refuse("A prompt is required", "PROMPT_REQUIRED");
  return body;
}
