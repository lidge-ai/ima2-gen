/**
 * Request validation shared by the L4 adapters: key presence, model lookup,
 * task support, vendorOptions allow-lists and input selection.
 */
import type {
  MediaAdapterContext, MediaInput, MediaInputRole, MediaModelSpec, MediaSubmitRequest,
} from "../../contract.js";
import { fail } from "./errors.js";

export function requireApiKey(prefix: string, label: string, ctx: MediaAdapterContext): string {
  const key = ctx.apiKey?.trim();
  if (!key) fail(prefix, "API_KEY_MISSING", `${label} API key is not configured`, { category: "auth", status: 401 });
  return key;
}

export function findModel(prefix: string, models: readonly MediaModelSpec[], id: string): MediaModelSpec {
  const model = models.find((candidate) => candidate.id === id);
  if (!model) fail(prefix, "UNKNOWN_MODEL", `Unknown model: ${id}`, { category: "invalid-request" });
  return model;
}

export function requireTask(prefix: string, model: MediaModelSpec, request: MediaSubmitRequest): void {
  if (!model.tasks.includes(request.task)) {
    fail(prefix, "UNSUPPORTED_TASK", `${model.id} does not support ${request.task}`, { category: "invalid-request" });
  }
}

/** vendorOptions keys outside the allow-list are refused, never silently dropped. */
export function readVendorOptions(
  prefix: string, request: MediaSubmitRequest, allowed: readonly string[],
): Record<string, unknown> {
  const options = request.vendorOptions ?? {};
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    fail(prefix, "UNKNOWN_OPTION", `Unsupported vendorOptions: ${unknown.join(", ")}`, { category: "invalid-request" });
  }
  return { ...options };
}

export function requirePrompt(prefix: string, request: MediaSubmitRequest): string {
  const prompt = request.prompt?.trim();
  if (!prompt) fail(prefix, "PROMPT_REQUIRED", "A prompt is required", { category: "invalid-request" });
  return prompt;
}

/**
 * Refuse request fields the model's spec does not advertise. Image adapters
 * never accept duration or audio; the rest follows MediaModelSpec.params.
 */
export function refuseUnsupportedFields(prefix: string, model: MediaModelSpec, request: MediaSubmitRequest): void {
  const { params } = model;
  const refuse = (field: string) => fail(prefix, "UNSUPPORTED_PARAM", `${model.id} does not accept ${field}`, { category: "invalid-request" });
  if (request.durationSec !== undefined && !params.durationsSec?.includes(request.durationSec)) refuse("durationSec");
  if (request.audio !== undefined && !params.nativeAudio) refuse("audio");
  if (request.negativePrompt !== undefined && !params.negativePrompt) refuse("negativePrompt");
  if (request.seed !== undefined && !params.seed) refuse("seed");
  if (request.resolution !== undefined && !params.resolutions?.includes(request.resolution)) refuse(`resolution ${request.resolution}`);
  if (request.quality !== undefined && !params.qualities?.includes(request.quality)) refuse(`quality ${request.quality}`);
  if (request.aspectRatio !== undefined && !params.aspectRatios?.includes(request.aspectRatio)) refuse(`aspectRatio ${request.aspectRatio}`);
  const refs = inputsWithRoles(request, ["reference-image", "source-image"]).length;
  if (refs > (params.maxReferenceImages ?? 0)) refuse(`${refs} input images (max ${params.maxReferenceImages ?? 0})`);
}

export function requireSingleOutput(prefix: string, request: MediaSubmitRequest): void {
  if (request.count !== undefined && request.count !== 1) {
    fail(prefix, "UNSUPPORTED_PARAM", "This endpoint returns one image per request; count must be 1", { category: "invalid-request" });
  }
}

export function inputsWithRoles(request: MediaSubmitRequest, roles: readonly MediaInputRole[]): MediaInput[] {
  return request.inputs.filter((input) => roles.includes(input.role));
}

export function requireOneInput(
  prefix: string, request: MediaSubmitRequest, roles: readonly MediaInputRole[],
): MediaInput {
  const matches = inputsWithRoles(request, roles);
  if (matches.length !== 1 || !matches[0]) {
    fail(prefix, "INPUT_REQUIRED", `Exactly one input with role ${roles.join(" or ")} is required`, { category: "invalid-request" });
  }
  return matches[0];
}

/** Inputs this adapter must inline (multipart or base64) arrive as bytes; a bare URL is refused. */
export function requireBytes(prefix: string, input: MediaInput): Uint8Array {
  if (!input.bytes) {
    fail(prefix, "INPUT_BYTES_REQUIRED", `Input ${input.role} must be provided as bytes`, { category: "invalid-request" });
  }
  return input.bytes;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function toBlob(input: MediaInput, bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: input.mimeType });
}

export function extensionFor(mimeType: string): string {
  const sub = mimeType.split("/")[1]?.split(";")[0]?.trim() ?? "bin";
  return sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub;
}
