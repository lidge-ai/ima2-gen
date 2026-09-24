/**
 * Native ChatGPT (GPT OAuth) login, ported from OpenCodex `src/oauth/chatgpt.ts` (browser
 * PKCE on localhost:1455) and `src/oauth/chatgpt-device.ts` (deviceauth grant).
 *
 * Replaces spawning `codex login` and scraping its terminal output for the device code: that
 * regex broke whenever the Codex CLI changed its banner, and the session it wrote landed in
 * ~/.codex/auth.json, shared with the Codex CLI's own refreshes.
 *
 * Both flows write only through lib/chatgptAuth.ts. Nothing is persisted unless the token
 * endpoint actually returned a usable session.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_OAUTH_CLIENT_ID,
  CHATGPT_OAUTH_SCOPE,
  CHATGPT_TOKEN_URL,
  saveChatgptTokenResponse,
  type ChatgptSession,
} from "./chatgptAuth.js";

export type ChatgptLoginFlow = "browser" | "device";

const USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
export const CHATGPT_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";

export const CHATGPT_CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CHATGPT_CALLBACK_PORT}${CALLBACK_PATH}`;
const ORIGINATOR = "codex_cli_rs";

/** The device grant's own lifetime. */
export const CHATGPT_DEVICE_TTL_MS = 15 * 60 * 1000;
export const CHATGPT_BROWSER_TTL_MS = 5 * 60 * 1000;
/** A fresh deadline per fetch; one shared timeout would kill the 15-minute grant. */
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;

export interface ChatgptLoginPrompt {
  flow: ChatgptLoginFlow;
  /** Where the user goes: the device page, or the authorize URL for the browser flow. */
  url: string;
  /** Human code for the device flow; absent for the browser flow. */
  userCode?: string;
  expiresIn: number;
}

export interface RunChatgptLoginOptions {
  flow: ChatgptLoginFlow;
  /** Called once, as soon as the user has something to open. */
  onPrompt: (prompt: ChatgptLoginPrompt) => void;
  signal?: AbortSignal;
  configDir?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Browser flow only: listener port (tests). The advertised redirect stays 1455. */
  callbackPort?: number;
}

function fetchSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Login cancelled"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Upstream sends `interval` as a number or a string; a string must not become a hot loop. */
function normalizeIntervalMs(raw: unknown): number {
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(CHATGPT_DEVICE_TTL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(seconds * 1000)));
}

