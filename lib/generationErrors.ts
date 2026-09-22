import { classifyUpstreamError, classifyUpstreamErrorCode, classifyModerationStage } from "./errorClassify.js";
import { providerErrorClass, statusForErrorCode } from "./errors/providerMap.js";
export { statusForErrorCode } from "./errors/providerMap.js";
import { safeDiagnosticLabel } from "./responsesParse.js";
import { RESPONSE_DIAGNOSTIC_CODES } from "./responsesErrors.js";

const PASSTHROUGH_CODES = new Set([
  "GROK_API_KEY_MISSING",
  "OAUTH_UNAVAILABLE",
  "NETWORK_FAILED",
  "AUTH_CHATGPT_EXPIRED",
  "AUTH_API_KEY_INVALID",
  "UPSTREAM_5XX",
  "OAUTH_IMAGE_TIMEOUT",
  "API_KEY_REQUIRED",
  "INVALID_REQUEST",
  "OAUTH_UPSTREAM_ERROR",
]);

const SAFETY_CODES = new Set(["SAFETY_REFUSAL", "MODERATION_REFUSED", "moderation_blocked"]);

function has4kSize(size: unknown) {
  if (typeof size !== "string") return false;
  const [w, h] = size.split("x").map((part: string) => Number(part));
  return Number.isFinite(w) && Number.isFinite(h) && w !== undefined && h !== undefined && Math.max(w, h) >= 3840;
}

export interface UpstreamErr {
  diagnosticReason?: string;
  referenceMismatchCount?: number;
  size?: string;
  upstreamCode?: string;
  upstreamType?: string;
  upstreamParam?: string;
  /** Cau upstream noi (da lam sach) khi luot sinh khong ra duoc anh nao. */
  upstreamMessage?: string;
  code?: string;
  message?: string;
  status?: number;
  cause?: unknown;
  eventType?: string;
  eventCount?: number;
  eventTypes?: unknown;
  webSearchCalls?: number;
  responseDiagnostics?: unknown;
  webSearchEnabled?: boolean;
  toolTypes?: unknown;
  toolChoiceKind?: string;
  promptChars?: number;
  quality?: string;
  moderation?: string;
  model?: string;
  provider?: string;
  refsCount?: number;
  inputImageCount?: number;
  referenceDiagnostics?: unknown;
  retryKind?: string;
  initialEventCount?: number;
  initialEventTypes?: unknown;
  hadReferences?: boolean;
  referencesDroppedOnRetry?: boolean;
  developerPromptDroppedOnRetry?: boolean;
  webSearchDroppedOnRetry?: boolean;
  fallbackEventCount?: number;
  fallbackEventTypes?: unknown;
  fallbackImageCallSeen?: boolean;
  fallbackImageResultCount?: number;
  name?: string;
  stack?: string;
}

function diagnosticReasonFrom(err: UpstreamErr | null | undefined) {
  if (typeof err?.diagnosticReason === "string" && err.diagnosticReason) return err.diagnosticReason;
  if (Number(err?.referenceMismatchCount) > 0) return "reference_mime_mismatch_candidate";
  const responseDiagnosticReason = responseDiagnosticReasonFrom(err);
  if (responseDiagnosticReason) return responseDiagnosticReason;
  if (has4kSize(err?.size)) return "experimental_4k_empty_response";
  return null;
}

function responseDiagnosticReasonFrom(err: UpstreamErr | null | undefined) {
  if (!err?.responseDiagnostics || typeof err.responseDiagnostics !== "object") return null;
  const diagnostics = err.responseDiagnostics as {
    imageCallSeen?: unknown;
    imageCallCompleted?: unknown;
    imageCallFailed?: unknown;
    imageResultCount?: unknown;
    messageOutputSeen?: unknown;
    streamStats?: { bytesRead?: unknown };
  };
  const bytesRead = Number(diagnostics.streamStats?.bytesRead);
  if (Number.isFinite(bytesRead) && bytesRead > 0 && Number(err.eventCount) === 0) return "stream_parse_failed";
  if (diagnostics.imageCallFailed === true) return "image_tool_failed";
  if (diagnostics.imageCallCompleted === true && Number(diagnostics.imageResultCount) === 0) return "image_tool_completed_without_result";
  if (diagnostics.imageCallSeen !== true && Number(err.webSearchCalls) > 0) return "web_search_only_response";
  if (diagnostics.imageCallSeen !== true && diagnostics.messageOutputSeen === true) return "image_tool_not_called";
  return null;
}

