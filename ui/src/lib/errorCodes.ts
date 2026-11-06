// 0.09.8 — ImaErrorCode registry + classifier.
import { classSpec, isPriorityErrorClass } from "./errorClassSpecs";
import { createLanAuthError } from "./lanSession";
// Mirrors lib/errorClassify.js on the server. Frontend uses this to map
// server error codes (or raw strings) to i18n keys + surface (toast vs card).

export type ImaErrorCode =
  | "LAN_TOKEN_REQUIRED"
  | "REF_TOO_LARGE"
  | "REF_NOT_BASE64"
  | "REF_EMPTY"
  | "REF_TOO_MANY"
  | "MINIMAX_MODEL_REQUIRES_REFERENCE"
  | "NAI_REF_UNSUPPORTED"
  | "NAI_EDIT_UNSUPPORTED"
  | "NAI_API_KEY_MISSING"
  | "GROK_API_KEY_MISSING"
  | "NAI_AUTH_FAILED"
  | "NAI_SUBSCRIPTION_REQUIRED"
  | "NAI_USAGE_EXHAUSTED"
  | "NAI_RATE_LIMITED"
  | "NAI_BAD_REQUEST"
  | "NAI_ZIP_INVALID"
  | "NAI_ZIP_UNSUPPORTED"
  | "NAI_ZIP_TOO_LARGE"
  | "NAI_RESPONSE_NOT_ZIP"
  | "NAI_IMAGE_INVALID"
  | "NAI_EMPTY_IMAGE"
  | "NAI_MASK_UNSUPPORTED"
  | "NAI_UPSTREAM_ERROR"
  | "MODERATION_REFUSED"
  | "SAFETY_REFUSAL"
  | "EMPTY_RESPONSE"
  | "STREAM_PARSE_FAILED"
  | "IMAGE_TOOL_NOT_CALLED"
  | "WEB_SEARCH_ONLY_RESPONSE"
  | "IMAGE_TOOL_FAILED"
  | "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT"
  | "PROVIDER_EMPTY_IMAGE"
  | "OAUTH_IMAGE_CAPABILITY_UNAVAILABLE"
  | "RESPONSES_STREAM_ERROR"
  | "UPSTREAM_5XX"
  | "AUTH_CHATGPT_EXPIRED"
  | "AUTH_API_KEY_INVALID"
  | "NETWORK_FAILED"
  | "OAUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_MODERATION"
  | "APIKEY_DISABLED"
  | "IMAGE_FEATURE_NOT_ENABLED"
  | "AGY_GENERATION_FAILED"
  | "AGY_TIMEOUT"
  | "JOB_TRACKING_TIMEOUT"
  | "AGY_PROCESS_ERROR"
  | "AGY_QUOTA_EXHAUSTED"
  | "AGY_PARSE_FAILED"
  | "AGY_ARTIFACT_NOT_FOUND"
  | "DB_ERROR"
  | "UNKNOWN";

export type ErrorSurface = "toast" | "card";

export const JOB_TRACKING_TIMEOUT_MESSAGE =
  "Job tracking expired; upstream completion is unknown. Inspect history before retrying.";

export type ErrorSpec = {
  surface: ErrorSurface;
  /** i18n key for a short toast line (surface=toast). */
  toastKey?: string;
  /**
   * i18n key root for ErrorCard. Full keys are <cardKey>.title / .body / .cta.
   * CTA key is optional (card shows close-only when missing).
   */
  cardKey?: string;
  /** Optional action type the ErrorCard renders as a button. */
  cta?: "reauth" | "reload" | "retry" | "dismiss";
};

