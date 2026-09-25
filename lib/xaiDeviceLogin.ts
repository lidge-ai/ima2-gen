/**
 * Stateless xAI (Grok) OAuth device-code login.
 *
 * routes/auth.ts keeps its own device-code flow because it is bound to the GUI session Map
 * and its cleanup timers (030 wp4, audit item 6). This module is the CLI-side twin: one call,
 * no module state, no timers left behind, and the only shared surface is lib/xaiAuth.ts.
 *
 * MUST stay a leaf module: only lib/xaiAuth.js. No config, routes, or adapters.
 */
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  discoverXaiOAuthEndpoints,
  saveGrokCredentials,
  type GrokCredentials,
} from "./xaiAuth.js";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8628 floor: never poll faster than this even if the server asks for less. */
const MIN_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_STEP_MS = 5_000;
const DEVICE_REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
/** Consecutive transport/5xx poll failures tolerated before the login gives up. */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export interface XaiDeviceCodeInfo {
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

export interface RunXaiDeviceLoginOptions {
  /** Called once, as soon as the code exists: the caller owns how it is displayed. */
  onUserCode: (info: XaiDeviceCodeInfo) => void;
  signal?: AbortSignal;
  homeDir?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  intervalSeconds: number;
}

type PollOutcome =
  | { kind: "token"; payload: Record<string, unknown> }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "retryable"; status?: number };

interface PollDeps {
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal | undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function formEncoded(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

async function requestDeviceCode(
  endpoint: string,
  deps: PollDeps,
): Promise<DeviceCodeGrant> {
  const response = await deps.doFetch(endpoint, {
    ...formEncoded({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }),
    signal: requestSignal(deps.signal, DEVICE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`xAI device code request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    device_code?: unknown;
    user_code?: unknown;
    verification_uri?: unknown;
    verification_uri_complete?: unknown;
    expires_in?: unknown;
    interval?: unknown;
  };
  const verification = typeof body.verification_uri_complete === "string" && body.verification_uri_complete
    ? body.verification_uri_complete
    : body.verification_uri;
  if (typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof verification !== "string") {
    throw new Error("xAI device code response is missing device_code/user_code/verification_uri");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: verification,
    expiresIn: typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? body.expires_in : 600,
    intervalSeconds: typeof body.interval === "number" && Number.isFinite(body.interval) ? body.interval : MIN_POLL_INTERVAL_SECONDS,
  };
}

async function pollTokenOnce(tokenEndpoint: string, deviceCode: string, deps: PollDeps): Promise<PollOutcome> {
  let response: Response;
  try {
    response = await deps.doFetch(tokenEndpoint, {
      ...formEncoded({ grant_type: DEVICE_CODE_GRANT, client_id: XAI_OAUTH_CLIENT_ID, device_code: deviceCode }),
      signal: requestSignal(deps.signal, TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    // A reset or one timed-out poll must not kill an interactive login the user is
    // still completing; the caller tolerates a few consecutive failures.
    return { kind: "retryable" };
  }
  if (response.ok) return { kind: "token", payload: (await response.json()) as Record<string, unknown> };
  const raw = await response.text();
  let oauthError: string | undefined;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string") oauthError = parsed.error;
  } catch {
    // Non-JSON error body; the status alone classifies the failure.
  }
  if (oauthError === "authorization_pending") return { kind: "pending" };
  if (oauthError === "slow_down") return { kind: "slow_down" };
  if (response.status === 429 || response.status >= 500) return { kind: "retryable", status: response.status };
  throw new Error(`xAI device login failed: ${oauthError ?? `HTTP ${response.status}`}`);
}

/**
 * Elapsed time is the larger of wall time and the time we asked to sleep, so an injected
 * no-op sleep still walks the clock to expires_in instead of spinning forever.
 */
async function pollUntilAuthorized(
  tokenEndpoint: string,
  grant: DeviceCodeGrant,
  deps: PollDeps,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const deadlineMs = grant.expiresIn * 1000;
  let intervalMs = Math.max(grant.intervalSeconds, MIN_POLL_INTERVAL_SECONDS) * 1000;
  let sleptMs = 0;
  let consecutiveFailures = 0;
  let lastFailureStatus: number | undefined;
  while (Math.max(Date.now() - startedAt, sleptMs) < deadlineMs) {
    await deps.sleep(intervalMs);
    sleptMs += intervalMs;
    if (deps.signal?.aborted) throw new Error("xAI device login was aborted");
    const outcome = await pollTokenOnce(tokenEndpoint, grant.deviceCode, deps);
    if (outcome.kind === "token") return outcome.payload;
    if (outcome.kind === "retryable") {
      consecutiveFailures += 1;
      if (outcome.status !== undefined) lastFailureStatus = outcome.status;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error(`xAI device login failed: the token endpoint kept failing (last: HTTP ${lastFailureStatus ?? "network"})`);
      }
      continue;
    }
    consecutiveFailures = 0;
    if (outcome.kind === "slow_down") intervalMs += SLOW_DOWN_STEP_MS;
  }
  throw new Error("xAI device login expired before it was approved");
}

/** Display metadata only: the id_token signature is never verified here. */
function emailFromIdToken(idToken: string): string | undefined {
  const segment = idToken.split(".")[1];
  if (!segment) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as { email?: unknown };
    if (typeof payload.email !== "string" || payload.email.length === 0) return undefined;
    return payload.email.toLowerCase();
  } catch {
    return undefined;
  }
}

function credentialsFromDeviceToken(payload: Record<string, unknown>, tokenEndpoint: string): GrokCredentials {
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("xAI token response did not include an access token");
  }
  const creds: GrokCredentials = { accessToken: payload.access_token, tokenEndpoint };
  if (typeof payload.refresh_token === "string" && payload.refresh_token.length > 0) {
    creds.refreshToken = payload.refresh_token;
  }
  // Same rule as lib/xaiAuth.ts (D5): an absent expires_in means "unknown", never one hour.
  if (typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)) {
    creds.expiresAt = Date.now() + payload.expires_in * 1000;
  }
  if (typeof payload.id_token === "string" && payload.id_token.length > 0) {
    creds.idToken = payload.id_token;
    const email = emailFromIdToken(payload.id_token);
    if (email !== undefined) creds.email = email;
  }
  return creds;
}

/**
 * Runs one complete device-code login and writes the session with saveGrokCredentials().
 * Rejects on discovery failure, a missing device_authorization_endpoint, a terminal OAuth
 * error, an abort, or expiry. Nothing is written unless a token actually came back.
 */
export async function runXaiDeviceLogin(opts: RunXaiDeviceLoginOptions): Promise<GrokCredentials> {
  const deps: PollDeps = {
    doFetch: opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
    sleep: opts.sleep ?? defaultSleep,
    signal: opts.signal,
  };
  const discovery = await discoverXaiOAuthEndpoints(opts.signal);
  const deviceEndpoint = discovery.deviceAuthorizationEndpoint;
  if (!deviceEndpoint) throw new Error("xAI does not expose device_authorization_endpoint");
  const grant = await requestDeviceCode(deviceEndpoint, deps);
  opts.onUserCode({ userCode: grant.userCode, verificationUrl: grant.verificationUrl, expiresIn: grant.expiresIn });
  const payload = await pollUntilAuthorized(discovery.tokenEndpoint, grant, deps);
  const creds = credentialsFromDeviceToken(payload, discovery.tokenEndpoint);
  saveGrokCredentials(creds, opts.homeDir);
  return creds;
}
