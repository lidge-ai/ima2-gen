import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PROVIDER_ERROR_MAP, statusForErrorCode } from "../../lib/errors/providerMap.js";

export const DEFAULT_PORT = 3333;

type TransportError = Error & { code: string; status?: number };
let binding: { origin: string; token: string } | undefined;

/** Service discovery must not inherit a previous command's credential selection. */
export function clearServerBinding(): void { binding = undefined; }

function transportError(code: string, message: string, status?: number): TransportError {
  return Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) });
}

function serverOrigin(value: unknown): string {
  try {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\\?#@]/.test(value)) throw new Error();
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch {
    throw transportError("SERVER_URL_INVALID", "Server must be an HTTP(S) origin without credentials, query, fragment or path.");
  }
}

function transportUrl(value: string, base?: string): URL {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some((key) => /^token(?:\[|$)/i.test(key))) throw new Error();
    return url;
  } catch {
    throw transportError("SERVER_URL_INVALID", "Invalid server request URL; URL credentials and LAN query tokens are not supported.");
  }
}

function transportHeaders(init: RequestInit, origin: string): Headers {
  try {
    const headers = new Headers(init.headers);
    if (headers.has("cookie") || headers.has("x-ima2-token")) throw new Error();
    if (binding?.origin === origin && binding.token) headers.set("x-ima2-token", binding.token);
    return headers;
  } catch {
    throw transportError("SERVER_CREDENTIAL_CONFLICT", "Use IMA2_LAN_TOKEN with an explicit server; caller cookie/token headers are not supported.");
  }
}

