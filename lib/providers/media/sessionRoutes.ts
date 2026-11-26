import { oauthFetch } from "../../codexBackend/index.js";
import { resolveGrokCredential } from "../../grokRuntime.js";
import type { RuntimeContext } from "../../runtimeContext.js";

/**
 * Subscription routes for workflows (L6 subscription presets): a registered media
 * adapter driven with a signed-in session instead of a saved API key.
 * - xai-oauth: the xai adapter with the Grok OAuth access token (a bearer for api.x.ai).
 * - openai-oauth: the openai Images adapter over the GPT OAuth transport; requests to
 *   https://api.openai.com/<path> are sent through oauthFetch(<path>).
 */
export interface SessionRoute {
  /** The registered adapter that speaks this upstream's API. */
  adapterId: string;
  label: string;
  open(signal: AbortSignal): Promise<{ apiKey: string; fetch?: typeof fetch; baseUrl?: string }>;
}

const OPENAI_API = "https://api.openai.com";

function oauthTransport(ctx: RuntimeContext): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${OPENAI_API}/`)) return Promise.reject(new Error("GPT OAuth transport only reaches api.openai.com paths"));
    return oauthFetch({ oauthUrl: ctx.oauthUrl, oauthTransport: ctx.oauthTransport, config: ctx.config }, url.slice(OPENAI_API.length), init ?? {});
  }) as typeof fetch;
}

export function createSessionRoutes(ctx: RuntimeContext): Record<string, SessionRoute> {
  return {
    "xai-oauth": {
      adapterId: "xai",
      label: "Grok subscription (Grok OAuth)",
      async open(signal) {
        const credential = await resolveGrokCredential(ctx, "grok", { signal });
        return { apiKey: credential.kind === "oauth" ? credential.token : credential.key };
      },
    },
    "openai-oauth": {
      adapterId: "openai",
      label: "ChatGPT subscription (GPT OAuth)",
      async open() {
        // The proxy or native transport holds the session; the adapter's key header is ignored upstream.
        return { apiKey: "gpt-oauth-session", fetch: oauthTransport(ctx), baseUrl: OPENAI_API };
      },
    },
  };
}
