import type { Express, Request, Response } from "express";
import { basename, join } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { RouteRuntimeContext, RuntimeContext } from "../lib/runtimeContext.js";
import { requireRuntimeContext } from "../lib/runtimeContext.js";
import { fetchWithGrokAuth, getGrokEndpoint, resolveGrokCredential, type GrokLane } from "../lib/grokRuntime.js";
import { logEvent, logError } from "../lib/logger.js";
import { downloadVideo, generateVideoViaGrok, pollVideoUntilDone, type GrokVideoGenerateResult, type GrokVideoOptions } from "../lib/grokVideoAdapter.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { ACTIVE_VIDEO_PROMPT_GUIDANCE, appendVideoContinuityEntry, lineageFromVideoMetadata, readVideoSidecar } from "../lib/videoContinuity.js";
import { assertLocalMp4, extractGeneratedVideoFrameB64, extractVideoFrame, safeGeneratedFilePath } from "../lib/videoFrameExtract.js";
import { finishJob, INFLIGHT_RETRY_AFTER_SECONDS, isJobCanceled, isStartJobFailure, registerJobAbortController, startJob, updateJobAdmission } from "../lib/inflight.js";
import { makeGenerationCanceledError } from "../lib/generationCancel.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { normalizeBodyRequestId } from "../lib/generationInputValidation.js";
import { MAX_VIDEO_DURATION, MIN_VIDEO_DURATION, normalizeGrokVideoModel, normalizeVideoAspectRatio, normalizeVideoDuration, normalizeVideoResolution, validateVideoResolutionForRequest } from "../lib/imageModels.js";
import { persistVideoArtifact } from "../lib/videoArtifactPersistence.js";
import { normalizeVideoLineage } from "../lib/videoLineage.js";
import { getMotionFragment, MOTION_PRESETS } from "../lib/videoMotionPresets.js";
import { errInfo, thrownFields } from "../lib/errInfo.js";
import { codedVideoError as codedError, emitPhase, envDeadline, requestSignal, requirePrompt, retryableData } from "../lib/videoExtendedHelpers.js";
import { DEFAULT_GROK_PLANNER_MODEL } from "../config.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import { runLastFrameI2v, type ParentMetadata } from "../lib/videoExtendI2vOperation.js";

export type VideoExtendedDependencies = {
  extractFrame?: (generatedDir: string, filename: string, position: string, options: { signal: AbortSignal }) => Promise<string>;
  generateVideo?: (prompt: string, ctx: RouteRuntimeContext, options: GrokVideoOptions) => Promise<GrokVideoGenerateResult>;
  persistArtifact?: typeof persistVideoArtifact;
  createFilename?: (ctx: RuntimeContext) => string;
  readSidecar?: typeof readVideoSidecar;
};

function validationError(value: unknown): { error: string; code: string; status: number } | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return value as { error: string; code: string; status: number };
}

function localSourceId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== basename(value) || !/\.mp4$/i.test(value)) {
    throw codedError("sourceVideoId must be a local .mp4 filename", 400, "VIDEO_SOURCE_LOCAL_ONLY");
  }
  return value;
}

function inheritedPrompt(value: unknown, parent: ParentMetadata | null): string {
  const explicit = requirePrompt(value);
  if (explicit) return explicit;
  for (const candidate of [parent?.userPrompt, parent?.prompt, parent?.revisedPrompt]) {
    const inherited = requirePrompt(candidate);
    if (inherited) return inherited;
  }
  throw codedError("prompt required when the source has no prompt metadata", 400, "PROMPT_REQUIRED");
}

function motionSelection(value: unknown, parent: ParentMetadata | null): { ids: string[]; fragment: string } {
  const inherited = Array.isArray(parent?.motionPresetIds)
    ? parent.motionPresetIds
    : Array.isArray(parent?.presetIds) ? parent.presetIds.filter((id: unknown) => typeof id === "string" && MOTION_PRESETS.has(id)) : [];
  const raw = value === undefined ? inherited : value;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !MOTION_PRESETS.has(id))) {
    throw codedError("motionPresetIds contains an unknown motion preset", 400, "VIDEO_EXTEND_UNSUPPORTED");
  }
  const ids = [...new Set(raw as string[])];
  return { ids, fragment: ids.map((id) => getMotionFragment(id, "grok")).filter(Boolean).join(", ") };
}