async function checkAccess(response: Response): Promise<void> {
  if (response.status >= 300 && response.status < 400) {
    try { await response.body?.cancel(); } catch { /* Preserve the safe redirect error. */ }
    throw transportError("SERVER_REDIRECT_REJECTED", "Server redirects are not allowed.");
  }
  if (response.status !== 401 && response.status !== 403) return;
  const denied = transportError("SERVER_ACCESS_DENIED", "Server authentication or access was denied.", response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch { throw denied; }
  const envelope = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const nested = envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown> : {};
  const reserved = [envelope.code, nested.code].filter((code): code is string => typeof code === "string"
    && ["LAN_TOKEN_REQUIRED", "LOCAL_HOST_REJECTED", "LOCAL_ORIGIN_REJECTED", "SERVER_ACCESS_DENIED"].includes(code));
  if (reserved.length) {
    const code = reserved[0]!;
    if (code === "SERVER_ACCESS_DENIED" || reserved.some((other) => other !== code)
      || response.status !== (code === "LAN_TOKEN_REQUIRED" ? 401 : 403)) throw denied;
    throw transportError(code, code === "LAN_TOKEN_REQUIRED"
      ? "LAN authentication required. Specify a known --server or IMA2_SERVER and set IMA2_LAN_TOKEN."
      : "Server access denied. Check the configured server Host/Origin policy.", response.status);
  }
  if (envelope.code !== undefined && nested.code !== undefined && envelope.code !== nested.code) throw denied;
  const code = typeof envelope.error === "string" ? envelope.code : nested.code;
  const message = typeof envelope.error === "string" ? envelope.error : nested.message;
  if (typeof code === "string" && typeof message === "string" && message.trim()
    && (statusForErrorCode(code, 0) === 401 || Object.hasOwn(PROVIDER_ERROR_MAP, code))) {
    throw Object.assign(transportError(code, message, response.status), { body });
  }
  throw denied;
}

/** Only explicit selection below can bind a secret; request URLs never do. */
export async function fetchServerUrl(url: string, init: RequestInit = {}): Promise<Response> {
  const target = transportUrl(url);
  const headers = transportHeaders(init, target.origin);
  let response: Response;
  try {
    response = await fetch(target.href, { ...init, headers, credentials: "omit", redirect: "error" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    // Node's native fetch rejects redirect:error before exposing a Response.
    const cause = (error as { cause?: { message?: string } })?.cause;
    if (cause?.message === "unexpected redirect") {
      throw transportError("SERVER_REDIRECT_REJECTED", "Server redirects are not allowed.");
    }
    throw transportError("NETWORK_FAILED", "Server request failed.");
  }
  await checkAccess(response);
  return response;
}

export async function fetchServer(base: string, pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  const origin = serverOrigin(base);
  const target = transportUrl(pathOrUrl, `${origin}/`);
  if (target.origin !== origin) throw transportError("SERVER_URL_INVALID", "Server request must stay on its selected origin.");
  return fetchServerUrl(target.href, init);
}

function readAdvertise() {
  const p = process.env.IMA2_ADVERTISE_FILE ||
    join(process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2"), "server.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export interface ServerHealth {
  ok?: boolean;
  version?: string;
  pid?: number;
  [key: string]: unknown;
}

async function probe(base: string, timeoutMs = 600): Promise<ServerHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetchServer(base, "/api/health", {
      signal: controller.signal,
      // CLI is short-lived: close the socket so process.exit() never races a
      // keep-alive handle (libuv UV_HANDLE_CLOSING assert on Windows, 260719).
      headers: { connection: "close" },
    });
    if (!r.ok) throw transportError("SERVER_HTTP_ERROR", `Server health failed: HTTP ${r.status}`, r.status);
    try { return (await r.json()) as ServerHealth; }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw transportError("SERVER_INVALID_HEALTH", "Server returned an invalid health response.");
    }
  } catch (error) {
    if ((error as TransportError)?.code === "NETWORK_FAILED"
      || (controller.signal.aborted && (error as Error)?.name === "AbortError")) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function findRunningServer({ includeEnv = true }: { includeEnv?: boolean } = {}) {
  clearServerBinding();
  if (includeEnv && process.env.IMA2_SERVER !== undefined) return selectServer(process.env.IMA2_SERVER);
  const candidates: string[] = [];
  const adv = readAdvertise();
  if (adv?.backend?.url) candidates.push(String(adv.backend.url).replace(/\/$/, ""));
  if (adv?.url) candidates.push(String(adv.url).replace(/\/$/, ""));
  if (adv?.port) candidates.push(`http://localhost:${adv.port}`);
  candidates.push(`http://localhost:${DEFAULT_PORT}`);

  const seen = new Set<string>();
  const uniq = candidates.filter((c) => !seen.has(c) && seen.add(c));

  for (const candidate of uniq) {
    const base = serverOrigin(candidate);
    const health = await probe(base);
    if (health) return { base, health };
  }
  return null;
}

export async function resolveServer({ serverFlag }: { serverFlag?: unknown } = {}) {
  clearServerBinding();
  if (serverFlag !== undefined) return selectServer(serverFlag);
  const found = await findRunningServer();
  if (found) return found;
  throw transportError("SERVER_UNREACHABLE", "Server unreachable; is 'ima2 serve' running?");
}

async function selectServer(value: unknown) {
  const base = serverOrigin(value);
  const selected = { origin: base, token: process.env.IMA2_LAN_TOKEN || "" };
  binding = selected;
  try {
    const health = await probe(base);
    if (health) return { base, health };
    throw transportError("SERVER_UNREACHABLE", "Selected server is unreachable.");
  } catch (error) {
    if (binding === selected) clearServerBinding();
    throw error;
  }
}

export type JsonRecord = Record<string, unknown>;

export interface InflightListResponse {
  jobs?: JsonRecord[];
  items?: JsonRecord[];
  terminalJobs?: JsonRecord[];
}

export interface HistoryListResponse {
  items?: JsonRecord[];
  history?: JsonRecord[];
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
  timeoutMs?: number;
}

export interface CliRequestError extends Error {
  status?: number;
  code?: unknown;
  body?: unknown;
}

function errorField(json: unknown, key: "message" | "code"): unknown {
  if (!json || typeof json !== "object") return undefined;
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[key];
}

// Response bodies are server JSON; callers declare the shape they consume via T.
export async function request<T = unknown>(base: string, path: string, {
  method = "GET",
  body,
  headers: extraHeaders,
  raw = false,
  timeoutMs = 180_000,
}: RequestOptions = {}): Promise<T> {
  const baseHeaders: Record<string, string> = raw
    ? { "X-ima2-client": `cli/${CLI_VERSION}` }
    : { "Content-Type": "application/json", "X-ima2-client": `cli/${CLI_VERSION}` };
  const finalHeaders = { ...baseHeaders, ...(extraHeaders || {}) };
  // Manual timeout + clearTimeout: a lingering AbortSignal.timeout handle
  // crashes process.exit() on Windows Node 24 (UV_HANDLE_CLOSING, 260719).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await fetchServer(base, path, {
      method,
      // connection: close — see the health-check note above.
      headers: { connection: "close", ...finalHeaders },
      ...(body === undefined ? {} : { body: raw ? body as NonNullable<RequestInit["body"]> : JSON.stringify(body) }),
      signal: controller.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try { json = JSON.parse(text!); } catch { /* best-effort: non-JSON bodies are handled below via the raw text */ }
  if (!res.ok) {
    const top = json && typeof json === "object" ? json as { error?: unknown; code?: unknown } : undefined;
    const message = errorField(json, "message") || top?.error || `HTTP ${res.status}`;
    const err: CliRequestError = new Error(String(message));
    err.status = res.status;
    err.code = errorField(json, "code") || top?.code || null;
    err.body = json || text;
    throw err;
  }
  return json as T;
}

export interface CliHistoryItem {
  filename: string;
  url?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export async function resolveLastHistoryItem(base: string): Promise<CliHistoryItem> {
  const response = await request<HistoryListResponse | null>(base, "/api/history?limit=1");
  const item = Array.isArray(response?.items) ? response.items[0] : undefined;
  if (!item || typeof item.filename !== "string" || !item.filename) {
    const error = new Error("no history image available for @last") as Error & { code: string };
    error.code = "HISTORY_EMPTY";
    throw error;
  }
  return item as CliHistoryItem;
}

export async function resolveHistoryReference(base: string, value: string): Promise<string> {
  if (value !== "@last") return value;
  return (await resolveLastHistoryItem(base)).filename;
}

interface RawImageItem {
  image?: string;
  filename?: string | null;
}
interface RawGenerateResponse {
  image?: string;
  images?: RawImageItem[];
  filename?: string | null;
  elapsed?: number | string | null;
  requestId?: string | null;
  [key: string]: unknown;
}

export function normalizeGenerate(resp: RawGenerateResponse | null | undefined) {
  if (!resp) return { images: [], elapsed: null, requestId: null };
  if (Array.isArray(resp.images)) {
    return {
      images: resp.images.map((it: RawImageItem) => ({ image: it.image, filename: it.filename })),
      elapsed: resp.elapsed ?? null,
      requestId: resp.requestId ?? null,
    };
  }
  if (resp.image) {
    return {
      images: [{ image: resp.image, filename: resp.filename || null }],
      elapsed: resp.elapsed ?? null,
      requestId: resp.requestId ?? null,
    };
  }
  return { images: [], elapsed: resp.elapsed ?? null, requestId: resp.requestId ?? null };
}

export let CLI_VERSION = "dev";
export function setCliVersion(v: string) { CLI_VERSION = v; }