function responseDiagnosticCodeFrom(err: UpstreamErr | null | undefined) {
  const reason = responseDiagnosticReasonFrom(err);
  if (reason === "stream_parse_failed") return "STREAM_PARSE_FAILED";
  if (reason === "web_search_only_response") return "WEB_SEARCH_ONLY_RESPONSE";
  if (reason === "image_tool_not_called") return "IMAGE_TOOL_NOT_CALLED";
  if (reason === "image_tool_failed") return "IMAGE_TOOL_FAILED";
  if (reason === "image_tool_completed_without_result") return "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT";
  return null;
}

export function errorCodeFrom(err: UpstreamErr | null | undefined): string {
  if (!err) return "UNKNOWN";
  const appCode = err.code as string;
  if (RESPONSE_DIAGNOSTIC_CODES.has(appCode) || appCode === "EMPTY_RESPONSE") return appCode;
  const upstreamCode = classifyUpstreamErrorCode(err.upstreamCode);
  if (upstreamCode !== "UNKNOWN") return upstreamCode;
  const upstreamType = classifyUpstreamErrorCode(err.upstreamType);
  if (upstreamType !== "UNKNOWN") return upstreamType;
  // Known app-level codes pass through directly (before message heuristic)
  if (PASSTHROUGH_CODES.has(appCode) || SAFETY_CODES.has(appCode)) return appCode;
  const rawCode = classifyUpstreamErrorCode(err.code);
  if (rawCode !== "UNKNOWN") return rawCode;
  const direct = classifyUpstreamError(err.message);
  if (direct !== "UNKNOWN") return direct;
  const responseDiagnosticCode = responseDiagnosticCodeFrom(err);
  if (responseDiagnosticCode) return responseDiagnosticCode;
  const status = Number(err.status);
  if (Number.isFinite(status) && status >= 400 && status < 500 && !SAFETY_CODES.has(err.code as string)) {
    return "INVALID_REQUEST";
  }
  if (typeof err.code === "string" && err.code) return err.code;
  if (err.cause) return errorCodeFrom(err.cause as UpstreamErr);
  return "UNKNOWN";
}

export function isNonRetryableGenerationError(err: UpstreamErr | null | undefined) {
  const code = errorCodeFrom(err);
  if (SAFETY_CODES.has(code)) return false;
  const status = Number(err?.status);
  return code === "INVALID_REQUEST" || code === "OAUTH_IMAGE_TIMEOUT" || (Number.isFinite(status) && status >= 400 && status < 500);
}

function copyEmptyResponseMetadata(target: any, source: UpstreamErr | null | undefined) {
  if (!source) return;
  if (typeof source.eventCount === "number") target.eventCount = source.eventCount;
  if (source.eventTypes) target.eventTypes = source.eventTypes;
  if (typeof source.webSearchCalls === "number") target.webSearchCalls = source.webSearchCalls;
  if (source.responseDiagnostics) target.responseDiagnostics = source.responseDiagnostics;
  if (typeof source.webSearchEnabled === "boolean") target.webSearchEnabled = source.webSearchEnabled;
  if (Array.isArray(source.toolTypes)) target.toolTypes = source.toolTypes;
  if (source.toolChoiceKind) target.toolChoiceKind = source.toolChoiceKind;
  if (typeof source.promptChars === "number") target.promptChars = source.promptChars;
  if (typeof source.refsCount === "number") target.refsCount = source.refsCount;
  if (typeof source.inputImageCount === "number") target.inputImageCount = source.inputImageCount;
  if (Array.isArray(source.referenceDiagnostics)) target.referenceDiagnostics = source.referenceDiagnostics;
  if (typeof source.referenceMismatchCount === "number") target.referenceMismatchCount = source.referenceMismatchCount;
  if (source.retryKind) target.retryKind = source.retryKind;
  if (typeof source.initialEventCount === "number") target.initialEventCount = source.initialEventCount;
  if (source.initialEventTypes) target.initialEventTypes = source.initialEventTypes;
  if (typeof source.hadReferences === "boolean") target.hadReferences = source.hadReferences;
  if (typeof source.referencesDroppedOnRetry === "boolean") target.referencesDroppedOnRetry = source.referencesDroppedOnRetry;
  if (typeof source.developerPromptDroppedOnRetry === "boolean") target.developerPromptDroppedOnRetry = source.developerPromptDroppedOnRetry;
  if (typeof source.webSearchDroppedOnRetry === "boolean") target.webSearchDroppedOnRetry = source.webSearchDroppedOnRetry;
  if (typeof source.fallbackEventCount === "number") target.fallbackEventCount = source.fallbackEventCount;
  if (source.fallbackEventTypes) target.fallbackEventTypes = source.fallbackEventTypes;
  if (typeof source.fallbackImageCallSeen === "boolean") target.fallbackImageCallSeen = source.fallbackImageCallSeen;
  if (typeof source.fallbackImageResultCount === "number") target.fallbackImageResultCount = source.fallbackImageResultCount;
}