/** Only the OAuth error code and description, never the raw body (it may echo request data). */
async function tokenError(stage: string, response: Response): Promise<Error> {
  let detail = `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(await response.text()) as { error?: unknown; error_description?: unknown };
    const code = typeof parsed.error === "string" ? parsed.error : typeof (parsed.error as { code?: unknown })?.code === "string" ? (parsed.error as { code: string }).code : undefined;
    const description = typeof parsed.error_description === "string" ? parsed.error_description : undefined;
    detail = [detail, code, description].filter(Boolean).join(" ");
  } catch {
    // Non-JSON body: the status alone.
  }
  return new Error(`ChatGPT ${stage} failed: ${detail}`);
}

async function exchangeCode(
  doFetch: typeof fetch,
  params: { code: string; codeVerifier: string; redirectUri: string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await doFetch(CHATGPT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    }).toString(),
    signal: fetchSignal(signal),
  });
  if (!response.ok) throw await tokenError("token exchange", response);
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

async function runDeviceFlow(opts: RunChatgptLoginOptions, doFetch: typeof fetch): Promise<Record<string, unknown>> {
  const sleep = opts.sleep ?? defaultSleep;
  const start = await doFetch(USERCODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CHATGPT_OAUTH_CLIENT_ID }),
    signal: fetchSignal(opts.signal),
  });
  if (!start.ok) {
    // A 404 here is most often the account-level switch for device code login.
    if (start.status === 404) {
      throw new Error("ChatGPT device authorization request failed: HTTP 404. Device code login may be disabled for this account (ChatGPT Settings → Security); the browser login does not need it.");
    }
    throw await tokenError("device authorization request", start);
  }
  const payload = (await start.json()) as Record<string, unknown>;
  const deviceAuthId = nonEmpty(payload.device_auth_id);
  const userCode = nonEmpty(payload.user_code) ?? nonEmpty(payload.usercode);
  if (!deviceAuthId || !userCode) throw new Error("ChatGPT device authorization response missing required fields");
  const intervalMs = normalizeIntervalMs(payload.interval);
  opts.onPrompt({ flow: "device", url: CHATGPT_DEVICE_VERIFICATION_URL, userCode, expiresIn: CHATGPT_DEVICE_TTL_MS / 1000 });

  // Pending is 403/404 rather than an authorization_pending body. The clock is the larger of
  // wall time and slept time so an injected no-op sleep still reaches the deadline.
  const startedAt = Date.now();
  let slept = 0;
  while (Math.max(Date.now() - startedAt, slept) < CHATGPT_DEVICE_TTL_MS) {
    if (opts.signal?.aborted) throw new Error("Login cancelled");
    const poll = await doFetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
      signal: fetchSignal(opts.signal),
    });
    if (poll.status === 403 || poll.status === 404) {
      await sleep(intervalMs, opts.signal);
      slept += intervalMs;
      continue;
    }
    if (!poll.ok) throw await tokenError("device authorization poll", poll);
    const grant = (await poll.json()) as Record<string, unknown>;
    const code = nonEmpty(grant.authorization_code);
    const codeVerifier = nonEmpty(grant.code_verifier);
    if (!code || !codeVerifier) throw new Error("ChatGPT device authorization response missing required fields");
    return exchangeCode(doFetch, { code, codeVerifier, redirectUri: DEVICE_REDIRECT_URI }, opts.signal);
  }
  throw new Error("ChatGPT device authorization expired before it was approved");
}

// ---------------------------------------------------------------------------
// Browser (PKCE callback) flow
// ---------------------------------------------------------------------------

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildChatgptAuthorizeUrl(params: { state: string; challenge: string; redirectUri?: string }): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CHATGPT_OAUTH_CLIENT_ID,
    redirect_uri: params.redirectUri ?? REDIRECT_URI,
    scope: CHATGPT_OAUTH_SCOPE,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: params.state,
    originator: ORIGINATOR,
  });
  return `${CHATGPT_AUTHORIZE_URL}?${query}`;
}

function page(title: string, body: string): string {
  return "<!doctype html><html><head><meta charset='utf-8'><title>ima2</title></head>"
    + "<body style='font-family:system-ui,sans-serif;text-align:center;padding:4rem;color:#111'>"
    + `<h2>${title}</h2><p>${body}</p></body></html>`;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error.code === "EADDRINUSE"
        ? new Error(`Port ${port} is busy (another Codex or ima2 login may be open). Close it, or use the device-code login.`)
        : error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function runBrowserFlow(opts: RunChatgptLoginOptions, doFetch: typeof fetch): Promise<Record<string, unknown>> {
  const pkce = generatePkce();
  const state = randomBytes(32).toString("base64url");
  const port = opts.callbackPort ?? CHATGPT_CALLBACK_PORT;
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const codePromise = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    res.setHeader("Connection", "close");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    // State first, for errors too: any page can navigate the browser to this loopback URL, and
    // without the unguessable state it must not be able to end (or complete) this login.
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(page("&#9888; Login failed", "State mismatch. Start the login again from ima2."));
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(page("&#9888; Login failed", "Return to ima2 and try again."));
      settle?.reject(new Error(`ChatGPT login was not approved: ${error.replace(/[^\w.-]/g, "")}`));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(page("&#9888; Login failed", "The callback carried no code. Start the login again from ima2."));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" }).end(page("&#9989; Login complete", "You can close this tab and return to ima2."));
    settle?.resolve(code);
  });

  await listen(server, port);
  const timer = setTimeout(() => settle?.reject(new Error("ChatGPT browser login timed out")), CHATGPT_BROWSER_TTL_MS);
  const onAbort = () => settle?.reject(new Error("Login cancelled"));
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    opts.onPrompt({
      flow: "browser",
      url: buildChatgptAuthorizeUrl({ state, challenge: pkce.challenge }),
      expiresIn: CHATGPT_BROWSER_TTL_MS / 1000,
    });
    const code = await codePromise;
    return await exchangeCode(doFetch, { code, codeVerifier: pkce.verifier, redirectUri: REDIRECT_URI }, opts.signal);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    server.closeAllConnections?.();
    server.close();
  }
}

/**
 * Runs one complete ChatGPT login and writes the session into ima2's store
 * (lib/chatgptAuth.ts). Rejects on cancel, expiry, or a token response that cannot drive the
 * GPT OAuth proxy.
 */
export async function runChatgptLogin(opts: RunChatgptLoginOptions): Promise<ChatgptSession> {
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const payload = opts.flow === "device"
    ? await runDeviceFlow(opts, doFetch)
    : await runBrowserFlow(opts, doFetch);
  // A login that was cancelled or superseded while its token request was in flight must not
  // overwrite the session a newer login just saved.
  if (opts.signal?.aborted) throw new Error("Login cancelled");
  return saveChatgptTokenResponse(payload, opts.configDir);
}
