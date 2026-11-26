/**
 * fal.ai aggregator adapter (BYOK, user's own FAL_KEY).
 *
 * Wire: POST https://queue.fal.run/<endpoint> with "Authorization: Key <key>",
 * then poll the status_url the submit response returns. For nested endpoint
 * ids fal serves status/result/cancel under the first two path segments only,
 * so the returned URLs are stored in the job ref instead of being rebuilt.
 * A COMPLETED status can still be a failure: the status error field and the
 * result response status are both checked before reporting success.
 * Docs: https://fal.ai/docs/api-reference/inference-api/queue/submit-path (checked 2026-11-26).
 */
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaKind, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest,
} from "../contract.js";
import { FAL_CATALOG } from "./fal/catalog.js";
import { discoverFalModels, falEndpointFromPlatform } from "./fal/discovery.js";
import { readFalError } from "./fal/errors.js";
import { extractFalOutputs } from "./fal/outputs.js";
import type { FalCatalogEntry } from "./fal/types.js";
import { adapterError, invalidRequest, MediaAdapterError, normalizeAdapterError } from "./shared/errors.js";
import { buildSchemaBody, paramsFromSchemas, type EndpointSchema } from "./shared/fields.js";
import { asRecord, asString, httpError, joinUrl, readBody, requestJson } from "./shared/http.js";

const PREFIX = "FAL_";
const QUEUE_BASE = "https://queue.fal.run";
export const FAL_PLATFORM_BASE = "https://api.fal.ai/v1";
/** Any public endpoint id works; the pricing API only answers authenticated callers. */
const VALIDATE_ENDPOINT = "fal-ai/flux/dev";

export function falHeaders(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Key ${ctx.apiKey}` };
}

function toSpec(entry: FalCatalogEntry): MediaModelSpec {
  const primary = entry.endpoints[0];
  return {
    id: entry.id,
    upstreamId: primary?.endpoint ?? entry.id,
    vendor: entry.vendor,
    label: entry.label,
    kind: entry.kind,
    tasks: [...new Set(entry.endpoints.map((endpoint) => endpoint.task))],
    params: paramsFromSchemas(entry.endpoints),
    pricing: entry.pricing,
    docsUrl: `https://fal.ai/models/${primary?.endpoint ?? entry.id}`,
  };
}

const SPECS: readonly MediaModelSpec[] = FAL_CATALOG.map(toSpec);

interface ResolvedEndpoint {
  schema: EndpointSchema;
  kind: MediaKind;
}

async function resolveEndpoint(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<ResolvedEndpoint> {
  const entry = FAL_CATALOG.find((candidate) => candidate.id === request.model);
  if (entry) {
    const schema = entry.endpoints.find((endpoint) => endpoint.task === request.task);
    if (!schema) throw invalidRequest(PREFIX, `Model ${entry.id} does not support ${request.task} on fal`, "TASK_UNSUPPORTED");
    return { schema, kind: entry.kind };
  }
  // Not curated: treat the id as a fal endpoint and read its published schema.
  const discovered = await falEndpointFromPlatform(ctx, request.model);
  if (!discovered) throw invalidRequest(PREFIX, `Model ${request.model} is not available on fal`, "MODEL_UNSUPPORTED");
  return discovered;
}

function appBase(ctx: MediaAdapterContext, endpoint: string): string {
  const [owner, app] = endpoint.split("/");
  return joinUrl(ctx.baseUrl ?? QUEUE_BASE, `${owner}/${app}`);
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const { schema, kind } = await resolveEndpoint(ctx, request);
  const body = buildSchemaBody(PREFIX, schema, request);
  const url = joinUrl(ctx.baseUrl ?? QUEUE_BASE, schema.endpoint);
  const res = asRecord(await requestJson(ctx, { url, headers: falHeaders(ctx), body, prefix: PREFIX, readError: readFalError }));
  const id = asString(res.request_id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "fal returned no request_id" });
  const base = `${appBase(ctx, schema.endpoint)}/requests/${id}`;
  return {
    providerJobId: id,
    pollAfterMs: kind === "video" ? 5000 : 1500,
    resume: {
      endpoint: schema.endpoint,
      kind,
      statusUrl: asString(res.status_url) ?? `${base}/status`,
      responseUrl: asString(res.response_url) ?? base,
      cancelUrl: asString(res.cancel_url) ?? `${base}/cancel`,
    },
  };
}

