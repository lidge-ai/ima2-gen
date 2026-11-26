/**
 * Replicate adapter (BYOK, user's own REPLICATE_API_TOKEN).
 *
 * Wire (https://replicate.com/docs/reference/http, checked 2026-11-26): official
 * models: POST /v1/models/{owner}/{name}/predictions { input }; other models:
 * POST /v1/predictions { version, input }. Poll GET /v1/predictions/{id}
 * (starting, processing, succeeded, failed, canceled; "aborted" when a deadline
 * expires before the run starts). Cancel: POST /v1/predictions/{id}/cancel.
 * Output files from API predictions are deleted after one hour, so the caller
 * must download them on completion.
 */
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaKind, MediaModelSpec, MediaOutput, MediaProviderAdapter, MediaSubmitRequest,
  MediaTask,
} from "../contract.js";
import { REPLICATE_CATALOG } from "./replicate/catalog.js";
import { readPredictionError, readReplicateError } from "./replicate/errors.js";
import type { ReplicateCatalogEntry } from "./replicate/types.js";
import { adapterError, invalidRequest, normalizeAdapterError } from "./shared/errors.js";
import { buildSchemaBody, paramsFromSchemas, type EndpointSchema } from "./shared/fields.js";
import { asArray, asRecord, asString, joinUrl, requestJson } from "./shared/http.js";
import { defaultMime, kindFromMime, mimeFromUrl } from "./shared/inputs.js";
import { endpointFromJsonSchema } from "./shared/openapi.js";

const PREFIX = "REPLICATE";
const BASE = "https://api.replicate.com/v1";
const API_HOST = "api.replicate.com";

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Bearer ${ctx.apiKey}` };
}

function base(ctx: MediaAdapterContext): string {
  return ctx.baseUrl ?? BASE;
}

function schemaOf(entry: ReplicateCatalogEntry, task: MediaTask): EndpointSchema {
  return { endpoint: entry.upstream, task, required: entry.required, fields: entry.fields };
}

function toSpec(entry: ReplicateCatalogEntry): MediaModelSpec {
  return {
    id: entry.id, upstreamId: entry.upstream, vendor: entry.vendor, label: entry.label, kind: entry.kind, tasks: entry.tasks,
    params: paramsFromSchemas(entry.tasks.map((task) => schemaOf(entry, task))), pricing: entry.pricing,
    docsUrl: `https://replicate.com/${entry.upstream}`,
  };
}

const SPECS: readonly MediaModelSpec[] = REPLICATE_CATALOG.map(toSpec);

const TASK_KIND: Partial<Record<MediaTask, MediaKind>> = {
  "text-to-image": "image", "image-to-image": "image", "image-upscale": "image", "image-vectorize": "image", "image-segment": "image",
  "text-to-audio": "audio", "video-to-audio": "audio",
};

interface Route {
  url: string;
  version?: string;
  schema: EndpointSchema;
  kind: MediaKind;
}

/** Reads the latest version's schema for a model outside the compiled catalog. */
async function discoveredRoute(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<Route | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(request.model)) return undefined;
  const model = asRecord(await requestJson(ctx, { url: joinUrl(base(ctx), `/models/${request.model}`), headers: headers(ctx), prefix: PREFIX, readError: readReplicateError }));
  const latest = asRecord(model.latest_version);
  const openapi = asRecord(latest.openapi_schema);
  const components = asRecord(asRecord(openapi.components).schemas);
  if (!components.Input) return undefined;
  const schema = endpointFromJsonSchema(request.model, request.task, components.Input, components);
  const version = asString(latest.id);
  const kind = TASK_KIND[request.task] ?? "video";
  return version
    ? { url: joinUrl(base(ctx), "/predictions"), version, schema, kind }
    : { url: joinUrl(base(ctx), `/models/${request.model}/predictions`), schema, kind };
}

async function resolveRoute(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<Route> {
  const entry = REPLICATE_CATALOG.find((candidate) => candidate.id === request.model);
  if (entry) {
    if (!entry.tasks.includes(request.task)) throw invalidRequest(PREFIX, `Model ${entry.id} does not support ${request.task} on Replicate`, "TASK_UNSUPPORTED");
    const schema = schemaOf(entry, request.task);
    if (entry.official || !entry.version) return { url: joinUrl(base(ctx), `/models/${entry.upstream}/predictions`), schema, kind: entry.kind };
    return { url: joinUrl(base(ctx), "/predictions"), version: entry.version, schema, kind: entry.kind };
  }
  const discovered = await discoveredRoute(ctx, request);
  if (!discovered) throw invalidRequest(PREFIX, `Model ${request.model} is not available on Replicate`, "MODEL_UNSUPPORTED");
  return discovered;
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const route = await resolveRoute(ctx, request);
  const input = buildSchemaBody(PREFIX, route.schema, request);
  const body = route.version ? { version: route.version, input } : { input };
  const res = asRecord(await requestJson(ctx, { url: route.url, headers: headers(ctx), body, prefix: PREFIX, readError: readReplicateError }));
  const id = asString(res.id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "Replicate returned no prediction id" });
  const urls = asRecord(res.urls);
  return {
    providerJobId: id,
    pollAfterMs: route.kind === "video" ? 5000 : 2000,
    resume: {
      kind: route.kind,
      getUrl: asString(urls.get) ?? joinUrl(base(ctx), `/predictions/${id}`),
      cancelUrl: asString(urls.cancel) ?? joinUrl(base(ctx), `/predictions/${id}/cancel`),
    },
  };
}

