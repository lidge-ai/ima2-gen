import { getGrokEndpoint, resolveGrokCredential, type GrokCredential } from "../grokRuntime.js";
import { GrokAuthError } from "../xaiAuth.js";
import { waitForOAuthReady } from "../oauthProxy/runtime.js";
import type { RuntimeContext } from "../runtimeContext.js";
import {
  PROMPT_BUILDER_AUTO_ORDER,
  type PromptBuilderBackend,
  type ResolvedPromptBuilderBackend,
} from "./constants.js";
import { promptBuilderError } from "./errors.js";
import type { PromptBuilderLaneSummary } from "./types.js";

export type PromptBuilderSelection = {
  requestedBackend: PromptBuilderBackend;
  backend: ResolvedPromptBuilderBackend;
  fallbackFrom?: ResolvedPromptBuilderBackend;
  fallbackReason?: string;
};

export type PromptBuilderTransportTarget = {
  url: string;
  headers: Record<string, string>;
  useOAuthFetch: boolean;
  /** GPT OAuth only: the /v1 path and context oauthFetch routes (native client or proxy). */
  oauth?: { ctx: RuntimeContext; path: string };
};

function unavailableBackendError(backend: ResolvedPromptBuilderBackend): Error {
  if (backend === "api") {
    return promptBuilderError(
      "OpenAI API key is required for Prompt Builder",
      "PROMPT_BUILDER_API_KEY_REQUIRED",
      401,
    );
  }
  if (backend === "grok-api") {
    return promptBuilderError(
      "xAI API key is required for Prompt Builder",
      "PROMPT_BUILDER_XAI_KEY_REQUIRED",
      401,
    );
  }
  return promptBuilderError(
    `${backend === "oauth" ? "OAuth" : "Grok"} backend is unavailable for Prompt Builder`,
    backend === "oauth"
      ? "PROMPT_BUILDER_OAUTH_UNAVAILABLE"
      : "PROMPT_BUILDER_GROK_UNAVAILABLE",
    503,
  );
}

/**
 * Both Grok lanes now go through the same resolver, so a missing credential surfaces as the
 * lane's own "unavailable" error instead of a raw auth failure. A refresh that fails against
 * xAI is a real upstream fault and propagates unchanged.
 */
async function grokCredential(
  ctx: RuntimeContext,
  backend: "grok" | "grok-api",
): Promise<GrokCredential> {
  try {
    return await resolveGrokCredential(ctx, backend);
  } catch (error) {
    if (error instanceof GrokAuthError && error.code === "GROK_AUTH_REQUIRED") {
      throw unavailableBackendError("grok");
    }
    if ((error as { code?: string } | null)?.code === "GROK_API_KEY_MISSING") {
      throw unavailableBackendError("grok-api");
    }
    throw error;
  }
}

export function selectPromptBuilderBackend(
  requestedBackend: PromptBuilderBackend,
  lanes: PromptBuilderLaneSummary,
  allowed: readonly ResolvedPromptBuilderBackend[] = PROMPT_BUILDER_AUTO_ORDER,
): PromptBuilderSelection {
  if (requestedBackend !== "auto") {
    if (lanes[requestedBackend]?.status !== "ready") {
      throw unavailableBackendError(requestedBackend);
    }
    return { requestedBackend, backend: requestedBackend };
  }
  const backend = allowed.find(
    (candidate) => lanes[candidate]?.status === "ready",
  );
  if (!backend) {
    throw promptBuilderError(
      "No Prompt Builder backend is ready",
      "PROMPT_BUILDER_NO_BACKEND_READY",
      503,
    );
  }
  const first = allowed[0];
  return first === undefined || backend === first
    ? { requestedBackend, backend }
    : {
        requestedBackend,
        backend,
        fallbackFrom: first,
        fallbackReason: lanes[first]?.reason || lanes[first]?.status || "not-ready",
      };
}

export async function resolvePromptBuilderTransport(
  ctx: RuntimeContext,
  backend: ResolvedPromptBuilderBackend,
  endpoint: "chat" | "responses",
): Promise<PromptBuilderTransportTarget> {
  try {
    if (backend === "oauth") {
      await waitForOAuthReady(ctx);
      const path = endpoint === "responses" ? "/v1/responses" : "/v1/chat/completions";
      return {
        url: `${ctx.oauthUrl}${path}`,
        headers: { "Content-Type": "application/json" },
        useOAuthFetch: true,
        oauth: { ctx, path },
      };
    }
    if (backend === "api") {
      if (!ctx.apiKey) throw unavailableBackendError("api");
      return {
        url: "https://api.openai.com/v1/responses",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${ctx.apiKey}`,
        },
        useOAuthFetch: false,
      };
    }
    const target = getGrokEndpoint("/v1/chat/completions", await grokCredential(ctx, backend));
    return { ...target, useOAuthFetch: false };
  } catch (error) {
    throw error;
  }
}
