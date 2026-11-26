/**
 * Black Forest Labs (FLUX) direct adapter.
 *
 * Wire format (https://api.bfl.ai/openapi.json, docs.bfl.ai, read 2026-11-26):
 * POST {base}/v1/<model-endpoint> with header "x-key" and a JSON body; the
 * response carries { id, polling_url }. GET exactly that polling_url with the
 * same header until "Ready" (result.sample is a signed URL valid ~10 minutes,
 * downloaded without the key) or a terminal status. GET /v1/credits proves a key.
 */
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import { fail, makeError, normalizeUnknownError, type MediaErrorCategory } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString, type ResponseBody } from "./_l4kit/http.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { buildBflBody } from "./bflBody.js";
import { BFL_MODELS } from "./bflModels.js";

const PREFIX = "BFL";
const LABEL = "Black Forest Labs";
const DEFAULT_BASE_URL = "https://api.bfl.ai";
/** Official regional hosts; "global" routes to the nearest cluster. */
const REGION_BASE_URLS: Readonly<Record<string, string>> = {
  global: DEFAULT_BASE_URL, eu: "https://api.eu.bfl.ai", us: "https://api.us.bfl.ai",
};
const TRUSTED_HOST_SUFFIXES = [".bfl.ai", ".bfl.ml"];
const RUNNING_STATES = new Set(["Pending", "Reasoning", "Generating"]);
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

function baseUrl(ctx: MediaAdapterContext): string {
  if (ctx.baseUrl) return ctx.baseUrl.replace(/\/+$/, "");
  const region = ctx.extra?.["region"]?.trim().toLowerCase();
  if (!region) return DEFAULT_BASE_URL;
  const url = REGION_BASE_URLS[region];
  if (!url) fail(PREFIX, "BAD_REGION", `Unknown BFL region "${region}" (use global, eu or us)`, { category: "invalid-request" });
  return url;
}

function headers(apiKey: string): Record<string, string> {
  return { "x-key": apiKey, accept: "application/json", "content-type": "application/json" };
}

function withSignal(ctx: MediaAdapterContext): { signal?: AbortSignal } {
  return ctx.signal ? { signal: ctx.signal } : {};
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const apiKey = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, BFL_MODELS, request.model);
  const { body, outputFormat } = buildBflBody(model, request);
  const res = await ctx.fetch(`${baseUrl(ctx)}/v1/${model.upstreamId}`, {
    method: "POST", headers: headers(apiKey), body: JSON.stringify(body), ...withSignal(ctx),
  });
  const parsed = await readBody(res);
  if (!res.ok) throw httpError({ prefix: PREFIX, label: LABEL, status: res.status, body: parsed, secrets: [apiKey] });
  const record = asRecord(parsed.json);
  const id = readString(record, "id");
  const pollingUrl = readString(record, "polling_url");
  if (!id || !pollingUrl) fail(PREFIX, "BAD_RESPONSE", "BFL submit response lacked id or polling_url", { category: "upstream", retryable: false });
  const resume: Record<string, string> = { pollingUrl: trustedPollingUrl(ctx, pollingUrl) };
  if (outputFormat) resume["outputFormat"] = outputFormat;
  return { providerJobId: id, pollAfterMs: 1500, resume };
}

/** The key goes only to BFL hosts (or the configured base URL), never to a host a response invented. */
export function trustedPollingUrl(ctx: MediaAdapterContext, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(PREFIX, "BAD_RESPONSE", "BFL polling_url is not a URL", { category: "upstream", retryable: false });
  }
  const configured = new URL(baseUrl(ctx)).host;
  const trusted = url.host === configured
    || (url.protocol === "https:" && TRUSTED_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix)));
  if (!trusted) fail(PREFIX, "UNTRUSTED_POLLING_URL", `Refusing to send the key to ${url.host}`, { category: "upstream", retryable: false });
  return url.toString();
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const apiKey = requireApiKey(PREFIX, LABEL, ctx);
  const raw = job.resume?.["pollingUrl"];
  if (!raw) fail(PREFIX, "BAD_JOB_REF", "BFL job reference has no polling URL", { category: "invalid-request", retryable: false });
  const res = await ctx.fetch(trustedPollingUrl(ctx, raw), { method: "GET", headers: headers(apiKey), ...withSignal(ctx) });
  const parsed = await readBody(res);
  if (!res.ok) throw httpError({ prefix: PREFIX, label: LABEL, status: res.status, body: parsed, secrets: [apiKey] });
  return bflJobState(parsed, job.resume?.["outputFormat"]);
}

