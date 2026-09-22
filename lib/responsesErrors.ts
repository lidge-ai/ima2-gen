import type { ParsedResponsesResult } from "./responsesParse.js";

const RESPONSES_ERROR_MARKER = "ima2ResponsesError";

export const RESPONSE_DIAGNOSTIC_CODES = new Set([
  "STREAM_PARSE_FAILED",
  "IMAGE_TOOL_NOT_CALLED",
  "WEB_SEARCH_ONLY_RESPONSE",
  "IMAGE_TOOL_FAILED",
  "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT",
  "OAUTH_IMAGE_CAPABILITY_UNAVAILABLE",
  "RESPONSES_STREAM_ERROR",
]);

export interface EmptyResponseMeta {
  provider?: string | undefined;
  model?: string | undefined;
  toolTypes?: string[] | undefined;
  toolChoiceKind?: string | undefined;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  webSearchEnabled?: boolean | undefined;
  refsCount?: number | undefined;
  inputImageCount?: number | undefined;
  promptChars?: number | undefined;
  retryKind?: string | undefined;
  initialEventCount?: number | undefined;
  initialEventTypes?: Record<string, number> | undefined;
  hadReferences?: boolean | undefined;
  referencesDroppedOnRetry?: boolean | undefined;
  developerPromptDroppedOnRetry?: boolean | undefined;
  webSearchDroppedOnRetry?: boolean | undefined;
  fallbackEventCount?: number | undefined;
  fallbackEventTypes?: Record<string, number> | undefined;
  fallbackImageCallSeen?: boolean | undefined;
  fallbackImageResultCount?: number | undefined;
}

interface ResponsesError extends Error {
  status: number;
  code: string;
  [key: string]: unknown;
}

function diagnosticReason(code: string): string | null {
  return code === "EMPTY_RESPONSE" ? null : code.toLowerCase();
}

function messageForCode(code: string, fallback: string) {
  if (code === "STREAM_PARSE_FAILED") return "Responses image stream could not be parsed.";
  if (code === "WEB_SEARCH_ONLY_RESPONSE") return "Responses called web search but not the image tool.";
  if (code === "IMAGE_TOOL_NOT_CALLED") return "Responses completed without calling the image tool.";
  if (code === "IMAGE_TOOL_FAILED") return "Responses image tool call failed.";
  if (code === "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT") return "Responses image tool completed without image data.";
  return fallback;
}

export function classifyNoImageResponse(result: ParsedResponsesResult): string {
  const diagnostics = result.diagnostics;
  const bytesRead = Number(diagnostics.streamStats.bytesRead);
  if (Number.isFinite(bytesRead) && bytesRead > 0 && result.eventCount === 0) return "STREAM_PARSE_FAILED";
  if (diagnostics.imageCallFailed) return "IMAGE_TOOL_FAILED";
  if (diagnostics.imageCallCompleted && diagnostics.imageResultCount === 0) return "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT";
  if (!diagnostics.imageCallSeen && (result.webSearchCalls > 0 || diagnostics.webSearchCallSeen)) return "WEB_SEARCH_ONLY_RESPONSE";
  if (!diagnostics.imageCallSeen && diagnostics.messageOutputSeen) return "IMAGE_TOOL_NOT_CALLED";
  return "EMPTY_RESPONSE";
}

export function emptyResponseError(message: string, result: ParsedResponsesResult, meta: EmptyResponseMeta): ResponsesError {
  const code = classifyNoImageResponse(result);
  // Ghep CAU UPSTREAM NOI vao sau nhan cua minh.
  //
  // "Responses image tool call failed." la ten minh dat cho tinh huong, khong
  // phai thu upstream noi - doc mot minh no thi khong sua duoc gi. Cau that
  // nam trong `error.message` cua muc ve anh, da duoc lam sach.
  const tuUpstream = result.diagnostics.upstreamErrorMessage;
  const nhan = messageForCode(code, message);
  const err = new Error(tuUpstream ? `${nhan} ${tuUpstream}` : nhan) as ResponsesError;
  if (tuUpstream) err.upstreamMessage = tuUpstream;
  if (result.diagnostics.upstreamErrorCode) err.upstreamItemCode = result.diagnostics.upstreamErrorCode;
  if (result.diagnostics.upstreamErrorType) err.upstreamItemType = result.diagnostics.upstreamErrorType;
  err.status = 422;
  err.code = code;
  err.eventCount = result.eventCount;
  err.eventTypes = result.eventTypes;
  err.webSearchCalls = result.webSearchCalls;
  err.responseDiagnostics = result.diagnostics;
  Object.assign(err, meta);
  const reason = diagnosticReason(code);
  if (reason) err.diagnosticReason = reason;
  Object.defineProperty(err, RESPONSES_ERROR_MARKER, { value: true });
  return err;
}
