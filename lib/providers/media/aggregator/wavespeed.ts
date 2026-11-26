/**
 * WaveSpeed adapter (BYOK, user's own WAVESPEED_API_KEY).
 *
 * Wire (https://wavespeed.ai/docs/docs-api, checked 2026-11-26): POST
 * /api/v3/<model_id> with the model's inputs and Bearer auth returns
 * { code: 200, data: { id, status, urls: { get } } }; GET
 * /api/v3/predictions/{id}/result until completed (failed, cancelled, timeout
 * and deleted are terminal). Poll no faster than every 2 s. Inputs go through
 * the documented direct upload (POST /api/v3/media/uploads, then PUT the bytes
 * to the returned URL without the WaveSpeed key). No cancel endpoint is documented.
 */
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaKind, MediaModelSpec, MediaOutput, MediaProviderAdapter,
  MediaSubmitRequest,
} from "../contract.js";
import { adapterError, invalidRequest, normalizeAdapterError } from "./shared/errors.js";
import { buildSchemaBody, paramsFromSchemas } from "./shared/fields.js";
import { asArray, asRecord, asString, httpError, joinUrl, readBody, requestJson } from "./shared/http.js";
import { defaultMime, kindFromMime, mimeFromUrl } from "./shared/inputs.js";
import { WAVESPEED_CATALOG } from "./wavespeed/catalog.js";
import { readTaskFailure, readWaveSpeedError } from "./wavespeed/errors.js";
import type { WaveSpeedCatalogEntry, WaveSpeedEndpoint } from "./wavespeed/types.js";

const PREFIX = "WAVESPEED";
const ORIGIN = "https://api.wavespeed.ai";
const MIN_POLL_MS = 2000;

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Bearer ${ctx.apiKey}` };
}

function origin(ctx: MediaAdapterContext): string {
  return ctx.baseUrl ?? ORIGIN;
}

function toSpec(entry: WaveSpeedCatalogEntry): MediaModelSpec {
  const primary = entry.endpoints[0];
  return {
    id: entry.id, upstreamId: primary?.endpoint ?? entry.id, vendor: entry.vendor, label: entry.label, kind: entry.kind,
    tasks: [...new Set(entry.endpoints.map((endpoint) => endpoint.task))], params: paramsFromSchemas(entry.endpoints),
    pricing: entry.pricing, docsUrl: `https://wavespeed.ai/docs/docs-api/${primary?.endpoint ?? entry.id}`,
  };
}

const SPECS: readonly MediaModelSpec[] = WAVESPEED_CATALOG.map(toSpec);

function resolveEndpoint(request: MediaSubmitRequest): { endpoint: WaveSpeedEndpoint; kind: MediaKind } {
  const entry = WAVESPEED_CATALOG.find((candidate) => candidate.id === request.model);
  // WaveSpeed's model list has no machine-readable input schema, so only catalogued endpoints can be submitted safely.
  if (!entry) throw invalidRequest(PREFIX, `Model ${request.model} is not in the WaveSpeed catalog`, "MODEL_UNSUPPORTED");
  const endpoint = entry.endpoints.find((candidate) => candidate.task === request.task);
  if (!endpoint) throw invalidRequest(PREFIX, `Model ${entry.id} does not support ${request.task} on WaveSpeed`, "TASK_UNSUPPORTED");
  return { endpoint, kind: entry.kind };
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const { endpoint, kind } = resolveEndpoint(request);
  const body = buildSchemaBody(PREFIX, endpoint, request);
  const res = asRecord(await requestJson(ctx, { url: joinUrl(origin(ctx), endpoint.path), headers: headers(ctx), body, prefix: PREFIX, readError: readWaveSpeedError }));
  const data = asRecord(res.data);
  const id = asString(data.id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "WaveSpeed returned no prediction id" });
  return { providerJobId: id, pollAfterMs: kind === "video" ? 5000 : MIN_POLL_MS, resume: { kind } };
}

