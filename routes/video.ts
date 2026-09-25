import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { tmpdir } from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import type { Express, Request, Response } from "express";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, isStartJobFailure, setJobPhase, INFLIGHT_RETRY_AFTER_SECONDS } from "../lib/inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError } from "../lib/generationCancel.js";
import { logEvent, logError } from "../lib/logger.js";
import { parseBackgroundPreset, backgroundPromptSuffix, backgroundPlannerConstraint } from "../lib/backgroundPresets.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { generateVideoViaGrok, type GrokVideoEvent } from "../lib/grokVideoAdapter.js";
import { resolveGrokCredential, type GrokLane } from "../lib/grokRuntime.js";
import { generateVideoViaComfy, type ComfyQueueInfo } from "../lib/comfyImageAdapter.js";
import { getVideoSeriesChain } from "../lib/videoSeriesChain.js";
import {
  ACTIVE_VIDEO_PROMPT_GUIDANCE,
  appendVideoContinuityEntry,
  lineageFromVideoMetadata,
  normalizeVideoContinuityLineage,
  readVideoSidecar,
  requireActiveVideoPrompt,
  safeGeneratedVideoFilename,
  type VideoContinuityLineage,
} from "../lib/videoContinuity.js";
import { extractGeneratedVideoFrameB64 } from "../lib/videoFrameExtract.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import {
  normalizeGrokVideoModel,
  normalizeVideoResolution,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  deriveVideoMode,
  MAX_REF2V_REFERENCES,
  MAX_REFERENCE_AUDIOS,
  validateVideoResolutionForRequest,
  validateVideoDurationForRequest,
  type VideoMode,
} from "../lib/imageModels.js";
import { errInfo, numberField, stringField, thrownFields } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";
import { generateVideoThumbnail } from "../lib/videoThumb.js";
import { publish } from "../lib/eventBus.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { persistVideoArtifact } from "../lib/videoArtifactPersistence.js";
import { normalizePresetIds } from "../lib/presetCompiler.js";
import { getElementById } from "../lib/assetsStore.js";
import { compileElements, ELEMENT_CAPACITY_DEFAULTS, type ElementDefinition, type ExistingReferenceInput } from "../lib/elementCompiler.js";

function sendSse(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client went away mid-write; bus emit still delivers */
  }
}

