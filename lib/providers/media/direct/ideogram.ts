/**
 * Ideogram direct adapter (developer.ideogram.ai v2 OpenAPI, read 2026-11-26).
 * Every route is submitted with async=true and polled at GET
 * /v2/generations/{id}; the synchronous mode can time out with 503 while the
 * generation still runs and bills, with no id to recover it.
 */
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { fail, makeError, normalizeUnknownError, MediaAdapterError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString, type ResponseBody } from "./_l4kit/http.js";
import { withResolvedInputs } from "./_l4kit/inputBytes.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { vendorMask } from "../maskConvention.js";
import { buildIdeogramBody } from "./ideogramBody.js";
import { IDEOGRAM_MODELS } from "./ideogramModels.js";

const P = "IDEOGRAM";
const LABEL = "Ideogram";

function base(ctx: MediaAdapterContext): string {
  return (ctx.baseUrl ?? "https://api.ideogram.ai").replace(/\/+$/, "");
}

/** Unlike the kit helper this also removes keys shorter than six characters. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join("[redacted]") : text;
}

function headers(key: string): Record<string, string> {
  return { "Api-Key": key, accept: "application/json" };
}

async function call(ctx: MediaAdapterContext, path: string, init: RequestInit, key: string): Promise<ResponseBody> {
  let res: Response;
  try {
    res = await ctx.fetch(`${base(ctx)}${path}`, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}), redirect: "error" });
  } catch (error) {
    const detail = normalizeUnknownError(P, error, [key]);
    throw new MediaAdapterError({ ...detail, message: redact(detail.message, key) });
  }
  const body = await readBody(res);
  if (!res.ok) {
    // 422 is Ideogram's prompt-safety rejection (errors guide), not a schema error.
    const override = res.status === 422 ? { reason: "MODERATED", category: "moderation" as const, retryable: false } : undefined;
    const error = httpError({ prefix: P, label: LABEL, status: res.status, body, secrets: [key], ...(override ? { override } : {}) });
    throw new MediaAdapterError({ ...error.detail, message: redact(error.message, key) });
  }
  return body;
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(P, LABEL, ctx);
  const model = findModel(P, IDEOGRAM_MODELS, request.model);
  // Ideogram edits the black regions of a mask and keeps the white ones (see ideogramModels.ts).
  const { path, form, mimeType } = buildIdeogramBody(model, await vendorMask(await withResolvedInputs(P, ctx, request), "black-repaints"));
  const body = await call(ctx, `/v2/${path}`, { method: "POST", headers: headers(key), body: form }, key);
  const id = readString(asRecord(body.json), "generation_id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) fail(P, "BAD_RESPONSE", "Ideogram did not return a valid generation_id", { category: "upstream", retryable: false });
  return { providerJobId: id, pollAfterMs: 1500, resume: { mimeType } };
}
function failed(reason: string, message: string, category: "moderation" | "upstream" | "unknown", state: string): MediaJobState {
  return { status: "failed", error: makeError(P, reason, message, { category, retryable: false, providerState: state }) };
}
function completed(record: Record<string, unknown>, mimeType: string): MediaJobState {
  const data = record["data"];
  if (!Array.isArray(data) || data.length === 0) return failed("BAD_RESPONSE", "Ideogram completed without outputs", "upstream", "completed");
  const outputs = [];
  const created = readString(record, "created");
  const timestamp = created ? Date.parse(created) : NaN;
  for (const item of data) {
    const result = asRecord(item);
    const url = readString(result, "url");
    if (!url || result?.["is_image_safe"] === false) return failed("MODERATED", "Ideogram withheld an output", "moderation", "completed");
    outputs.push({ kind: "image" as const, url, mimeType, ...(Number.isFinite(timestamp) ? { expiresAt: new Date(timestamp + 86400000).toISOString() } : {}) });
  }
  return { status: "succeeded", outputs };
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const key = requireApiKey(P, LABEL, ctx);
  if (!/^[A-Za-z0-9_-]+$/.test(job.providerJobId)) fail(P, "BAD_JOB_REF", "Invalid generation ID", { category: "invalid-request" });
  const body = await call(ctx, `/v2/generations/${job.providerJobId}`, { method: "GET", headers: headers(key) }, key);
  const record = asRecord(body.json) ?? {};
  const status = redact(readString(record, "status") ?? "", key);
  if (status === "pending") return { status: "running" };
  if (status === "completed") return completed(record, job.resume?.["mimeType"] === "image/svg+xml" ? "image/svg+xml" : "application/octet-stream");
  if (status === "failed") return failed("GENERATION_FAILED", `Ideogram generation failed: ${redact(readString(record, "failure_reason") ?? "unknown", key)}`, "upstream", status);
  return failed("UNEXPECTED_STATUS", `Ideogram returned an unknown status: ${status || "(none)"}`, "unknown", status);
}
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim();
  if (!key) return { ok: false, reason: "API key is not configured" };
  try {
    await call(ctx, "/v2/image/generate/ideogram-4-5?dry_run=true", { method: "POST", headers: { ...headers(key), "content-type": "application/json" }, body: JSON.stringify({ prompt: "A simple illustration" }) }, key);
    return { ok: true };
  } catch (error) { return { ok: false, reason: normalizeUnknownError(P, error, [key]).message }; }
}
export const adapter: MediaProviderAdapter = {
  id: "ideogram",
  label: LABEL,
  route: "direct",
  errorPrefix: P,
  credential: { keyVocabulary: "ideogram", envVars: ["IDEOGRAM_API_KEY"], configKey: "ideogramApiKey", consoleUrl: "https://ideogram.ai/platform" },
  inputTransport: "inline",
  listModels: () => IDEOGRAM_MODELS,
  validateKey,
  submit,
  poll,
  normalizeError: (error) => normalizeUnknownError(P, error),
};
