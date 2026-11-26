/**
 * Sume error envelope (https://www.sume.com/docs/errors, observed 2026-11-26):
 * { "error": { "code", "message", "request_id", "category", "stage", "retryable",
 *   "retry_after_seconds", "public_reason", "next_action" } }
 */
import type { ErrorCategory } from "../shared/errors.js";
import type { VendorErrorView } from "../shared/http.js";
import { asRecord, asString } from "../shared/http.js";

const CODE_CATEGORY: Record<string, ErrorCategory> = {
  unauthorized: "auth",
  invalid_api_key: "auth",
  insufficient_scope: "auth",
  open_key_route_not_allowed: "auth",
  open_key_required: "auth",
  insufficient_funds: "quota",
  spend_cap_exceeded: "quota",
  rate_limited: "rate-limit",
  queue_full: "rate-limit",
  invalid_request: "invalid-request",
  bad_request: "invalid-request",
  not_found: "not-found",
  content_policy_violation: "moderation",
  moderation_blocked: "moderation",
};

function categoryOf(code: string | undefined, vendorCategory: string | undefined): ErrorCategory | undefined {
  if (code && CODE_CATEGORY[code]) return CODE_CATEGORY[code];
  if (code && /moderat|content_policy|safety/.test(code)) return "moderation";
  if (code && /spend|cap|balance|funds/.test(code)) return "quota";
  if (vendorCategory === "auth") return "auth";
  return undefined;
}

export function readSumeError(body: unknown, _status: number): VendorErrorView {
  const error = asRecord(asRecord(body).error);
  const code = asString(error.code);
  const message = asString(error.message);
  const category = categoryOf(code, asString(error.category));
  return {
    message,
    ...(category ? { category } : {}),
    ...(code ? { reason: code.toUpperCase().replace(/[^A-Z0-9]+/g, "_") } : {}),
    ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}),
  };
}