/**
 * These handlers take the lane from the request body, which is untyped. Anything that is
 * not the explicit API-key lane runs on the OAuth session, the same default the rest of
 * the video surface uses.
 */
function videoLane(body: unknown): GrokLane {
  return (body as { provider?: unknown } | null)?.provider === "grok-api" ? "grok-api" : "grok";
}

function routeError(message: string, status = 400): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function sendError(res: Response, error: unknown): void {
  const err = thrownFields(error);
  if (err.name === "TimeoutError") {
    res.status(504).json({ error: "Video operation timed out", code: "VIDEO_TIMEOUT" });
    return;
  }
  if (err.name === "AbortError") {
    if (!res.headersSent) res.status(499).json({ error: "Request canceled", code: "REQUEST_CANCELED" });
    return;
  }
  res.status(typeof err.status === "number" ? err.status : 500).json({ error: err.message || String(error), ...(typeof err.code === "string" ? { code: err.code } : {}), ...errorEnvelopeFields(error) });
}

async function safeGeneratedFile(ctx: RuntimeContext, file: string, options: { requireMp4?: boolean } = {}): Promise<string> {
  return safeGeneratedFilePath(ctx.config.storage.generatedDir, file, options);
}

function summarizeSource(input: string): Record<string, unknown> {
  if (input.startsWith("data:video/")) {
    const encoded = input.split(",", 2)[1] || "";
    return { kind: "data-url", approximateBytes: Math.floor(encoded.length * 0.75) };
  }
  if (/^https?:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      return { kind: "url", origin: parsed.origin, pathname: basename(parsed.pathname) };
    } catch {
      return { kind: "url" };
    }
  }
  if (/^file[-_][A-Za-z0-9._-]+$/.test(input)) return { kind: "file_id" };
  return { kind: "generated-file", filename: basename(input) };
}

