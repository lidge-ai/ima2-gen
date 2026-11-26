/**
 * Sume adapter: the user's own Sume API key (https://www.sume.com/dashboard/api-keys).
 *
 * Wire (https://www.sume.com/docs, checked 2026-11-26): POST /v1/video-router/generate
 * or /v1/image-router/generate with { model, ...inputs } and Bearer auth. The 202
 * receipt carries status_url/result_url; GET /v1/jobs/{id}/status until terminal,
 * then GET /v1/jobs/{id}/result for data.result.artifacts. Cancel only works
 * before generation starts (409 job_generation_already_started otherwise).
 * Router models accept different field subsets; Sume rejects unsupported fields
 * with 400, so the adapter sends only fields the router documents.
 */
import { randomUUID } from "node:crypto";
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaKind, MediaModelSpec, MediaOutput, MediaProviderAdapter,
  MediaSubmitRequest,
} from "../contract.js";
import { adapterError, invalidRequest, normalizeAdapterError } from "./shared/errors.js";
import { buildSchemaBody, type EndpointSchema, type InputField } from "./shared/fields.js";
import { asArray, asNumber, asRecord, asString, joinUrl, requestJson } from "./shared/http.js";
import { defaultMime, kindFromMime, mimeFromUrl, requireTask } from "./shared/inputs.js";
import { SUME_CATALOG } from "./sume/catalog.js";
import { readSumeError } from "./sume/errors.js";
import type { SumeCatalogEntry } from "./sume/types.js";

const PREFIX = "SUME";
const BASE = "https://api.sume.com";

