// Shared error helpers for the L2 direct adapters (byteplus, kling, alibaba,
// tencent, vidu, minimax, pixverse). Adapters throw MediaAdapterError with a
// finished MediaProviderError so normalizeError can return it unchanged.
import type { MediaAdapterContext, MediaProviderError } from "../../contract.js";

export type ErrorCategory = MediaProviderError["category"];

export class MediaAdapterError extends Error {
  readonly detail: MediaProviderError;
  constructor(detail: MediaProviderError) {
    super(detail.message);
    this.name = "MediaAdapterError";
    this.detail = detail;
  }
}

const RETRYABLE: ReadonlySet<ErrorCategory> = new Set(["rate-limit", "upstream", "timeout"]);

export function isRetryableCategory(category: ErrorCategory): boolean {
  return RETRYABLE.has(category);
}

export function categoryForStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 404) return "not-found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (status >= 400 && status < 500) return "invalid-request";
  if (status >= 500) return "upstream";
  return "unknown";
}

export interface MediaErrorInit {
  status?: number | undefined;
  retryable?: boolean | undefined;
  providerState?: string | undefined;
}

/** Builds "<PREFIX>_<REASON>"; prefix may already end with "_". */
export function mediaError(
  prefix: string,
  reason: string,
  category: ErrorCategory,
  message: string,
  init: MediaErrorInit = {},
): MediaProviderError {
  const head = prefix.endsWith("_") ? prefix.slice(0, -1) : prefix;
  const error: MediaProviderError = {
    code: `${head}_${reason}`,
    message,
    retryable: init.retryable ?? isRetryableCategory(category),
    category,
  };
  if (init.status !== undefined) error.status = init.status;
  if (init.providerState !== undefined) error.providerState = init.providerState;
  return error;
}

export function fail(
  prefix: string,
  reason: string,
  category: ErrorCategory,
  message: string,
  init: MediaErrorInit = {},
): never {
  throw new MediaAdapterError(mediaError(prefix, reason, category, message, init));
}

/** Secrets an error message must never contain: the key and named secret extras. */
export function contextSecrets(ctx: MediaAdapterContext, secretExtraNames: readonly string[] = []): string[] {
  const out = [ctx.apiKey];
  for (const name of secretExtraNames) {
    const value = ctx.extra?.[name];
    if (value) out.push(value);
  }
  return out.filter((s) => s.length >= 4);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  // Bearer tokens and JWTs echoed back by an upstream are never useful in a message.
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]");
}

function isAbort(error: unknown): error is Error {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * normalizeError for thrown values that are not MediaAdapterError: aborts,
 * network failures and programming errors. Messages are redacted generically
 * because normalizeError has no context to name the key.
 */
export function normalizeUnknownError(prefix: string, error: unknown): MediaProviderError {
  if (error instanceof MediaAdapterError) return error.detail;
  if (isAbort(error)) {
    return error.name === "TimeoutError"
      ? mediaError(prefix, "TIMEOUT", "timeout", "Request to the provider timed out")
      : mediaError(prefix, "ABORTED", "unknown", "Request was aborted", { retryable: false });
  }
  if (error instanceof TypeError) {
    return mediaError(prefix, "NETWORK", "upstream", redactSecrets(`Network error: ${error.message}`, []));
  }
  const message = error instanceof Error ? error.message : String(error);
  return mediaError(prefix, "UNKNOWN", "unknown", redactSecrets(message, []), { retryable: false });
}
