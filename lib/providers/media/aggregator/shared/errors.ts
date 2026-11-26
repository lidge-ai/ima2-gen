/**
 * Error vocabulary shared by the aggregator adapters (fal, Replicate, Sume, Atlas Cloud).
 *
 * Each adapter keeps its own prefix ("FAL_", "REPLICATE_") and may refine the
 * reason from the vendor body, but the HTTP status to category mapping and the
 * thrown error type are the same everywhere, so normalizeError behaves alike.
 */
import type { MediaProviderError } from "../../contract.js";

export type ErrorCategory = MediaProviderError["category"];

/** Thrown by adapters for any vendor or local failure; normalizeError unwraps it. */
export class MediaAdapterError extends Error {
  readonly detail: MediaProviderError;

  constructor(detail: MediaProviderError) {
    super(detail.message);
    this.name = "MediaAdapterError";
    this.detail = detail;
  }
}

const REASON_BY_CATEGORY: Record<ErrorCategory, string> = {
  auth: "AUTH",
  quota: "INSUFFICIENT_CREDIT",
  "rate-limit": "RATE_LIMITED",
  "invalid-request": "INVALID_REQUEST",
  moderation: "CONTENT_POLICY",
  "not-found": "NOT_FOUND",
  upstream: "UPSTREAM",
  timeout: "TIMEOUT",
  unknown: "UNKNOWN",
};

const RETRYABLE: ReadonlySet<ErrorCategory> = new Set(["rate-limit", "upstream", "timeout"]);

/** Maps an HTTP status to the normalized category. */
export function categoryForStatus(status: number | undefined): ErrorCategory {
  if (status === undefined) return "unknown";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 404 || status === 410) return "not-found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (status === 400 || status === 409 || status === 413 || status === 415 || status === 422) return "invalid-request";
  if (status >= 500) return "upstream";
  return "unknown";
}

export interface ErrorInit {
  prefix: string;
  category: ErrorCategory;
  message: string;
  status?: number | undefined;
  /** Overrides the default reason for the category, e.g. "MODEL_UNSUPPORTED". */
  reason?: string | undefined;
  retryable?: boolean | undefined;
  providerState?: string | undefined;
}

export function buildError(init: ErrorInit): MediaProviderError {
  const reason = init.reason ?? REASON_BY_CATEGORY[init.category];
  return {
    code: `${init.prefix}${reason}`,
    message: init.message,
    ...(init.status === undefined ? {} : { status: init.status }),
    retryable: init.retryable ?? RETRYABLE.has(init.category),
    category: init.category,
    ...(init.providerState === undefined ? {} : { providerState: init.providerState }),
  };
}

export function adapterError(init: ErrorInit): MediaAdapterError {
  return new MediaAdapterError(buildError(init));
}

export function invalidRequest(prefix: string, message: string, reason?: string): MediaAdapterError {
  return adapterError({ prefix, category: "invalid-request", message, reason });
}

function isAbort(error: unknown): error is Error {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Turns anything an adapter call can throw into the contract error. Unknown
 * values never leak their structure: only an Error message survives.
 */
export function normalizeAdapterError(prefix: string, error: unknown): MediaProviderError {
  if (error instanceof MediaAdapterError) return error.detail;
  if (isAbort(error)) {
    const timeout = error.name === "TimeoutError";
    return buildError({
      prefix, category: timeout ? "timeout" : "unknown", reason: timeout ? "TIMEOUT" : "ABORTED",
      message: timeout ? "Request timed out" : "Request was aborted", retryable: timeout,
    });
  }
  if (error instanceof TypeError) {
    // fetch() rejects with TypeError for DNS, TLS and connection failures.
    return buildError({ prefix, category: "upstream", reason: "NETWORK", message: `Network error: ${error.message}`, retryable: true });
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Request failed";
  return buildError({ prefix, category: "unknown", message, retryable: false });
}
