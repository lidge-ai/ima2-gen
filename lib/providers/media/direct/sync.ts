import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { assertAllowed, findModel, httpJson, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, requireInput, requireUrl } from "./l3-http.js";

const base = "https://api.sync.so/v2";
const docsUrl = "https://sync.so/docs/api-reference/api/generate-api/create";
const pricingUrl = "https://sync.so/pricing";
const plans = ["Hobbyist", "Creator", "Growth", "Scale"];
const definitions = [
  ["sync-lipsync-2", "lipsync-2", [0.05, 0.05, 0.0475, 0.04]],
  ["sync-lipsync-2-pro", "lipsync-2-pro", [0.08325, 0.08325, 0.07925, 0.06675]],
  ["sync-lipsync-3", "sync-3", [0.13325, 0.13325, 0.12675, 0.10675]],
] as const;
const models: readonly MediaModelSpec[] = definitions.map(([id, upstreamId, prices]) => ({
  id: `sync/${id}`, upstreamId, vendor: "sync", label: upstreamId, kind: "video", tasks: ["lipsync"], params: {}, docsUrl,
  pricing: prices.map((usd, index) => ({ unit: "second" as const, usd, variant: `${plans[index]} (25 fps)`, source: pricingUrl, checkedAt: "2026-11-26" })),
}));

function optionsFor(request: MediaSubmitRequest, upstreamId: string): Record<string, unknown> {
  const options = readVendorOptions(request, ["sync_mode", "temperature", "reasoning_enabled", "occlusion_detection_enabled", "refinement_enabled", "blending_mode"]);
  if (options.sync_mode !== undefined && (typeof options.sync_mode !== "string" || !["bounce", "loop", "cut_off", "silence", "remap"].includes(options.sync_mode))) throw invalidRequest("Invalid sync_mode");
  if (options.blending_mode !== undefined && (typeof options.blending_mode !== "string" || !["default", "advanced", "disabled"].includes(options.blending_mode))) throw invalidRequest("Invalid blending_mode");
  if (options.temperature !== undefined && (typeof options.temperature !== "number" || !Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 1)) throw invalidRequest("Invalid temperature");
  for (const key of ["reasoning_enabled", "occlusion_detection_enabled", "refinement_enabled"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw invalidRequest(`Invalid ${key}`);
  }
  if (upstreamId === "sync-3" && ["temperature", "reasoning_enabled", "occlusion_detection_enabled"].some((key) => options[key] !== undefined)) throw invalidRequest("Option unsupported for sync-3");
  return options;
}

function validateRequest(request: MediaSubmitRequest): { model: MediaModelSpec; options: Record<string, unknown> } {
  const model = findModel(models, request.model);
  assertAllowed("task", request.task, model.tasks);
  for (const [name, value] of Object.entries({ prompt: request.prompt, negativePrompt: request.negativePrompt, durationSec: request.durationSec, resolution: request.resolution, aspectRatio: request.aspectRatio, seed: request.seed, audio: request.audio, count: request.count })) {
    if (value !== undefined) throw invalidRequest(`Unsupported parameter: ${name}`, "UNSUPPORTED_PARAM");
  }
  if (request.inputs.length !== 2) throw invalidRequest("Exactly one video and one audio are required");
  return { model, options: optionsFor(request, model.upstreamId) };
}

async function safe<T>(ctx: MediaAdapterContext, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    const clean = (value: string) => ctx.apiKey ? value.split(ctx.apiKey).join("[redacted]") : value;
    if (error instanceof MediaHttpError) throw new MediaHttpError({ message: clean(error.message), reason: error.reason, category: error.category, retryable: error.retryable, ...(error.status === undefined ? {} : { status: error.status }) });
    const mapped = normalizeMediaError("SYNC", error);
    throw new MediaHttpError({ message: clean(mapped.message), reason: mapped.code.slice(5), category: mapped.category, retryable: mapped.retryable });
  }
}

function stateOf(ctx: MediaAdapterContext, data: Record<string, unknown>): MediaJobState {
  if (data.status === "PENDING") return { status: "queued" };
  if (data.status === "PROCESSING") return { status: "running" };
  if (data.status === "COMPLETED") {
    if (typeof data.outputUrl !== "string" || !data.outputUrl) throw protocolError("Completed generation has no output URL");
    return { status: "succeeded", outputs: [{ kind: "video", url: data.outputUrl, mimeType: "video/mp4" }] };
  }
  if (data.status === "FAILED" || data.status === "REJECTED" || data.status === "NO_OP") {
    const message = typeof data.error === "string" && data.error ? data.error.split(ctx.apiKey).join("[redacted]") : "Sync generation failed";
    return { status: "failed", error: { code: `SYNC_${data.status}`, message, category: data.status === "REJECTED" ? "invalid-request" : "upstream", retryable: false, providerState: data.status } };
  }
  throw protocolError("Unknown Sync generation status");
}

export const adapter: MediaProviderAdapter = {
  id: "sync", label: "Sync Labs", route: "direct", errorPrefix: "SYNC", inputTransport: "url",
  credential: { keyVocabulary: "sync", envVars: ["SYNC_API_KEY"], configKey: "syncApiKey", consoleUrl: "https://sync.so" },
  listModels: () => models,
  async validateKey(ctx) {
    try { await safe(ctx, () => httpJson(ctx, "Sync models", `${ctx.baseUrl ?? base}/models`, { headers: { "x-api-key": ctx.apiKey } })); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized API key" }; throw error; }
  },
  async submit(ctx, request) {
    return safe(ctx, async () => {
      const { model, options } = validateRequest(request);
      const input = [{ type: "video", url: requireUrl(requireInput(request, "source-video")) }, { type: "audio", url: requireUrl(requireInput(request, "source-audio")) }];
      const data = await httpJson(ctx, "Sync generation", `${ctx.baseUrl ?? base}/generate`, { method: "POST", headers: { "x-api-key": ctx.apiKey }, json: { model: model.upstreamId, input, ...(Object.keys(options).length ? { options } : {}) } });
      if (typeof data.id !== "string" || !data.id) throw protocolError("Generation response missing id");
      return { providerJobId: data.id };
    });
  },
  async poll(ctx, job: MediaJobRef) {
    return safe(ctx, async () => stateOf(ctx, await httpJson(ctx, "Sync generation", `${ctx.baseUrl ?? base}/generate/${encodeURIComponent(job.providerJobId)}`, { headers: { "x-api-key": ctx.apiKey } })));
  },
  normalizeError(error) { const result = normalizeMediaError("SYNC", error); return { ...result, message: "Sync provider request failed" }; },
};
