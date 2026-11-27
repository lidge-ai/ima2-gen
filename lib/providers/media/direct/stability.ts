/**
 * Stability AI direct adapter (docs.stability.ai, read 2026-11-26).
 *
 * Multipart POSTs with "Authorization: Bearer". Synchronous routes answer with
 * the raw bytes when Accept is image/* or audio/*; async routes (creative
 * upscale, Stable Audio 3) answer 202 { id } and GET /v2beta/results/{id} or
 * /v2beta/audio/results/{id} returns 202 while working and the bytes (Accept
 * any type) when done. Result state comes from the "finish-reason" header; the
 * JSON field names of the base64 variant are not documented, so bytes are used.
 */
import { withImageForms, type ImageForm } from "./_l2/imageForm.js";
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaKind, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import { fail, makeError, MediaAdapterError, normalizeUnknownError, redactedTransportError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString } from "./_l4kit/http.js";
import { withResolvedInputs } from "./_l4kit/inputBytes.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { byteResultRef, isSyncRef, readSyncResult } from "./_l4kit/syncJobs.js";
import { buildStabilityBody } from "./stabilityBody.js";
import { STABILITY_MODELS } from "./stabilityModels.js";

/**
 * Direct image and 3D endpoints move to Comfy for individual users on this
 * date; audio stays. https://kb.stability.ai/knowledge-base/transitioning-stability-ai-image-3d-api-endpoints-to-comfyui
 */
export const STABILITY_IMAGE_SUNSET = "2026-12-10";

const PREFIX = "STABILITY";
const LABEL = "Stability AI";
const JOB_ID = /^[a-zA-Z0-9_-]+$/;

function base(ctx: MediaAdapterContext): string {
  return (ctx.baseUrl ?? "https://api.stability.ai").replace(/\/+$/, "");
}

function headers(key: string, accept: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, accept };
}

async function send(ctx: MediaAdapterContext, url: string, init: RequestInit, key: string): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (error) {
    throw redactedTransportError(error, [key]);
  }
}

async function throwIfError(res: Response, key: string): Promise<void> {
  if (res.ok) return;
  const body = await readBody(res);
  const override = res.status === 403 ? { reason: "MODERATED", category: "moderation" as const, retryable: false } : undefined;
  throw httpError({ prefix: PREFIX, label: LABEL, status: res.status, body, secrets: [key], ...(override ? { override } : {}) });
}

function failure(reason: string, message: string, category: "unknown" | "moderation" | "upstream", state?: string): MediaJobState {
  const options = state ? { category, retryable: false, providerState: state } : { category, retryable: false };
  return { status: "failed", error: makeError(PREFIX, reason, message, options) };
}

export async function bytesResult(res: Response, kind: MediaKind): Promise<MediaJobState> {
  const finish = res.headers.get("finish-reason");
  if (finish === "CONTENT_FILTERED") return failure("MODERATED", "Stability filtered this result", "moderation", finish);
  if (finish && finish !== "SUCCESS") return failure("UNEXPECTED_STATUS", `Stability returned finish-reason ${finish}`, "unknown", finish);
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith(`${kind}/`)) return failure("BAD_RESPONSE", `Stability returned ${mimeType || "no content type"} instead of ${kind} bytes`, "upstream");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) return failure("BAD_RESPONSE", "Stability returned an empty result", "upstream");
  return { status: "succeeded", outputs: [{ kind, bytes, mimeType }] };
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, STABILITY_MODELS, request.model);
  const built = buildStabilityBody(model, await withResolvedInputs(PREFIX, ctx, request));
  const accept = built.async ? "application/json" : `${model.kind}/*`;
  const res = await send(ctx, `${base(ctx)}${built.path}`, { method: "POST", headers: headers(key, accept), body: built.body }, key);
  await throwIfError(res, key);
  if (built.async && res.status === 202) {
    const id = readString(asRecord((await readBody(res)).json), "id");
    if (!id || !JOB_ID.test(id)) fail(PREFIX, "BAD_RESPONSE", "Stability response lacks a valid id", { category: "upstream", retryable: false });
    return { providerJobId: id, pollAfterMs: 2000, resume: { kind: model.kind } };
  }
  if (!built.async && res.status === 200) {
    const state = await bytesResult(res, model.kind);
    if (state.status === "failed") throw new MediaAdapterError(state.error);
    if (state.status === "succeeded") return byteResultRef(state.outputs);
  }
  return fail(PREFIX, "UNEXPECTED_STATUS", `Stability returned unexpected HTTP ${res.status}`, { category: "unknown", retryable: false });
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  if (isSyncRef(job)) return readSyncResult(PREFIX, job);
  const kind = job.resume?.["kind"];
  if ((kind !== "image" && kind !== "audio") || !JOB_ID.test(job.providerJobId)) {
    fail(PREFIX, "BAD_JOB_REF", "Invalid Stability job reference", { category: "invalid-request", retryable: false });
  }
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const route = kind === "audio" ? "/v2beta/audio/results/" : "/v2beta/results/";
  const res = await send(ctx, `${base(ctx)}${route}${job.providerJobId}`, { method: "GET", headers: headers(key, "*/*") }, key);
  await throwIfError(res, key);
  if (res.status === 202) return { status: "running" };
  if (res.status === 200) return bytesResult(res, kind);
  return failure("UNEXPECTED_STATUS", `Stability returned unexpected HTTP ${res.status}`, "unknown");
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim();
  if (!key) return { ok: false, reason: "API key is not configured" };
  const res = await send(ctx, `${base(ctx)}/v1/user/balance`, { method: "GET", headers: headers(key, "application/json") }, key);
  if (res.ok) return { ok: true };
  const body = await readBody(res);
  return { ok: false, reason: httpError({ prefix: PREFIX, label: LABEL, status: res.status, body, secrets: [key] }).message };
}

export const adapter: MediaProviderAdapter = {
  id: "stability",
  label: LABEL,
  route: "direct",
  errorPrefix: PREFIX,
  credential: { keyVocabulary: "stability", envVars: ["STABILITY_API_KEY"], configKey: "stabilityApiKey", consoleUrl: "https://platform.stability.ai/dashboard/api-keys" },
  inputTransport: "inline",
  listModels: () => DECLARED,
  validateKey,
  submit,
  poll,
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};

// The two image-to-image models need settings a plain form cannot fill, so they declare none.
const DECLARED = withImageForms(STABILITY_MODELS, {
  "stability/upscale-fast": { task: "image-upscale", images: 1, accepts: [] },
  "stability/upscale-creative": { task: "image-upscale", images: 1, accepts: ["prompt", "negativePrompt", "seed"], requires: ["prompt"] },
} satisfies Record<string, ImageForm>);