const S: InputField = { type: "string" };
const URLS: InputField = { type: "array", items: "string" };
const VIDEO_FIELDS: Record<string, InputField> = {
  prompt: S, duration: { type: "number" }, resolution: S, aspect_ratio: S, seed: { type: "integer" }, generate_audio: { type: "boolean" },
  image_url: S, end_image_url: S, video_url: S, audio_url: S,
  reference_image_urls: URLS, reference_video_urls: URLS, reference_audio_urls: URLS,
  keep_original_sound: { type: "boolean" }, model_params: { type: "object" }, mode: S,
};
const IMAGE_FIELDS: Record<string, InputField> = {
  prompt: S, image_urls: URLS, aspect_ratio: S, image_size: S, quality: S,
};

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Bearer ${ctx.apiKey}` };
}

function base(ctx: MediaAdapterContext): string {
  return ctx.baseUrl ?? BASE;
}

function toSpec(entry: SumeCatalogEntry): MediaModelSpec {
  return {
    id: entry.id, upstreamId: entry.wire, vendor: entry.vendor, label: entry.label, kind: entry.kind,
    tasks: entry.tasks, params: {}, pricing: entry.pricing, docsUrl: entry.route === "image" ? "https://www.sume.com/docs/images" : "https://www.sume.com/docs/video",
  };
}

const SPECS: readonly MediaModelSpec[] = SUME_CATALOG.map(toSpec);

/** Ids that only live discovery returns: "sume/video/<wire>" or "sume/image/<wire>". */
function parseRouterId(id: string): { route: "video" | "image"; wire: string } | undefined {
  const match = /^sume\/(video|image)\/(.+)$/.exec(id);
  return match ? { route: match[1] as "video" | "image", wire: match[2] as string } : undefined;
}

function resolve(request: MediaSubmitRequest): { route: "video" | "image"; wire: string; kind: MediaKind } {
  const entry = SUME_CATALOG.find((candidate) => candidate.id === request.model);
  if (entry) {
    requireTask(PREFIX, toSpec(entry), request);
    return { route: entry.route, wire: entry.wire, kind: entry.kind };
  }
  const routed = parseRouterId(request.model);
  if (!routed) throw invalidRequest(PREFIX, `Model ${request.model} is not available on Sume`, "MODEL_UNSUPPORTED");
  return { ...routed, kind: routed.route === "image" ? "image" : "video" };
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const { route, wire, kind } = resolve(request);
  const schema: EndpointSchema = { endpoint: wire, task: request.task, required: [], fields: route === "image" ? IMAGE_FIELDS : VIDEO_FIELDS };
  const body = { model: wire, ...buildSchemaBody(PREFIX, schema, request) };
  const res = asRecord(await requestJson(ctx, {
    url: joinUrl(base(ctx), `/v1/${route}-router/generate`),
    // One key per submit: a transport retry of this same call is deduplicated by Sume.
    headers: { ...headers(ctx), "idempotency-key": randomUUID() },
    body, prefix: PREFIX, readError: readSumeError,
  }));
  const data = asRecord(res.data);
  const id = asString(data.request_id) ?? asString(asRecord(data.job).id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "Sume returned no job id" });
  const wait = asNumber(data.next_poll_after_seconds);
  return {
    providerJobId: id,
    pollAfterMs: wait !== undefined ? wait * 1000 : kind === "video" ? 5000 : 2000,
    resume: { kind, statusUrl: asString(data.status_url) ?? joinUrl(base(ctx), `/v1/jobs/${id}/status`), resultUrl: asString(data.result_url) ?? joinUrl(base(ctx), `/v1/jobs/${id}/result`) },
  };
}

function jobUrls(ctx: MediaAdapterContext, job: MediaJobRef): { statusUrl: string; resultUrl: string; kind: MediaKind } {
  const resume = job.resume ?? {};
  const kind = resume.kind === "image" || resume.kind === "audio" ? resume.kind : "video";
  return {
    statusUrl: resume.statusUrl ?? joinUrl(base(ctx), `/v1/jobs/${job.providerJobId}/status`),
    resultUrl: resume.resultUrl ?? joinUrl(base(ctx), `/v1/jobs/${job.providerJobId}/result`),
    kind,
  };
}

function artifactsToOutputs(body: unknown, kind: MediaKind): MediaOutput[] {
  const artifacts = asArray(asRecord(asRecord(asRecord(body).data).result).artifacts).map(asRecord);
  return artifacts.flatMap((artifact): MediaOutput[] => {
    const url = asString(artifact.url);
    if (!url) return [];
    const mimeType = asString(artifact.content_type) ?? mimeFromUrl(url, defaultMime(kind));
    return [{ kind: kindFromMime(mimeType, kind), url, mimeType }];
  });
}

async function failure(ctx: MediaAdapterContext, job: MediaJobRef, state: string): Promise<MediaJobState> {
  const body = asRecord(await requestJson(ctx, { url: joinUrl(base(ctx), `/v1/jobs/${job.providerJobId}`), headers: headers(ctx), prefix: PREFIX, readError: readSumeError }));
  const jobError = asRecord(asRecord(asRecord(body.data).job ?? body.data).error);
  const view = readSumeError({ error: jobError }, 0);
  return {
    status: "failed",
    error: adapterError({
      prefix: PREFIX, category: view.category ?? "upstream", reason: view.reason ?? "JOB_FAILED",
      message: view.message ?? "Sume job failed", retryable: view.retryable ?? false, providerState: state,
    }).detail,
  };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const { statusUrl, resultUrl, kind } = jobUrls(ctx, job);
  const status = asRecord(await requestJson(ctx, { url: statusUrl, headers: headers(ctx), prefix: PREFIX, readError: readSumeError }));
  const data = Object.keys(asRecord(status.data)).length > 0 ? asRecord(status.data) : status;
  const state = (asString(data.sume_status) ?? asString(data.status) ?? "").toLowerCase();
  const wait = asNumber(data.next_poll_after_seconds);
  const pollAfterMs = wait !== undefined ? wait * 1000 : kind === "video" ? 5000 : 2000;
  if (state === "queued" || state === "in_queue") return { status: "queued", pollAfterMs };
  if (state === "processing" || state === "in_progress") return { status: "running", pollAfterMs };
  if (state === "canceled" || state === "cancelled") return { status: "canceled" };
  if (state === "failed") return failure(ctx, job, state);
  if (state !== "completed") {
    return { status: "failed", error: adapterError({ prefix: PREFIX, category: "unknown", reason: "UNKNOWN_STATE", message: `Sume reported unknown status ${state || "(none)"}`, providerState: state }).detail };
  }
  const outputs = artifactsToOutputs(await requestJson(ctx, { url: resultUrl, headers: headers(ctx), prefix: PREFIX, readError: readSumeError }), kind);
  if (outputs.length === 0) {
    return { status: "failed", error: adapterError({ prefix: PREFIX, category: "upstream", reason: "NO_OUTPUT", message: "Sume result had no artifacts" }).detail };
  }
  return { status: "succeeded", outputs };
}

async function cancel(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void> {
  await requestJson(ctx, { method: "POST", url: joinUrl(base(ctx), `/v1/jobs/${job.providerJobId}/cancel`), headers: headers(ctx), body: {}, prefix: PREFIX, readError: readSumeError });
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    await requestJson(ctx, { url: joinUrl(base(ctx), "/v1/video-router/models"), headers: headers(ctx), prefix: PREFIX, readError: readSumeError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

function listedIds(body: unknown): string[] {
  const root = asRecord(body);
  const list = Array.isArray(root.data) ? root.data : asArray(asRecord(root.data).models ?? root.models);
  return list.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof item === "string" ? item : asString(record.id) ?? asString(record.model_id) ?? asString(record.model);
    return id ? [id] : [];
  });
}

/** Curated specs plus router models the key can see that the catalog does not name. */
async function discoverModels(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]> {
  const known = new Set(SUME_CATALOG.map((entry) => `${entry.route}:${entry.wire}`));
  const extra: MediaModelSpec[] = [];
  for (const route of ["video", "image"] as const) {
    const body = await requestJson(ctx, { url: joinUrl(base(ctx), `/v1/${route}-router/models`), headers: headers(ctx), prefix: PREFIX, readError: readSumeError });
    for (const wire of listedIds(body)) {
      if (known.has(`${route}:${wire}`)) continue;
      extra.push({
        id: `sume/${route}/${wire}`, upstreamId: wire, vendor: "sume", label: wire, kind: route,
        tasks: route === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video"],
        params: {}, pricing: [], docsUrl: "https://www.sume.com/docs/models",
      });
    }
  }
  return [...SPECS, ...extra];
}

export const adapter: MediaProviderAdapter = {
  id: "sume",
  label: "Sume",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "sume",
    envVars: ["SUME_API_KEY"],
    configKey: "sumeApiKey",
    keyPrefix: "sume_",
    consoleUrl: "https://www.sume.com/dashboard/api-keys",
  },
  // Router fields take public HTTPS URLs or data URIs (10 MiB each).
  inputTransport: "inline",
  listModels: () => SPECS,
  discoverModels,
  validateKey,
  submit,
  poll,
  cancel,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