async function resolveVideoInput(ctx: RuntimeContext, input: string): Promise<Record<string, string>> {
  if (/^https?:\/\//i.test(input) || input.startsWith("data:video/")) return { url: input };
  if (/^file[-_][A-Za-z0-9._-]+$/.test(input)) return { file_id: input };
  const inputPath = await safeGeneratedFile(ctx, input, { requireMp4: true });
  await assertLocalMp4(inputPath);
  const buf = await readFile(inputPath);
  return { url: `data:video/mp4;base64,${buf.toString("base64")}` };
}

function validateEditModel(model: unknown): string {
  if (typeof model !== "string") throw routeError("model must be a string", 400);
  if (model !== "grok-imagine-video") throw routeError("Video edit/extension only supports grok-imagine-video", 400);
  return model;
}

async function saveVideoResult(
  ctx: RuntimeContext,
  options: { requestId: string; prompt: string; model: string; operation: "edit" | "extend"; source: string; duration: number | null; videoUrl: string; usage?: Record<string, number> | null | undefined; signal?: AbortSignal | undefined },
): Promise<{ filename: string; url: string; sourceUrl: string }> {
  const { buffer, contentType } = await downloadVideo(ctx, options.videoUrl, options.signal);
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
  const filename = `${Date.now()}_${rand}.mp4`;
  const sourceFilename = /^https?:\/\//i.test(options.source) || options.source.startsWith("data:") || /^file[-_]/.test(options.source)
    ? null
    : basename(options.source);
  const sourceMeta = sourceFilename ? await readVideoSidecar(ctx.config.storage.generatedDir, sourceFilename) : null;
  const parentLineage = sourceFilename ? lineageFromVideoMetadata(sourceFilename, sourceMeta) : null;
  const videoContinuity = appendVideoContinuityEntry(parentLineage, {
    filename,
    userPrompt: options.prompt,
    revisedPrompt: options.prompt,
    createdAt: Date.now(),
  });
  const createdAt = Date.now();
  await persistVideoArtifact(
    ctx.config.storage.generatedDir,
    filename,
    buffer,
    {
        kind: "video",
        mediaType: "video",
        requestId: options.requestId,
        prompt: options.prompt,
        userPrompt: options.prompt,
        provider: "grok",
        model: options.model,
        createdAt,
        usage: options.usage ?? null,
        revisedPrompt: options.prompt,
        videoContinuity,
        video: {
          operation: options.operation,
          duration: options.duration,
          source: summarizeSource(options.source),
          sourceUrl: summarizeSource(options.videoUrl),
          contentType,
        },
    },
  );
  invalidateHistoryIndex();
  return { filename, url: `/generated/${encodeURIComponent(filename)}`, sourceUrl: options.videoUrl };
}

function extractOutputText(data: Record<string, unknown>): string {
  const output = Array.isArray(data.output) ? data.output : [];
  const texts: string[] = [];
  for (const item of output) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

/** The global fetch response; `Response` in this module is Express's. */
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

/**
 * The frame analysis call is a single request with nothing downstream, so it resolves its
 * credential through fetchWithGrokAuth: an expired OAuth bearer is refreshed once and the
 * request replayed, which costs nothing because a 401 arrives before any work is billed.
 */
async function requestFrameAnalysis(
  ctx: RouteRuntimeContext, lane: GrokLane, body: Record<string, unknown>, signal: AbortSignal,
): Promise<FetchResponse> {
  return fetchWithGrokAuth(ctx, lane, (credential) => {
    const { url, headers } = getGrokEndpoint("/v1/responses", credential);
    return fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }, { signal });
}

export function registerVideoExtendedRoutes(app: Express, ctxRaw: RouteRuntimeContext, dependencies: VideoExtendedDependencies = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const extractFrame = dependencies.extractFrame ?? ((dir, filename, position, options) => extractGeneratedVideoFrameB64(dir, filename, position, options));
  const readSidecar = dependencies.readSidecar ?? readVideoSidecar;
  const generateVideo = dependencies.generateVideo ?? generateVideoViaGrok;
  const persistArtifact = dependencies.persistArtifact ?? persistVideoArtifact;
  const createFilename = dependencies.createFilename ?? ((runtime) => `${Date.now()}_${randomBytes(runtime.config.ids.generatedHexBytes).toString("hex")}.mp4`);

  // --- Video Edit (V2V) ---
  app.post("/api/video/edit", async (req: Request, res: Response) => {
    try {
      const { prompt: rawPrompt, videoUrl, model = "grok-imagine-video" } = req.body ?? {};
      const prompt = requirePrompt(rawPrompt);
      if (!prompt) return res.status(400).json({ error: "prompt required", code: "PROMPT_REQUIRED", guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      const validModel = validateEditModel(model);
      const signal = requestSignal(req, res, envDeadline("IMA2_VIDEO_EDIT_TIMEOUT_MS", 10 * 60_000));

      // Resolved once and carried into the poll loop so the whole edit runs on one bearer.
      const credential = await resolveGrokCredential(ctx, videoLane(req.body), { signal });
      const { url, headers } = getGrokEndpoint("/v1/videos/edits", credential);
      const video = await resolveVideoInput(ctx, videoUrl);
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: validModel, prompt, video }), signal });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      if (!request_id) return res.status(502).json({ error: "No request_id in response" });
      logEvent("video", "edit:start", { requestId: request_id, model: validModel });

      const result = await pollVideoUntilDone(ctx, request_id, { signal, credential });
      if (result.respectModeration === false) return res.status(502).json({ error: "Grok video blocked by moderation" });
      if (!result.videoUrl) return res.status(502).json({ error: "No video URL in response" });
      const saved = await saveVideoResult(ctx, { requestId: request_id, prompt, model: validModel, operation: "edit", source: videoUrl, duration: result.duration ?? null, videoUrl: result.videoUrl, usage: result.usage, signal });

      logEvent("video", "edit:done", { requestId: request_id });
      res.json({ requestId: request_id, url: saved.url, filename: saved.filename, sourceUrl: saved.sourceUrl, duration: result.duration, model: validModel });
    } catch (err: unknown) {
      logError("video", "edit:error", err);
      sendError(res, err);
    }
  });

  // --- Last-frame image-to-video extension ---
  app.post("/api/video/extend", async (req: Request, res: Response) => {
    const requestId = normalizeBodyRequestId(req.body?.requestId, req.id);
    const canceledResponse = () => {
      // A canceled job gets no error event from this handler (abortJob already
      // recorded + published the canceled terminal state when it was active).
      const canceled = makeGenerationCanceledError() as Error & { status?: number; code?: string };
      if (!res.headersSent) res.status(canceled.status ?? 499).json({ requestId, error: canceled.message, code: canceled.code ?? "GENERATION_CANCELED", status: canceled.status ?? 499 });
    };
    // Admit the job BEFORE any await so a client cancel (DELETE inflight) can
    // never lose the race against preflight (audit blocker B2). Prompt/meta
    // are provisional here; authoritative values are resolved below.
    const startedEarly = startJob({ requestId, kind: "video", prompt: String(req.body?.prompt ?? ""), meta: { workflow: "last-frame-i2v", sourceVideoId: req.body?.sourceVideoId ?? null }, respectCanceledTombstone: true });
    if (startedEarly && isStartJobFailure(startedEarly)) {
      // Duplicate/capacity: respond WITHOUT publishing — the requestId channel
      // belongs to the ACTIVE job and an error event here would corrupt its
      // terminal stream (audit blocker B1).
      if (startedEarly.code === "GENERATION_CANCELED") { canceledResponse(); return; }
      if (startedEarly.code === "TOO_MANY_JOBS") res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
      const status = startedEarly.code === "TOO_MANY_JOBS" ? 429 : 409;
      res.status(status).json({ requestId, error: startedEarly.code === "TOO_MANY_JOBS" ? "Too many concurrent generation jobs" : "Request ID already in use", code: startedEarly.code, status });
      return;
    }
    const cancelController = new AbortController();
    registerJobAbortController(requestId, cancelController);
    const fail = (error: unknown) => {
      if (isJobCanceled(requestId)) { canceledResponse(); return; }
      const info = errInfo(error);
      const status = info.status ?? 500;
      const code = info.code ?? "VIDEO_EXTEND_FAILED";
      const payload = { requestId, error: info.message, code, status, ...retryableData(error), ...errorEnvelopeFields(error) };
      // #151 stage 2: terminal failure carries the canonical envelope.
      publishJobEvent(requestId, "error", payload);
      finishJob(requestId, { status: "error", httpStatus: status, errorCode: code, meta: { stage: "preflight" } });
      if (!res.headersSent) res.status(status).json(payload);
    };

    let sourceVideoId: string;
    let parent: ParentMetadata | null;
    let prompt: string;
    let provider: "grok" | "grok-api";
    let model: string;
    let duration: number;
    let resolution: "480p" | "720p" | "1080p";
    let aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "auto";
    let motion: { ids: string[]; fragment: string };
    try {
      sourceVideoId = localSourceId(req.body?.sourceVideoId);
      await safeGeneratedFilePath(ctx.config.storage.generatedDir, sourceVideoId, { requireMp4: true }).catch((error: unknown) => {
        const info = errInfo(error);
        throw codedError(info.message || "source video not found", info.status === 404 ? 404 : 400, info.status === 404 ? "VIDEO_NOT_FOUND" : "VIDEO_SOURCE_LOCAL_ONLY");
      });
      parent = await readSidecar(ctx.config.storage.generatedDir, sourceVideoId) as ParentMetadata | null;
      const parentLineage = normalizeVideoLineage(parent?.videoLineage);
      if (parentLineage && parentLineage.id !== sourceVideoId) throw codedError("source lineage id does not match filename", 500, "VIDEO_LINEAGE_INVALID");
      prompt = inheritedPrompt(req.body?.prompt, parent);
      const rawProvider = req.body?.provider ?? parent?.provider ?? "grok";
      if (rawProvider !== "grok" && rawProvider !== "grok-api") throw codedError("video extension requires provider 'grok' or 'grok-api'", 400, "VIDEO_EXTEND_UNSUPPORTED");
      provider = rawProvider;
      const modelResult = normalizeGrokVideoModel(req.body?.model ?? parent?.model ?? ctx.config.grokProvider.defaultVideoModel);
      const durationResult = normalizeVideoDuration(req.body?.duration ?? parent?.video?.duration);
      const resolutionResult = normalizeVideoResolution(req.body?.resolution ?? parent?.video?.resolution);
      const aspectResult = normalizeVideoAspectRatio(req.body?.aspectRatio ?? parent?.video?.aspectRatio);
      for (const result of [modelResult, durationResult, resolutionResult, aspectResult]) {
        const error = validationError(result);
        if (error) throw codedError(error.error, error.status, error.code);
      }
      model = (modelResult as { model: string }).model;
      duration = (durationResult as { duration: number }).duration;
      resolution = (resolutionResult as { resolution: typeof resolution }).resolution;
      aspectRatio = (aspectResult as { aspectRatio: typeof aspectRatio }).aspectRatio;
      const resolutionError = validationError(validateVideoResolutionForRequest(model, resolution, "image-to-video"));
      if (resolutionError) throw codedError(resolutionError.error, resolutionError.status, resolutionError.code);
      motion = motionSelection(req.body?.motionPresetIds, parent);
    } catch (error) {
      fail(error);
      return;
    }

    // Post-preflight cancel check (B2 round 2): a DELETE can only interleave
    // during the preflight awaits, so this is the earliest point that can
    // actually observe it — before 202 and before any provider work.
    if (isJobCanceled(requestId) || cancelController.signal.aborted) { canceledResponse(); return; }
    // Install authoritative job metadata now that inheritance is resolved
    // (admission was provisional).
    updateJobAdmission(requestId, { prompt, meta: { workflow: "last-frame-i2v", sourceVideoId, provider, model } });

    emitPhase(requestId, "queued");
    res.status(202).json({ ok: true, requestId, sourceVideoId, workflow: "last-frame-i2v" });

    void runLastFrameI2v({
      ctx, requestId, sourceVideoId, prompt, model, provider, duration, resolution,
      aspectRatio, parent, motion, cancelController, extractFrame, generateVideo,
      persistArtifact, createFilename,
    });
  });

  // --- Provider-native legacy extension ---
  app.post("/api/video/extend/native", async (req: Request, res: Response) => {
    try {
      const { prompt: rawPrompt, videoUrl, duration = 6, model = "grok-imagine-video" } = req.body ?? {};
      const prompt = requirePrompt(rawPrompt);
      if (!prompt) return res.status(400).json({ error: "prompt required", code: "PROMPT_REQUIRED", guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      const validModel = validateEditModel(model);
      const dur = Number(duration);
      // xAI documents 2-10 for extensions, but the endpoint accepts 1 and 11 and refuses
      // only 0 and 16 — the same 1-15 bound as generation. Enforcing the documented range
      // would refuse extensions the API would have produced.
      // devlog/_plan/260908_xai_imagine_spec_resync/000_research.md (D11)
      if (!Number.isInteger(dur) || dur < MIN_VIDEO_DURATION || dur > MAX_VIDEO_DURATION) {
        return res.status(400).json({ error: `duration must be an integer between ${MIN_VIDEO_DURATION} and ${MAX_VIDEO_DURATION}` });
      }
      const signal = requestSignal(req, res, envDeadline("IMA2_VIDEO_EXTEND_TIMEOUT_MS", 10 * 60_000));
      const credential = await resolveGrokCredential(ctx, videoLane(req.body), { signal });
      const { url, headers } = getGrokEndpoint("/v1/videos/extensions", credential);
      const video = await resolveVideoInput(ctx, videoUrl);
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: validModel, prompt, duration: dur, video }), signal });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      if (!request_id) return res.status(502).json({ error: "No request_id in response" });
      const result = await pollVideoUntilDone(ctx, request_id, { signal, credential });
      if (result.respectModeration === false) return res.status(502).json({ error: "Grok video blocked by moderation" });
      if (!result.videoUrl) return res.status(502).json({ error: "No video URL in response" });
      const saved = await saveVideoResult(ctx, { requestId: request_id, prompt, model: validModel, operation: "extend", source: videoUrl, duration: result.duration ?? null, videoUrl: result.videoUrl, usage: result.usage, signal });
      res.json({ requestId: request_id, url: saved.url, filename: saved.filename, sourceUrl: saved.sourceUrl, duration: result.duration, model: validModel });
    } catch (err: unknown) {
      logError("video", "extend:error", err);
      sendError(res, err);
    }
  });

  // --- Video Frame Extraction ---
  /**
   * Frame extraction for a video the SERVER cannot see.
   *
   * The GET form resolves its file inside the generated directory, which is the
   * right containment rule but means a clip the caller saved elsewhere with
   * `-o` is unreachable — the CLI reported "video file not found" for a file
   * sitting right there on disk (#171). The bytes come over the wire instead.
   */
  app.post("/api/video/frame", async (req: Request, res: Response) => {
    const tmpIn = join(ctx.config.storage.generatedDir, `frame_in_${randomBytes(4).toString("hex")}.mp4`);
    const tmpOut = join(ctx.config.storage.generatedDir, `frame_tmp_${randomBytes(4).toString("hex")}.png`);
    try {
      const b64 = typeof req.body?.video === "string" ? req.body.video : "";
      const position = typeof req.body?.position === "string" ? req.body.position : "last";
      if (!b64) return res.status(400).json({ error: "video (base64) required" });
      const buffer = Buffer.from(b64.replace(/^data:[^;,]+;base64,/, ""), "base64");
      if (buffer.byteLength === 0) return res.status(400).json({ error: "video payload is empty" });
      await writeFile(tmpIn, buffer);
      // Same byte-level validation the generated-file path gets: the container
      // is trusted from its header, never from a filename.
      await assertLocalMp4(tmpIn);
      await extractVideoFrame(tmpIn, tmpOut, position);
      res.type("png").send(await readFile(tmpOut));
    } catch (err: unknown) {
      logError("video", "frame:upload-error", err);
      sendError(res, err);
    } finally {
      await unlink(tmpIn).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  });

  app.get("/api/video/frame", async (req: Request, res: Response) => {
    try {
      const file = req.query.file as string | undefined;
      const position = (req.query.position as string) || "last";
      if (!file) return res.status(400).json({ error: "file query param required" });
      const inputPath = await safeGeneratedFile(ctx, file, { requireMp4: true });
      await assertLocalMp4(inputPath);

      const tmpOut = join(ctx.config.storage.generatedDir, `frame_tmp_${randomBytes(4).toString("hex")}.png`);
      try {
        await extractVideoFrame(inputPath, tmpOut, position);
        const frame = await readFile(tmpOut);
        res.type("png").send(frame);
      } catch (err: unknown) {
        return res.status(500).json({ error: "ffmpeg failed" });
      } finally {
        await unlink(tmpOut).catch(() => {});
      }
    } catch (err: unknown) {
      logError("video", "frame:error", err);
      sendError(res, err);
    }
  });

  // --- Video Analysis (configured Grok planner vision model) ---
  app.post("/api/video/analyze", async (req: Request, res: Response) => {
    try {
      const signal = requestSignal(req, res, envDeadline("IMA2_VIDEO_ANALYZE_TIMEOUT_MS", 2 * 60_000));
      const { videoUrl } = req.body ?? {};
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      if (/^https?:\/\//i.test(videoUrl) || videoUrl.startsWith("data:")) {
        return res.status(400).json({ error: "videoUrl must be a generated .mp4 filename" });
      }
      const input = await safeGeneratedFile(ctx, videoUrl, { requireMp4: true });
      await assertLocalMp4(input);
      const firstFrame = join(ctx.config.storage.generatedDir, `analyze_first_${randomBytes(4).toString("hex")}.png`);
      const lastFrame = join(ctx.config.storage.generatedDir, `analyze_last_${randomBytes(4).toString("hex")}.png`);

      try {
        await extractVideoFrame(input, firstFrame, "0");
        await extractVideoFrame(input, lastFrame, "last");
        const first = (await readFile(firstFrame)).toString("base64");
        const last = (await readFile(lastFrame)).toString("base64");
        const plannerModel = ctx.config.grokProvider.plannerModel || DEFAULT_GROK_PLANNER_MODEL;
        const apiRes = await requestFrameAnalysis(ctx, videoLane(req.body), {
          model: plannerModel,
          input: [{
            role: "user",
            content: [
              { type: "input_image", image_url: `data:image/png;base64,${first}`, detail: "high" },
              { type: "input_image", image_url: `data:image/png;base64,${last}`, detail: "high" },
              { type: "input_text", text: "Analyze these first and last frames from a video for recreation. Infer likely motion between them. Include shot type, camera movement, lighting, color palette, subjects, motion direction/speed, mood, and audio/sound prompt suggestions. Be specific and cinematic." },
            ],
          }],
        }, signal);
        if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
        const data = (await apiRes.json()) as Record<string, unknown>;
        const text = extractOutputText(data);
        if (!text) return res.status(502).json({ error: "No analysis text in response" });
        logEvent("video", "analyze:done", { videoUrl, chars: text.length });
        res.json({ analysis: text, model: plannerModel, method: "first-last-frame" });
      } finally {
        await unlink(firstFrame).catch(() => {});
        await unlink(lastFrame).catch(() => {});
      }
    } catch (err: unknown) {
      logError("video", "analyze:error", err);
      sendError(res, err);
    }
  });
}
