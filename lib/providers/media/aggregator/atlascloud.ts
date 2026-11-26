/**
 * Atlas Cloud media adapter (video, image and audio), reusing the Atlas key the
 * existing image lane stores (ATLASCLOUD_API_KEY / atlasCloudApiKey).
 *
 * Wire (https://www.atlascloud.ai/docs/predictions, checked 2026-11-26): POST the
 * route the model's schema declares (/api/v1/model/generateVideo|generateImage|
 * generateAudio) with { model, ...inputs } and Bearer auth; the response carries
 * data.id; GET /api/v1/model/prediction/{id} until completed or failed. Atlas
 * documents no cancel endpoint. Inputs arrive as public URLs: bytes go through
 * POST /api/v1/model/uploadMedia first (inputTransport "upload").
 */
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaKind, MediaModelSpec, MediaOutput, MediaProviderAdapter,
  MediaSubmitRequest, MediaTask,
} from "../contract.js";
import { ATLAS_CATALOG } from "./atlascloud/catalog.js";
import { readAtlasError, readPredictionFailure } from "./atlascloud/errors.js";
import type { AtlasCatalogEntry, AtlasEndpoint } from "./atlascloud/types.js";
import { adapterError, invalidRequest, normalizeAdapterError } from "./shared/errors.js";
import { buildSchemaBody, paramsFromSchemas } from "./shared/fields.js";
import { asArray, asRecord, asString, httpError, joinUrl, readBody, requestJson } from "./shared/http.js";
import { defaultMime, kindFromMime, mimeFromUrl } from "./shared/inputs.js";
import { endpointFromJsonSchema, requestSchemaFromOpenApi } from "./shared/openapi.js";

const PREFIX = "ATLASCLOUD";
const ORIGIN = "https://api.atlascloud.ai";

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Bearer ${ctx.apiKey}` };
}

function origin(ctx: MediaAdapterContext): string {
  return ctx.baseUrl ?? ORIGIN;
}

function toSpec(entry: AtlasCatalogEntry): MediaModelSpec {
  const primary = entry.endpoints[0];
  return {
    id: entry.id, upstreamId: primary?.endpoint ?? entry.id, vendor: entry.vendor, label: entry.label, kind: entry.kind,
    tasks: [...new Set(entry.endpoints.map((endpoint) => endpoint.task))], params: paramsFromSchemas(entry.endpoints),
    pricing: entry.pricing, docsUrl: `https://www.atlascloud.ai/models/${primary?.endpoint ?? entry.id}`,
  };
}

const SPECS: readonly MediaModelSpec[] = ATLAS_CATALOG.map(toSpec);

const CATEGORY_TASK: Record<string, MediaTask> = {
  "TEXT-TO-VIDEO": "text-to-video", "IMAGE-TO-VIDEO": "image-to-video", "VIDEO-TO-VIDEO": "video-to-video",
  "TEXT-TO-IMAGE": "text-to-image", "IMAGE-TO-IMAGE": "image-to-image", "TEXT-TO-AUDIO": "text-to-audio",
  "TEXT-TO-SPEECH": "text-to-audio", "AUDIO-TO-VIDEO": "avatar",
};
const TYPE_KIND: Record<string, MediaKind> = { Video: "video", Image: "image", Audio: "audio" };

async function listing(ctx: MediaAdapterContext): Promise<Record<string, unknown>[]> {
  const body = asRecord(await requestJson(ctx, { url: joinUrl(origin(ctx), "/api/v1/models"), headers: headers(ctx), prefix: PREFIX, readError: readAtlasError }));
  return asArray(body.data).map(asRecord);
}

function taskOf(model: Record<string, unknown>): MediaTask | undefined {
  const categories = asArray(model.categories).map((c) => String(c));
  for (const category of categories) if (CATEGORY_TASK[category]) return CATEGORY_TASK[category];
  return undefined;
}