export const errorCodes: Record<ImaErrorCode, ErrorSpec> = {
  // handleError routes this to the LAN gate before either presentation surface.
  LAN_TOKEN_REQUIRED: { surface: "toast" },
  REF_TOO_LARGE: { surface: "toast", toastKey: "toast.refTooLarge" },
  REF_NOT_BASE64: { surface: "toast", toastKey: "toast.refNotBase64" },
  REF_EMPTY: { surface: "toast", toastKey: "toast.refEmpty" },
  REF_TOO_MANY: { surface: "toast", toastKey: "toast.refLimitExceeded" },
  MINIMAX_MODEL_REQUIRES_REFERENCE: { surface: "toast", toastKey: "toast.minimaxModelRequiresReference" },
  // Thrown by lib/generatePipeline.ts and routes/edit.ts: the NovelAI lane is
  // text-to-image only, so an attached image is refused rather than dropped.
  NAI_REF_UNSUPPORTED: { surface: "toast", toastKey: "toast.naiRefUnsupported" },
  NAI_EDIT_UNSUPPORTED: { surface: "toast", toastKey: "toast.naiEditUnsupported" },
  // 040 error table. These stay NovelAI-specific instead of collapsing into the
  // generic auth/billing class cards, which tell the user to "sign in again" —
  // wrong advice for a lane authenticated by a pasted persistent token.
  // "reauth" is the only CTA Toast wires to openSettings("providers"), which is
  // exactly where the token is pasted. The copy stays NovelAI-specific, so the
  // user is not told to re-run a sign-in flow this lane does not have.
  NAI_API_KEY_MISSING: { surface: "card", cardKey: "errorCard.naiApiKeyMissing", cta: "reauth" },
  GROK_API_KEY_MISSING: { surface: "card", cardKey: "errorCard.grokApiKeyMissing", cta: "reauth" },
  NAI_AUTH_FAILED: { surface: "card", cardKey: "errorCard.naiAuthFailed", cta: "reauth" },
  NAI_SUBSCRIPTION_REQUIRED: { surface: "card", cardKey: "errorCard.naiSubscriptionRequired", cta: "dismiss" },
  NAI_USAGE_EXHAUSTED: { surface: "card", cardKey: "errorCard.naiUsageExhausted", cta: "dismiss" },
  NAI_RATE_LIMITED: { surface: "toast", toastKey: "toast.naiRateLimited", cta: "retry" },
  NAI_BAD_REQUEST: { surface: "toast", toastKey: "toast.naiBadRequest" },
  NAI_ZIP_INVALID: { surface: "card", cardKey: "errorCard.naiZipInvalid", cta: "retry" },
  NAI_ZIP_UNSUPPORTED: { surface: "card", cardKey: "errorCard.naiZipInvalid", cta: "retry" },
  NAI_ZIP_TOO_LARGE: { surface: "card", cardKey: "errorCard.naiZipInvalid", cta: "retry" },
  NAI_RESPONSE_NOT_ZIP: { surface: "card", cardKey: "errorCard.naiResponseNotZip", cta: "retry" },
  NAI_IMAGE_INVALID: { surface: "card", cardKey: "errorCard.naiImageInvalid", cta: "retry" },
  NAI_EMPTY_IMAGE: { surface: "card", cardKey: "errorCard.naiImageInvalid", cta: "retry" },
  NAI_MASK_UNSUPPORTED: { surface: "toast", toastKey: "toast.naiMaskUnsupported" },
  NAI_UPSTREAM_ERROR: { surface: "card", cardKey: "errorCard.naiUpstreamError", cta: "retry" },
  MODERATION_REFUSED: { surface: "card", cardKey: "errorCard.moderationRefused", cta: "dismiss" },
  SAFETY_REFUSAL: { surface: "card", cardKey: "errorCard.moderationRefused", cta: "dismiss" },
  EMPTY_RESPONSE: { surface: "card", cardKey: "errorCard.emptyResponse", cta: "dismiss" },
  STREAM_PARSE_FAILED: { surface: "card", cardKey: "errorCard.streamParseFailed", cta: "retry" },
  IMAGE_TOOL_NOT_CALLED: { surface: "card", cardKey: "errorCard.imageToolNotCalled", cta: "retry" },
  WEB_SEARCH_ONLY_RESPONSE: { surface: "card", cardKey: "errorCard.webSearchOnlyResponse", cta: "retry" },
  IMAGE_TOOL_FAILED: { surface: "card", cardKey: "errorCard.imageToolFailed", cta: "retry" },
  IMAGE_TOOL_COMPLETED_WITHOUT_RESULT: { surface: "card", cardKey: "errorCard.imageToolNoResult", cta: "retry" },
  PROVIDER_EMPTY_IMAGE: { surface: "card", cardKey: "errorCard.providerEmptyImage", cta: "retry" },
  OAUTH_IMAGE_CAPABILITY_UNAVAILABLE: { surface: "card", cardKey: "errorCard.oauthImageCapabilityUnavailable", cta: "dismiss" },
  RESPONSES_STREAM_ERROR: { surface: "card", cardKey: "errorCard.responsesStreamError", cta: "retry" },
  UPSTREAM_5XX: { surface: "card", cardKey: "errorCard.upstream5xx", cta: "retry" },
  AUTH_CHATGPT_EXPIRED: { surface: "card", cardKey: "errorCard.authChatgptExpired", cta: "reauth" },
  AUTH_API_KEY_INVALID: { surface: "card", cardKey: "errorCard.authApiKeyInvalid", cta: "dismiss" },
  NETWORK_FAILED: { surface: "card", cardKey: "errorCard.networkFailed", cta: "reload" },
  OAUTH_UNAVAILABLE: { surface: "card", cardKey: "errorCard.oauthUnavailable", cta: "reload" },
  INVALID_REQUEST: { surface: "card", cardKey: "errorCard.invalidRequest", cta: "dismiss" },
  INVALID_MODERATION: { surface: "toast", toastKey: "toast.generateFailed" },
  APIKEY_DISABLED: { surface: "card", cardKey: "errorCard.apikeyDisabled", cta: "dismiss" },
  IMAGE_FEATURE_NOT_ENABLED: { surface: "card", cardKey: "errorCard.imageFeatureNotEnabled", cta: "dismiss" },
  AGY_GENERATION_FAILED: { surface: "card", cardKey: "errorCard.agyGenerationFailed", cta: "retry" },
  AGY_TIMEOUT: { surface: "card", cardKey: "errorCard.agyTimeout", cta: "retry" },
  JOB_TRACKING_TIMEOUT: { surface: "toast", toastKey: "toast.jobTrackingTimeout" },
  AGY_PROCESS_ERROR: { surface: "card", cardKey: "errorCard.agyProcessError", cta: "retry" },
  AGY_QUOTA_EXHAUSTED: { surface: "card", cardKey: "errorCard.agyQuotaExhausted", cta: "dismiss" },
  AGY_PARSE_FAILED: { surface: "card", cardKey: "errorCard.agyProcessError", cta: "retry" },
  AGY_ARTIFACT_NOT_FOUND: { surface: "card", cardKey: "errorCard.agyProcessError", cta: "retry" },
  DB_ERROR: { surface: "toast", toastKey: "toast.generateFailed" },
  UNKNOWN: { surface: "toast", toastKey: "toast.generateFailed" },
};