function resumeOf(job: MediaJobRef): { statusUrl: string; responseUrl: string; cancelUrl: string; kind: MediaKind } {
  const resume = job.resume ?? {};
  const { statusUrl, responseUrl, cancelUrl } = resume;
  if (!statusUrl || !responseUrl || !cancelUrl) throw invalidRequest(PREFIX, "fal job reference is missing its queue URLs", "BAD_JOB_REF");
  const kind = resume.kind === "image" || resume.kind === "audio" ? resume.kind : "video";
  return { statusUrl, responseUrl, cancelUrl, kind };
}

function failedFromStatus(status: Record<string, unknown>): MediaJobState {
  const errorType = asString(status.error_type);
  const message = asString(status.error) ?? "fal job failed";
  const view = readFalError({ detail: message, type: errorType }, 0);
  return {
    status: "failed",
    error: adapterError({
      prefix: PREFIX, category: view.category ?? "upstream", reason: view.reason, message, providerState: "COMPLETED",
      retryable: view.retryable,
    }).detail,
  };
}

async function readResult(ctx: MediaAdapterContext, responseUrl: string, kind: MediaKind): Promise<MediaJobState> {
  const init: RequestInit = { headers: { ...falHeaders(ctx), accept: "application/json" } };
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(responseUrl, init);
  const body = await readBody(res);
  if (!res.ok) {
    return { status: "failed", error: httpError(ctx, { prefix: PREFIX, readError: readFalError }, res.status, body).detail };
  }
  const outputs = extractFalOutputs(body, kind);
  if (outputs.length === 0) {
    return { status: "failed", error: adapterError({ prefix: PREFIX, category: "upstream", reason: "NO_OUTPUT", message: "fal result had no media files" }).detail };
  }
  return { status: "succeeded", outputs };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const { statusUrl, responseUrl, kind } = resumeOf(job);
  const status = asRecord(await requestJson(ctx, { url: statusUrl, headers: falHeaders(ctx), prefix: PREFIX, readError: readFalError }));
  const state = asString(status.status);
  const pollAfterMs = kind === "video" ? 5000 : 1500;
  if (state === "IN_QUEUE") return { status: "queued", pollAfterMs };
  if (state === "IN_PROGRESS") return { status: "running", pollAfterMs };
  if (state !== "COMPLETED") {
    return { status: "failed", error: adapterError({ prefix: PREFIX, category: "unknown", reason: "UNKNOWN_STATE", message: `fal reported unknown status ${state ?? "(none)"}`, providerState: state }).detail };
  }
  if (status.error !== undefined && status.error !== null) return failedFromStatus(status);
  return readResult(ctx, responseUrl, kind);
}

async function cancel(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void> {
  const { cancelUrl } = resumeOf(job);
  try {
    await requestJson(ctx, { method: "PUT", url: cancelUrl, headers: falHeaders(ctx), prefix: PREFIX, readError: readFalError });
  } catch (error) {
    // ALREADY_COMPLETED is not a failure to cancel: the caller's next poll reports the outcome.
    if (error instanceof MediaAdapterError && /ALREADY_COMPLETED/.test(error.message)) return;
    throw error;
  }
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  const url = `${FAL_PLATFORM_BASE}/models/pricing?endpoint_id=${encodeURIComponent(VALIDATE_ENDPOINT)}`;
  try {
    await requestJson(ctx, { url, headers: falHeaders(ctx), prefix: PREFIX, readError: readFalError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

export const adapter: MediaProviderAdapter = {
  id: "fal",
  label: "fal.ai",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "fal",
    envVars: ["FAL_KEY"],
    configKey: "falApiKey",
    consoleUrl: "https://fal.ai/dashboard/keys",
  },
  // fal accepts public URLs and base64 data URIs on file fields.
  inputTransport: "inline",
  listModels: () => SPECS,
  discoverModels: (ctx) => discoverFalModels(ctx, SPECS),
  validateKey,
  submit,
  poll,
  cancel,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