/** Reads the published schema of a model outside the compiled catalog. */
async function discoveredEndpoint(ctx: MediaAdapterContext, id: string): Promise<{ endpoint: AtlasEndpoint; kind: MediaKind } | undefined> {
  const model = (await listing(ctx)).find((m) => m.model === id);
  const schemaUrl = model ? asString(model.schema) : undefined;
  const kind = model ? TYPE_KIND[asString(model.type) ?? ""] : undefined;
  const task = model ? taskOf(model) : undefined;
  if (!model || !schemaUrl || !kind || !task) return undefined;
  const doc = await requestJson(ctx, { url: schemaUrl, headers: {}, prefix: PREFIX, readError: readAtlasError });
  const path = Object.entries(asRecord(asRecord(doc).paths)).find(([, item]) => asRecord(item).post !== undefined)?.[0];
  const input = requestSchemaFromOpenApi(doc);
  if (!path || !input) return undefined;
  const base = endpointFromJsonSchema(id, task, input);
  // "model" is the routing field the adapter sets itself, never a user input.
  const fields = Object.fromEntries(Object.entries(base.fields).filter(([name]) => name !== "model"));
  return { endpoint: { ...base, fields, required: base.required.filter((name) => name !== "model"), path }, kind };
}

async function resolveEndpoint(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<{ endpoint: AtlasEndpoint; kind: MediaKind }> {
  const entry = ATLAS_CATALOG.find((candidate) => candidate.id === request.model);
  if (entry) {
    const endpoint = entry.endpoints.find((candidate) => candidate.task === request.task);
    if (!endpoint) throw invalidRequest(PREFIX, `Model ${entry.id} does not support ${request.task} on Atlas Cloud`, "TASK_UNSUPPORTED");
    return { endpoint, kind: entry.kind };
  }
  const discovered = await discoveredEndpoint(ctx, request.model);
  if (!discovered) throw invalidRequest(PREFIX, `Model ${request.model} is not available on Atlas Cloud`, "MODEL_UNSUPPORTED");
  return discovered;
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const { endpoint, kind } = await resolveEndpoint(ctx, request);
  const body = { model: endpoint.endpoint, ...buildSchemaBody(PREFIX, endpoint, request) };
  const res = asRecord(await requestJson(ctx, { url: joinUrl(origin(ctx), endpoint.path), headers: headers(ctx), body, prefix: PREFIX, readError: readAtlasError }));
  const data = asRecord(res.data);
  const id = asString(data.id) ?? asString(data.request_id) ?? asString(res.id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "Atlas Cloud returned no prediction id" });
  return { providerJobId: id, pollAfterMs: kind === "video" ? 5000 : 2000, resume: { kind } };
}

