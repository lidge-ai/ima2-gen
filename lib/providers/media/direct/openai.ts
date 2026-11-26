import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { redactSecrets } from "../redact.js";
import { MediaHttpError, classifyStatus, normalizeMediaError } from "./l3-http.js";

const API = "https://api.openai.com";
const MODELS = [
  ["gpt-image-2", "gpt-image-2", "GPT Image 2 (deprecated)"],
  ["gpt-image-2.5", "gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
  ["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
  ["gpt-image-2.6", "gpt-image-2.6-flare", "GPT Image 2.6 Flare"],
  ["gpt-image-2.6-sunburst", "gpt-image-2.6-sunburst", "GPT Image 2.6 Sunburst"],
].map(([id, upstreamId, label]): MediaModelSpec => ({
  id: `openai/${id}`, upstreamId: upstreamId!, label: label!, vendor: "openai", kind: "image",
  tasks: ["text-to-image", "image-to-image"],
  params: { resolutions: ["1024x1024", "1536x1024", "1024x1536"], maxReferenceImages: 15 },
  pricing: [{ unit: "1k-tokens", usd: 0.03, variant: "output image", source: `https://developers.openai.com/api/docs/models/${id === "gpt-image-2" ? "gpt-image-2.5-flare" : upstreamId}`, checkedAt: "2026-11-26" }],
  docsUrl: `https://developers.openai.com/api/docs/models/${upstreamId}`,
}));

const results = new Map<string, { at: number; state: MediaJobState }>();
const TTL = 30 * 60 * 1000;
function park(state: MediaJobState): MediaJobRef {
  const now = Date.now();
  for (const [id, entry] of results) if (now - entry.at >= TTL) results.delete(id);
  while (results.size >= 64) results.delete(results.keys().next().value!);
  const providerJobId = `openai-${crypto.randomUUID()}`;
  results.set(providerJobId, { at: now, state });
  return { providerJobId, pollAfterMs: 0 };
}
function pollResult(job: MediaJobRef): MediaJobState {
  const item = results.get(job.providerJobId);
  results.delete(job.providerJobId);
  if (item && Date.now() - item.at < TTL) return item.state;
  return { status: "failed", error: { code: "OPENAI_RESULT_EXPIRED", message: "The image result has expired.", category: "not-found", retryable: false } };
}
function failure(status: number, data: unknown, key: string): MediaHttpError {
  const body = data && typeof data === "object" ? (data as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error : undefined;
  const code = `${body?.code ?? ""} ${body?.type ?? ""}`;
  const base = classifyStatus(status);
  const classification = /content_policy|moderation/i.test(code) ? { reason: "MODERATION", category: "moderation" as const, retryable: false }
    : /insufficient_quota/i.test(code) ? { reason: "QUOTA", category: "quota" as const, retryable: false } : base;
  return new MediaHttpError({ ...classification, status, message: redactSecrets(typeof body?.message === "string" ? body.message : `OpenAI HTTP ${status}`, [key]) });
}
async function call(ctx: MediaAdapterContext, path: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await ctx.fetch((ctx.baseUrl ?? API) + path, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw failure(response.status, body, ctx.apiKey);
    return body;
  } catch (error) {
    if (error instanceof MediaHttpError) throw error;
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), [ctx.apiKey]));
  }
}
function requestBody(request: MediaSubmitRequest): { model: string; prompt: string; size?: string; n?: number } {
  const spec = MODELS.find((m) => m.id === request.model);
  if (!spec || !spec.tasks.includes(request.task) || !request.prompt?.trim()) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Invalid model, task or prompt", category: "invalid-request", retryable: false });
  if (request.resolution && !spec.params.resolutions?.includes(request.resolution)) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Unsupported image size", category: "invalid-request", retryable: false });
  if (request.count !== undefined && (!Number.isInteger(request.count) || request.count < 1 || request.count > 10)) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Count must be between 1 and 10", category: "invalid-request", retryable: false });
  if (request.aspectRatio !== undefined || request.seed !== undefined || request.negativePrompt !== undefined || request.audio !== undefined || request.durationSec !== undefined || Object.keys(request.vendorOptions ?? {}).length) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Unsupported parameter", category: "invalid-request", retryable: false });
  return { model: spec.upstreamId, prompt: request.prompt, ...(request.resolution ? { size: request.resolution } : {}), ...(request.count !== undefined ? { n: request.count } : {}) };
}
function multipart(body: ReturnType<typeof requestBody>, request: MediaSubmitRequest): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, String(value));
  const sources = request.inputs.filter((i) => i.role === "source-image");
  const refs = request.inputs.filter((i) => i.role === "reference-image");
  const masks = request.inputs.filter((i) => i.role === "mask");
  if (!sources.length || sources.length > 1 || masks.length > 1 || sources.length + refs.length > 16 || sources.length + refs.length + masks.length !== request.inputs.length) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Invalid edit inputs", category: "invalid-request", retryable: false });
  for (const input of [...sources, ...refs, ...masks]) {
    if (!input.bytes?.length) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Image bytes are required", category: "invalid-request", retryable: false });
    form.append(input.role === "mask" ? "mask" : "image[]", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.role + ".png");
  }
  return form;
}
function outputs(data: unknown): MediaJobState {
  const items = (data as { data?: Array<{ b64_json?: unknown }> } | null)?.data;
  if (!Array.isArray(items) || !items.length || items.some((item) => typeof item.b64_json !== "string" || !item.b64_json || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.b64_json))) throw new MediaHttpError({ reason: "INVALID_RESPONSE", message: "OpenAI returned invalid image data", category: "upstream", retryable: false });
  return { status: "succeeded", outputs: items.map((item) => ({ kind: "image", bytes: new Uint8Array(Buffer.from(item.b64_json as string, "base64")), mimeType: "image/png" })) };
}
export const adapter: MediaProviderAdapter = {
  id: "openai", label: "OpenAI", route: "direct", errorPrefix: "OPENAI", inputTransport: "inline",
  credential: { keyVocabulary: "openai", envVars: ["OPENAI_API_KEY"], configKey: "apiKey", keyPrefix: "sk-", consoleUrl: "https://platform.openai.com/api-keys" },
  listModels: () => MODELS,
  async validateKey(ctx) {
    try { await call(ctx, "/v1/models", { headers: { Authorization: `Bearer ${ctx.apiKey}` } }); return { ok: true }; }
    catch (error) { const e = normalizeMediaError("OPENAI", error); if (e.category === "auth") return { ok: false, reason: e.message }; throw error; }
  },
  async submit(ctx, request) {
    const body = requestBody(request);
    const edit = request.task === "image-to-image";
    if (!edit && request.inputs.length) throw new MediaHttpError({ reason: "INVALID_REQUEST", message: "Text generation takes no images", category: "invalid-request", retryable: false });
    const headers: Record<string, string> = { Authorization: `Bearer ${ctx.apiKey}` };
    if (!edit) headers["Content-Type"] = "application/json";
    const data = await call(ctx, edit ? "/v1/images/edits" : "/v1/images/generations", { method: "POST", headers, body: edit ? multipart(body, request) : JSON.stringify(body) });
    return park(outputs(data));
  },
  async poll(_ctx, job) { return pollResult(job); },
  normalizeError(error) {
    if (!(error instanceof Error) && error && typeof error === "object") {
      const status = (error as { status?: unknown }).status;
      if (typeof status === "number") return normalizeMediaError("OPENAI", failure(status, error, ""));
    }
    return normalizeMediaError("OPENAI", error);
  },
};
