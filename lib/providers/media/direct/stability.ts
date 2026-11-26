/** Direct image/3D endpoints transition to Comfy for individual users on this date;
 * audio remains: https://kb.stability.ai/knowledge-base/transitioning-stability-ai-image-3d-api-endpoints-to-comfyui */
export const STABILITY_IMAGE_SUNSET = "2026-12-10";
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaOutput, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { fail, makeError, normalizeUnknownError, MediaAdapterError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString } from "./_l4kit/http.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { byteResultRef, isSyncRef, readSyncResult } from "./_l4kit/syncJobs.js";
import { buildStabilityBody } from "./stabilityBody.js";
import { STABILITY_MODELS } from "./stabilityModels.js";

const PREFIX = "STABILITY";
const LABEL = "Stability AI";
function base(ctx: MediaAdapterContext): string { return (ctx.baseUrl ?? "https://api.stability.ai").replace(/\/+$/, ""); }
function headers(key: string): Record<string, string> { return { authorization: `Bearer ${key}`, accept: "application/json" }; }
function signal(ctx: MediaAdapterContext): { signal?: AbortSignal } { return ctx.signal ? { signal: ctx.signal } : {}; }
function failure(reason: string, message: string, category: "unknown" | "moderation" | "upstream"): MediaJobState {
  return { status: "failed", error: makeError(PREFIX, reason, message, { category, retryable: false }) };
}
function mime(kind: string, format: string): string {
  if (kind === "audio") return format === "wav" ? "audio/wav" : "audio/mpeg";
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}
async function result(res: Response, kind: string, format: string): Promise<MediaJobState> {
  if (res.headers.get("finish-reason") === "CONTENT_FILTERED") return failure("MODERATED", "Stability filtered this result", "moderation");
  const record = asRecord((await readBody(res)).json);
  if (record?.["status"] !== undefined) return failure("UNEXPECTED_STATUS", "Stability returned an unexpected status field", "unknown");
  const finish = readString(record, "finish_reason");
  if (finish === "CONTENT_FILTERED") return failure("MODERATED", "Stability filtered this result", "moderation");
  if (finish && finish !== "SUCCESS") return failure("UNEXPECTED_STATUS", "Stability returned an unknown finish reason", "unknown");
  const data = readString(record, kind);
  if (!data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return failure("BAD_RESPONSE", "Stability response lacks valid base64 output", "upstream");
  const output: MediaOutput = { kind: kind === "audio" ? "audio" : "image", bytes: new Uint8Array(Buffer.from(data, "base64")), mimeType: mime(kind, format) };
  return { status: "succeeded", outputs: [output] };
}
async function checkError(res: Response, key: string): Promise<void> {
  if (res.ok) return;
  const body = await readBody(res);
  const override = res.status === 403 ? { reason: "MODERATED", category: "moderation" as const, retryable: false } : undefined;
  throw httpError({ prefix: PREFIX, label: LABEL, status: res.status, body, secrets: [key], ...(override ? { override } : {}) });
}
async function safeFetch(ctx: MediaAdapterContext, url: string, init: RequestInit, key: string): Promise<Response> {
  try { return await ctx.fetch(url, init); }
  catch (error) { throw new MediaAdapterError(normalizeUnknownError(PREFIX, error, [key])); }
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, STABILITY_MODELS, request.model);
  const built = buildStabilityBody(model, request);
  const res = await safeFetch(ctx, `${base(ctx)}${built.path}`, { method: "POST", headers: headers(key), body: built.body, ...signal(ctx) }, key);
  await checkError(res, key);
  if (built.async && res.status === 202) {
    const id = readString(asRecord((await readBody(res)).json), "id");
    if (!id) fail(PREFIX, "BAD_RESPONSE", "Stability response lacks id", { category: "upstream" });
    return { providerJobId: id, pollAfterMs: 1500, resume: { kind: model.kind, format: built.format } };
  }
  if (!built.async && res.status === 200) {
    const state = await result(res, model.kind, built.format);
    if (state.status === "succeeded") return byteResultRef(state.outputs);
    if (state.status === "failed" && state.error.category === "moderation") return { providerJobId: "filtered", resume: { filtered: "true" } };
    if (state.status === "failed") throw new MediaAdapterError(state.error);
  }
  return fail(PREFIX, "UNEXPECTED_STATUS", `Stability returned unexpected HTTP ${res.status}`, { category: "unknown", retryable: false });
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  if (job.resume?.["filtered"] === "true") return failure("MODERATED", "Stability filtered this result", "moderation");
  if (isSyncRef(job)) return readSyncResult(PREFIX, job);
  const kind = job.resume?.["kind"];
  const format = job.resume?.["format"];
  if ((kind !== "image" && kind !== "audio") || !format || !/^[a-zA-Z0-9_-]+$/.test(job.providerJobId)) fail(PREFIX, "BAD_JOB_REF", "Invalid Stability job reference", { category: "invalid-request" });
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const route = kind === "audio" ? "/v2beta/audio/results/" : "/v2beta/results/";
  const res = await safeFetch(ctx, `${base(ctx)}${route}${encodeURIComponent(job.providerJobId)}`, { method: "GET", headers: headers(key), ...signal(ctx) }, key);
  await checkError(res, key);
  if (res.status === 202) return { status: "running" };
  if (res.status === 200) return result(res, kind, format);
  return failure("UNEXPECTED_STATUS", `Stability returned unexpected HTTP ${res.status}`, "unknown");
}
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim();
  if (!key) return { ok: false, reason: "API key is not configured" };
  const res = await safeFetch(ctx, `${base(ctx)}/v1/user/balance`, { method: "GET", headers: headers(key), ...signal(ctx) }, key);
  if (res.ok) return { ok: true };
  const body = await readBody(res);
  return { ok: false, reason: httpError({ prefix: PREFIX, label: LABEL, status: res.status, body, secrets: [key] }).message };
}
export const adapter: MediaProviderAdapter = {
  id: "stability", label: LABEL, route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "stability", envVars: ["STABILITY_API_KEY"], configKey: "stabilityApiKey", consoleUrl: "https://platform.stability.ai/dashboard/api-keys" },
  inputTransport: "inline", listModels: () => STABILITY_MODELS, validateKey, submit, poll,
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};