function outputsOf(data: Record<string, unknown>, kind: MediaKind): MediaOutput[] {
  const raw = asArray(data.outputs ?? data.output ?? data.result);
  const list = raw.length > 0 ? raw : typeof data.outputs === "string" ? [data.outputs] : [];
  return list.flatMap((item): MediaOutput[] => {
    const url = typeof item === "string" ? item : asString(asRecord(item).url);
    if (!url || !/^https?:\/\//.test(url)) return [];
    const mimeType = asString(asRecord(item).content_type) ?? mimeFromUrl(url, defaultMime(kind));
    return [{ kind: kindFromMime(mimeType, kind), url, mimeType }];
  });
}

function failed(view: ReturnType<typeof readPredictionFailure>, state: string): MediaJobState {
  return {
    status: "failed",
    error: adapterError({
      prefix: PREFIX, category: view.category ?? "upstream", reason: view.reason ?? "PREDICTION_FAILED",
      message: view.message ?? "Atlas Cloud prediction failed", retryable: view.retryable ?? false, providerState: state,
    }).detail,
  };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const resumeKind = job.resume?.kind;
  const kind: MediaKind = resumeKind === "image" || resumeKind === "audio" ? resumeKind : "video";
  const url = joinUrl(origin(ctx), `/api/v1/model/prediction/${encodeURIComponent(job.providerJobId)}`);
  const body = asRecord(await requestJson(ctx, { url, headers: headers(ctx), prefix: PREFIX, readError: readAtlasError }));
  const data = Object.keys(asRecord(body.data)).length > 0 ? asRecord(body.data) : body;
  const state = (asString(data.status) ?? "").toLowerCase();
  const pollAfterMs = kind === "video" ? 5000 : 2000;
  if (state === "created" || state === "queued" || state === "pending" || state === "starting") return { status: "queued", pollAfterMs };
  if (state === "processing" || state === "running" || state === "in_progress") return { status: "running", pollAfterMs };
  if (state === "failed" || state === "error") return failed(readPredictionFailure(data), state);
  if (state === "timeout") return failed({ ...readPredictionFailure(data), category: "timeout", reason: "TIMEOUT" }, state);
  if (state !== "completed" && state !== "succeeded") {
    return failed({ category: "unknown", reason: "UNKNOWN_STATE", message: `Atlas Cloud reported unknown status ${state || "(none)"}` }, state);
  }
  const outputs = outputsOf(data, kind);
  if (outputs.length === 0) return failed({ category: "upstream", reason: "NO_OUTPUT", message: "Atlas Cloud prediction had no outputs" }, state);
  return { status: "succeeded", outputs };
}

async function uploadInput(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }> {
  if (input.url) return { url: input.url };
  if (!input.bytes) throw invalidRequest(PREFIX, `Input ${input.role} has neither url nor bytes`);
  const form = new FormData();
  const copy = new Uint8Array(input.bytes);
  form.append("file", new Blob([copy], { type: input.mimeType }), `${input.role}.${input.mimeType.split("/")[1] ?? "bin"}`);
  const init: RequestInit = { method: "POST", headers: headers(ctx), body: form };
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(joinUrl(origin(ctx), "/api/v1/model/uploadMedia"), init);
  const body = await readBody(res);
  if (!res.ok) throw httpError(ctx, { prefix: PREFIX, readError: readAtlasError }, res.status, body);
  const record = asRecord(body);
  const url = asString(record.url) ?? asString(asRecord(record.data).url) ?? (typeof record.data === "string" ? record.data : undefined);
  if (!url) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "UPLOAD_NO_URL", message: "Atlas Cloud upload returned no URL" });
  return { url };
}

/** Balance read: authenticated, free, and never a generation. */
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    await requestJson(ctx, { url: joinUrl(origin(ctx), "/public/v1/balance"), headers: headers(ctx), prefix: PREFIX, readError: readAtlasError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

async function discoverModels(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]> {
  const routed = new Set(ATLAS_CATALOG.flatMap((entry) => entry.endpoints.map((endpoint) => endpoint.endpoint)));
  const extra = (await listing(ctx)).flatMap((model): MediaModelSpec[] => {
    const id = asString(model.model);
    const kind = TYPE_KIND[asString(model.type) ?? ""];
    const task = taskOf(model);
    if (!id || !kind || !task || routed.has(id)) return [];
    return [{
      id, upstreamId: id, vendor: id.split("/")[0] ?? "atlascloud", label: asString(model.displayName) ?? id, kind,
      tasks: [task], params: {}, pricing: [], docsUrl: `https://www.atlascloud.ai/models/${id}`,
    }];
  });
  return [...SPECS, ...extra];
}

export const adapter: MediaProviderAdapter = {
  id: "atlascloud",
  label: "Atlas Cloud",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "atlascloud",
    envVars: ["ATLASCLOUD_API_KEY"],
    configKey: "atlasCloudApiKey",
    keyPrefix: "apikey-",
    consoleUrl: "https://www.atlascloud.ai/console/api-keys",
  },
  inputTransport: "upload",
  listModels: () => SPECS,
  discoverModels,
  validateKey,
  uploadInput,
  submit,
  poll,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
