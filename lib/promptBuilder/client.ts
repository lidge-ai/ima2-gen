import { errInfo } from "../errInfo.js";
import { logEvent, logWarn } from "../logger.js";
import { fetchOAuth, fetchOAuthPath } from "../oauthProxy/runtime.js";
import {
  requireRuntimeContext,
  type RouteRuntimeContext,
  type RuntimeContext,
} from "../runtimeContext.js";
import {
  DEFAULT_PROMPT_BUILDER_MODELS,
  PROMPT_BUILDER_AUTO_ORDER,
} from "./constants.js";
import { promptBuilderError } from "./errors.js";
import {
  lanesForModel,
  promptBuilderLaneModel,
  normalizeMessages,
  normalizePromptBuilderBackend,
  normalizeRequestModel,
} from "./requestSchema.js";
import {
  resolvePromptBuilderTransport,
  selectPromptBuilderBackend,
  type PromptBuilderSelection,
  type PromptBuilderTransportTarget,
} from "./router.js";
import { buildTransportPayload, type TransportPayload } from "./transport.js";
import {
  parseUpstreamError,
  responseSummary,
  extractChatText,
  readResponsesResult,
} from "./responseParser.js";
import type {
  ChatCompletionBody,
  PromptBuilderChatResult,
  PromptBuilderLaneSummary,
  PromptBuilderRequest,
  ResponseShapeSummary,
} from "./types.js";

type PreparedRequest = {
  selection: PromptBuilderSelection;
  model: string;
  payload: TransportPayload;
  target: PromptBuilderTransportTarget;
};

type ParsedResponse = {
  content: string;
  usage: Record<string, unknown> | null;
  summary: ResponseShapeSummary;
};

async function prepareRequest(
  ctx: RuntimeContext,
  input: PromptBuilderRequest,
  lanes: PromptBuilderLaneSummary,
): Promise<PreparedRequest> {
  const persistedBackend = normalizePromptBuilderBackend(ctx.config.promptBuilder.backend);
  const requestedBackend = normalizePromptBuilderBackend(input.backend, persistedBackend);
  const backendOverridden = requestedBackend !== persistedBackend;
  const requestedModel = normalizeRequestModel(
    requestedBackend,
    input.model ?? (backendOverridden
      ? DEFAULT_PROMPT_BUILDER_MODELS[requestedBackend]
      : ctx.config.promptBuilder.model),
  );
  const allowedLanes = requestedBackend === "auto" && requestedModel !== "auto"
    ? lanesForModel(requestedModel)
    : PROMPT_BUILDER_AUTO_ORDER;
  const selection = selectPromptBuilderBackend(requestedBackend, lanes, allowedLanes);
  const model = requestedBackend === "auto"
    ? (requestedModel === "auto"
      ? DEFAULT_PROMPT_BUILDER_MODELS[selection.backend]
      : promptBuilderLaneModel(selection.backend, requestedModel))
    : requestedModel;
  const messages = normalizeMessages(input.messages);
  if (selection.fallbackFrom) logFallback(selection);
  const payload = buildTransportPayload(selection.backend, model, messages, input.context);
  const target = await resolvePromptBuilderTransport(ctx, selection.backend, payload.endpoint);
  return { selection, model, payload, target };
}

function logFallback(selection: PromptBuilderSelection): void {
  logEvent("prompt-builder", "backend_fallback", {
    requestedBackend: selection.requestedBackend,
    from: selection.fallbackFrom,
    to: selection.backend,
    reason: selection.fallbackReason,
  });
}

function sendUpstream(
  prepared: PreparedRequest,
  signal: AbortSignal,
): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: prepared.target.headers,
    signal,
    body: JSON.stringify(prepared.payload.body),
  };
  if (prepared.target.useOAuthFetch && prepared.target.oauth) {
    return fetchOAuthPath(prepared.target.oauth.ctx, prepared.target.oauth.path, init, { scope: "prompt-builder" });
  }
  return prepared.target.useOAuthFetch
    ? fetchOAuth(prepared.target.url, init, { scope: "prompt-builder" })
    : fetch(prepared.target.url, init);
}

async function throwUpstreamFailure(
  res: Response,
  prepared: PreparedRequest,
): Promise<never> {
  const text = await res.text();
  const upstream = parseUpstreamError(text);
  logWarn("prompt-builder", "upstream_failed", {
    endpoint: prepared.payload.endpoint,
    model: prepared.model,
    status: res.status,
    hasImageAttachments: prepared.payload.endpoint === "responses",
    upstreamBodyChars: text.length,
    upstreamCode: upstream.upstreamCode,
    upstreamType: upstream.upstreamType,
    upstreamParam: upstream.upstreamParam,
  });
  const err = promptBuilderError(
    "Prompt builder upstream failed",
    "PROMPT_BUILDER_UPSTREAM_FAILED",
    502,
  );
  Object.assign(err, {
    upstreamStatus: res.status,
    upstreamBodyChars: text.length,
    upstreamEndpoint: prepared.payload.endpoint,
    ...upstream,
  });
  throw err;
}

async function parseResponse(
  res: Response,
  endpoint: "chat" | "responses",
): Promise<ParsedResponse> {
  if (endpoint === "responses") {
    return readResponsesResult(res);
  }
  const body = (await res.json()) as ChatCompletionBody;
  return {
    content: extractChatText(body),
    usage: body.usage ?? null,
    summary: responseSummary(body),
  };
}

function requireContent(parsed: ParsedResponse, prepared: PreparedRequest): string {
  const content = parsed.content.trim();
  if (content) return content;
  logWarn("prompt-builder", "empty_response", {
    endpoint: prepared.payload.endpoint,
    model: prepared.model,
    ...parsed.summary,
  });
  const err = promptBuilderError(
    "Prompt builder returned an empty response",
    "PROMPT_BUILDER_EMPTY_RESPONSE",
    502,
  );
  err.upstreamEndpoint = prepared.payload.endpoint;
  Object.assign(err, parsed.summary);
  throw err;
}

export async function requestPromptBuilderChat(
  ctxRaw: RouteRuntimeContext,
  input: PromptBuilderRequest,
  lanes: PromptBuilderLaneSummary,
): Promise<PromptBuilderChatResult> {
  const ctx = requireRuntimeContext(ctxRaw);
  const prepared = await prepareRequest(ctx, input, lanes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.config.oauth.generationTimeoutMs);
  try {
    const res = await sendUpstream(prepared, controller.signal);
    if (!res.ok) await throwUpstreamFailure(res, prepared);
    const parsed = await parseResponse(res, prepared.payload.endpoint);
    const content = requireContent(parsed, prepared);
    return {
      provider: prepared.selection.backend,
      backend: prepared.selection.backend,
      requestedBackend: prepared.selection.requestedBackend,
      model: prepared.model,
      message: { role: "assistant", content },
      usage: parsed.usage,
    };
  } catch (error) {
    const info = errInfo(error);
    if (info.name === "AbortError") {
      throw promptBuilderError("Prompt builder timed out", "PROMPT_BUILDER_TIMEOUT", 504);
    }
    throw info.raw;
  } finally {
    clearTimeout(timer);
  }
}
