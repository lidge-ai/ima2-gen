/**
 * OpenRouter video adapter (BYOK, user's own OPENROUTER_API_KEY).
 *
 * Wire (https://openrouter.ai/openapi.json, checked 2026-11-26): POST /api/v1/videos
 * returns 202 { id, polling_url, status: "pending" }; GET /api/v1/videos/{id}
 * reports pending, in_progress, completed, failed, cancelled or expired, with
 * unsigned_urls and usage.cost when completed. OpenRouter's guide says the
 * returned content URLs on openrouter.ai still need the Bearer key. No cancel
 * operation is documented. OpenRouter image generation is synchronous and is
 * not routed here.
 */
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaOutput, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { buildVideoBody } from "./openrouter/body.js";
import { OPENROUTER_CATALOG } from "./openrouter/catalog.js";
import type { OpenRouterCatalogEntry } from "./openrouter/types.js";
import { adapterError, invalidRequest, normalizeAdapterError } from "./shared/errors.js";
import type { VendorErrorView } from "./shared/http.js";
import { asArray, asNumber, asRecord, asString, joinUrl, requestJson } from "./shared/http.js";
import { mimeFromUrl } from "./shared/inputs.js";

const PREFIX = "OPENROUTER_";
const BASE = "https://openrouter.ai/api/v1";
const POLL_MS = 5000;

/** { "error": { "code": 402, "message": "Insufficient credits ..." } } */
function readError(body: unknown, _status: number): VendorErrorView {
  const error = asRecord(asRecord(body).error);
  return { message: asString(error.message) };
}

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Bearer ${ctx.apiKey}` };
}

function base(ctx: MediaAdapterContext): string {
  return ctx.baseUrl ?? BASE;
}

function toSpec(entry: OpenRouterCatalogEntry): MediaModelSpec {
  return {
    id: entry.id, upstreamId: entry.upstream, vendor: entry.vendor, label: entry.label, kind: "video", tasks: entry.tasks,
    params: {
      ...(entry.durations.length > 0 ? { durationsSec: entry.durations } : {}),
      ...(entry.resolutions.length > 0 ? { resolutions: entry.resolutions } : {}),
      ...(entry.aspectRatios.length > 0 ? { aspectRatios: entry.aspectRatios } : {}),
      ...(entry.audio ? { nativeAudio: true } : {}),
      ...(entry.seed ? { seed: true } : {}),
    },
    pricing: entry.pricing, docsUrl: `https://openrouter.ai/${entry.upstream}`,
  };
}

const SPECS: readonly MediaModelSpec[] = OPENROUTER_CATALOG.map(toSpec);

function entryFromListing(raw: Record<string, unknown>): OpenRouterCatalogEntry | undefined {
  const id = asString(raw.id);
  if (!id) return undefined;
  const numbers = asArray(raw.supported_durations).map((d) => asNumber(d)).filter((d): d is number => d !== undefined);
  const strings = (value: unknown) => asArray(value).filter((v): v is string => typeof v === "string");
  const frames = strings(raw.supported_frame_images);
  return {
    id, upstream: id, label: asString(raw.name) ?? id, vendor: id.split("/")[0] ?? "openrouter",
    tasks: frames.includes("first_frame") ? ["text-to-video", "image-to-video"] : ["text-to-video"],
    resolutions: strings(raw.supported_resolutions), durations: numbers.filter((d) => d > 0), allowAutoDuration: numbers.includes(-1),
    aspectRatios: strings(raw.supported_aspect_ratios), frames, audio: raw.generate_audio === true, seed: raw.seed === true, pricing: [],
  };
}

async function liveEntries(ctx: MediaAdapterContext): Promise<OpenRouterCatalogEntry[]> {
  const body = asRecord(await requestJson(ctx, { url: joinUrl(base(ctx), "/videos/models"), headers: headers(ctx), prefix: PREFIX, readError }));
  return asArray(body.data).map(asRecord).flatMap((raw) => entryFromListing(raw) ?? []);
}

