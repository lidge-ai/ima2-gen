/**
 * Where GPT OAuth calls go: in process (native) or an external OpenAI-compatible endpoint at
 * `ctx.oauthUrl` (IMA2_NO_OAUTH_PROXY, and tests that stub the proxy URL). Kept apart from
 * index.ts so error wording can name the endpoint without loading the transport itself.
 */
export interface OAuthTransportContext {
  oauthUrl?: string | undefined;
  oauthTransport?: "native" | "proxy" | undefined;
  config?: { oauth?: { proxyEditsBody?: string | undefined } | undefined } | undefined;
}

export const DEFAULT_OAUTH_PROXY_URL = "http://127.0.0.1:10531";

export function usesNativeOAuth(ctx: OAuthTransportContext | null | undefined): boolean {
  return ctx?.oauthTransport === "native";
}

/** Drop trailing slashes with a linear scan (no regex backtracking on untrusted input). */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

/** An external endpoint URL without embedded credentials or a trailing slash. */
export function safeOAuthBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    return trimTrailingSlashes(parsed.toString());
  } catch {
    return trimTrailingSlashes(value);
  }
}

/** host:port of the external endpoint, or null when GPT OAuth runs in process. */
export function oauthEndpointLabel(ctx: OAuthTransportContext | null | undefined): string | null {
  if (usesNativeOAuth(ctx)) return null;
  const base = safeOAuthBaseUrl(ctx?.oauthUrl || DEFAULT_OAUTH_PROXY_URL);
  try {
    return new URL(base).host || base;
  } catch {
    return base;
  }
}