function collectUrls(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return;
  }
  for (const item of Object.values(asRecord(value))) collectUrls(item, out);
}

function outputsOf(ctx: MediaAdapterContext, output: unknown, kind: MediaKind): MediaOutput[] {
  const urls: string[] = [];
  collectUrls(output, urls);
  return urls.map((url) => {
    const mimeType = mimeFromUrl(url, defaultMime(kind));
    // Files served from the API host itself need the token; replicate.delivery links do not.
    const needsAuth = new URL(url).host === API_HOST;
    return { kind: kindFromMime(mimeType, kind), url, mimeType, ...(needsAuth ? { downloadHeaders: headers(ctx) } : {}) };
  });
}

function failedState(view: ReturnType<typeof readPredictionError>, state: string, category?: "timeout"): MediaJobState {
  return {
    status: "failed",
    error: adapterError({
      prefix: PREFIX, category: category ?? view.category ?? "upstream", reason: category ? "ABORTED" : view.reason ?? "PREDICTION_FAILED",
      message: view.message ?? "Replicate prediction failed", retryable: category === "timeout" || (view.retryable ?? false), providerState: state,
    }).detail,
  };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const resumeKind = job.resume?.kind;
  const kind: MediaKind = resumeKind === "image" || resumeKind === "audio" ? resumeKind : "video";
  const url = job.resume?.getUrl ?? joinUrl(base(ctx), `/predictions/${job.providerJobId}`);
  const prediction = asRecord(await requestJson(ctx, { url, headers: headers(ctx), prefix: PREFIX, readError: readReplicateError }));
  const state = asString(prediction.status) ?? "";
  const pollAfterMs = kind === "video" ? 5000 : 2000;
  if (state === "starting") return { status: "queued", pollAfterMs };
  if (state === "processing") return { status: "running", pollAfterMs };
  if (state === "canceled") return { status: "canceled" };
  if (state === "failed") return failedState(readPredictionError(prediction.error), state);
  if (state === "aborted") return failedState({ message: "Replicate aborted the prediction before it started (deadline expired)" }, state, "timeout");
  if (state !== "succeeded") return failedState({ category: "unknown", reason: "UNKNOWN_STATE", message: `Replicate reported unknown status ${state || "(none)"}` }, state);
  const outputs = outputsOf(ctx, prediction.output, kind);
  if (outputs.length === 0) return failedState({ category: "upstream", reason: "NO_OUTPUT", message: "Replicate prediction had no output files" }, state);
  return { status: "succeeded", outputs };
}

async function cancel(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void> {
  const url = job.resume?.cancelUrl ?? joinUrl(base(ctx), `/predictions/${job.providerJobId}/cancel`);
  await requestJson(ctx, { method: "POST", url, headers: headers(ctx), prefix: PREFIX, readError: readReplicateError });
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    await requestJson(ctx, { url: joinUrl(base(ctx), "/account"), headers: headers(ctx), prefix: PREFIX, readError: readReplicateError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

/** Public collections that map cleanly onto one task. */
const COLLECTIONS: ReadonlyArray<{ slug: string; task: MediaTask; kind: MediaKind }> = [
  { slug: "text-to-video", task: "text-to-video", kind: "video" },
  { slug: "image-to-video", task: "image-to-video", kind: "video" },
  { slug: "text-to-image", task: "text-to-image", kind: "image" },
];

async function discoverModels(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]> {
  const routed = new Set(REPLICATE_CATALOG.map((entry) => entry.upstream));
  const extra = new Map<string, MediaModelSpec>();
  for (const { slug, task, kind } of COLLECTIONS) {
    let body: Record<string, unknown>;
    try {
      body = asRecord(await requestJson(ctx, { url: joinUrl(base(ctx), `/collections/${slug}`), headers: headers(ctx), prefix: PREFIX, readError: readReplicateError }));
    } catch (error) {
      // A collection Replicate retired is not a failure of discovery; anything else is.
      if (normalizeAdapterError(PREFIX, error).category === "not-found") continue;
      throw error;
    }
    for (const raw of asArray(body.models)) {
      const model = asRecord(raw);
      const id = `${asString(model.owner) ?? ""}/${asString(model.name) ?? ""}`;
      if (id === "/" || routed.has(id)) continue;
      const known = extra.get(id);
      if (known) {
        if (!known.tasks.includes(task)) extra.set(id, { ...known, tasks: [...known.tasks, task] });
        continue;
      }
      extra.set(id, {
        id, upstreamId: id, vendor: asString(model.owner) ?? "replicate", label: asString(model.name) ?? id, kind,
        tasks: [task], params: {}, pricing: [], docsUrl: `https://replicate.com/${id}`,
      });
    }
  }
  return [...SPECS, ...extra.values()];
}

export const adapter: MediaProviderAdapter = {
  id: "replicate",
  label: "Replicate",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "replicate",
    envVars: ["REPLICATE_API_TOKEN"],
    configKey: "replicateApiToken",
    keyPrefix: "r8_",
    consoleUrl: "https://replicate.com/account/api-tokens",
  },
  // File inputs take HTTP URLs or data URIs.
  inputTransport: "inline",
  listModels: () => SPECS,
  discoverModels,
  validateKey,
  submit,
  poll,
  cancel,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
