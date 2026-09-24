/**
 * One status projection for every OAuth login, shared by `ima2 status`, `ima2 gpt status`,
 * `ima2 doctor`, and GET /api/oauth/status. Modelled on OpenCodex `getLoginStatus` +
 * `src/oauth/health.ts`: a health verdict, the account (masked), and the one action that fixes
 * it. No tokens and no full account ids ever leave this module.
 *
 * MUST stay a leaf module apart from the two credential stores.
 */
import { resolveChatgptSession, type ChatgptSession } from "./chatgptAuth.js";
import { loadGrokCredentials, type GrokCredentials } from "./xaiAuth.js";

export type AuthHealth = "healthy" | "warning" | "reauth_required" | "not_logged_in";

export type GptSessionState = "ready" | "access_expired" | "no_refresh_token" | "none";

export interface ProviderAuthStatus {
  provider: "gpt" | "grok";
  loggedIn: boolean;
  health: AuthHealth;
  /** Why the verdict is not plain healthy (machine-readable). */
  reason?: "no_session" | "no_refresh_token" | "session_expired" | "shared_with_codex_cli" | "proxy_rejected_session";
  source?: string;
  email?: string;
  plan?: string;
  accountId?: string;
  /** ISO time the access token expires; an expired one with a refresh token still works. */
  expiresAt?: string;
  refreshable: boolean;
  action?: string;
  note?: string;
}

export function maskAccountId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.length <= 8 ? `${id.slice(0, 2)}…` : `${id.slice(0, 8)}…`;
}

/**
 * An expired access token with a refresh token is still a usable session: the proxy refreshes
 * it on the next request (OpenCodex getLoginStatus treats it the same way).
 */
export function gptSessionState(session: ChatgptSession | null, now = Date.now()): GptSessionState {
  if (!session) return "none";
  if (!session.refreshable) return "no_refresh_token";
  if (session.accessExpiresAt !== undefined && session.accessExpiresAt <= now) return "access_expired";
  return "ready";
}

export interface GptAuthStatusOptions {
  /** Live verdict from the running proxy (GET /api/oauth/status), when one is known. */
  proxyStatus?: "ready" | "auth_required" | "starting" | "offline";
  now?: number;
}

export function gptAuthStatus(session: ChatgptSession | null = resolveChatgptSession(), options: GptAuthStatusOptions = {}): ProviderAuthStatus {
  const state = gptSessionState(session, options.now);
  if (!session) {
    return { provider: "gpt", loggedIn: false, health: "not_logged_in", reason: "no_session", refreshable: false, action: "ima2 login" };
  }
  const base: ProviderAuthStatus = {
    provider: "gpt",
    loggedIn: true,
    health: "healthy",
    source: session.source,
    refreshable: session.refreshable,
    ...(session.email ? { email: session.email } : {}),
    ...(session.plan ? { plan: session.plan } : {}),
    ...(session.accountId ? { accountId: maskAccountId(session.accountId)! } : {}),
    ...(session.accessExpiresAt !== undefined ? { expiresAt: new Date(session.accessExpiresAt).toISOString() } : {}),
  };
  if (state === "no_refresh_token") {
    return { ...base, loggedIn: false, health: "reauth_required", reason: "no_refresh_token", action: "ima2 login" };
  }
  if (options.proxyStatus === "auth_required") {
    return {
      ...base,
      loggedIn: false,
      health: "reauth_required",
      reason: "proxy_rejected_session",
      action: "ima2 login",
      note: "The GPT OAuth proxy was refused by ChatGPT with this session (revoked, or its refresh token was rotated by another client).",
    };
  }
  if (session.source !== "ima2") {
    return {
      ...base,
      health: "warning",
      reason: "shared_with_codex_cli",
      action: "ima2 login",
      note: "Shared with the Codex CLI: whichever client refreshes second can be logged out. Logging in with ima2 gives it its own session.",
    };
  }
  if (state === "access_expired") return { ...base, note: "The access token refreshes on the next request." };
  return base;
}

export function grokAuthStatus(creds: GrokCredentials | null = loadGrokCredentials(), now = Date.now()): ProviderAuthStatus {
  if (!creds) {
    return { provider: "grok", loggedIn: false, health: "not_logged_in", reason: "no_session", refreshable: false, action: "ima2 grok login" };
  }
  const refreshable = typeof creds.refreshToken === "string" && creds.refreshToken.length > 0;
  const base: ProviderAuthStatus = {
    provider: "grok",
    loggedIn: true,
    health: "healthy",
    source: "progrok",
    refreshable,
    ...(creds.email ? { email: creds.email } : {}),
    ...(creds.accountId ? { accountId: maskAccountId(creds.accountId)! } : {}),
    ...(creds.expiresAt !== undefined ? { expiresAt: new Date(creds.expiresAt).toISOString() } : {}),
  };
  const expired = creds.expiresAt !== undefined && creds.expiresAt <= now;
  if (expired && !refreshable) {
    return { ...base, loggedIn: false, health: "reauth_required", reason: "session_expired", action: "ima2 grok login" };
  }
  if (expired) return { ...base, note: "The access token refreshes on the next request." };
  return base;
}
