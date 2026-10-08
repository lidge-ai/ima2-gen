import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { startJob, finishJob, mergeJobMeta, mergeStoppedJobMeta, registerJobAbortController, isStartJobFailure,
  isJobCanceled, isJobTrackingExpired, setJobPhase, INFLIGHT_RETRY_AFTER_SECONDS } from "../lib/inflight.js";
import { publish } from "../lib/eventBus.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { persistVideoArtifact } from "../lib/videoArtifactPersistence.js";
import { generateVideoThumbnail } from "../lib/videoThumb.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { errInfo } from "../lib/errInfo.js";
import { logError } from "../lib/logger.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import { makeGenerationCanceledError, isGenerationCanceledError } from "../lib/generationCancel.js";
import { prepareApi88Video, type Api88PreparedVideo } from "../lib/api88/videoRouteInput.js";
import { generateApi88Video, resumeApi88Video, type Api88VideoEvent,
  type Api88VideoOptions, type Api88VideoResult } from "../lib/api88/videoTransport.js";

export interface Api88VideoRouteDependencies extends Pick<Api88VideoOptions, "sleep" | "now"> {
  thumbnail?: (path: string) => Promise<unknown>;
}
interface Job {
  req: Request; res: Response; ctx: RuntimeContext; requestId: string;
  async: boolean; owned: boolean; finished: boolean; controller: AbortController;
  taskId?: string; prepared?: Api88PreparedVideo; startedAt: number;
  dependencies: Api88VideoRouteDependencies;
}
function emit(job: Job, event: string, data: Record<string, unknown>): void {
  const payload = { requestId: job.requestId, provider: "88api", ...data };
  if (!job.res.writableEnded && !job.res.destroyed && !job.async) {
    job.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
  if (job.owned) {
    if (event === "done" || event === "error") publishJobEvent(job.requestId, event, payload);
    else publish(job.requestId, event, payload);
  }
}
function setup(req: Request, res: Response, ctx: RuntimeContext, dependencies: Api88VideoRouteDependencies): Job {
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId
    ? req.body.requestId : typeof req.body?.clientRequestId === "string" && req.body.clientRequestId
      ? req.body.clientRequestId : req.id;
  const async = req.body?.async === true;
  if (!async) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
  }
  return { req, res, ctx, dependencies, requestId, async, owned: false, finished: false,
    controller: new AbortController(), startedAt: Date.now() };
}
function admit(job: Job, prepared: Api88PreparedVideo): boolean {
  const { req, res, requestId } = job;
  const meta = { kind: "video", provider: "88api", model: prepared.model,
    sessionId: req.body?.sessionId ?? null, clientNodeId: req.body?.clientNodeId ?? null,
    presetIds: Array.isArray(req.body?.presetIds) ? req.body.presetIds : [],
    ...prepared.video, ...(prepared.taskId ? { providerTaskId: prepared.taskId } : {}) };
  const result = startJob({ requestId, kind: "video", prompt: prepared.prompt, meta, respectCanceledTombstone: true });
  if (!result) throw new Error("Video requestId required");
  if (isStartJobFailure(result)) {
    const status = result.code === "TOO_MANY_JOBS" ? 429 : result.code === "GENERATION_CANCELED" ? 499 : 409;
    if (status === 429) res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
    const payload = { requestId, code: result.code, status, error: result.code };
    if (job.async) res.status(status).json(payload);
    else emit(job, "error", payload);
    return false;
  }
  job.owned = true;
  registerJobAbortController(requestId, job.controller);
  if (job.async) res.status(202).json({ requestId });
  return true;
}
function onEvent(job: Job, event: Api88VideoEvent): void {
  if (event.phase === "submitted") {
    job.taskId = event.providerTaskId;
    try {
      if (!mergeJobMeta(job.requestId, { providerTaskId: event.providerTaskId, api88Origin: event.origin })) {
        if (mergeStoppedJobMeta(job.requestId, { providerTaskId: event.providerTaskId, api88Origin: event.origin })) {
          throw makeGenerationCanceledError();
        }
        throw new Error("Missing admitted job");
      }
    } catch (error) {
      if (isGenerationCanceledError(error)) throw error;
      throw Object.assign(new Error("Could not persist provider task id"), { code: "API88_VIDEO_META_FAILED", status: 500 });
    }
    setJobPhase(job.requestId, "streaming");
  }
  emit(job, event.phase, { providerTaskId: event.providerTaskId, requestedModel: event.model,
    effectiveModel: event.model, api88Origin: event.origin,
    ...(event.phase === "progress" ? { progress: event.progress, status: event.status } : {}) });
}
function assertActive(job: Job): void {
  if (job.controller.signal.aborted || isJobCanceled(job.requestId) || isJobTrackingExpired(job.requestId)) {
    throw makeGenerationCanceledError();
  }
}
async function save(job: Job, result: Api88VideoResult): Promise<Record<string, unknown>> {
  assertActive(job);
  const filename = `${Date.now()}_${randomBytes(job.ctx.config.ids.generatedHexBytes).toString("hex")}.mp4`;
  const elapsed = +((Date.now() - job.startedAt) / 1000).toFixed(1);
  const video = { ...job.prepared!.video, providerTaskId: result.providerTaskId, api88Origin: result.origin };
  const metadata = {
    kind: "video", mediaType: "video", provider: "88api", providerUrl: result.providerUrl,
    providerTaskId: result.providerTaskId, api88Origin: result.origin, requestId: job.requestId,
    sessionId: job.req.body?.sessionId ?? null, clientNodeId: job.req.body?.clientNodeId ?? null,
    prompt: job.prepared!.prompt, userPrompt: job.prepared!.prompt, revisedPrompt: null,
    model: result.model, requestedModel: result.model, effectiveModel: result.model,
    createdAt: Date.now(), elapsed, video,
    presetIds: Array.isArray(job.req.body?.presetIds) ? job.req.body.presetIds : [],
  };
  const directory = job.ctx.config.storage.generatedDir;
  await mkdir(directory, { recursive: true });
  await persistVideoArtifact(directory, filename, result.videoBuffer, metadata);
  try { assertActive(job); }
  catch (error) {
    await Promise.all([unlink(join(directory, filename)), unlink(join(directory, `${filename}.json`))]
      .map((operation) => operation.catch(() => {})));
    throw error;
  }
  invalidateHistoryIndex();
  void (job.dependencies.thumbnail ?? generateVideoThumbnail)(join(job.ctx.config.storage.generatedDir, filename)).catch(() => {});
  finishJob(job.requestId, { meta: { filename, providerTaskId: result.providerTaskId } });
  job.finished = true;
  return { filename, url: `/generated/${encodeURIComponent(filename)}`, providerUrl: result.providerUrl,
    mediaType: "video", model: result.model, requestedModel: result.model, effectiveModel: result.model,
    providerTaskId: result.providerTaskId, revisedPrompt: null, elapsed, video };
}
function failure(job: Job, error: unknown): void {
  const info = errInfo(error);
  const canceled = job.controller.signal.aborted || isJobCanceled(job.requestId) || isGenerationCanceledError(error);
  const normalized = canceled ? errInfo(makeGenerationCanceledError()) : info;
  const status = normalized.status ?? 500;
  const code = normalized.code ?? "API88_VIDEO_FAILED";
  const taskId = job.taskId ?? (error as { providerTaskId?: string } | null)?.providerTaskId;
  if (job.owned && !job.finished) {
    try {
      finishJob(job.requestId, { canceled, status: "error", httpStatus: status, errorCode: code,
        meta: taskId ? { providerTaskId: taskId } : {} });
    } catch (trackingError) {
      logError("api88", "video:finish-failed", trackingError, { requestId: job.requestId });
    }
    job.finished = true;
  }
  const payload = { error: normalized.message, code, status, ...errorEnvelopeFields(normalized.raw),
    ...(taskId ? { providerTaskId: taskId } : {}) };
  if (job.async && !job.res.headersSent) job.res.status(status).json({ requestId: job.requestId, ...payload });
  else emit(job, "error", payload);
}
export async function handleApi88Video(
  req: Request, res: Response, ctx: RuntimeContext, resume = false, dependencies: Api88VideoRouteDependencies = {},
): Promise<void> {
  const job = setup(req, res, ctx, dependencies);
  try {
    if (!ctx.api88VideoKey?.trim()) throw Object.assign(new Error("88API video key required"),
      { code: "API88_VIDEO_KEY_MISSING", status: 401 });
    const prepared = await prepareApi88Video(ctx, (req.body ?? {}) as Record<string, unknown>, resume);
    job.prepared = prepared;
    if (!admit(job, prepared)) return;
    const options: Api88VideoOptions = { ...dependencies, signal: job.controller.signal,
      onEvent: (event) => onEvent(job, event) };
    const result = resume
      ? await resumeApi88Video(ctx, prepared.taskId!, prepared.model, options)
      : await generateApi88Video(ctx, prepared.input!, options);
    emit(job, "done", await save(job, result));
  } catch (error) { failure(job, error); }
  finally { if (!res.writableEnded) res.end(); }
}
export function registerApi88ResumeRoute(
  app: Express, ctx: RuntimeContext, dependencies: Api88VideoRouteDependencies = {},
): void {
  app.post("/api/video/88api/resume", (req, res) => handleApi88Video(req, res, ctx, true, dependencies));
}