export function bflJobState(parsed: ResponseBody, outputFormat: string | undefined, now = Date.now()): MediaJobState {
  const record = asRecord(parsed.json);
  const status = readString(record, "status") ?? "";
  if (RUNNING_STATES.has(status)) {
    const progress = record?.["progress"];
    return typeof progress === "number" ? { status: "running", progress } : { status: "running" };
  }
  switch (status) {
    case "Ready":
      return readyState(record, outputFormat, now);
    case "Request Moderated":
    case "Content Moderated":
      return failed("MODERATED", `BFL refused the job (${status})${detailText(record)}`, "moderation", status);
    case "Task not found":
      return failed("TASK_NOT_FOUND", "BFL no longer knows this task (results expire)", "not-found", status);
    case "No Card Generated":
    case "Error":
      return failed("GENERATION_FAILED", `BFL generation failed (${status})${detailText(record)}`, "upstream", status);
    default:
      return failed("UNEXPECTED_STATUS", `BFL returned an unknown status: ${status || "(none)"}`, "unknown", status);
  }
}

function detailText(record: Record<string, unknown> | undefined): string {
  const details = record?.["details"];
  if (!details) return "";
  return `: ${(typeof details === "string" ? details : JSON.stringify(details)).slice(0, 300)}`;
}

const FORMAT_MIME: Readonly<Record<string, string>> = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Known format first; otherwise the signed URL's extension; otherwise let the downloader read Content-Type. */
export function bflMimeType(sample: string, outputFormat: string | undefined): string {
  if (outputFormat && FORMAT_MIME[outputFormat]) return FORMAT_MIME[outputFormat];
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(sample).pathname)?.[1]?.toLowerCase();
  return (ext && FORMAT_MIME[ext]) ?? "application/octet-stream";
}

function readyState(record: Record<string, unknown> | undefined, outputFormat: string | undefined, now: number): MediaJobState {
  const sample = readString(asRecord(record?.["result"]), "sample");
  if (!sample) return failed("BAD_RESPONSE", "BFL reported Ready without result.sample", "upstream", "Ready");
  const expiresAt = new Date(now + SIGNED_URL_TTL_MS).toISOString();
  return { status: "succeeded", outputs: [{ kind: "image", url: sample, mimeType: bflMimeType(sample, outputFormat), expiresAt }] };
}

function failed(reason: string, message: string, category: MediaErrorCategory, state: string): MediaJobState {
  return { status: "failed", error: makeError(PREFIX, reason, message, { category, retryable: false, providerState: state }) };
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = ctx.apiKey?.trim();
  if (!apiKey) return { ok: false, reason: "API key is not configured" };
  const res = await ctx.fetch(`${baseUrl(ctx)}/v1/credits`, { method: "GET", headers: headers(apiKey), ...withSignal(ctx) });
  if (res.ok) return { ok: true };
  const parsed = await readBody(res);
  return { ok: false, reason: httpError({ prefix: PREFIX, label: LABEL, status: res.status, body: parsed, secrets: [apiKey] }).message };
}

export const adapter: MediaProviderAdapter = {
  id: "bfl",
  label: LABEL,
  route: "direct",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "bfl",
    envVars: ["BFL_API_KEY"],
    configKey: "bflApiKey",
    consoleUrl: "https://dashboard.bfl.ai/",
    extraFields: [{ name: "region", envVar: "BFL_REGION", secret: false, required: false }],
  },
  inputTransport: "inline",
  listModels: () => BFL_MODELS,
  validateKey,
  submit,
  poll,
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};