function decorateProviderFailure<T extends Error>(target: T, source: UpstreamErr | null | undefined): T {
  // Only the top-level code is authoritative. Walking the cause chain looked
  // thorough but attaches an unrelated inner error's identity: a SAFETY_REFUSAL
  // wrapping a transport failure would come out as NETWORK_FAILURE. Provider
  // adapters throw their own code directly, so the outer code is the one that
  // describes this failure.
  if (typeof source?.code !== "string") return target;
  const errorClass = providerErrorClass(source.code, source.status);
  if (errorClass) Object.assign(target, { rawCode: source.code, errorClass });
  return target;
}

export function normalizeGenerationFailure(lastErr: UpstreamErr | null | undefined, options: any = {}) {
  const code = errorCodeFrom(lastErr);
  if (PASSTHROUGH_CODES.has(code)) {
    const err: any = new Error(lastErr?.message || options.proxyMessage || "GPT OAuth proxy/network failure");
    err.code = code;
    err.status = lastErr?.status || statusForErrorCode(code);
    err.cause = lastErr;
    if (lastErr?.upstreamCode) err.upstreamCode = safeDiagnosticLabel(lastErr.upstreamCode);
    if (lastErr?.upstreamType) err.upstreamType = safeDiagnosticLabel(lastErr.upstreamType);
    if (lastErr?.upstreamParam) err.upstreamParam = safeDiagnosticLabel(lastErr.upstreamParam);
    if (lastErr?.eventType) err.eventType = lastErr.eventType;
    if (typeof lastErr?.eventCount === "number") err.eventCount = lastErr.eventCount;
    return decorateProviderFailure(err, lastErr);
  }
  if (SAFETY_CODES.has(code)) {
    const stage = classifyModerationStage(lastErr?.message);
    const err: any = new Error(options.safetyMessage || lastErr?.message || "Content generation refused after retries");
    err.code = "SAFETY_REFUSAL";
    err.status = 422;
    err.moderationStage = stage;
    err.cause = lastErr;
    return decorateProviderFailure(err, lastErr);
  }
  if (RESPONSE_DIAGNOSTIC_CODES.has(code)) {
    const err: any = new Error(lastErr?.message || "Image generation did not return image data");
    err.code = code;
    err.status = lastErr?.status || statusForErrorCode(code, 422);
    err.cause = lastErr;
    if (lastErr?.upstreamCode) err.upstreamCode = safeDiagnosticLabel(lastErr.upstreamCode);
    if (lastErr?.upstreamType) err.upstreamType = safeDiagnosticLabel(lastErr.upstreamType);
    if (lastErr?.upstreamParam) err.upstreamParam = safeDiagnosticLabel(lastErr.upstreamParam);
    if (lastErr?.eventType) err.eventType = lastErr.eventType;
    copyEmptyResponseMetadata(err, lastErr);
    err.diagnosticReason = diagnosticReasonFrom(lastErr) || code.toLowerCase();
    return decorateProviderFailure(err, lastErr);
  }
  // Empty response with metadata → likely a technical limitation (unsupported size/quality/model)
  if (typeof lastErr?.eventCount === "number") {
    const meta: string[] = [];
    if (lastErr.size) meta.push(`size=${lastErr.size}`);
    if (lastErr.quality) meta.push(`quality=${lastErr.quality}`);
    if (lastErr.model) meta.push(`model=${lastErr.model}`);
    const msg = meta.length
      ? `No image data returned. This may be an unsupported ${meta.join(", ")} combination. Try a different size or model.`
      : "No image data returned from the image backend. Try a different size, quality, or prompt.";
    const err: any = new Error(msg);
    err.code = "EMPTY_RESPONSE";
    err.status = 422;
    err.cause = lastErr;
    if (lastErr.size) err.size = lastErr.size;
    if (lastErr.quality) err.quality = lastErr.quality;
    if (lastErr.model) err.model = lastErr.model;
    if (lastErr.provider) err.provider = lastErr.provider;
    if (lastErr.moderation) err.moderation = lastErr.moderation;
    copyEmptyResponseMetadata(err, lastErr);
    const diagnosticReason = diagnosticReasonFrom(lastErr);
    if (diagnosticReason) err.diagnosticReason = diagnosticReason;
    return decorateProviderFailure(err, lastErr);
  }
  // Unrecognized errors → UNKNOWN (do not pretend they are safety refusals)
  const err: any = new Error(lastErr?.message || options.proxyMessage || "Image generation failed");
  err.code = "UNKNOWN";
  err.status = lastErr?.status || 500;
  err.cause = lastErr;
  return decorateProviderFailure(err, lastErr);
}
