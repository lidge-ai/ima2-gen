import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaOutput, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { assertAllowed, contextSecrets, findModel, httpJson, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, redact, requireInput, requireUrl } from "./l3-http.js";

const models: readonly MediaModelSpec[] = [{
  id: "mirelo/mirelo-sfx-2.0", upstreamId: "sfx-2.0", vendor: "mirelo", label: "Mirelo SFX 2.0",
  kind: "audio", tasks: ["video-to-audio", "text-to-audio"], params: { negativePrompt: true, seed: true }, pricing: [],
  docsUrl: "https://mirelo.ai/api-docs#concept/sfx-2.0",
}];
const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? "https://api.mirelo.ai").replace(/\/$/, "");
const headers = (ctx: MediaAdapterContext) => ({ Authorization: `Bearer ${ctx.apiKey}` });
const clean = (value: string, ctx?: MediaAdapterContext) => redact(value, ctx ? contextSecrets(ctx) : []).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");

type FileInfo = { url?: string; format?: string; url_expires_at?: string };
type Output = { status?: string; variants?: Array<{ status?: string; files?: { audio?: FileInfo } | null }> };
type Job = { id?: string; status?: string; progress?: number; errors?: Array<{ code?: string; message?: string; retryable?: boolean }>; result?: { output?: Output; outputs?: Output[] } | null };

function requestBody(request: MediaSubmitRequest): Record<string, unknown> {
  const model = findModel(models, request.model);
  assertAllowed("task", request.task, model.tasks);
  readVendorOptions(request, []);
  if (request.resolution !== undefined || request.aspectRatio !== undefined || request.audio !== undefined) throw invalidRequest("Unsupported parameter", "UNSUPPORTED_PARAM");
  if (request.count !== undefined && (!Number.isInteger(request.count) || request.count < 1 || request.count > 4)) throw invalidRequest("count must be 1 to 4");
  if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 4294967295)) throw invalidRequest("Invalid seed");
  const duration = request.durationSec === undefined ? undefined : request.durationSec * 1000;
  if (duration !== undefined && (!Number.isInteger(duration) || duration < (request.task === "text-to-audio" ? 100 : 1000) || duration > 600000)) throw invalidRequest("Invalid duration");
  if (request.task === "text-to-audio" && (duration === undefined || !request.prompt?.trim())) throw invalidRequest("Text generation requires prompt and duration");
  if ((request.prompt?.length ?? 0) > 2000 || (request.negativePrompt?.length ?? 0) > 1000) throw invalidRequest("Prompt too long");
  const input: Record<string, unknown> = {};
  if (request.task === "video-to-audio") input.video = { type: "url", url: requireUrl(requireInput(request, "source-video")) };
  if (request.prompt !== undefined) input.prompt = request.prompt;
  if (request.negativePrompt !== undefined) input.negative_prompt = request.negativePrompt;
  return { model: model.upstreamId, ...(duration !== undefined && { duration_ms: duration }), ...(request.count !== undefined && { num_variants: request.count }), ...(request.seed !== undefined && { seed: request.seed }), input };
}

function endpoint(task: string): string {
  if (task === "video-to-audio") return "video-to-sfx";
  if (task === "text-to-audio") return "text-to-sfx";
  throw invalidRequest("Unknown job task");
}

function outputs(job: Job): MediaOutput[] {
  const groups = job.result?.outputs ?? (job.result?.output ? [job.result.output] : []);
  return groups.filter((group) => group.status !== "failed").flatMap((group) => (group.variants ?? []).flatMap((variant) => {
    const file = variant.files?.audio;
    if (variant.status !== "succeeded" || !file?.url) return [];
    const mimeType = file.format === "wav" ? "audio/wav" : file.format?.startsWith("mp3") ? "audio/mpeg" : undefined;
    if (!mimeType) throw protocolError("Unknown audio format");
    return [{ kind: "audio" as const, url: file.url, mimeType, ...(file.url_expires_at && { expiresAt: file.url_expires_at }) }];
  }));
}

function jobFailure(ctx: MediaAdapterContext, job: Job): MediaJobState {
  const detail = job.errors?.[0];
  const code = detail?.code ?? "generation_failed";
  const category = code === "insufficient_credits" ? "quota" : code === "rate_limited" || code === "concurrency_limit_reached" ? "rate-limit" : "upstream";
  const reason = /^[a-z0-9_]+$/.test(code) ? code.toUpperCase() : "UPSTREAM";
  const error = new MediaHttpError({ reason, category, retryable: detail?.retryable === true, message: clean(detail?.message ?? "Mirelo generation failed", ctx) });
  return { status: "failed", error: normalizeMediaError("MIRELO", error) };
}

function state(ctx: MediaAdapterContext, job: Job): MediaJobState {
  if (job.status === "queued" || job.status === "running") return { status: job.status, ...(typeof job.progress === "number" && { progress: job.progress }) };
  if (job.status === "canceled") return { status: "canceled" };
  if (job.status === "failed" || job.status === "expired" || job.status === "partially_succeeded") return jobFailure(ctx, job);
  if (job.status === "succeeded") {
    const result = outputs(job);
    if (!result.length) throw protocolError("Mirelo returned no usable audio");
    return { status: "succeeded", outputs: result };
  }
  throw protocolError("Mirelo returned an unknown job status");
}

async function call<T>(ctx: MediaAdapterContext, url: string, json?: unknown): Promise<T> {
  try { return await httpJson<T>(ctx, "Mirelo", url, { headers: headers(ctx), ...(json !== undefined && { method: "POST", json }) }); }
  catch (error) {
    if (error instanceof MediaHttpError) throw error;
    throw new MediaHttpError({ message: clean(error instanceof Error ? error.message : String(error), ctx), reason: "NETWORK", category: "upstream", retryable: true });
  }
}

export const adapter: MediaProviderAdapter = {
  id: "mirelo", label: "Mirelo", route: "direct", errorPrefix: "MIRELO", inputTransport: "url",
  credential: { keyVocabulary: "mirelo", envVars: ["MIRELO_API_KEY"], configKey: "mireloApiKey", keyPrefix: "sk-", consoleUrl: "https://mirelo.ai/studio/api-keys" },
  listModels: () => models,
  async validateKey(ctx) {
    try { await call(ctx, `${base(ctx)}/v3/me`); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: error.message }; throw error; }
  },
  async submit(ctx, request) {
    const body = requestBody(request);
    const job = await call<Job>(ctx, `${base(ctx)}/v3/${endpoint(request.task)}/generations`, body);
    if (!job.id) throw protocolError("Mirelo returned no job id");
    return { providerJobId: job.id, resume: { task: request.task }, pollAfterMs: 2000 };
  },
  async poll(ctx, job: MediaJobRef) {
    const task = endpoint(job.resume?.task ?? "");
    const data = await call<Job>(ctx, `${base(ctx)}/v3/${task}/generations/${encodeURIComponent(job.providerJobId)}`);
    return state(ctx, data);
  },
  normalizeError(error) {
    const normalized = normalizeMediaError("MIRELO", error);
    return { ...normalized, message: clean(normalized.message) };
  },
};
