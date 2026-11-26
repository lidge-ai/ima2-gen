/**
 * Atlas Cloud error shapes (https://www.atlascloud.ai/docs/errors, 2026-11-26):
 * - media API: { "code": 401, "msg": "unauthorized", "request_id": "...", "data": null }
 * - public API: { "error": { "type", "code", "message", "param" }, "request_id" }
 * - async failure on a prediction: data.error (text) and data.error_code (1039 = input moderation)
 */
import type { VendorErrorView } from "../shared/http.js";
import { asNumber, asRecord, asString } from "../shared/http.js";

const MODERATION_CODES = new Set([1039]);

export function readAtlasError(body: unknown, _status: number): VendorErrorView {
  const record = asRecord(body);
  const nested = asRecord(record.error);
  const message = asString(record.msg) ?? asString(record.message) ?? asString(nested.message) ?? (typeof record.error === "string" ? record.error : undefined);
  const code = asString(nested.code);
  return {
    message,
    ...(code ? { reason: code.toUpperCase().replace(/[^A-Z0-9]+/g, "_") } : {}),
  };
}

/** Classifies a failed prediction's data block. */
export function readPredictionFailure(data: Record<string, unknown>): VendorErrorView {
  const errorCode = asNumber(data.error_code);
  const message = asString(data.error) ?? asString(data.message) ?? "Atlas Cloud prediction failed";
  if (errorCode !== undefined && MODERATION_CODES.has(errorCode)) {
    return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  }
  return { message, ...(errorCode !== undefined ? { reason: `ERROR_${errorCode}` } : {}) };
}
