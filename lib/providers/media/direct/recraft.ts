/** Recraft synchronous JSON API, documented in the 2026-11-26 L4 research report. */
import { withImageForms, type ImageForm } from "./_l2/imageForm.js";
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaOutput, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { fail, makeError, MediaAdapterError, normalizeUnknownError } from "./_l4kit/errors.js";
import { asRecord, httpError, readBody, readString } from "./_l4kit/http.js";
import { findModel, requireApiKey } from "./_l4kit/request.js";
import { isSyncRef, readSyncResult, urlResultRef } from "./_l4kit/syncJobs.js";
import { buildRecraftBody } from "./recraftBody.js";
import { RECRAFT_MODELS } from "./recraftModels.js";

const PREFIX = "RECRAFT";
const LABEL = "Recraft";
const BASE = "https://external.api.recraft.ai";
const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? BASE).replace(/\/+$/, "");
const headers = (key: string) => ({ authorization: `Bearer ${key}`, accept: "application/json", "content-type": "application/json" });
const signal = (ctx: MediaAdapterContext) => ctx.signal ? { signal: ctx.signal } : {};

async function fetchSafe(ctx: MediaAdapterContext, url: string, init: RequestInit, key: string): Promise<Response> {
  try { return await ctx.fetch(url, init); }
  catch (error) { throw new MediaAdapterError(normalizeUnknownError(PREFIX, error, [key])); }
}

function outputsFrom(json: unknown, utility: boolean, mimeType: string): MediaOutput[] {
  const record = asRecord(json);
  const raw = utility ? [record?.["image"]] : record?.["data"];
  if (!Array.isArray(raw) || raw.length === 0) fail(PREFIX, "BAD_RESPONSE", "Recraft response has no images", { category: "upstream", retryable: false });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return raw.map((item) => {
    const url = readString(asRecord(item), "url");
    if (!url) fail(PREFIX, "BAD_RESPONSE", "Recraft response image has no URL", { category: "upstream", retryable: false });
    let parsed: URL;
    try { parsed = new URL(url); } catch { return fail(PREFIX, "BAD_RESPONSE", "Recraft returned an invalid output URL", { category: "upstream", retryable: false }); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") fail(PREFIX, "BAD_RESPONSE", "Recraft returned an invalid output URL", { category: "upstream", retryable: false });
    return { kind: "image", url, mimeType, expiresAt };
  });
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const key = requireApiKey(PREFIX, LABEL, ctx);
  const model = findModel(PREFIX, RECRAFT_MODELS, request.model);
  const body = buildRecraftBody(model, request);
  const generation = request.task === "text-to-image" || request.task === "image-to-image";
  const endpoint = generation ? (request.task === "text-to-image" ? "generations" : "imageToImage") : model.upstreamId;
  const response = await fetchSafe(ctx, `${base(ctx)}/v1/images/${endpoint}`, { method: "POST", headers: headers(key), body: JSON.stringify(body), ...signal(ctx) }, key);
  const parsed = await readBody(response);
  if (!response.ok) throw httpError({ prefix: PREFIX, label: LABEL, status: response.status, body: parsed, secrets: [key] });
  const mime = model.upstreamId.includes("vector") ? "image/svg+xml" : body["image_format"] === "png" ? "image/png" : "image/webp";
  return urlResultRef(outputsFrom(parsed.json, !generation, mime));
}
async function poll(_ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  if (!isSyncRef(job)) return { status: "failed", error: makeError(PREFIX, "UNEXPECTED_STATUS", "Unknown synchronous job status", { retryable: false }) };
  try { return readSyncResult(PREFIX, job); } catch { return { status: "failed", error: makeError(PREFIX, "BAD_JOB_REF", "Malformed synchronous job reference", { category: "invalid-request", retryable: false }) }; }
}
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const key = ctx.apiKey?.trim();
  if (!key) return { ok: false, reason: "API key is not configured" };
  const response = await fetchSafe(ctx, `${base(ctx)}/v1/users/me`, { method: "GET", headers: headers(key), ...signal(ctx) }, key);
  if (response.ok) return { ok: true };
  const body = await readBody(response);
  return { ok: false, reason: httpError({ prefix: PREFIX, label: LABEL, status: response.status, body, secrets: [key] }).message };
}
export const adapter: MediaProviderAdapter = {
  id: "recraft", label: LABEL, route: "direct", errorPrefix: PREFIX,
  credential: { keyVocabulary: "recraft", envVars: ["RECRAFT_API_KEY"], configKey: "recraftApiKey", consoleUrl: "https://www.recraft.ai/app/api/api-keys" },
  inputTransport: "inline", listModels: () => DECLARED, validateKey, submit, poll,
  normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};

// Vectorize and upscale take the image alone: no prompt, ratio or count.
const DECLARED = withImageForms(RECRAFT_MODELS, {
  "recraft/recraft-vectorize": { task: "image-vectorize", images: 1, accepts: [] },
  "recraft/recraft-crisp-upscale": { task: "image-upscale", images: 1, accepts: [] },
  "recraft/recraft-creative-upscale": { task: "image-upscale", images: 1, accepts: [] },
} satisfies Record<string, ImageForm>);
