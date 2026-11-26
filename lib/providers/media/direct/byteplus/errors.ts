// ModelArk error vocabulary -> contract categories.
// Source: https://docs.byteplus.com/en/docs/ModelArk/error-codes (read 2026-11-26).
import type { MediaProviderError } from "../../contract.js";
import { categoryForStatus, mediaError, type ErrorCategory } from "../_l2/errors.js";

export const ERROR_PREFIX = "BYTEPLUS";

const REAL_PERSON = new Set(["InputImageSensitiveContentDetected.PrivacyInformation", "InputVideoSensitiveContentDetected.PrivacyInformation"]);
const PORTRAIT_GUIDE = "https://docs.byteplus.com/en/docs/ModelArk/seedance-portrait-asset-guide";

/** Seedance refuses real faces in uploaded references; the guide lists the three accepted routes. */
function realPersonError(message: string, status: number | undefined, code: string): MediaProviderError {
  return mediaError(ERROR_PREFIX, "REAL_PERSON_BLOCKED", "moderation",
    "BytePlus blocked a reference that may show a real person. Seedance accepts real faces only as: " +
    "an asset://<asset id> from the digital character library, an asset://<asset id> for an authorized real person " +
    "(uploaded after that person's verification), or an original Seedance/Seedream output from the same account " +
    "within 30 days. See " + PORTRAIT_GUIDE + ". Upstream: " + message,
    { status, providerState: code });
}

const REASON: Readonly<Record<ErrorCategory, string>> = {
  auth: "AUTH", quota: "QUOTA", "rate-limit": "RATE_LIMIT", "invalid-request": "INVALID_REQUEST", moderation: "MODERATION",
  "not-found": "NOT_FOUND", upstream: "UPSTREAM", timeout: "TIMEOUT", unknown: "UNKNOWN",
};

const QUOTA_CODES = new Set(["AccountOverdueError", "OperationDenied.ServiceOverdue", "SetLimitExceeded"]);
const AUTH_CODES = new Set(["AuthenticationError", "InvalidAccountStatus", "AccessDenied", "OperationDenied.PermissionDenied"]);
const NOT_ACTIVATED = new Set(["ModelNotOpen", "OperationDenied.ServiceNotOpen", "InvalidEndpointOrModel.ModelIDAccessDisabled"]);
const RATE_CODES = /RateLimitExceeded|^ServerOverloaded$|^RequestBurstTooFast$|^InflightBatchsizeExceeded$/;

function categoryForCode(code: string, message: string, status: number | undefined): ErrorCategory {
  if (code.includes("SensitiveContentDetected")) return "moderation";
  if (AUTH_CODES.has(code)) return "auth";
  if (QUOTA_CODES.has(code)) return "quota";
  // QuotaExceeded covers both an exhausted quota and too many queued tasks; only the latter clears by waiting.
  if (code === "QuotaExceeded") return /queued/i.test(message) ? "rate-limit" : "quota";
  if (RATE_CODES.test(code)) return "rate-limit";
  if (code.startsWith("InvalidParameter") || code.startsWith("MissingParameter")) return "invalid-request";
  if (code.startsWith("InvalidEndpointOrModel") || code.startsWith("NotFound")) return "not-found";
  if (code === "InternalServiceError") return "upstream";
  return status === undefined ? "unknown" : categoryForStatus(status);
}

/** Maps a ModelArk error object (HTTP body or failed task) to the contract error. */
export function arkError(code: string | undefined, message: string, status?: number): MediaProviderError {
  const vendorCode = code ?? "";
  if (REAL_PERSON.has(vendorCode)) return realPersonError(message, status, vendorCode);
  if (NOT_ACTIVATED.has(vendorCode)) {
    return mediaError(ERROR_PREFIX, "MODEL_NOT_ACTIVATED", "auth",
      "Model is not activated for this BytePlus account (activate it in the ModelArk console): " + message,
      { status, providerState: vendorCode });
  }
  const category = categoryForCode(vendorCode, message, status);
  return mediaError(ERROR_PREFIX, REASON[category], category, message, {
    status, providerState: vendorCode || undefined,
  });
}