function outputsOf(data: Record<string, unknown>, kind: MediaKind): MediaOutput[] {
  return asArray(data.outputs).flatMap((item): MediaOutput[] => {
    const url = typeof item === "string" ? item : asString(asRecord(item).url);
    if (!url || !/^https?:\/\//.test(url)) return [];
    const mimeType = asString(asRecord(item).content_type) ?? mimeFromUrl(url, defaultMime(kind));
    return [{ kind: kindFromMime(mimeType, kind), url, mimeType }];
  });
}

function failed(view: ReturnType<typeof readTaskFailure>, state: string, fallback: "upstream" | "timeout" | "not-found" | "unknown" = "upstream", reason = "PREDICTION_FAILED"): MediaJobState {
  return {
    status: "failed",
    error: adapterError({
      prefix: PREFIX, category: view.category ?? fallback, reason: view.reason ?? reason, message: view.message ?? "WaveSpeed prediction failed",
      retryable: view.retryable ?? fallback === "timeout", providerState: state,
    }).detail,
  };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const resumeKind = job.resume?.kind;
  const kind: MediaKind = resumeKind === "image" || resumeKind === "audio" ? resumeKind : "video";
  const url = joinUrl(origin(ctx), `/api/v3/predictions/${encodeURIComponent(job.providerJobId)}/result`);
  const res = asRecord(await requestJson(ctx, { url, headers: headers(ctx), prefix: PREFIX, readError: readWaveSpeedError }));
  const data = asRecord(res.data);
  const state = (asString(data.status) ?? "").toLowerCase();
  const pollAfterMs = kind === "video" ? 5000 : MIN_POLL_MS;
  if (state === "created" || state === "queued" || state === "pending") return { status: "queued", pollAfterMs };
  if (state === "processing" || state === "running") return { status: "running", pollAfterMs };
  if (state === "cancelled" || state === "canceled") return { status: "canceled" };
  if (state === "failed") return failed(readTaskFailure(data), state);
  if (state === "timeout") return failed({ message: asString(data.error) ?? "WaveSpeed prediction timed out" }, state, "timeout", "TIMEOUT");
  if (state === "deleted") return failed({ message: "WaveSpeed deleted the prediction before its output was read" }, state, "not-found", "DELETED");
  if (state !== "completed") return failed({ message: `WaveSpeed reported unknown status ${state || "(none)"}` }, state, "unknown", "UNKNOWN_STATE");
  const outputs = outputsOf(data, kind);
  if (outputs.length === 0) return failed({ message: "WaveSpeed prediction had no outputs" }, state, "upstream", "NO_OUTPUT");
  return { status: "succeeded", outputs };
}

async function uploadInput(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }> {
  if (input.url) return { url: input.url };
  if (!input.bytes) throw invalidRequest(PREFIX, `Input ${input.role} has neither url nor bytes`);
  const filename = `${input.role}.${input.mimeType.split("/")[1] ?? "bin"}`;
  const ticket = asRecord(asRecord(await requestJson(ctx, {
    url: joinUrl(origin(ctx), "/api/v3/media/uploads"), headers: headers(ctx),
    body: { filename, size: input.bytes.byteLength, content_type: input.mimeType }, prefix: PREFIX, readError: readWaveSpeedError,
  })).data);
  const upload = asRecord(ticket.upload);
  const uploadUrl = asString(upload.url);
  const downloadUrl = asString(ticket.download_url);
  if (!uploadUrl || !downloadUrl) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "UPLOAD_NO_URL", message: "WaveSpeed upload ticket had no URL" });
  const putHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(asRecord(upload.headers))) if (typeof value === "string") putHeaders[name] = value;
  // The upload URL is pre-signed: the WaveSpeed key must not travel with the bytes.
  const init: RequestInit = { method: asString(upload.method) ?? "PUT", headers: putHeaders, body: new Uint8Array(input.bytes) };
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(uploadUrl, init);
  if (!res.ok) throw httpError(ctx, { prefix: PREFIX, readError: readWaveSpeedError }, res.status, await readBody(res));
  return { url: downloadUrl };
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    await requestJson(ctx, { url: joinUrl(origin(ctx), "/api/v3/balance"), headers: headers(ctx), prefix: PREFIX, readError: readWaveSpeedError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

export const adapter: MediaProviderAdapter = {
  id: "wavespeed",
  label: "WaveSpeed",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "wavespeed",
    envVars: ["WAVESPEED_API_KEY"],
    configKey: "wavespeedApiKey",
    consoleUrl: "https://wavespeed.ai/accesskey",
  },
  inputTransport: "upload",
  listModels: () => SPECS,
  validateKey,
  uploadInput,
  submit,
  poll,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
