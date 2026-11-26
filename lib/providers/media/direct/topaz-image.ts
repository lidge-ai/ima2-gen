/**
 * Topaz Labs Image direct adapter (developer.topazlabs.com, read 2026-11-26).
 *
 * POST /image/v1/enhance/async (precision) or /enhance-gen/async (generative)
 * as multipart with header X-API-Key; the response carries process_id. Poll
 * GET /status/{id} (Pending, Processing, Completed, Cancelled, Failed). When
 * Completed, GET /download/{id} returns a presigned download_url (1 hour) that
 * is fetched without the key; 409 there means "not ready yet".
 */
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import { fail, makeError, normalizeUnknownError, redactedTransportError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString, type ResponseBody } from "./_l4kit/http.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { buildBody } from "./topaz-imageBody.js";

const PREFIX = "TOPAZ_IMAGE";
const LABEL = "Topaz Labs Image";
const BASE = "https://api.topazlabs.com";
const PROCESS_ID = /^[A-Za-z0-9_-]+$/;
const OUTPUT_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", tiff: "image/tiff", tif: "image/tiff",
};

// Pricing stays empty: cost is ceil(output MP / model MP-per-credit) credits and
// the credit price depends on the subscription ($0.10 Developer, $0.08 Scale),
// so no fixed USD price per unit is exact.
const MODELS: readonly MediaModelSpec[] = [
  {
    id: "topaz-labs/topaz-upscale", upstreamId: "Standard V2", vendor: "topaz-labs", label: "Topaz Upscale",
    kind: "image", tasks: ["image-upscale"], params: { maxReferenceImages: 1 }, pricing: [],
    docsUrl: "https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/standard-2",
  },
  {
    id: "topaz-labs/topaz-upscale-creative", upstreamId: "Redefine", vendor: "topaz-labs", label: "Topaz Upscale Creative",
    kind: "image", tasks: ["image-upscale"], params: { maxReferenceImages: 1 }, pricing: [],
    docsUrl: "https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/redefine",
  },
];

function root(ctx: MediaAdapterContext): string {
  return (ctx.baseUrl ?? BASE).replace(/\/+$/, "");
}

function headers(key: string): Record<string, string> {
  return { "X-API-Key": key, accept: "application/json" };
}

function topazError(status: number, body: ResponseBody, key: string): Error {
  if (status === 412) {
    const error = httpError({ prefix: PREFIX, label: LABEL, status, body, secrets: [key], override: { reason: "NO_SUBSCRIPTION", category: "auth", retryable: false } });
    error.detail.message = `Topaz API subscription required: ${error.detail.message}`;
    error.message = error.detail.message;
    return error;
  }
  const override = status === 425 ? { reason: "CREDIT_PENDING", category: "upstream" as const, retryable: true } : undefined;
  return httpError({ prefix: PREFIX, label: LABEL, status, body, secrets: [key], ...(override ? { override } : {}) });
}

async function send(ctx: MediaAdapterContext, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, redirect: "error", ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (error) {
    throw redactedTransportError(error, [ctx.apiKey]);
  }
}

function processId(job: MediaJobRef): string {
  if (!PROCESS_ID.test(job.providerJobId)) fail(PREFIX, "BAD_JOB_REF", "Invalid process ID", { category: "invalid-request" });
  return job.providerJobId;
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, MODELS, request.model);
  const form = buildBody(model, request);
  const endpoint = model.id.endsWith("-creative") ? "enhance-gen" : "enhance";
  const res = await send(ctx, `${root(ctx)}/image/v1/${endpoint}/async`, { method: "POST", headers: headers(key), body: form });
  const parsed = await readBody(res);
  if (!res.ok) throw topazError(res.status, parsed, key);
  const id = readString(asRecord(parsed.json), "process_id");
  if (!id || !PROCESS_ID.test(id)) fail(PREFIX, "BAD_RESPONSE", "Topaz response lacked a valid process_id", { category: "upstream" });
  return { providerJobId: id, pollAfterMs: 2000 };
}

function failed(reason: string, message: string, providerState?: string): MediaJobState {
  const category = reason === "UNEXPECTED_STATUS" ? "unknown" : "upstream";
  const options = providerState ? { category, retryable: false, providerState } as const : { category, retryable: false } as const;
  return { status: "failed", error: makeError(PREFIX, reason, message, options) };
}

function validExpiry(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value * 1000).getTime());
}

function isHttps(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

async function download(ctx: MediaAdapterContext, id: string, key: string, format: string | undefined): Promise<MediaJobState> {
  const res = await send(ctx, `${root(ctx)}/image/v1/download/${id}`, { method: "GET", headers: headers(key) });
  if (res.status === 409) return { status: "running" };
  const parsed = await readBody(res);
  if (!res.ok) throw topazError(res.status, parsed, key);
  const record = asRecord(parsed.json);
  const url = readString(record, "download_url");
  const expiry = record?.["expiry"];
  if (!url || !validExpiry(expiry)) return failed("BAD_RESPONSE", "Topaz download response lacked URL or valid expiry");
  if (!isHttps(url)) return failed("BAD_RESPONSE", "Topaz download URL is invalid");
  const mimeType = OUTPUT_MIME[format ?? ""] ?? "application/octet-stream";
  return { status: "succeeded", outputs: [{ kind: "image", url, mimeType, expiresAt: new Date(expiry * 1000).toISOString() }] };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const id = processId(job);
  const res = await send(ctx, `${root(ctx)}/image/v1/status/${id}`, { method: "GET", headers: headers(key) });
  const parsed = await readBody(res);
  if (!res.ok) throw topazError(res.status, parsed, key);
  const record = asRecord(parsed.json);
  const status = readString(record, "status");
  switch (status) {
    case "Pending": return { status: "queued" };
    case "Processing": return { status: "running" };
    case "Completed": return download(ctx, id, key, readString(record, "output_format"));
    case "Cancelled": return { status: "canceled" };
    case "Failed": return failed("GENERATION_FAILED", "Topaz image processing failed", status);
    default: return failed("UNEXPECTED_STATUS", "Topaz returned an unknown status");
  }
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim();
  if (!key) return { ok: false, reason: "API key is not configured" };
  const res = await send(ctx, `${root(ctx)}/account/v1/credits/balance`, { method: "GET", headers: headers(key) });
  if (res.ok) return { ok: true };
  const parsed = await readBody(res);
  return { ok: false, reason: topazError(res.status, parsed, key).message };
}

export const adapter: MediaProviderAdapter = {
  id: "topaz-image",
  label: LABEL,
  route: "direct",
  errorPrefix: PREFIX,
  credential: { keyVocabulary: "topaz", envVars: ["TOPAZ_API_KEY"], configKey: "topazApiKey", consoleUrl: "https://account.topazlabs.com/manage-api" },
  inputTransport: "inline",
  listModels: () => MODELS,
  validateKey,
  submit,
  poll,
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};
