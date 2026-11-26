/**
 * VEED API direct adapter: Fabric 1.0 (talking video from image + audio),
 * Lipsync 2.0 and Dubbing (Standard / Pro). Docs: https://api.veed.io/docs,
 * OpenAPI https://api.veed.io/openapi.yaml, checked 2026-11-26.
 *
 * VEED Subtitles is not listed: no standalone subtitles endpoint or price is
 * published in the OpenAPI or on the pricing page (lanes/L3-notes/veed.md).
 */
import type {
  MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaProviderError,
  MediaSubmitRequest,
} from "../contract.js";
import {
  MediaHttpError, assertAllowed, findModel, httpJson, invalidRequest, normalizeMediaError, protocolError,
  readVendorOptions, requireInput, requireUrl,
} from "./l3-http.js";

const PREFIX = "VEED";
const BASE_URL = "https://api.veed.io";
const PRICING = "https://api.veed.io/pricing";
const CHECKED = "2026-11-26";
const POLL_MS = 10_000;
/** A job id that cannot exist; the lookup tells a rejected key (401) from an accepted one (404). */
const PROBE_JOB_ID = "00000000-0000-0000-0000-000000000000";

const MODELS: readonly MediaModelSpec[] = [
  {
    id: "veed/veed-fabric-1.0", upstreamId: "fabric-1.0", vendor: "veed", label: "VEED Fabric 1.0",
    kind: "video", tasks: ["avatar"], params: { resolutions: ["480p", "720p"] },
    pricing: [
      { unit: "second", usd: 0.08, variant: "480p", source: PRICING, checkedAt: CHECKED },
      { unit: "second", usd: 0.15, variant: "720p", source: PRICING, checkedAt: CHECKED },
    ],
    docsUrl: "https://api.veed.io/docs/api/post-v1-fabric-1-0",
  },
  {
    id: "veed/veed-lipsync", upstreamId: "lipsync-2.0", vendor: "veed", label: "VEED Lipsync 2.0",
    kind: "video", tasks: ["lipsync"], params: {},
    pricing: [{ unit: "second", usd: 0.07, source: PRICING, checkedAt: CHECKED }],
    docsUrl: "https://api.veed.io/docs/api/post-v1-lipsync-2-0",
  },
  {
    id: "veed/veed-dubbing", upstreamId: "dubbing", vendor: "veed", label: "VEED Dubbing",
    kind: "video", tasks: ["dubbing"], params: {},
    pricing: [
      { unit: "second", usd: 0.11, variant: "standard", source: PRICING, checkedAt: CHECKED },
      { unit: "second", usd: 0.18, variant: "pro", source: PRICING, checkedAt: CHECKED },
    ],
    docsUrl: "https://api.veed.io/docs/api/post-v1-dubbing",
  },
];

const OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "veed/veed-fabric-1.0": [],
  "veed/veed-lipsync": [],
  "veed/veed-dubbing": ["tier", "target_language", "source_language", "voice_cloning_strength"],
};

/** VEED error body codes (https://api.veed.io/docs/concepts) that say more than the status. */
const BODY_CODES: Readonly<Record<string, { reason: string; category: MediaProviderError["category"]; retryable: boolean }>> = {
  insufficient_tokens: { reason: "INSUFFICIENT_CREDIT", category: "quota", retryable: false },
  insufficient_credits: { reason: "INSUFFICIENT_CREDIT", category: "quota", retryable: false },
  permission_denied: { reason: "PERMISSION_DENIED", category: "auth", retryable: false },
  unauthenticated: { reason: "AUTH", category: "auth", retryable: false },
  rate_limited: { reason: "RATE_LIMITED", category: "rate-limit", retryable: true },
  unavailable: { reason: "UNAVAILABLE", category: "upstream", retryable: true },
  conflict: { reason: "CONFLICT", category: "invalid-request", retryable: false },
};

/** Job failure codes from the job GET responses. */
const JOB_CODES: Readonly<Record<string, { category: MediaProviderError["category"]; retryable: boolean }>> = {
  content_moderation: { category: "moderation", retryable: false },
  input_validation: { category: "invalid-request", retryable: false },
  invalid_file: { category: "invalid-request", retryable: false },
  audio_too_long: { category: "invalid-request", retryable: false },
  transload_failed: { category: "invalid-request", retryable: false },
  insufficient_credits: { category: "quota", retryable: false },
  timeout: { category: "timeout", retryable: true },
  generation_failed: { category: "upstream", retryable: false },
};

interface VeedJob {
  data?: {
    job_id?: string;
    status?: string;
    result?: { video?: { url?: string; content_type?: string } };
    error?: { code?: string; message?: string };
  };
}

function bodyCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
}

function call(ctx: MediaAdapterContext, label: string, path: string, json?: unknown): Promise<VeedJob> {
  return httpJson<VeedJob>(ctx, label, (ctx.baseUrl ?? BASE_URL) + path, {
    headers: { Authorization: "Bearer " + ctx.apiKey },
    ...(json !== undefined ? { json } : {}),
    classify: (_status, body) => BODY_CODES[bodyCode(body) ?? ""],
  });
}

