/**
 * Error helpers shared by the L4 direct image adapters (bfl, ideogram, recraft,
 * topaz-image, stability). Every thrown error carries a ready MediaProviderError
 * so normalizeError() is lossless and never has to re-parse a message.
 */
import type { MediaProviderError } from "../../contract.js";
import { redactSecrets } from "./redact.js";

export type MediaErrorCategory = MediaProviderError["category"];

export class MediaAdapterError extends Error {
  readonly detail: MediaProviderError;

  constructor(detail: MediaProviderError) {
    super(detail.message);
    this.name = "MediaAdapterError";
    this.detail = detail;
  }
}

const RETRYABLE: ReadonlySet<MediaErrorCategory> = new Set(["rate-limit", "upstream", "timeout"]);

export interface MakeErrorOptions {
  status?: number;
  category?: MediaErrorCategory;
  retryable?: boolean;
  providerState?: string;
}

/** Build a MediaProviderError whose code is "<prefix>_<reason>". */
export function makeError(
  prefix: string, reason: string, message: string, options: MakeErrorOptions = {},
): MediaProviderError {
  const category = options.category ?? (options.status ? categoryForStatus(options.status) : "unknown");
  const detail: MediaProviderError = {
    code: `${prefix}_${reason}`,
    message,
    category,
    retryable: options.retryable ?? RETRYABLE.has(category),
  };
  if (options.status !== undefined) detail.status = options.status;
  if (options.providerState !== undefined) detail.providerState = options.providerState;
  return detail;
}

export function fail(prefix: string, reason: string, message: string, options: MakeErrorOptions = {}): never {
  throw new MediaAdapterError(makeError(prefix, reason, message, options));
}

/**
 * A transport failure from ctx.fetch with known secrets removed from the
 * message. The error class and name survive so normalizeUnknownError still
 * tells a network failure (retryable) from an abort; the original cause is
 * dropped on purpose because it may carry request details.
 */
export function redactedTransportError(error: unknown, secrets: readonly (string | undefined)[]): Error {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
  const copy = error instanceof TypeError ? new TypeError(message) : new Error(message);
  if (error instanceof Error) copy.name = error.name;
  return copy;
}

export function categoryForStatus(status: number): MediaErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 404) return "not-found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (status === 400 || status === 413 || status === 415 || status === 422) return "invalid-request";
  if (status >= 500) return "upstream";
  return "unknown";
}

export function reasonForStatus(status: number): string {
  switch (categoryForStatus(status)) {
    case "auth": return "AUTH";
    case "quota": return "INSUFFICIENT_CREDIT";
    case "not-found": return "NOT_FOUND";
    case "timeout": return "TIMEOUT";
    case "rate-limit": return "RATE_LIMITED";
    case "invalid-request": return "INVALID_REQUEST";
    case "upstream": return "UPSTREAM";
    default: return `HTTP_${status}`;
  }
}

/**
 * Map anything thrown inside an adapter (or by ctx.fetch) to a MediaProviderError.
 * Known secrets are removed from the message.
 */
export function normalizeUnknownError(
  prefix: string, error: unknown, secrets: readonly (string | undefined)[] = [],
): MediaProviderError {
  if (error instanceof MediaAdapterError) {
    return { ...error.detail, message: redactSecrets(error.detail.message, secrets) };
  }
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(raw, secrets);
  if (name === "AbortError") return makeError(prefix, "ABORTED", message || "Request aborted", { retryable: false });
  if (name === "TimeoutError") return makeError(prefix, "TIMEOUT", message || "Request timed out", { category: "timeout" });
  if (error instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|socket/i.test(raw)) {
    return makeError(prefix, "NETWORK", message, { category: "upstream" });
  }
  return makeError(prefix, "UNKNOWN", message || "Unknown error", { retryable: false });
}
