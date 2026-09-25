/**
 * xAI (Grok) OAuth credential store and refresh client.
 *
 * Ported from OpenCodex `src/oauth/xai.ts` (refresh path only) with the D1-D6/D9 fixes
 * recorded in devlog/_fin/260909_grok_native_oauth/001_opencodex_port_spec.md.
 *
 * MUST stay a leaf module: only node:fs, node:crypto, node:os, node:path. No imports from
 * config, routes, adapters, or the logger — adapters call loadGrokCredentials() synchronously.
 *
 * The file on disk (~/.progrok/auth.json) is the single source of truth. There is deliberately
 * no in-memory credential cache: progrok may refresh the same file from another process, and a
 * cache would make this module serve a token that was already rotated away.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_TOKEN_ENDPOINT_FALLBACK = `${XAI_OAUTH_ISSUER}/oauth2/token`;
export const XAI_TOKEN_REFRESH_SKEW_MS = 120_000;
export const XAI_TOKEN_REQUEST_TIMEOUT_MS = 30_000;

/** progrok's CORS allow-list (dist/index.js:24). Any other host is a poisoned discovery doc. */
const XAI_TRUSTED_AUTH_HOSTS = new Set(["auth.x.ai", "accounts.x.ai"]);
const XAI_TOKEN_MAX_ATTEMPTS = 3;
/** Retry-After is honored as sent (D1), but never long enough to hang a request forever. */
const RETRY_AFTER_CAP_MS = 60_000;
const JITTER_CAP_MS = 2_000;
const FLIGHT_STALE_MS = 120_000;
const TERMINAL_FAILURE_TTL_MS = 30_000;
const TERMINAL_OAUTH_ERRORS = new Set(["invalid_grant", "refresh_token_reused", "revoked_token"]);

export type GrokAuthErrorCode = "GROK_AUTH_REQUIRED" | "GROK_AUTH_REFRESH_FAILED";

const httpStatusForGrokAuthCode: Record<GrokAuthErrorCode, number> = {
  GROK_AUTH_REQUIRED: 401,
  GROK_AUTH_REFRESH_FAILED: 502,
};

export class GrokAuthError extends Error {
  readonly code: GrokAuthErrorCode;
  readonly status: number;
  readonly oauthError?: string;

  constructor(code: GrokAuthErrorCode, message: string, options?: { oauthError?: string; cause?: unknown }) {
    super(message, options && "cause" in options ? { cause: options.cause } : undefined);
    this.name = "GrokAuthError";
    this.code = code;
    this.status = httpStatusForGrokAuthCode[code];
    if (options?.oauthError !== undefined) this.oauthError = options.oauthError;
  }
}

/** ~/.progrok/auth.json on-disk shape. Byte-compatible with progrok 0.2.0. */
export interface GrokCredentials {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms, RAW: the skew is subtracted at comparison time, never stored (D8). */
  expiresAt?: number;
  tokenEndpoint?: string;
  email?: string;
  idToken?: string;
  accountId?: string;
}

export interface XaiDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
}

export interface XaiTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  token_type?: unknown;
}

export interface XaiTokenRetryDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export class XaiTokenRequestError extends Error {
  readonly status?: number;
  readonly oauthError?: string;

  constructor(
    status?: number,
    oauthError?: string,
    message = "xAI token request failed",
    options?: { cause?: unknown },
  ) {
    super(message, options && "cause" in options ? { cause: options.cause } : undefined);
    this.name = "XaiTokenRequestError";
    if (status !== undefined) this.status = status;
    if (oauthError !== undefined) this.oauthError = oauthError;
  }
}

interface XaiDiscoveryPayload {
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  device_authorization_endpoint?: unknown;
}

interface XaiJwtPayload {
  sub?: unknown;
  email?: unknown;
}

// ---------------------------------------------------------------------------
// Credential file I/O
// ---------------------------------------------------------------------------

export function grokAuthFilePath(homeDir: string = homedir()): string {
  return join(homeDir, ".progrok", "auth.json");
}

/** Never throws: a missing, unreadable, or malformed file is simply "not logged in". */
export function loadGrokCredentials(homeDir?: string): GrokCredentials | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(grokAuthFilePath(homeDir), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.accessToken !== "string" || record.accessToken.length === 0) return null;
    // Keep the raw record so unknown keys written by progrok survive a round-trip.
    return record as unknown as GrokCredentials;
  } catch {
    return null;
  }
}