/**
 * Pattern-match a raw error message into an ImaErrorCode. Mirrors the server
 * classifier so the UI can fall back gracefully when the server omitted a code.
 */
export function classifyError(message: string): ImaErrorCode {
  const s = (message || "").toLowerCase();
  if (!s) return "UNKNOWN";
  if (s.includes("moderation_blocked") || s.includes("moderation refused")) {
    return "MODERATION_REFUSED";
  }
  if (s.includes("no image data returned")) {
    return "EMPTY_RESPONSE";
  }
  if (s.includes("stream could not be parsed")) return "STREAM_PARSE_FAILED";
  if (s.includes("web search but not the image tool")) return "WEB_SEARCH_ONLY_RESPONSE";
  if (s.includes("without calling the image tool")) return "IMAGE_TOOL_NOT_CALLED";
  if (s.includes("image tool call failed")) return "IMAGE_TOOL_FAILED";
  if (s.includes("image tool completed without image data")) return "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT";
  if (
    s.includes("token is expired") ||
    s.includes("sign in again") ||
    (s.includes("access token") && s.includes("expired")) ||
    (s.includes("token") && s.includes("expired") && !s.includes("api key"))
  ) {
    return "AUTH_CHATGPT_EXPIRED";
  }
  if (
    s.includes("incorrect api key") ||
    s.includes("invalid authentication") ||
    s.includes("exceeded your current quota") ||
    s.includes("incorrect organization")
  ) {
    return "AUTH_API_KEY_INVALID";
  }
  if (
    s.includes("failed to fetch") ||
    s.includes("econnrefused") ||
    s.includes("econnreset") ||
    s.includes("enotfound") ||
    s.includes("etimedout") ||
    s.includes("network error")
  ) {
    return "NETWORK_FAILED";
  }
  if (s.includes("oauth") && (s.includes("not running") || s.includes("unavailable") || s.includes("not ready"))) {
    return "OAUTH_UNAVAILABLE";
  }
  if (
    s.includes("invalid_request_error") ||
    s.includes("invalid_value") ||
    s.includes("invalid size") ||
    s.includes("invalid request") ||
    s.includes("requested resolution") ||
    s.includes("minimum pixel budget") ||
    s.includes("unsupported value")
  ) {
    return "INVALID_REQUEST";
  }
  if (s.includes("resource exhausted") || s.includes("exhausted your capacity") || s.includes("quota will reset")) {
    return "AGY_QUOTA_EXHAUSTED";
  }
  if (s.includes("agy generation timed out")) return "AGY_TIMEOUT";
  if (s.includes("agy generation failed")) return "AGY_GENERATION_FAILED";
  if (s.includes("agy process error") || s.includes("agy exited")) return "AGY_PROCESS_ERROR";
  if (s.includes("agy artifact not found")) return "AGY_ARTIFACT_NOT_FOUND";
  if (s.includes("could not parse artifact path from agy")) return "AGY_PARSE_FAILED";
  if (s.includes("an error occurred while processing") || /\b5\d\d\b/.test(s)) {
    return "UPSTREAM_5XX";
  }
  return "UNKNOWN";
}

