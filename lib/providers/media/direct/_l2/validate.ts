// Request validation shared by the L2 direct adapters. Unknown vendor options are refused.
import type { MediaModelSpec, MediaSubmitRequest } from "../../contract.js";
import { fail } from "./errors.js";

export function findModel(prefix: string, models: readonly MediaModelSpec[], id: string): MediaModelSpec {
  const model = models.find((m) => m.id === id || m.upstreamId === id);
  return model ?? fail(prefix, "UNKNOWN_MODEL", "invalid-request", `Model "${id}" is not served by this provider`);
}

export function assertTask(prefix: string, model: MediaModelSpec, request: MediaSubmitRequest): void {
  if (!model.tasks.includes(request.task)) {
    fail(prefix, "UNSUPPORTED_TASK", "invalid-request", `${model.id} does not support ${request.task}`);
  }
}

export function assertKnownOptions(
  prefix: string,
  options: Readonly<Record<string, unknown>> | undefined,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!options) return {};
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(prefix, "UNKNOWN_OPTION", "invalid-request", `Unsupported vendorOptions: ${unknown.join(", ")}`);
  }
  return { ...options };
}

export function assertOneOf<T extends string | number>(
  prefix: string,
  field: string,
  value: T | undefined,
  allowed: readonly T[] | undefined,
): void {
  if (value === undefined || !allowed || allowed.length === 0) return;
  if (!allowed.includes(value)) {
    fail(prefix, "INVALID_PARAM", "invalid-request", `${field} ${String(value)} is not one of ${allowed.join(", ")}`);
  }
}

/** Checks duration, resolution and aspect ratio against the model's declared params. */
export function assertParams(prefix: string, model: MediaModelSpec, request: MediaSubmitRequest): void {
  assertOneOf(prefix, "durationSec", request.durationSec, model.params.durationsSec);
  assertOneOf(prefix, "resolution", request.resolution, model.params.resolutions);
  assertOneOf(prefix, "aspectRatio", request.aspectRatio, model.params.aspectRatios);
  if (request.negativePrompt && !model.params.negativePrompt) {
    fail(prefix, "INVALID_PARAM", "invalid-request", `${model.id} does not take a negative prompt`);
  }
  if (request.seed !== undefined && !model.params.seed) {
    fail(prefix, "INVALID_PARAM", "invalid-request", `${model.id} does not take a seed`);
  }
}
