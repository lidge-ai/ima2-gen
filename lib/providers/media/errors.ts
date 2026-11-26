import type { MediaProviderError } from "./contract.js";

export type MediaErrorCategory = MediaProviderError["category"];

/** An error the media routes surface as { code, error, status, category, retryable }. */
export class MediaJobError extends Error {
  readonly code: string;
  readonly status: number;
  readonly category: MediaErrorCategory;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { status?: number; category?: MediaErrorCategory; retryable?: boolean } = {}) {
    super(message);
    this.name = "MediaJobError";
    this.code = code;
    this.status = options.status ?? 400;
    this.category = options.category ?? "invalid-request";
    this.retryable = options.retryable ?? false;
  }
}

const CATEGORY_STATUS: Record<MediaErrorCategory, number> = {
  auth: 401,
  quota: 402,
  "rate-limit": 429,
  "invalid-request": 400,
  moderation: 422,
  "not-found": 404,
  upstream: 502,
  timeout: 504,
  unknown: 502,
};

export function mediaJobErrorFromProvider(err: MediaProviderError): MediaJobError {
  return new MediaJobError(err.code, err.message, {
    status: err.status && err.status >= 400 ? err.status : CATEGORY_STATUS[err.category] ?? 502,
    category: err.category,
    retryable: err.retryable,
  });
}

export function mediaErrorBody(err: MediaJobError): Record<string, unknown> {
  return { ok: false, code: err.code, error: err.message, status: err.status, category: err.category, retryable: err.retryable };
}