export type ModerationStage = "input" | "output" | "unknown";

/**
 * Codes whose own copy already names the provider and the exact remedy, so the
 * generic AUTH_INVALID / BILLING_REQUIRED class card must not override them.
 */
const SELF_DESCRIBING_AUTH_CODES: readonly ImaErrorCode[] = [
  "GROK_API_KEY_MISSING",
  "NAI_API_KEY_MISSING",
  "NAI_AUTH_FAILED",
  "NAI_SUBSCRIPTION_REQUIRED",
  "NAI_USAGE_EXHAUSTED",
];

export function classifyModerationStage(msg: string): ModerationStage {
  const s = (msg || "").toLowerCase();
  if (s.includes("request was rejected") || s.includes("prompt was rejected")) return "input";
  if (s.includes("image was filtered") || s.includes("generated image")) return "output";
  return "unknown";
}

export type ResolvedErrorSpec = {
  code: ImaErrorCode;
  spec: ErrorSpec;
  message: string;
  rawCode?: string;
  errorClass?: string;
  moderationStage?: ModerationStage;
};

/** Resolve the spec for an arbitrary error-like value. */
export function resolveErrorSpec(err: unknown): ResolvedErrorSpec {
  const e = err as (Error & {
    code?: string;
    message?: string;
    rawCode?: string;
    errorClass?: string;
    moderationStage?: string;
  }) | Record<string, unknown> | undefined;
  const rec = e && typeof e === "object" ? e as Record<string, unknown> : {};
  const rawMessage = typeof rec.message === "string" ? rec.message : String(err ?? "");
  const incomingCode = typeof rec.code === "string" ? rec.code : "";
  if (incomingCode === "LAN_TOKEN_REQUIRED") {
    return { code: "LAN_TOKEN_REQUIRED", spec: errorCodes.LAN_TOKEN_REQUIRED,
      message: createLanAuthError().message };
  }
  const incomingRawCode = typeof rec.rawCode === "string" ? rec.rawCode : undefined;
  const incomingClass = typeof rec.errorClass === "string" ? rec.errorClass : undefined;
  // A wrapper code (e.g. the agent's AGENT_TEXT_ONLY_RESULT) is not in the registry,
  // but it carries the underlying cause in rawCode. Fall back to that so the user sees
  // WHY generation gave up instead of a generic unknown-error toast.
  const registered = incomingCode && incomingCode in errorCodes
    ? incomingCode as ImaErrorCode
    : incomingRawCode && incomingRawCode in errorCodes
      ? incomingRawCode as ImaErrorCode
      : undefined;
  if (registered === "JOB_TRACKING_TIMEOUT" ||
    (registered === "UNKNOWN" && incomingRawCode === "JOB_TRACKING_TIMEOUT")) {
    return { code: "JOB_TRACKING_TIMEOUT", spec: errorCodes.JOB_TRACKING_TIMEOUT,
      message: JOB_TRACKING_TIMEOUT_MESSAGE };
  }
  const priority = isPriorityErrorClass(incomingClass) ? classSpec(incomingClass) : undefined;
  // WP4 audit blocker: the priority class card says "sign in again from Settings",
  // which is wrong for a lane authenticated by a pasted persistent token. A code
  // that already carries its own auth/billing copy keeps it.
  const selfDescribing = registered ? SELF_DESCRIBING_AUTH_CODES.includes(registered) : false;
  const fallbackClass = classSpec(incomingClass);
  let code: ImaErrorCode;
  let spec: ErrorSpec;
  if (priority && !selfDescribing) {
    code = registered ?? "UNKNOWN";
    spec = priority;
  } else if (selfDescribing && registered) {
    code = registered;
    spec = errorCodes[registered];
  } else if (registered) {
    code = registered;
    spec = errorCodes[registered];
  } else if (fallbackClass) {
    code = classifyError(rawMessage);
    spec = fallbackClass;
  } else {
    code = classifyError(rawMessage);
    spec = errorCodes[code] ?? errorCodes.UNKNOWN;
  }
  const moderationStage = (code === "MODERATION_REFUSED" || code === "SAFETY_REFUSAL")
    ? ((typeof rec.moderationStage === "string" ? rec.moderationStage as ModerationStage : undefined) || classifyModerationStage(rawMessage))
    : undefined;
  return {
    code,
    spec,
    message: rawMessage,
    ...(incomingRawCode ? { rawCode: incomingRawCode } : incomingCode && !registered ? { rawCode: incomingCode } : {}),
    ...(incomingClass && (priority || fallbackClass) ? { errorClass: incomingClass } : {}),
    ...(moderationStage ? { moderationStage } : {}),
  };
}