/** Atomic 0600 write (tmp + rename); the directory is forced to 0700. */
export function saveGrokCredentials(creds: GrokCredentials, homeDir?: string): void {
  const target = grokAuthFilePath(homeDir);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `auth.json.tmp-${randomBytes(6).toString("hex")}`);
  writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
}

/** Explicit logout only. A refresh failure must never delete the file. */
export function clearGrokCredentials(homeDir?: string): void {
  rmSync(grokAuthFilePath(homeDir), { force: true });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(XAI_TOKEN_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

/** D6: exact host allow-list, https only, and no userinfo that fetch could turn into auth. */
function validateXaiAuthEndpoint(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !XAI_TRUSTED_AUTH_HOSTS.has(host)) {
    throw new Error(`xAI OAuth endpoint is not trusted: ${rawUrl}`);
  }
  return parsed.toString();
}

export async function discoverXaiOAuthEndpoints(signal?: AbortSignal): Promise<XaiDiscovery> {
  const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    signal: requestSignal(signal),
  });
  if (!response.ok) {
    throw new Error(`xAI OAuth discovery failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as XaiDiscoveryPayload;
  if (typeof payload.authorization_endpoint !== "string" || typeof payload.token_endpoint !== "string") {
    throw new Error("xAI OAuth discovery response missing authorization/token endpoints");
  }
  const discovery: XaiDiscovery = {
    authorizationEndpoint: validateXaiAuthEndpoint(payload.authorization_endpoint),
    tokenEndpoint: validateXaiAuthEndpoint(payload.token_endpoint),
  };
  if (typeof payload.device_authorization_endpoint === "string") {
    discovery.deviceAuthorizationEndpoint = validateXaiAuthEndpoint(payload.device_authorization_endpoint);
  }
  return discovery;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** D2: RFC 9110 allows delay-seconds (including fractions) and HTTP-date. */
function parseRetryAfterMs(retryAfter: string | null): number | undefined {
  const raw = retryAfter?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function retryDelayMs(attempt: number, retryAfter: string | null, random: () => number): number {
  const fromHeader = parseRetryAfterMs(retryAfter);
  // D1: a server instruction wins over local jitter; only the absolute ceiling clamps it.
  if (fromHeader !== undefined) return Math.min(fromHeader, RETRY_AFTER_CAP_MS);
  const base = attempt === 1 ? 100 : 250;
  return Math.min(JITTER_CAP_MS, Math.round(base * (0.75 + random() * 0.5)));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** D9: always drain the failed body so undici can reuse the socket. */
async function readTokenError(response: Response): Promise<XaiTokenRequestError> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // Body already gone; the status alone still classifies the failure.
  }
  let oauthError: string | undefined;
  let detail = "";
  try {
    const body = JSON.parse(raw) as { error?: unknown; error_description?: unknown };
    if (typeof body.error === "string") oauthError = body.error;
    if (typeof body.error_description === "string") detail = body.error_description;
  } catch {
    // Non-JSON error body.
  }
  const suffix = detail ? `: ${detail}` : oauthError ? `: ${oauthError}` : "";
  return new XaiTokenRequestError(response.status, oauthError, `xAI token request failed: ${response.status}${suffix}`);
}

function sendTokenRequest(
  tokenEndpoint: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(tokenEndpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: requestSignal(signal),
  });
}

export async function postXaiToken(
  tokenEndpoint: string,
  body: Record<string, string>,
  signal?: AbortSignal,
  deps: XaiTokenRetryDeps = {},
): Promise<XaiTokenPayload> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  let last: unknown;
  for (let attempt = 1; attempt <= XAI_TOKEN_MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await sendTokenRequest(tokenEndpoint, body, signal);
    } catch (error) {
      // D3: the caller's abort reason can be any value, so trust signal.aborted, not the error type.
      if (signal?.aborted) throw error;
      if (isTimeoutError(error)) {
        throw new XaiTokenRequestError(undefined, undefined, "xAI token request timed out", { cause: error });
      }
      last = error;
      if (attempt === XAI_TOKEN_MAX_ATTEMPTS) break;
      await sleep(retryDelayMs(attempt, null, random));
      continue;
    }
    if (response.ok) return (await response.json()) as XaiTokenPayload;
    const error = await readTokenError(response);
    last = error;
    if (!(response.status === 429 || response.status >= 500) || attempt === XAI_TOKEN_MAX_ATTEMPTS) throw error;
    await sleep(retryDelayMs(attempt, response.headers.get("retry-after"), random));
  }
  // D4: never rethrow the bare last value — it can be undefined and erases the failure shape.
  throw new XaiTokenRequestError(undefined, undefined, "xAI token request exhausted retries", { cause: last });
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): XaiJwtPayload | undefined {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as XaiJwtPayload;
  } catch {
    return undefined;
  }
}

/** Display metadata only: the signature is never verified, so this cannot gate authorization. */
function getTokenIdentity(accessToken: string, idToken?: string): { accountId?: string; email?: string } {
  const payload = (idToken ? decodeJwtPayload(idToken) : undefined) ?? decodeJwtPayload(accessToken);
  const identity: { accountId?: string; email?: string } = {};
  if (typeof payload?.sub === "string" && payload.sub.length > 0) identity.accountId = payload.sub;
  if (typeof payload?.email === "string" && payload.email.length > 0) identity.email = payload.email.toLowerCase();
  return identity;
}

function credentialsFromTokenPayload(
  payload: XaiTokenPayload,
  refreshFallback: string,
  tokenEndpoint: string,
  now: () => number,
): GrokCredentials {
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("xAI token response did not include an access token");
  }
  const refreshToken = typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
    ? payload.refresh_token
    : refreshFallback;
  if (!refreshToken) throw new Error("xAI token response did not include a refresh token");
  const creds: GrokCredentials = { accessToken: payload.access_token, refreshToken, tokenEndpoint };
  // D5: no 3600 fallback. An absent expires_in means "unknown", and 401 becomes the signal —
  // inventing an hour would let this module hand out a token it already knows nothing about.
  if (typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)) {
    creds.expiresAt = now() + payload.expires_in * 1000;
  }
  if (typeof payload.id_token === "string" && payload.id_token.length > 0) creds.idToken = payload.id_token;
  const identity = getTokenIdentity(creds.accessToken, creds.idToken);
  if (identity.accountId !== undefined) creds.accountId = identity.accountId;
  if (identity.email !== undefined) creds.email = identity.email;
  return creds;
}

export async function refreshXaiToken(
  refreshToken: string,
  opts: { tokenEndpoint?: string; signal?: AbortSignal; deps?: XaiTokenRetryDeps } = {},
): Promise<GrokCredentials> {
  if (!refreshToken) throw new Error("xAI credentials are expired and do not include a refresh token");
  const raw = opts.tokenEndpoint ?? (await discoverXaiOAuthEndpoints(opts.signal)).tokenEndpoint;
  const tokenEndpoint = validateXaiAuthEndpoint(raw);
  const payload = await postXaiToken(
    tokenEndpoint,
    { grant_type: "refresh_token", client_id: XAI_OAUTH_CLIENT_ID, refresh_token: refreshToken },
    opts.signal,
    opts.deps,
  );
  return credentialsFromTokenPayload(payload, refreshToken, tokenEndpoint, opts.deps?.now ?? Date.now);
}

// ---------------------------------------------------------------------------
// Access token accessor (single-flight + negative cache)
// ---------------------------------------------------------------------------

interface RefreshFlight {
  promise: Promise<GrokCredentials>;
  startedAt: number;
}

let refreshFlight: RefreshFlight | undefined;
let terminalFailureUntil = 0;

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
  /** The token that just got a 401. If the file already moved on, no refresh is needed. */
  rejectedAccessToken?: string;
  signal?: AbortSignal;
  homeDir?: string;
  deps?: XaiTokenRetryDeps;
}

const LOGIN_REQUIRED_MESSAGE = "Grok login required. Run: ima2 grok login";

function toGrokAuthError(error: unknown, now: () => number): GrokAuthError {
  if (error instanceof GrokAuthError) return error;
  const oauthError = error instanceof XaiTokenRequestError ? error.oauthError : undefined;
  if (oauthError !== undefined && TERMINAL_OAUTH_ERRORS.has(oauthError)) {
    // Terminal: block further round-trips for a while, but leave the file alone so the user
    // keeps their display metadata and a misclassified failure stays recoverable.
    terminalFailureUntil = now() + TERMINAL_FAILURE_TTL_MS;
    return new GrokAuthError("GROK_AUTH_REQUIRED", `Grok session is no longer valid. ${LOGIN_REQUIRED_MESSAGE}`, {
      oauthError,
      cause: error,
    });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new GrokAuthError("GROK_AUTH_REFRESH_FAILED", `Grok token refresh failed: ${detail}`, {
    ...(oauthError !== undefined ? { oauthError } : {}),
    cause: error,
  });
}

async function performRefresh(stored: GrokCredentials, opts: GetAccessTokenOptions): Promise<GrokCredentials> {
  const now = opts.deps?.now ?? Date.now;
  try {
    const fresh = await refreshXaiToken(stored.refreshToken ?? "", {
      ...(stored.tokenEndpoint !== undefined ? { tokenEndpoint: stored.tokenEndpoint } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.deps !== undefined ? { deps: opts.deps } : {}),
    });
    // The file is the single source of truth and other writers (progrok, a device login,
    // a logout) can move it while a refresh is in flight — never clobber or resurrect it.
    const current = loadGrokCredentials(opts.homeDir);
    if (!current) throw new GrokAuthError("GROK_AUTH_REQUIRED", LOGIN_REQUIRED_MESSAGE);
    if (current.refreshToken !== stored.refreshToken) return current;
    const merged: GrokCredentials = { ...current, ...fresh };
    // An unknown new expiry must erase the old one rather than inherit a stale deadline.
    if (fresh.expiresAt === undefined) delete merged.expiresAt;
    saveGrokCredentials(merged, opts.homeDir);
    return merged;
  } catch (error) {
    throw toGrokAuthError(error, now);
  }
}

function runRefreshFlight(stored: GrokCredentials, opts: GetAccessTokenOptions): Promise<GrokCredentials> {
  const now = opts.deps?.now ?? Date.now;
  const existing = refreshFlight;
  if (existing && now() - existing.startedAt <= FLIGHT_STALE_MS) return existing.promise;
  // The flight is shared, so no caller's signal may reach it: one aborted request must
  // not fail every other caller joined to the same refresh (callers abort via their
  // own await in getGrokAccessToken instead).
  const shared: GetAccessTokenOptions = {
    ...(opts.forceRefresh !== undefined ? { forceRefresh: opts.forceRefresh } : {}),
    ...(opts.rejectedAccessToken !== undefined ? { rejectedAccessToken: opts.rejectedAccessToken } : {}),
    ...(opts.homeDir !== undefined ? { homeDir: opts.homeDir } : {}),
    ...(opts.deps !== undefined ? { deps: opts.deps } : {}),
  };
  const flight: RefreshFlight = { startedAt: now(), promise: performRefresh(stored, shared) };
  // Release only when we are still the current flight, so a slow earlier refresh cannot
  // clear a newer one (OpenCodex index.ts:537 pattern).
  flight.promise = flight.promise.finally(() => {
    if (refreshFlight === flight) refreshFlight = undefined;
  });
  refreshFlight = flight;
  return flight.promise;
}

export async function getGrokAccessToken(opts: GetAccessTokenOptions = {}): Promise<string> {
  const now = opts.deps?.now ?? Date.now;
  if (now() < terminalFailureUntil) {
    throw new GrokAuthError("GROK_AUTH_REQUIRED", `Grok session is no longer valid. ${LOGIN_REQUIRED_MESSAGE}`);
  }
  const stored = loadGrokCredentials(opts.homeDir);
  if (!stored) throw new GrokAuthError("GROK_AUTH_REQUIRED", LOGIN_REQUIRED_MESSAGE);
  if (opts.rejectedAccessToken !== undefined && stored.accessToken !== opts.rejectedAccessToken) {
    return stored.accessToken;
  }
  const expiring = stored.expiresAt !== undefined && now() + XAI_TOKEN_REFRESH_SKEW_MS >= stored.expiresAt;
  if (!opts.forceRefresh && !expiring) return stored.accessToken;
  if (!stored.refreshToken) {
    throw new GrokAuthError(
      "GROK_AUTH_REQUIRED",
      `Grok session expired and cannot be refreshed. ${LOGIN_REQUIRED_MESSAGE}`,
    );
  }
  const fresh = await raceWithAbort(runRefreshFlight(stored, opts), opts.signal);
  return fresh.accessToken;
}

/** A caller bails on its own signal without cancelling the shared flight. */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason as unknown);
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason as unknown), { once: true });
    }),
  ]);
}

/** Test-only: clears the single-flight slot and the terminal-failure negative cache. */
export function __resetGrokAuthStateForTest(): void {
  refreshFlight = undefined;
  terminalFailureUntil = 0;
}
