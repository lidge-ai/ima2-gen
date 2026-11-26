/**
 * Shared plumbing for the L3 direct adapters (google, xai, heygen, sync, veed,
 * topaz, mirelo, elevenlabs, cartesia). Wire formats stay in each adapter;
 * this file only owns the parts every adapter would otherwise copy: calling
 * ctx.fetch, classifying HTTP failures, scrubbing secrets from messages,
 * refusing unknown vendor options, and holding results of synchronous APIs.
 */
import type {
  MediaAdapterContext, MediaInput, MediaInputRole, MediaJobRef, MediaJobState, MediaProviderError,
  MediaSubmitRequest,
} from "../contract.js";

type Category = MediaProviderError["category"];

/** An HTTP or protocol failure raised inside an adapter, before normalizeError. */
export class MediaHttpError extends Error {
  readonly status: number | undefined;
  readonly reason: string;
  readonly category: Category;
  readonly retryable: boolean;
  readonly providerState: string | undefined;

  constructor(init: {
    message: string; reason: string; category: Category; retryable: boolean;
    status?: number; providerState?: string;
  }) {
    super(init.message);
    this.name = "MediaHttpError";
    this.status = init.status;
    this.reason = init.reason;
    this.category = init.category;
    this.retryable = init.retryable;
    this.providerState = init.providerState;
  }
}

/** The category and retry rule an HTTP status implies when the body says nothing better. */
export function classifyStatus(status: number): { reason: string; category: Category; retryable: boolean } {
  if (status === 401 || status === 403) return { reason: "AUTH", category: "auth", retryable: false };
  if (status === 402) return { reason: "INSUFFICIENT_CREDIT", category: "quota", retryable: false };
  if (status === 404) return { reason: "NOT_FOUND", category: "not-found", retryable: false };
  if (status === 408 || status === 504) return { reason: "TIMEOUT", category: "timeout", retryable: true };
  if (status === 429) return { reason: "RATE_LIMITED", category: "rate-limit", retryable: true };
  if (status >= 500) return { reason: "UPSTREAM", category: "upstream", retryable: true };
  if (status >= 400) return { reason: "INVALID_REQUEST", category: "invalid-request", retryable: false };
  return { reason: "UNKNOWN", category: "unknown", retryable: false };
}

/** Replace every secret occurrence; short values are skipped so ordinary words survive. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Every secret the context carries: the key plus secret extra fields. */
export function contextSecrets(ctx: MediaAdapterContext, secretExtras: readonly string[] = []): string[] {
  const values = [ctx.apiKey];
  for (const name of secretExtras) {
    const value = ctx.extra?.[name];
    if (value) values.push(value);
  }
  return values;
}

export interface HttpCall {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  json?: unknown;
  body?: RequestInit["body"];
  /** Lets an adapter map a vendor error body to a better reason/category. */
  classify?: (status: number, body: string) => Partial<{ reason: string; category: Category; retryable: boolean }> | undefined;
  secretExtras?: readonly string[];
}

/** Call ctx.fetch and return the raw Response, throwing MediaHttpError on a non-2xx status. */
export async function httpRaw(ctx: MediaAdapterContext, label: string, url: string, call: HttpCall = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(call.headers ?? {}) };
  let body = call.body;
  if (call.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(call.json);
  }
  const init: RequestInit = { method: call.method ?? (body === undefined ? "GET" : "POST"), headers };
  if (body !== undefined) init.body = body;
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(url, init);
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  const base = classifyStatus(res.status);
  const override = call.classify?.(res.status, text) ?? {};
  const detail = redact(text.slice(0, 300), contextSecrets(ctx, call.secretExtras));
  throw new MediaHttpError({
    message: `${label} failed (${res.status})${detail ? `: ${detail}` : ""}`,
    status: res.status,
    reason: override.reason ?? base.reason,
    category: override.category ?? base.category,
    retryable: override.retryable ?? base.retryable,
  });
}

/** httpRaw plus a JSON body. An unparseable success body is an upstream protocol error. */
export async function httpJson<T = Record<string, unknown>>(
  ctx: MediaAdapterContext, label: string, url: string, call: HttpCall = {},
): Promise<T> {
  const res = await httpRaw(ctx, label, url, call);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw protocolError(`${label} returned a non-JSON body`);
  }
}

export function protocolError(message: string, providerState?: string): MediaHttpError {
  return new MediaHttpError({
    message, reason: "BAD_RESPONSE", category: "upstream", retryable: false,
    ...(providerState !== undefined ? { providerState } : {}),
  });
}