async function resolve(ctx: MediaAdapterContext, model: string): Promise<OpenRouterCatalogEntry> {
  const curated = OPENROUTER_CATALOG.find((entry) => entry.id === model);
  if (curated) return curated;
  const live = (await liveEntries(ctx)).find((entry) => entry.id === model);
  if (!live) throw invalidRequest(PREFIX, `Model ${model} is not available on OpenRouter video`, "MODEL_UNSUPPORTED");
  return live;
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const entry = await resolve(ctx, request.model);
  const body = buildVideoBody(entry, request);
  const res = asRecord(await requestJson(ctx, { url: joinUrl(base(ctx), "/videos"), headers: headers(ctx), body, prefix: PREFIX, readError }));
  const id = asString(res.id);
  if (!id) throw adapterError({ prefix: PREFIX, category: "upstream", reason: "BAD_RESPONSE", message: "OpenRouter returned no job id" });
  return { providerJobId: id, pollAfterMs: POLL_MS };
}

function outputs(ctx: MediaAdapterContext, job: Record<string, unknown>): MediaOutput[] {
  const urls = asArray(job.unsigned_urls).length > 0 ? asArray(job.unsigned_urls) : asArray(job.urls);
  return urls.flatMap((value): MediaOutput[] => {
    if (typeof value !== "string" || !/^https?:\/\//.test(value)) return [];
    const onOpenRouter = new URL(value).host.endsWith("openrouter.ai");
    return [{ kind: "video", url: value, mimeType: mimeFromUrl(value, "video/mp4"), ...(onOpenRouter ? { downloadHeaders: headers(ctx) } : {}) }];
  });
}

function failure(category: "upstream" | "not-found" | "unknown", reason: string, message: string, state: string): MediaJobState {
  return { status: "failed", error: adapterError({ prefix: PREFIX, category, reason, message, providerState: state }).detail };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const url = joinUrl(base(ctx), `/videos/${encodeURIComponent(job.providerJobId)}`);
  const res = asRecord(await requestJson(ctx, { url, headers: headers(ctx), prefix: PREFIX, readError }));
  const state = asString(res.status) ?? "";
  const progress = asNumber(res.progress);
  if (state === "pending") return { status: "queued", pollAfterMs: POLL_MS };
  if (state === "in_progress") return { status: "running", pollAfterMs: POLL_MS, ...(progress !== undefined ? { progress: progress / 100 } : {}) };
  if (state === "cancelled") return { status: "canceled" };
  if (state === "failed") return failure("upstream", "GENERATION_FAILED", asString(res.error) ?? "OpenRouter video generation failed", state);
  if (state === "expired") return failure("not-found", "EXPIRED", "OpenRouter video job expired before its output was fetched", state);
  if (state !== "completed") return failure("unknown", "UNKNOWN_STATE", `OpenRouter reported unknown status ${state || "(none)"}`, state);
  const files = outputs(ctx, res);
  if (files.length === 0) return failure("upstream", "NO_OUTPUT", "OpenRouter job completed without output URLs", state);
  const cost = asNumber(asRecord(res.usage).cost);
  return { status: "succeeded", outputs: files, ...(cost !== undefined ? { billed: { usd: cost } } : {}) };
}

async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    await requestJson(ctx, { url: joinUrl(base(ctx), "/key"), headers: headers(ctx), prefix: PREFIX, readError });
    return { ok: true };
  } catch (error) {
    const detail = normalizeAdapterError(PREFIX, error);
    return { ok: false, reason: detail.status ? `${detail.message} (HTTP ${detail.status})` : detail.message };
  }
}

async function discoverModels(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]> {
  const routed = new Set(OPENROUTER_CATALOG.map((entry) => entry.upstream));
  const extra = (await liveEntries(ctx)).filter((entry) => !routed.has(entry.upstream)).map(toSpec);
  return [...SPECS, ...extra];
}

export const adapter: MediaProviderAdapter = {
  id: "openrouter",
  label: "OpenRouter",
  route: "aggregator",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "openrouter",
    envVars: ["OPENROUTER_API_KEY"],
    configKey: "openrouterApiKey",
    keyPrefix: "sk-or-",
    consoleUrl: "https://openrouter.ai/settings/keys",
  },
  // Frame and reference parts take URLs (data URIs are sent as-is when bytes are given).
  inputTransport: "inline",
  listModels: () => SPECS,
  discoverModels,
  validateKey,
  submit,
  poll,
  normalizeError: (error) => normalizeAdapterError(PREFIX, error),
};