function dubbingBody(request: MediaSubmitRequest, options: Record<string, unknown>): { path: string; body: Record<string, unknown> } {
  const tier = options.tier ?? "standard";
  if (tier !== "standard" && tier !== "pro") throw invalidRequest("tier must be standard or pro", "UNSUPPORTED_PARAM");
  if (typeof options.target_language !== "string" || !options.target_language) {
    throw invalidRequest("dubbing needs vendorOptions.target_language", "MISSING_PARAM");
  }
  if (tier === "standard" && options.voice_cloning_strength !== undefined) {
    throw invalidRequest("voice_cloning_strength needs tier pro", "UNSUPPORTED_PARAM");
  }
  const strength = options.voice_cloning_strength;
  if (strength !== undefined && (typeof strength !== "number" || strength < 0 || strength > 10)) {
    throw invalidRequest("voice_cloning_strength must be a number from 0 to 10", "UNSUPPORTED_PARAM");
  }
  const body: Record<string, unknown> = {
    video_url: requireUrl(requireInput(request, "source-video")),
    target_language: options.target_language,
  };
  if (options.source_language !== undefined) body.source_language = options.source_language;
  if (strength !== undefined) body.voice_cloning_strength = strength;
  return { path: tier === "pro" ? "/v1/dubbing-pro" : "/v1/dubbing", body };
}

function buildRequest(request: MediaSubmitRequest): { path: string; body: Record<string, unknown> } {
  const spec = findModel(MODELS, request.model);
  if (!spec.tasks.includes(request.task)) throw invalidRequest(spec.id + " does not support " + request.task, "UNSUPPORTED_TASK");
  const options = readVendorOptions(request, OPTIONS[spec.id] ?? []);
  assertAllowed("resolution", request.resolution, spec.params.resolutions);
  if (spec.id === "veed/veed-dubbing") return dubbingBody(request, options);
  const audio_url = requireUrl(requireInput(request, "source-audio"));
  if (spec.id === "veed/veed-lipsync") {
    return { path: "/v1/lipsync-2.0", body: { video_url: requireUrl(requireInput(request, "source-video")), audio_url } };
  }
  const body: Record<string, unknown> = { image_url: requireUrl(requireInput(request, "source-image")), audio_url };
  if (request.resolution) body.resolution = request.resolution;
  return { path: "/v1/fabric-1.0", body };
}

function jobState(job: VeedJob): MediaJobState {
  const data = job.data ?? {};
  switch (data.status) {
    case "PROCESSING": return { status: "running", pollAfterMs: POLL_MS };
    case "CANCELLED": return { status: "canceled" };
    case "COMPLETED": {
      const url = data.result?.video?.url;
      if (!url) throw protocolError("VEED job completed without a video URL", "COMPLETED");
      return { status: "succeeded", outputs: [{ kind: "video", url, mimeType: data.result?.video?.content_type ?? "video/mp4" }] };
    }
    case "FAILED": {
      const code = data.error?.code ?? "generation_failed";
      const mapped = JOB_CODES[code] ?? { category: "upstream" as const, retryable: false };
      return { status: "failed", error: {
        code: PREFIX + "_" + code.toUpperCase(), message: data.error?.message ?? "VEED job failed",
        category: mapped.category, retryable: mapped.retryable, providerState: "FAILED",
      } };
    }
    default: throw protocolError("VEED returned an unknown job status: " + String(data.status), String(data.status));
  }
}

export const adapter: MediaProviderAdapter = {
  id: "veed",
  label: "VEED",
  route: "direct",
  errorPrefix: PREFIX,
  credential: {
    keyVocabulary: "veed", envVars: ["VEED_API_KEY"], configKey: "veedApiKey",
    consoleUrl: "https://api.veed.io/docs/accounts",
  },
  inputTransport: "url",
  listModels: () => MODELS,

  async validateKey(ctx) {
    try {
      await call(ctx, "VEED key check", "/v1/lipsync-2.0/" + PROBE_JOB_ID);
      return { ok: true };
    } catch (error) {
      if (error instanceof MediaHttpError && error.status === 404) return { ok: true };
      const normalized = normalizeMediaError(PREFIX, error, [ctx.apiKey]);
      return { ok: false, reason: normalized.message };
    }
  },

  async submit(ctx, request): Promise<MediaJobRef> {
    const { path, body } = buildRequest(request);
    const job = await call(ctx, "VEED submit", path, body);
    const id = job.data?.job_id;
    if (!id) throw protocolError("VEED submit returned no job_id");
    return { providerJobId: id, pollAfterMs: POLL_MS, resume: { path } };
  },

  async poll(ctx, job) {
    const path = job.resume?.path;
    if (!path) throw invalidRequest("VEED job is missing its resume path", "MISSING_RESUME");
    return jobState(await call(ctx, "VEED poll", path + "/" + encodeURIComponent(job.providerJobId)));
  },

  normalizeError: (error) => normalizeMediaError(PREFIX, error),
};