export function invalidRequest(message: string, reason = "INVALID_REQUEST"): MediaHttpError {
  return new MediaHttpError({ message, reason, category: "invalid-request", retryable: false });
}

/** The shared half of every adapter's normalizeError. */
export function normalizeMediaError(prefix: string, error: unknown, secrets: readonly string[] = []): MediaProviderError {
  if (error instanceof MediaHttpError) {
    return {
      code: prefix + "_" + error.reason,
      message: redact(error.message, secrets),
      ...(error.status !== undefined ? { status: error.status } : {}),
      retryable: error.retryable,
      category: error.category,
      ...(error.providerState !== undefined ? { providerState: error.providerState } : {}),
    };
  }
  const name = error instanceof Error ? error.name : "";
  const message = redact(error instanceof Error ? error.message : String(error ?? "Unknown error"), secrets);
  if (name === "TimeoutError") return { code: prefix + "_TIMEOUT", message, retryable: true, category: "timeout" };
  if (name === "AbortError") return { code: prefix + "_ABORTED", message, retryable: false, category: "unknown" };
  if (error instanceof TypeError) return { code: prefix + "_NETWORK", message, retryable: true, category: "upstream" };
  return { code: prefix + "_UNKNOWN", message, retryable: false, category: "unknown" };
}

/** Refuse vendor options the adapter does not know, as the contract requires. */
export function readVendorOptions(request: MediaSubmitRequest, allowed: readonly string[]): Record<string, unknown> {
  const options = { ...(request.vendorOptions ?? {}) };
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw invalidRequest("Unknown vendorOptions: " + unknown.join(", "), "UNKNOWN_OPTION");
  }
  return options;
}

export function inputsByRole(request: MediaSubmitRequest, role: MediaInputRole): MediaInput[] {
  return request.inputs.filter((input) => input.role === role);
}

/** The one input of a role the task needs, or an invalid-request error naming it. */
export function requireInput(request: MediaSubmitRequest, role: MediaInputRole): MediaInput {
  const found = inputsByRole(request, role);
  if (found.length !== 1) throw invalidRequest(request.task + " needs exactly one " + role + " input", "MISSING_INPUT");
  return found[0]!;
}

/** The input as a public URL, for adapters whose inputTransport is "url". */
export function requireUrl(input: MediaInput): string {
  if (!input.url) throw invalidRequest(input.role + " must arrive as a URL", "INPUT_NOT_URL");
  return input.url;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** The model spec with this id, or an invalid-request error. */
export function findModel<T extends { id: string }>(models: readonly T[], id: string): T {
  const found = models.find((model) => model.id === id);
  if (!found) throw invalidRequest("Unknown model: " + id, "UNKNOWN_MODEL");
  return found;
}

/** Refuse a value outside a spec's allowed list; absent values and absent lists pass. */
export function assertAllowed<T>(name: string, value: T | undefined, allowed: readonly T[] | undefined): void {
  if (value === undefined || allowed === undefined) return;
  if (!allowed.includes(value)) {
    throw invalidRequest(name + " " + String(value) + " is not one of " + allowed.join(", "), "UNSUPPORTED_PARAM");
  }
}

/**
 * Results of synchronous vendor APIs (TTS that answers with audio bytes).
 * submit() runs the call and parks the terminal state here; poll() hands it
 * out once. The store is process-local and bounded: a job resumed after a
 * restart reads as expired instead of hanging. lanes/L3.md "L0 요청" asks for
 * the contract change that would make this unnecessary.
 */
const SYNC_RESULTS = new Map<string, { state: MediaJobState; at: number }>();
const SYNC_TTL_MS = 30 * 60 * 1000;
const SYNC_MAX = 64;

export function parkSyncResult(prefix: string, state: MediaJobState, now = Date.now()): MediaJobRef {
  for (const [id, entry] of SYNC_RESULTS) {
    if (now - entry.at > SYNC_TTL_MS || SYNC_RESULTS.size >= SYNC_MAX) SYNC_RESULTS.delete(id);
  }
  const id = prefix.toLowerCase() + "-sync-" + crypto.randomUUID();
  SYNC_RESULTS.set(id, { state, at: now });
  return { providerJobId: id, pollAfterMs: 0, resume: { sync: "1" } };
}

export function takeSyncResult(prefix: string, job: MediaJobRef): MediaJobState {
  const entry = SYNC_RESULTS.get(job.providerJobId);
  if (!entry) {
    return { status: "failed", error: {
      code: prefix + "_RESULT_EXPIRED", category: "not-found", retryable: false,
      message: "The synchronous result is no longer held by this process; submit again.",
    } };
  }
  SYNC_RESULTS.delete(job.providerJobId);
  return entry.state;
}
