/**
 * fal error bodies. Observed/documented shapes (2026-11-26):
 * - queue/model: { "detail": "<string>", "type": "<string>" }
 * - validation: { "detail": [{ "loc": [...], "msg": "...", "type": "..." }] } (422)
 *   where type "content_policy_violation" marks a moderation refusal
 * - platform API: { "error": { "type": "authorization_error", "message": "..." } }
 */
import type { VendorErrorView } from "../shared/http.js";
import { asArray, asRecord, asString } from "../shared/http.js";

const CREDIT_PATTERN = /exhausted balance|insufficient (?:balance|credit|funds)|top up your balance/i;

function detailMessages(detail: unknown): { message?: string; types: string[] } {
  if (typeof detail === "string") return { message: detail, types: [] };
  const items = asArray(detail).map(asRecord);
  if (items.length === 0) return { types: [] };
  const message = items.map((item) => asString(item.msg) ?? "").filter(Boolean).join("; ");
  const types = items.map((item) => asString(item.type) ?? "").filter(Boolean);
  return message ? { message, types } : { types };
}

export function readFalError(body: unknown, status: number): VendorErrorView {
  const record = asRecord(body);
  const platform = asRecord(record.error);
  const { message: detailMessage, types } = detailMessages(record.detail);
  const type = asString(record.type) ?? asString(platform.type) ?? types[0];
  const message = detailMessage ?? asString(platform.message) ?? asString(record.message);
  if (types.includes("content_policy_violation") || type === "content_policy_violation") {
    return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  }
  if (type === "authorization_error") return { message, category: "auth" };
  if (message && CREDIT_PATTERN.test(message)) return { message, category: "quota", reason: "INSUFFICIENT_CREDIT", retryable: false };
  if (type === "startup_timeout" || type === "runner_disconnected") return { message, category: "upstream", reason: type.toUpperCase(), retryable: true };
  if (status === 0) return { message };
  return { message };
}
