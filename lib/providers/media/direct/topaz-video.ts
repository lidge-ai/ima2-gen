import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { assertAllowed, contextSecrets, findModel, httpJson, httpRaw, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, redact, requireInput } from "./l3-http.js";

const prefix = "TOPAZ_VIDEO";
const models: readonly MediaModelSpec[] = [{ id: "topaz-labs/topaz-video", upstreamId: "prob-4", vendor: "topaz-labs", label: "Topaz Video (Proteus 4)", kind: "video", tasks: ["video-upscale"], params: {}, pricing: [], docsUrl: "https://developer.topazlabs.com/getting-started/video-quickstart" }];
const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? "https://api.topazlabs.com").replace(/\/$/, "");
const headers = (ctx: MediaAdapterContext) => ({ "X-API-Key": ctx.apiKey, Accept: "application/json" });
const path = (ctx: MediaAdapterContext, id: string) => `${base(ctx)}/video/${encodeURIComponent(id)}`;
function safeContext(ctx: MediaAdapterContext): MediaAdapterContext {
  return { ...ctx, fetch: async (input, init) => {
    try { return await ctx.fetch(input, init); }
    catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), contextSecrets(ctx));
      if (error instanceof TypeError) throw new TypeError(message);
      const safe = new Error(message);
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) safe.name = error.name;
      throw safe;
    }
  } };
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw invalidRequest(`${name} must be positive`);
  return value;
}
function dimensions(value: unknown): { width: number; height: number } {
  const o = object(value, "resolution");
  if (Object.keys(o).some(k => k !== "width" && k !== "height")) throw invalidRequest("Unknown resolution field");
  const width = positive(o.width, "width"), height = positive(o.height, "height");
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw invalidRequest("Resolution must use integer pixels");
  return { width, height };
}
function buildBody(request: MediaSubmitRequest, bytes: Uint8Array): object {
  const opts = readVendorOptions(request, ["source", "output", "model"]);
  assertAllowed("model", opts.model, ["prob-4"]);
  const source = object(opts.source, "source"), output = object(opts.output, "output");
  if (Object.keys(source).some(k => !["resolution", "container", "duration", "frameRate", "frameCount"].includes(k)) || Object.keys(output).some(k => k !== "resolution")) throw invalidRequest("Unknown source or output field");
  assertAllowed("container", source.container, ["mp4"]);
  if (source.container !== "mp4") throw invalidRequest("source.container must be mp4");
  return { source: { resolution: dimensions(source.resolution), container: "mp4", size: bytes.byteLength, duration: positive(source.duration, "duration"), frameRate: positive(source.frameRate, "frameRate"), frameCount: positive(source.frameCount, "frameCount") }, output: { resolution: dimensions(output.resolution) }, filters: [{ model: "prob-4", auto: "Auto" }] };
}
function checkRequest(request: MediaSubmitRequest): Uint8Array {
  findModel(models, request.model);
  assertAllowed("task", request.task, ["video-upscale"]);
  for (const field of ["prompt", "negativePrompt", "durationSec", "resolution", "aspectRatio", "seed", "audio", "count"] as const) if (request[field] !== undefined) throw invalidRequest(`${field} is unsupported`);
  const input = requireInput(request, "source-video");
  if (request.inputs.length !== 1 || !input.bytes?.byteLength || input.url || input.mimeType !== "video/mp4") throw invalidRequest("Provide one MP4 source as bytes");
  return input.bytes;
}
async function upload(ctx: MediaAdapterContext, id: string, bytes: Uint8Array): Promise<void> {
  const accepted = await httpJson<{ urls?: string[] }>(ctx, "Topaz accept", `${path(ctx, id)}/accept`, { method: "PATCH", headers: headers(ctx) });
  if (!Array.isArray(accepted.urls) || accepted.urls.length === 0 || accepted.urls.some(u => typeof u !== "string" || !u.startsWith("https://"))) throw protocolError("Topaz returned invalid upload URLs");
  const size = Math.max(500_000_000, Math.ceil(bytes.length / accepted.urls.length));
  const results: { partNum: number; eTag: string }[] = [];
  for (const [i, url] of accepted.urls.entries()) {
    const response = await httpRaw(ctx, "Topaz upload", url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: Buffer.from(bytes.subarray(i * size, (i + 1) * size)) });
    const eTag = response.headers.get("etag");
    if (accepted.urls.length > 1 && !eTag) throw protocolError("Topaz multipart upload did not return an ETag");
    results.push({ partNum: i + 1, eTag: eTag ?? "unused" });
  }
  await httpRaw(ctx, "Topaz complete upload", `${path(ctx, id)}/complete-upload/`, { method: "PATCH", headers: headers(ctx), json: { uploadResults: results } });
}
function failed(ctx: MediaAdapterContext, data: { errorCode?: string; message?: string }): MediaJobState {
  const code = data.errorCode ?? "UNKNOWN";
  const quota = code === "INSUFFICIENT_CREDITS" || code === "CREDIT_DIFFERENCE";
  const error = new MediaHttpError({ message: redact(data.message ?? "Topaz processing failed", contextSecrets(ctx)), reason: quota ? "INSUFFICIENT_CREDIT" : "PROCESSING_FAILED", category: quota ? "quota" : "upstream", retryable: false });
  return { status: "failed", error: normalizeMediaError(prefix, error) };
}
export const adapter: MediaProviderAdapter = {
  id: "topaz-video", label: "Topaz Video", route: "direct", errorPrefix: prefix,
  credential: { keyVocabulary: "topaz", envVars: ["TOPAZ_API_KEY"], configKey: "topazApiKey", consoleUrl: "https://account.topazlabs.com/manage-api" },
  inputTransport: "inline", listModels: () => models,
  async validateKey(ctx) {
    ctx = safeContext(ctx);
    try { await httpRaw(ctx, "Topaz credentials", `${base(ctx)}/account/v1/credits/balance`, { headers: headers(ctx) }); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid API key" }; throw error; }
  },
  async submit(ctx, request) {
    ctx = safeContext(ctx);
    const bytes = checkRequest(request), body = buildBody(request, bytes);
    const result = await httpJson<{ requestId?: string }>(ctx, "Topaz create", `${base(ctx)}/video/`, { method: "POST", headers: headers(ctx), json: body });
    if (typeof result.requestId !== "string" || !result.requestId) throw protocolError("Topaz did not return a request ID");
    await upload(ctx, result.requestId, bytes);
    return { providerJobId: result.requestId, pollAfterMs: 5000 };
  },
  async poll(ctx, job: MediaJobRef) {
    ctx = safeContext(ctx);
    const data = await httpJson<{ status?: string; progress?: number; message?: string; errorCode?: string; download?: { url?: string; expiresAt?: number } }>(ctx, "Topaz status", `${path(ctx, job.providerJobId)}/status`, { headers: headers(ctx) });
    if (data.status === "failed") return failed(ctx, data);
    if (data.status === "canceled") return { status: "canceled" };
    if (data.status === "complete") {
      if (!data.download?.url) throw protocolError("Topaz did not return a download URL");
      return { status: "succeeded", outputs: [{ kind: "video", url: data.download.url, mimeType: "video/mp4", ...(typeof data.download.expiresAt === "number" ? { expiresAt: new Date(data.download.expiresAt).toISOString() } : {}) }] };
    }
    if (["requested", "accepted"].includes(data.status ?? "")) return { status: "queued" };
    if (["initializing", "preprocessing", "processing", "postprocessing", "canceling"].includes(data.status ?? "")) return { status: "running", ...(typeof data.progress === "number" ? { progress: Math.min(1, Math.max(0, data.progress / 100)) } : {}) };
    throw protocolError("Topaz returned an unknown status");
  },
  async cancel(ctx, job) { ctx = safeContext(ctx); await httpRaw(ctx, "Topaz cancel", path(ctx, job.providerJobId), { method: "DELETE", headers: headers(ctx) }); },
  normalizeError(error) {
    if (error instanceof MediaHttpError) return normalizeMediaError(prefix, error);
    const safe = error instanceof TypeError ? new TypeError("Topaz network error") : new Error("Topaz request failed");
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) safe.name = error.name;
    return normalizeMediaError(prefix, safe);
  },
};
