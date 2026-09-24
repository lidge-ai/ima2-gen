import { config } from "../../config.js";
import { logEvent } from "../logger.js";
import { isAbortError, makeOAuthError } from "./errors.js";
import type { RouteRuntimeContext } from "../runtimeContext.js";

import { errInfo } from "../errInfo.js";
const FALLBACK_REASONING_EFFORT = "none";
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export interface OAuthRuntimeOptions {
  reasoningEffort?: unknown;
  webSearchEnabled?: unknown;
  searchMode?: unknown;
}

export function resolveReasoningEffort(ctx: RouteRuntimeContext | undefined, options: OAuthRuntimeOptions = {}) {
  const fromOptions = typeof options.reasoningEffort === "string" ? options.reasoningEffort : null;
  const fromCtx = typeof ctx?.config?.imageModels?.reasoningEffort === "string"
    ? ctx.config.imageModels.reasoningEffort
    : null;
  const candidate = fromOptions || fromCtx || FALLBACK_REASONING_EFFORT;
  return VALID_REASONING_EFFORTS.has(candidate) ? candidate : FALLBACK_REASONING_EFFORT;
}

export function resolveWebSearchEnabled(options: OAuthRuntimeOptions = {}) {
  return options.webSearchEnabled !== false && options.searchMode !== "off";
}

export function buildImageTools(webSearchEnabled: boolean, imageOptions: Record<string, unknown>) {
  return [
    ...(webSearchEnabled ? [{ type: "web_search" }] : []),
    { type: "image_generation", ...imageOptions },
  ];
}

export function getOAuthUrl(ctx: RouteRuntimeContext = {}) {
  return ctx.oauthUrl || `http://127.0.0.1:${config.oauth.proxyPort}`;
}

export function getOAuthGenerationTimeoutMs(ctx: RouteRuntimeContext = {}) {
  return ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs ?? 400 * 1000;
}

export function createOAuthGenerationTimeout(ctx: RouteRuntimeContext = {}, requestId: string | null = null, scope: string = "oauth") {
  const timeoutMs = getOAuthGenerationTimeoutMs(ctx);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: undefined as AbortSignal | undefined,
      timeoutMs,
      clear: () => {},
      isTimeoutError: (_err: unknown) => false,
    };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logEvent(scope, "timeout", { requestId, timeoutMs });
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal as AbortSignal | undefined,
    timeoutMs,
    clear: () => clearTimeout(timer),
    isTimeoutError: (err: unknown) => timedOut && isAbortError(err),
  };
}

export async function waitForOAuthReady(ctx: RouteRuntimeContext = {}) {
  if (!ctx || ctx.oauthReadyState === undefined) return;
  // A new login may have landed since the proxy started (or gave up); restart onto it first.
  if (ctx.oauthReadyState === "failed") ctx.syncOAuthProxySession?.();
  const initialState = ctx.oauthReadyState;
  if (initialState === "ready" || initialState === "disabled") return;
  if (initialState === "failed") {
    throw makeOAuthError("OAuth proxy is unavailable", { code: "OAUTH_UNAVAILABLE", status: 503 });
  }
  const timeoutMs = ctx.config?.oauth?.statusTimeoutMs ?? config.oauth.statusTimeoutMs;
  if (ctx.oauthReadyPromise) {
    await Promise.race([
      ctx.oauthReadyPromise,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  const finalState = ctx.oauthReadyState;
  if (finalState !== "ready" && finalState !== "disabled") {
    throw makeOAuthError("OAuth proxy is not ready yet", { code: "OAUTH_UNAVAILABLE", status: 503 });
  }
}

export async function fetchOAuth(url: string, init: RequestInit, { requestId, scope }: { requestId?: string | null; scope?: string } = {}) {
  try {
    return await fetch(url, init);
  } catch (e) {
    const err = errInfo(e);
    if (isAbortError(err.raw)) throw err.raw;
    logEvent(scope || "oauth", "proxy_unavailable", { requestId, message: err.message });
    throw makeOAuthError("OAuth proxy is unavailable", {
      code: "OAUTH_UNAVAILABLE",
      status: 503,
      cause: err.raw,
    });
  }
}

export function summarizeEventTypes(eventTypes: Record<string, unknown> = {}) {
  const entries = Object.entries(eventTypes || {});
  const countFor = (needle: string) =>
    entries.reduce((sum, [key, value]) => sum + (key.includes(needle) && Number.isFinite(value) ? (value as number) : 0), 0);
  return {
    eventTypeCount: entries.length,
    eventTypeKeys: entries.slice(0, 12).map(([key]) => key).join(","),
    imageEventCount: countFor("image"),
    partialEventCount: countFor("partial"),
    completedEventCount: countFor("completed"),
  };
}
