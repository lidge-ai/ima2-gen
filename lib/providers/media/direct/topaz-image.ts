import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { fail, makeError, normalizeUnknownError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString, type ResponseBody } from "./_l4kit/http.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { redactSecrets } from "./_l4kit/redact.js";
import { buildBody } from "./topaz-imageBody.js";

const PREFIX = "TOPAZ_IMAGE";
const LABEL = "Topaz Labs Image";
const BASE = "https://api.topazlabs.com";
// Credit costs are rounded up per output and depend on model and subscription;
// a fixed USD/megapixel MediaPrice cannot represent the official pricing exactly.
const MODELS: readonly MediaModelSpec[] = [
  { id: "topaz-labs/topaz-upscale", upstreamId: "Standard V2", vendor: "topaz-labs", label: "Topaz Upscale", kind: "image", tasks: ["image-upscale"], params: { maxReferenceImages: 1 }, pricing: [], docsUrl: "https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/standard-2" },
  { id: "topaz-labs/topaz-upscale-creative", upstreamId: "Redefine", vendor: "topaz-labs", label: "Topaz Upscale Creative", kind: "image", tasks: ["image-upscale"], params: { maxReferenceImages: 1 }, pricing: [], docsUrl: "https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/redefine" },
];
function root(ctx: MediaAdapterContext): string { return (ctx.baseUrl ?? BASE).replace(/\/+$/, ""); }
function headers(key: string): Record<string, string> { return { "X-API-Key": key, accept: "application/json" }; }
function error(status: number, body: ResponseBody, key: string) {
  const override = status === 412 ? { reason: "NO_SUBSCRIPTION", category: "auth" as const, retryable: false }
    : status === 425 ? { reason: "CREDIT_PENDING", category: "upstream" as const, retryable: true } : undefined;
  const result = httpError({ prefix: PREFIX, label: LABEL, status, body, secrets: [key], ...(override ? { override } : {}) });
  if (status === 412) { result.detail.message = `Topaz API subscription required: ${result.detail.message}`; result.message = result.detail.message; }
  return result;
}
async function fetchSafe(ctx: MediaAdapterContext, url: string, init: RequestInit): Promise<Response> {
  try { return await ctx.fetch(url, { ...init, redirect: "error", ...(ctx.signal ? { signal: ctx.signal } : {}) }); }
  catch (e) {
    // The original cause may contain the API key; do not attach it to the error.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(redactSecrets(e instanceof Error ? e.message : String(e), [ctx.apiKey]));
  }
}
function jobId(job: MediaJobRef): string {
  if (!/^[A-Za-z0-9_-]+$/.test(job.providerJobId)) fail(PREFIX, "BAD_JOB_REF", "Invalid process ID", { category: "invalid-request" });
  return job.providerJobId;
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, MODELS, request.model);
  const form = buildBody(model, request);
  const endpoint = model.id.endsWith("-creative") ? "enhance-gen" : "enhance";
  const res = await fetchSafe(ctx, `${root(ctx)}/image/v1/${endpoint}/async`, { method: "POST", headers: headers(key), body: form });
  const parsed = await readBody(res);
  if (!res.ok) throw error(res.status, parsed, key);
  const id = readString(asRecord(parsed.json), "process_id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) fail(PREFIX, "BAD_RESPONSE", "Topaz response lacked a valid process_id", { category: "upstream" });
  return { providerJobId: id };
}
function failed(reason: string, message: string): MediaJobState {
  return { status: "failed", error: makeError(PREFIX, reason, message, { category: reason === "UNEXPECTED_STATUS" ? "unknown" : "upstream", retryable: false }) };
}
async function download(ctx: MediaAdapterContext, id: string, key: string, format: string | undefined): Promise<MediaJobState> {
  const res = await fetchSafe(ctx, `${root(ctx)}/image/v1/download/${id}`, { method: "GET", headers: headers(key) });
  if (res.status === 409) return { status: "running" };
  const parsed = await readBody(res); if (!res.ok) throw error(res.status, parsed, key);
  const record = asRecord(parsed.json); const url = readString(record, "download_url"); const expiry = record?.["expiry"];
  if (!url || typeof expiry !== "number" || !Number.isFinite(expiry) || !Number.isFinite(new Date(expiry * 1000).getTime())) return failed("BAD_RESPONSE", "Topaz download response lacked URL or valid expiry");
  try { if (new URL(url).protocol !== "https:") return failed("BAD_RESPONSE", "Topaz download URL is invalid"); } catch { return failed("BAD_RESPONSE", "Topaz download URL is invalid"); }
  const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", tiff: "image/tiff", tif: "image/tiff" };
  return { status: "succeeded", outputs: [{ kind: "image", url, mimeType: mime[format ?? ""] ?? "application/octet-stream", expiresAt: new Date(expiry * 1000).toISOString() }] };
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const key = requireApiKey(PREFIX, LABEL, ctx); const id = jobId(job);
  const res = await fetchSafe(ctx, `${root(ctx)}/image/v1/status/${id}`, { method: "GET", headers: headers(key) });
  const parsed = await readBody(res); if (!res.ok) throw error(res.status, parsed, key);
  const record = asRecord(parsed.json); const status = readString(record, "status");
  switch (status) {
    case "Pending": return { status: "queued" };
    case "Processing": return { status: "running" };
    case "Completed": return download(ctx, id, key, readString(record, "output_format"));
    case "Cancelled": return { status: "canceled" };
    case "Failed": return failed("GENERATION_FAILED", "Topaz image processing failed");
    default: return failed("UNEXPECTED_STATUS", "Topaz returned an unknown status");
  }
}
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim(); if (!key) return { ok: false, reason: "API key is not configured" };
  const res = await fetchSafe(ctx, `${root(ctx)}/account/v1/credits/balance`, { method: "GET", headers: headers(key) });
  if (res.ok) return { ok: true };
  const parsed = await readBody(res); return { ok: false, reason: error(res.status, parsed, key).message };
}
export const adapter: MediaProviderAdapter = {
  id: "topaz-image", label: LABEL, route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "topaz", envVars: ["TOPAZ_API_KEY"], configKey: "topazApiKey", consoleUrl: "https://account.topazlabs.com/manage-api" },
  inputTransport: "inline", listModels: () => MODELS, validateKey, submit, poll,
  normalizeError: (e) => normalizeUnknownError(PREFIX, e),
};
