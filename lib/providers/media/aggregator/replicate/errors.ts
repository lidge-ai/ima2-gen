/**
 * Replicate error shapes (https://replicate.com/docs/reference/http, 2026-11-26):
 * - problem JSON: { "title": "Unauthenticated", "detail": "...", "status": 401 }
 * - throttling: { "detail": "Request was throttled. Expected available in 1 second." }
 * - validation: { "detail": [{ "loc": [...], "msg": "...", "type": "..." }] } or a string
 * - failed prediction: prediction.error (text, sometimes prefixed with an E#### code)
 */
import type { VendorErrorView } from "../shared/http.js";
import { asArray, asRecord, asString } from "../shared/http.js";

/** INFERRED from Replicate's error-code reference: E005 marks sensitive (moderated) content. */
const MODERATION_PATTERN = /\bE005\b|flagged as sensitive|nsfw|content polic|safety (?:filter|system)/i;

export function readReplicateError(body: unknown, _status: number): VendorErrorView {
  const record = asRecord(body);
  const items = asArray(record.detail).map(asRecord);
  const listed = items.map((item) => asString(item.msg) ?? "").filter(Boolean).join("; ");
  const message = asString(record.detail) ?? (listed || undefined) ?? asString(record.title);
  if (message && MODERATION_PATTERN.test(message)) return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  return { message };
}

export function readPredictionError(error: unknown): VendorErrorView {
  const message = typeof error === "string" ? error : asString(asRecord(error).message) ?? (error ? JSON.stringify(error) : "Replicate prediction failed");
  if (MODERATION_PATTERN.test(message)) return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  const code = /\b(E\d{3,4})\b/.exec(message)?.[1];
  return { message, ...(code ? { reason: code } : {}) };
}