function dualEmitVideo(res: Response, requestId: string, event: string, data: unknown) {
  if (!res.writableEnded) sendSse(res, event, data);
  if (event === "done" || event === "error") {
    // #151 stage 2: terminal events (done AND error) carry the canonical
    // envelope. Stream events (progress/phase/partial) stay on raw publish.
    publishJobEvent(requestId, event, data as Record<string, unknown>);
  } else {
    publish(requestId, event, data as Record<string, unknown>);
  }
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

type NormalizeError = { error: string; code: string; status: number };

function isNormalizeError(x: unknown): x is NormalizeError {
  return typeof x === "object" && x !== null && typeof (x as { error?: unknown }).error === "string";
}

export async function saveGeneratedVideoArtifact(ctx: RuntimeContext, filename: string, buffer: Buffer, metadata: unknown): Promise<void> {
  await persistVideoArtifact(ctx.config.storage.generatedDir, filename, buffer, metadata);
}

async function resolveSourceImage(
  ctx: RuntimeContext,
  sourceImage: unknown,
  sourceFilename: unknown,
): Promise<{ b64: string | null; filename: string | null }> {
  if (typeof sourceFilename === "string" && sourceFilename) {
    const safe = sourceFilename.replace(/^\/+/, "");
    if (safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
      throw { status: 400, code: "GROK_VIDEO_INVALID_MODE", message: "invalid source filename" };
    }
    if (/\.mp4$/i.test(safe)) throw { status: 400, code: "GROK_VIDEO_INVALID_MODE", message: "use continueFromVideo for generated video continuation" };
    const buf = await readFile(join(ctx.config.storage.generatedDir, safe));
    return { b64: buf.toString("base64"), filename: safe };
  }
  if (typeof sourceImage === "string" && sourceImage) {
    return { b64: sourceImage, filename: null };
  }
  return { b64: null, filename: null };
}

const STORYBOARD_TRIM_SECONDS = "1.0";

async function trimStoryboardLeadIn(buffer: Buffer, requestId: string): Promise<Buffer> {
  const tmpIn = join(tmpdir(), `ima2_sb_trim_in_${requestId.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`);
  const tmpOut = join(tmpdir(), `ima2_sb_trim_out_${requestId.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`);
  try {
    await writeFile(tmpIn, buffer);
    logEvent("video", "storyboard:trim-start", { requestId, inputBytes: buffer.length, trimSeconds: STORYBOARD_TRIM_SECONDS });
    await execFileAsync("ffmpeg", [
      "-y", "-ss", STORYBOARD_TRIM_SECONDS, "-i", tmpIn,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-c:a", "aac", "-b:a", "128k",
      "-avoid_negative_ts", "make_zero", tmpOut,
    ], { timeout: 60_000 });
    const trimmed = await readFile(tmpOut);
    logEvent("video", "storyboard:trimmed", { requestId, originalBytes: buffer.length, trimmedBytes: trimmed.length, trimSeconds: STORYBOARD_TRIM_SECONDS });
    return trimmed;
  } catch (trimError: unknown) {
    const trimErrorFields = thrownFields(trimError);
    logEvent("video", "storyboard:trim-exec-error", { requestId, error: trimErrorFields.message, stderr: typeof trimErrorFields.stderr === "string" ? trimErrorFields.stderr.slice(0, 500) : undefined });
    throw trimError;
  } finally {
    await unlink(tmpIn).catch(() => {});
    await unlink(tmpOut).catch(() => {});
  }
}

export function registerVideoRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.post("/api/video/generate", async (req: Request, res: Response) => {
    const requestId =
      typeof req.body?.requestId === "string"
        ? req.body.requestId
        : typeof req.body?.clientRequestId === "string"
          ? req.body.clientRequestId
          : req.id;
    const asyncMode = req.body?.async === true;
    let finishStatus = "completed";
    let finishHttpStatus = 200;
    let finishErrorCode: string | undefined;
    let finishMeta: Record<string, unknown> = {};
    let finishCanceled = false;
    let jobOwned = false;
    const cancelController = new AbortController();

    if (!asyncMode) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const fail = (status: number | undefined, code: string, error: string, extra: Record<string, unknown> = {}) => {
      const httpStatus = status ?? 500;
      finishStatus = "error";
      finishHttpStatus = httpStatus;
      finishErrorCode = code;
      const payload = { error, code, status: httpStatus, requestId, ...extra };
      // #151 stage 2: terminal failure carries the canonical envelope.
      publishJobEvent(requestId, "error", payload);
      if (asyncMode && !res.headersSent) {
        return res.status(httpStatus).json(payload);
      }
      if (!res.writableEnded) sendSse(res, "error", payload);
    };

    try {
      const { prompt, provider = "grok", model: rawModel } = req.body || {};
      const presetIds = normalizePresetIds(req.body?.presetIds);
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const backgroundParse = parseBackgroundPreset(req.body?.backgroundPreset);
      if ("error" in backgroundParse) {
        return fail(400, backgroundParse.code, backgroundParse.error);
      }
      const backgroundPreset = backgroundParse.preset;
      // "transparent" is an image-only preset: it depends on the GPT image
      // tool's alpha-capable output, and Grok video has no such parameter.
      // Accepting it here would append a cutout suffix that the model cannot
      // honor and hand back an opaque clip that claims transparency.
      if (backgroundPreset === "transparent") {
        return fail(400, "TRANSPARENT_VIDEO_UNSUPPORTED", "transparent backgrounds are image-only; video generation has no alpha channel — use chroma-green and key the clip instead");
      }
      const clientNodeId = typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;
      const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";

      const isComfy = provider === "comfy";
      if (!isComfy && provider !== "grok" && provider !== "grok-api") return fail(400, provider === "agy" ? "AGY_VIDEO_UNSUPPORTED" : "VIDEO_PROVIDER_UNSUPPORTED", provider === "agy" ? "Gemini (agy) does not support video generation" : "video generation requires provider 'grok', 'grok-api' or 'comfy'");
      // Grok-only axes are refused rather than ignored. Accepting a storyboard
      // or continuation request and silently dropping it would hand back a clip
      // that quietly is not what was asked for.
      if (isComfy) {
        const unsupported = ["storyboard", "continueFromVideo", "continuityLineage", "topic", "plannerModel", "referenceAudios"]
          .filter((key) => {
            const value = (req.body ?? {})[key];
            return value !== undefined && value !== null && value !== false && value !== "";
          });
        if (unsupported.length > 0) {
          return fail(400, "COMFY_VIDEO_OPTION_UNSUPPORTED", `the comfy lane does not support: ${unsupported.join(", ")}`);
        }
      }
      const storyboardActive = req.body?.storyboard === true;
      const storyboardPrefix = storyboardActive
        ? [
          "[STORYBOARD MODE — Sequential Video Clip]",
          "This clip is part of a multi-shot video storyboard sequence.",
          "The prompt and all injected instructions MUST be in English. Exception: dialogue lines keep original language.",
          "",
          "CHARACTER LOCK:",
          "- Identify each character by 2-3 VISUAL identifiers (clothing + physique + position/props). Never by name alone.",
          "- Copy character descriptions VERBATIM from prior clip context. Do NOT rephrase or drift.",
          "",
          "CONTINUITY:",
          "- Continue from the previous frame's exact composition, pose, and spatial arrangement.",
          "- Lock lighting direction, color palette, environment, and style.",
          "- Describe ONLY what changes: action, camera movement, dialogue, sound.",
          "",
          "STORYBOARD IMAGE SOURCE RULE (HIGHEST PRIORITY — OVERRIDES ALL OTHER RULES):",
          "- The source image is a 3x3 storyboard grid. Panel 1 (top-left) is a BLACK LEAD-IN FRAME — it contains no scene content.",
          "- The video starts from black (Panel 1), then transitions into the action scene from Panel 2.",
          "- Panels 2-9 contain the action sequence. Describe and animate only Panels 2-9.",
          "- Start your rewritten prompt with: 'Fading in from black into the full-screen scene of [Panel 2 description],' — the server auto-trims the black lead-in.",
          "- The storyboard grid must NEVER appear as a visible grid in any frame. The output is a single continuous cinematic clip.",
          "- Do NOT reference Panel 1 in the action description — it is only a technical black frame.",
          "",
          "PROMPT STRUCTURE (layered caption format):",
          "- Shot foundation: type + camera motion (dolly, pan, tracking, crane, static).",
          "- Subject: action with intensity modifiers (crashes violently, drifts gently).",
          "- Environment: setting details inherited from prior shots.",
          "- Dialogue: who speaks (by appearance), exact line (original language), timing.",
          "- Audio: music style/no-music, sound effects, room tone.",
          "- Ending frame: final pose, camera state, last audio cue — must be stable for next shot.",
          "",
        ].join("\n") + "\n"
        : "";
      const activePrompt = requireActiveVideoPrompt(prompt);
      if (!activePrompt) return fail(400, "PROMPT_REQUIRED", "Prompt is required", { guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });

      // A comfy workflow id is not a grok model id, so the grok normalizer would
      // reject it. The branch has to happen here, before normalization, while the
      // actual comfy run stays below with admission and cancellation.
      const comfyWorkflowId = isComfy ? String(rawModel ?? "").trim() : "";
      if (isComfy && !comfyWorkflowId) {
        return fail(400, "COMFY_WORKFLOW_REQUIRED", "provider 'comfy' requires a workflow id as the model.");
      }
      const modelCheck = isComfy
        ? { model: comfyWorkflowId }
        : normalizeGrokVideoModel(rawModel || ctx.config.grokProvider.defaultVideoModel);
      if (isNormalizeError(modelCheck)) return fail(modelCheck.status, modelCheck.code, modelCheck.error);
      const durationCheck = normalizeVideoDuration(req.body?.duration);
      if (isNormalizeError(durationCheck)) return fail(durationCheck.status, durationCheck.code, durationCheck.error);
      const resolutionCheck = normalizeVideoResolution(req.body?.resolution);
      if (isNormalizeError(resolutionCheck)) return fail(resolutionCheck.status, resolutionCheck.code, resolutionCheck.error);
      const aspectCheck = normalizeVideoAspectRatio(req.body?.aspectRatio);
      if (isNormalizeError(aspectCheck)) return fail(aspectCheck.status, aspectCheck.code, aspectCheck.error);

      // Resolve reference inputs: base64 list + existing-file list + legacy single source.
      let parentLineage: VideoContinuityLineage | null = null;
      let continueFromVideoFilename: string | null = null;
      if (typeof req.body?.continueFromVideo === "string" && req.body.continueFromVideo.trim()) {
        try {
          continueFromVideoFilename = safeGeneratedVideoFilename(req.body.continueFromVideo);
          const parentMeta = await readVideoSidecar(ctx.config.storage.generatedDir, continueFromVideoFilename);
          parentLineage = lineageFromVideoMetadata(continueFromVideoFilename, parentMeta);
        } catch (e: unknown) {
          const eFields = thrownFields(e);
          return fail(numberField(eFields.status) || 400, "GROK_VIDEO_INVALID_MODE", stringField(eFields.message) || "invalid continuation video");
        }
      } else {
        parentLineage = normalizeVideoContinuityLineage(req.body?.continuityLineage);
      }

      const refInputs: Array<{ image?: unknown; filename?: unknown; source: ExistingReferenceInput["source"] }> = [];
      if (continueFromVideoFilename && !req.body?.sourceImage && !req.body?.sourceFilename) {
        try {
          refInputs.push({
            image: await extractGeneratedVideoFrameB64(ctx.config.storage.generatedDir, continueFromVideoFilename),
            source: "continuity",
          });
        } catch (e: unknown) {
          const eFields = thrownFields(e);
          return fail(numberField(eFields.status) || 500, "GROK_VIDEO_FRAME_FAILED", stringField(eFields.message) || "failed to extract continuation frame");
        }
      }
      refInputs.push(
        ...toArray(req.body?.referenceImages).map((image) => ({ image, source: "composer" as const })),
        ...toArray(req.body?.referenceFilenames).map((filename) => ({ filename, source: "composer" as const })),
        ...(req.body?.sourceImage || req.body?.sourceFilename
          ? [{ image: req.body?.sourceImage, filename: req.body?.sourceFilename, source: "node" as const }]
          : []),
      );

      const rawElementIds: string[] = Array.isArray(req.body?.elementIds)
        ? req.body.elementIds.filter((id: unknown) => typeof id === "string" && id)
        : [];
      let elementNotesFragment = "";
      const elementResolvedRefs: string[] = [];
      let appliedElementIds: string[] = [];
      if (rawElementIds.length > 0) {
        try {
          const elementMap = new Map<string, ElementDefinition>();
          for (const elementId of rawElementIds) {
            const record = getElementById(elementId);
            if (record?.metadata) {
              const metadata = typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata;
              elementMap.set(elementId, {
                id: elementId,
                name: metadata.name ?? record.name,
                kind: metadata.elementKind ?? "character",
                refs: Array.isArray(metadata.refs) ? metadata.refs : [],
                notes: metadata.notes,
                defaultStrength: metadata.defaultStrength,
                createdAt: record.createdAt ?? 0,
                updatedAt: record.updatedAt ?? 0,
              });
            }
          }
          const elementCapacity = refInputs.length > 1
            ? { ...ELEMENT_CAPACITY_DEFAULTS.grok.video, maxTotalRefs: MAX_REF2V_REFERENCES }
            : ELEMENT_CAPACITY_DEFAULTS.grok.video;
          const compiled = compileElements({
            elementIds: rawElementIds,
            elements: elementMap,
            existingRefs: refInputs.map((ref): ExistingReferenceInput => ({
              source: ref.source,
              path: typeof ref.filename === "string" ? ref.filename : typeof ref.image === "string" ? ref.image : "",
            })),
            provider: "grok",
            mode: "video",
            capacity: elementCapacity,
            missingPolicy: "collect",
          });
          elementNotesFragment = compiled.notesFragment;
          appliedElementIds = compiled.elementIds;
          for (const slot of compiled.referenceSlots) {
            try {
              const buffer = await readFile(slot.path);
              const mime = slot.path.endsWith(".png") ? "image/png" : "image/jpeg";
              elementResolvedRefs.push(`data:${mime};base64,${buffer.toString("base64")}`);
            } catch {
              logEvent("video", "element_ref_read_failed", { requestId, path: slot.path, elementId: slot.elementId });
            }
          }
        } catch (e) {
          logEvent("video", "element_compile_failed", { requestId, error: errInfo(e) });
        }
      }
      refInputs.push(...elementResolvedRefs.map((image) => ({ image, source: "composer" as const })));
      let resolved: Array<{ b64: string; filename: string | null; source: ExistingReferenceInput["source"] }>;
      try {
        const all = await Promise.all(refInputs.map(async (r) => ({
          ...(await resolveSourceImage(ctx, r.image, r.filename)),
          source: r.source,
        })));
        resolved = all.filter((r): r is { b64: string; filename: string | null; source: ExistingReferenceInput["source"] } => Boolean(r.b64));
      } catch (e: unknown) {
        const eFields = thrownFields(e);
        return fail(numberField(eFields.status) || 400, stringField(eFields.code) || "GROK_VIDEO_INVALID_MODE", stringField(eFields.message) || "invalid reference image");
      }
      if (resolved.length > MAX_REF2V_REFERENCES) return fail(400, "GROK_VIDEO_REF_TOO_MANY", `at most ${MAX_REF2V_REFERENCES} reference images`);
      const incomingProviderUrl = typeof req.body?.providerUrl === "string" && req.body.providerUrl.startsWith("http") ? req.body.providerUrl : null;
      // Which slot an image arrived in IS the caller's intent, and a bare count throws
      // that away. A composer reference means "guide the video with this" even when
      // there is only one of them; a node/continuity image means "start from this
      // frame". Deriving from the count alone forced every single composer reference
      // into image-to-video, so the one thing the tray is named for was unreachable.
      // devlog/_plan/260820_grok15_multi_reference_video/030_single_ref_mode_choice.md
      const composerRefCount = resolved.filter((r) => r.source === "composer").length;
      const requestedMode = typeof req.body?.mode === "string" ? req.body.mode : null;
      // Shape only. Which voice ids exist is xAI's to answer, and its 400 names every
      // valid voice — a list we would only get wrong, and which cannot include the
      // caller's custom voices anyway. Parsed here rather than at the call site because
      // the mode derivation below needs to know whether any voice was attached.
      const referenceAudios = toArray(req.body?.referenceAudios)
        .map((voice) => (typeof voice === "string" ? voice.trim() : ""))
        .filter((voice) => voice.length > 0);
      if (referenceAudios.length > MAX_REFERENCE_AUDIOS) {
        return fail(400, "GROK_VIDEO_AUDIO_TOO_MANY", `at most ${MAX_REFERENCE_AUDIOS} reference voices`);
      }
      const derivedMode: VideoMode = composerRefCount > 0
        ? "reference-to-video"
        // A voice alone selects reference-to-video upstream: "at least one reference of
        // either kind selects the reference-to-video mode" (xAI OpenAPI,
        // GenerateVideoRequest.reference_audios). Calling it text-to-video here would let
        // a 15s base-model request through while xAI applies the 10s r2v ceiling, and the
        // rejection would name a mode this request never asked for.
        : referenceAudios.length > 0
          ? "reference-to-video"
          : deriveVideoMode(resolved.length);
      const mode: VideoMode = incomingProviderUrl
        ? "image-to-video"
        : (requestedMode === "reference-to-video" || requestedMode === "image-to-video" || requestedMode === "text-to-video")
          ? requestedMode
          : derivedMode;
      // An explicit reference-to-video with nothing to reference at all would ship empty
      // arrays and fail upstream with a less useful message. A voice counts as a
      // reference, so audio-only is legitimate and must not be rejected here.
      if (mode === "reference-to-video" && resolved.length === 0 && referenceAudios.length === 0) {
        return fail(400, "GROK_VIDEO_INVALID_MODE", "reference-to-video requires at least 1 reference image or voice");
      }
      const duration = durationCheck.duration;
      const resolutionModeCheck = validateVideoResolutionForRequest(modelCheck.model, resolutionCheck.resolution, mode, {
        allowTextCanvasShim: true,
      });
      if (isNormalizeError(resolutionModeCheck)) return fail(resolutionModeCheck.status, resolutionModeCheck.code, resolutionModeCheck.error);
      // The r2v ceiling is per model, and the start call is deliberately never retried
      // (a retry could bill a second video), so a 400 we can predict must be answered
      // before the job is admitted rather than asynchronously after planning.
      const durationModeCheck = validateVideoDurationForRequest(modelCheck.model, duration, mode);
      if (isNormalizeError(durationModeCheck)) return fail(durationModeCheck.status, durationModeCheck.code, durationModeCheck.error);
      const referenceImages = mode === "reference-to-video" ? resolved.map((r) => r.b64) : undefined;
      const sourceB64 = incomingProviderUrl || (mode === "image-to-video" ? resolved[0]?.b64 : undefined);
      const sourceFilename = resolved[0]?.filename ?? null;

      const started = startJob({
        requestId,
        kind: "video",
        prompt: activePrompt,
        meta: { kind: "video", sessionId, clientNodeId, model: modelCheck.model, mode, duration, resolution: resolutionCheck.resolution, presetIds },
      });
      if (started && isStartJobFailure(started)) {
        if (started.code === "TOO_MANY_JOBS") {
          res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
        }
        return fail(
          started.code === "TOO_MANY_JOBS" ? 429 : 409,
          started.code,
          started.code === "TOO_MANY_JOBS"
            ? "Too many concurrent generation jobs"
            : "Request ID already in use",
        );
      }
      jobOwned = true;
      registerJobAbortController(requestId, cancelController);
      if (asyncMode) res.status(202).json({ requestId });
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });

      logEvent("video", "request", { requestId, mode, duration, resolution: resolutionCheck.resolution, aspectRatio: aspectCheck.aspectRatio });
      const startTime = Date.now();

      if (isComfy) {
        // Deliberately inside the handler closure, after startJob and
        // registerJobAbortController: cancelController.signal is what carries a
        // UI cancel into the adapter's poll loop, and finishJob in the finally
        // below is what releases the inflight slot. A separate top-level handler
        // would have had neither.
        setJobPhase(requestId, "streaming");
        dualEmitVideo(res, requestId, "submitted", { requestId, requestedModel: comfyWorkflowId, effectiveModel: comfyWorkflowId });
        const comfyResult = await generateVideoViaComfy(activePrompt, ctx, {
          model: comfyWorkflowId,
          signal: cancelController.signal,
          requestId,
          ...(sourceB64 ? { references: [{ b64: sourceB64 }] } : {}),
          onQueue: (info: ComfyQueueInfo) => {
            dualEmitVideo(res, requestId, "progress", {
              requestId,
              progress: null,
              queuePosition: info.position,
              running: info.running,
            });
          },
        });
        const comfyRand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
        const comfyFilename = `${Date.now()}_${comfyRand}.mp4`;
        const comfyElapsed = +((Date.now() - startTime) / 1000).toFixed(1);
        const comfyBuffer = Buffer.from(comfyResult.b64, "base64");
        const comfyMeta = {
          kind: "video",
          mediaType: "video",
          providerUrl: comfyResult.providerUrl ?? null,
          requestId,
          sessionId,
          clientNodeId,
          prompt: activePrompt,
          userPrompt: activePrompt,
          revisedPrompt: null,
          presetIds,
          provider,
          model: comfyResult.effectiveModel,
          requestedModel: comfyWorkflowId,
          effectiveModel: comfyResult.effectiveModel,
          createdAt: Date.now(),
          elapsed: comfyElapsed,
          usage: null,
          webSearchCalls: 0,
          video: {
            mode,
            refsCount: resolved.length,
            sourceImageFilename: sourceFilename,
            comfyPromptId: comfyResult.promptId,
            comfyOrigin: comfyResult.origin,
          },
        };
        await saveGeneratedVideoArtifact(ctx, comfyFilename, comfyBuffer, comfyMeta);
        generateVideoThumbnail(join(ctx.config.storage.generatedDir, comfyFilename)).catch(() => {});
        invalidateHistoryIndex();
        finishMeta = { filename: comfyFilename };
        logEvent("comfy", "video:saved", { requestId, filename: comfyFilename, bytes: comfyBuffer.length, elapsedMs: Date.now() - startTime });
        dualEmitVideo(res, requestId, "done", {
          requestId,
          filename: comfyFilename,
          url: `/generated/${encodeURIComponent(comfyFilename)}`,
          providerUrl: comfyResult.providerUrl ?? null,
          mediaType: "video",
          revisedPrompt: null,
          elapsed: comfyElapsed,
          usage: null,
          requestedModel: comfyWorkflowId,
          effectiveModel: comfyResult.effectiveModel,
          video: comfyMeta.video,
        });
        return;
      }

      const onEvent = (ev: GrokVideoEvent) => {
        if (ev.phase === "submitted") {
          setJobPhase(requestId, "streaming");
          dualEmitVideo(res, requestId, "submitted", {
            requestId,
            xaiVideoRequestId: ev.xaiVideoRequestId,
            requestedModel: ev.requestedModel,
            effectiveModel: ev.effectiveModel,
            modelFallback: ev.modelFallback ?? null,
          });
        } else if (ev.phase === "progress") {
          dualEmitVideo(res, requestId, "progress", { requestId, progress: typeof ev.progress === "number" ? ev.progress / 100 : null, stalled: Boolean(ev.stalled) });
        } else {
          setJobPhase(requestId, "planning");
          dualEmitVideo(res, requestId, "planning", { requestId });
        }
      };

      // Build prompt with series chain context
      const chain = !parentLineage && topic ? await getVideoSeriesChain(ctx.config.storage.generatedDir, topic) : [];
      const basePrompt = chain.length > 0
        ? `[Series topic: ${topic}]\n[Previous prompts in series:\n${chain.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n]\n\n${activePrompt}`
        : activePrompt;
      const effectivePrompt = storyboardPrefix + basePrompt
        + (elementNotesFragment ? `\n${elementNotesFragment}` : "")
        + (backgroundPreset ? ` ${backgroundPromptSuffix(backgroundPreset, "video")}` : "");

      const plannerModel = typeof req.body?.plannerModel === "string" ? req.body.plannerModel.trim() : undefined;
      // `provider` comes off the untyped body; the comfy branch already returned, so the
      // only values left are the two Grok lanes. Narrow explicitly so the lane the
      // credential is resolved for is a real GrokLane rather than an `any` passthrough.
      const lane: GrokLane = provider === "grok-api" ? "grok-api" : "grok";
      const credential = await resolveGrokCredential(ctx, lane, { signal: cancelController.signal });

      const result = await generateVideoViaGrok(effectivePrompt, ctx, {
        model: modelCheck.model,
        mode,
        duration,
        resolution: resolutionCheck.resolution,
        aspectRatio: aspectCheck.aspectRatio,
        sourceImage: sourceB64,
        referenceImages,
        ...(referenceAudios.length ? { referenceAudios } : {}),
        signal: cancelController.signal,
        requestId,
        continuityLineage: parentLineage,
        plannerModel: plannerModel || undefined,
        credential,
        onEvent,
        storyboardActive,
        backgroundConstraint: backgroundPreset ? backgroundPlannerConstraint(backgroundPreset) : undefined,
      });

      const plannerDroppedBackground = Boolean(
        backgroundPreset
        && typeof result.revisedPrompt === "string"
        && result.revisedPrompt.trim()
        && !/background/i.test(result.revisedPrompt),
      );
      if (plannerDroppedBackground) {
        logEvent("grok", "video:background-constraint-dropped", { requestId, backgroundPreset });
      }

      const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
      const filename = `${Date.now()}_${rand}.mp4`;
      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      const videoContinuity = appendVideoContinuityEntry(parentLineage, {
        filename,
        userPrompt: activePrompt,
        revisedPrompt: result.revisedPrompt,
        createdAt: Date.now(),
      });
      const meta = {
        kind: "video",
        mediaType: "video",
        providerUrl: result.url,
        requestId,
        sessionId,
        clientNodeId,
        prompt: activePrompt,
        userPrompt: activePrompt,
        revisedPrompt: result.revisedPrompt,
        presetIds,
        ...(appliedElementIds.length > 0 ? { elementIds: appliedElementIds } : {}),
        provider,
        model: result.effectiveModel,
        requestedModel: result.requestedModel,
        effectiveModel: result.effectiveModel,
        modelFallback: result.modelFallback,
        createdAt: Date.now(),
        elapsed,
        usage: result.usage,
        webSearchCalls: result.webSearchCalls,
        ...(result.searchDegraded ? { searchDegraded: result.searchDegraded } : {}),
        ...(result.plannerDegraded ? { plannerDegraded: result.plannerDegraded } : {}),
        video: {
          duration: result.duration,
          resolution: result.resolution,
          aspectRatio: result.aspectRatio,
          // The resolved mode was computed for the request and then thrown
          // away: inflight carried it, but inflight is gone the moment the job
          // finishes, so nothing could answer "was this i2v or t2v" afterwards
          // (#172). A --ref run that silently falls back to t2v produces a
          // different person, which is the failure this makes detectable.
          mode,
          refsCount: resolved.length,
          sourceImageFilename: sourceFilename,
          xaiVideoRequestId: result.xaiVideoRequestId,
          requestedModel: result.requestedModel,
          effectiveModel: result.effectiveModel,
          modelFallback: result.modelFallback,
        },
        videoContinuity,
        ...(topic ? { videoSeries: { topic, chainIndex: chain.length } } : {}),
        ...(storyboardActive ? { storyboard: true } : {}),
        ...(backgroundPreset ? { backgroundPreset, ...(plannerDroppedBackground ? { plannerDroppedBackground: true } : {}) } : {}),
      };
      let finalBuffer = result.videoBuffer;
      if (storyboardActive) {
        try {
          finalBuffer = await trimStoryboardLeadIn(result.videoBuffer, requestId);
        } catch (trimErr: unknown) {
          const trimErrFields = thrownFields(trimErr);
          logEvent("video", "storyboard:trim-failed", { requestId, error: trimErrFields.message });
        }
      }
      await saveGeneratedVideoArtifact(ctx, filename, finalBuffer, meta);
      generateVideoThumbnail(join(ctx.config.storage.generatedDir, filename)).catch(() => {});
      invalidateHistoryIndex();

      finishMeta = { filename, xaiVideoRequestId: result.xaiVideoRequestId };
      logEvent("video", "saved", { requestId, filename, bytes: result.videoBuffer.length, elapsedMs: Date.now() - startTime });
      dualEmitVideo(res, requestId, "done", {
        requestId,
        filename,
        url: `/generated/${encodeURIComponent(filename)}`,
        providerUrl: result.url,
        mediaType: "video",
        revisedPrompt: result.revisedPrompt,
        elapsed,
        usage: result.usage,
        requestedModel: result.requestedModel,
        effectiveModel: result.effectiveModel,
        modelFallback: result.modelFallback,
        video: meta.video,
        videoContinuity,
        ...(meta.videoSeries ? { videoSeries: meta.videoSeries } : {}),
      });
    } catch (e) {
      const err = errInfo(e);
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        finishHttpStatus = canceled.status;
        finishErrorCode = canceled.code;
        dualEmitVideo(res, requestId, "error", { error: canceled.message, code: canceled.code, status: canceled.status, requestId });
      } else {
        finishStatus = "error";
        finishHttpStatus = err.status || 500;
        finishErrorCode = err.code || "GROK_VIDEO_FAILED";
        logError("video", "error", err.raw, { requestId, code: finishErrorCode });
        dualEmitVideo(res, requestId, "error", { error: err.message, code: finishErrorCode, status: finishHttpStatus, requestId, ...errorEnvelopeFields(err.raw) });
      }
    } finally {
      if (jobOwned) finishJob(requestId, { canceled: finishCanceled, status: finishStatus, httpStatus: finishHttpStatus, errorCode: finishErrorCode, meta: finishMeta });
      if (!res.writableEnded) res.end();
    }
  });
}
