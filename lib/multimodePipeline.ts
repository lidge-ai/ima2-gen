import { mkdir, readFile } from "fs/promises";
import { safeWriteSidecar } from "./atomicWrite.js";
import { join } from "path";
import { randomBytes } from "crypto";
import { buildFilename, writeFileUnique } from "./filename.js";
import type { Request, Response } from "express";
import { detectImageMimeFromB64, summarizeReferencePayload, validateAndNormalizeRefs } from "./refs.js";
import { generateImageThumbnailFromBuffer } from "./imageThumb.js";
import { classifyUpstreamError } from "./errorClassify.js";
import { normalizeOAuthParams } from "./oauthNormalize.js";
import { resolveProviderOptions } from "./providerOptions.js";
import { prepareImageExecution } from "./providers/execution/index.js";
import { checkImageExecutionAdmission } from "./providers/execution/admission.js";
import { resolveGrokQualityModel } from "./imageModels.js";
import { composerNegativePromptMeta, readNaiOptions } from "./naiOptions.js";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, isStartJobFailure, INFLIGHT_RETRY_AFTER_SECONDS } from "./inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError, throwIfJobCanceled, } from "./generationCancel.js";
import { logEvent, logError } from "./logger.js";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import { normalizeComposerInsertedPrompts, normalizeComposerPrompt, } from "./composerSnapshot.js";
import { errInfo } from "./errInfo.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { validateModeration, imageFormatFromMime, writeSse } from "./routeHelpers.js";
import { publish } from "./eventBus.js";
import { publishJobEvent } from "./ssePublish.js";
import { normalizeMaxImages, sequenceStatus, type MultimodeImage, type MultimodeRouteItem, } from "./multimodeHelpers.js";
import { normalizeBodyRequestId, validateBoundedCount, validateGenerationPrompt } from "./generationInputValidation.js";
import { getElementById } from "./assetsStore.js";
import { compileElements, ELEMENT_CAPACITY_DEFAULTS, type ElementDefinition, type ExistingReferenceInput } from "./elementCompiler.js";
import { errorEnvelopeFields } from "./errors/envelope.js";
import { upstreamLabelFields } from "./diagnosticLabel.js";
import { getProviderSurfaceSupport } from "./providers/derive.js";

async function resolveMultimodeElements(
  elementIds: string[], references: string[], activeProvider: string, requestId: string | undefined,
) {
  let notesFragment = "";
  const resolvedRefs: string[] = [];
  let appliedIds: string[] = [];
  try {
    const elements = new Map<string, ElementDefinition>();
    for (const id of elementIds) {
      const record = getElementById(id);
      if (!record?.metadata) continue;
      const meta = typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata;
      elements.set(id, { id, name: meta.name ?? record.name, kind: meta.elementKind ?? "character", refs: Array.isArray(meta.refs) ? meta.refs : [], notes: meta.notes, defaultStrength: meta.defaultStrength, createdAt: record.createdAt ?? 0, updatedAt: record.updatedAt ?? 0 });
    }
    const provider = activeProvider === "grok" || activeProvider === "grok-api" ? "grok"
      : activeProvider === "gemini-api" ? "gemini" : "gpt";
    const capacity = ELEMENT_CAPACITY_DEFAULTS[provider]?.image ?? { maxTotalRefs: 6, maxRefsPerElement: 6 };
    const compiled = compileElements({ elementIds, elements, existingRefs: references.map((path): ExistingReferenceInput => ({ source: "composer", path })), provider, mode: "image", capacity, missingPolicy: "collect" });
    notesFragment = compiled.notesFragment;
    appliedIds = compiled.elementIds;
    for (const slot of compiled.referenceSlots) {
      try {
        const buffer = await readFile(slot.path);
        const mime = slot.path.endsWith(".png") ? "image/png" : "image/jpeg";
        resolvedRefs.push(`data:${mime};base64,${buffer.toString("base64")}`);
      } catch {
        logEvent("multimode", "element_ref_read_failed", { requestId, path: slot.path, elementId: slot.elementId });
      }
    }
  } catch (error) {
    logEvent("multimode", "element_compile_failed", { requestId, error: errInfo(error) });
  }
  return { notesFragment, resolvedRefs, appliedIds };
}
function dualEmitMultimode(res: Response, requestId: string, event: string, data: unknown) {
  if (!res.writableEnded) writeSse(res, event, data);
  if (event === "done" || event === "error") {
    // #151 stage 2: terminal events carry the canonical envelope.
    publishJobEvent(requestId, event, data as Record<string, unknown>);
  } else {
    publish(requestId, event, data as Record<string, unknown>);
  }
}

function respondMultimodeValidationError(
  res: Response,
  requestId: string,
  asyncMode: boolean,
  status: number,
  payload: Record<string, unknown>,
) {
  // #151 stage 2: terminal failure carries the canonical envelope.
  publishJobEvent(requestId, "error", payload);
  if (asyncMode && !res.headersSent) {
    return res.status(status).json(payload);
  }
  if (!res.writableEnded) {
    writeSse(res, "error", payload);
    res.end();
  }
}
export async function runMultimodePipeline(req: Request, res: Response, ctx: RuntimeContext) {
    const requestId = normalizeBodyRequestId(req.body?.requestId, req.id);
    const asyncMode = req.body?.async === true;
    const promptError = validateGenerationPrompt(req.body?.prompt);
    if (promptError) return res.status(400).json(promptError);
    const maxAllowedImages = Math.max(1, Math.trunc(Number(ctx.config.limits.maxGeneratedImages) || 1));
    const maxImagesResult = validateBoundedCount(req.body?.maxImages, 1, maxAllowedImages, "maxImages");
    if ("error" in maxImagesResult) return res.status(400).json(maxImagesResult);
    let finishStatus = "completed";
    let finishHttpStatus = 200;
    let finishErrorCode;
    let finishMeta = {};
    let finishCanceled = false;
    let jobOwned = false;
    const cancelController = new AbortController();
    const images: MultimodeRouteItem[] = [];
    const persistedIndexes = new Set<number>();
    let routeMaxImages = 0;
    let routeSequenceId = "";
    let routeStartTime = Date.now();
    let routeActiveProvider = "auto";
    let routeQuality = "medium";
    let routeEffectiveSize = "1024x1024";
    let routeModeration = "low";
    let routeImageToolModel: string | undefined;
  let routeImageModel: string | null = null;
    let routeWebSearchEnabled = true;
    let routePromptMode: "auto" | "direct" = "auto";
    let routeQualityWarnings: unknown[] = [];
    let routeComposerPrompt: string | null = null;
    let routeComposerInsertedPrompts: ReturnType<typeof normalizeComposerInsertedPrompts> = [];
    let latestUsage: Record<string, number> | null = null;
    let latestWebSearchCalls = 0;
    let latestExtraIgnored = 0;
    if (!asyncMode) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }
    try {
      const {
        prompt,
        quality: rawQuality = "medium",
        size = "1024x1024",
        format = "png",
        moderation = "low",
        provider = "auto",
        references = [],
        mode: promptMode = "auto",
        model: rawModel,
        imageToolModel: rawImageToolModel,
        reasoningEffort: rawReasoningEffort,
        webSearchEnabled: rawWebSearchEnabled = true,
      } = req.body;
      const composerPrompt = normalizeComposerPrompt(req.body?.composerPrompt);
      const composerInsertedPrompts = normalizeComposerInsertedPrompts(
        req.body?.composerInsertedPrompts,
      );
      const maxImages = normalizeMaxImages(maxImagesResult.value, maxAllowedImages);
      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";
      const { quality, warnings: qualityWarnings } = normalizeOAuthParams({ provider, quality: rawQuality, imageToolModel: rawImageToolModel });
      // Multimode has no comfy dispatch in this unit. Without this guard the
      // request would reach generateViaResponses and bill OAuth for an image
      // the user asked ComfyUI to make — silently, with no error to trace.
      // Removed in wp7 when this surface gains a real comfy branch.
      if (getProviderSurfaceSupport(provider, "multimode")?.supported === false) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "COMFY_SURFACE_UNSUPPORTED";
        return respondMultimodeValidationError(res, requestId, asyncMode, 400, {
          error: "provider 'comfy' is not supported on this surface yet",
          code: "COMFY_SURFACE_UNSUPPORTED",
          status: 400,
          requestId,
        });
      }
      const providerOptions = resolveProviderOptions(ctx, {
        provider,
        rawModel,
        rawImageToolModel,
        rawReasoningEffort,
        rawSize: size,
        rawWebSearchEnabled,
      });
      if (providerOptions.error !== undefined) {
        finishStatus = "error";
        finishHttpStatus = providerOptions.status;
        finishErrorCode = providerOptions.code;
        return respondMultimodeValidationError(res, requestId, asyncMode, providerOptions.status, {
          error: providerOptions.error,
          code: providerOptions.code,
          status: providerOptions.status,
          requestId,
        });
      }
      const imageModel = providerOptions.model;
      const imageToolModel = providerOptions.imageToolModel;
      const reasoningEffort = providerOptions.reasoningEffort;
      const effectiveSize = providerOptions.size;
      const webSearchEnabled = providerOptions.webSearchEnabled;
      const activeProvider = providerOptions.provider;
      // --- Element injection ---
      const rawElementIds: string[] = Array.isArray(req.body?.elementIds)
       ? req.body.elementIds.filter((id: unknown) => typeof id === "string" && id)
      : [];
     const elementResult = rawElementIds.length > 0
        ? await resolveMultimodeElements(rawElementIds, references as string[], activeProvider as string, requestId as string)
        : { notesFragment: "", resolvedRefs: [] as string[], appliedIds: [] as string[] };
      const { notesFragment: elementNotesFragment, resolvedRefs: elementResolvedRefs, appliedIds: appliedElementIds } = elementResult;
      const mergedReferences = [...references, ...elementResolvedRefs];
      const generationPrompt = prompt + (elementNotesFragment ? `\n${elementNotesFragment}` : "");
      const moderationCheck = validateModeration(ctx, moderation);
      if (moderationCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "INVALID_MODERATION";
        return respondMultimodeValidationError(res, requestId, asyncMode, 400, {
          error: moderationCheck.error,
          code: finishErrorCode,
          status: 400,
          requestId,
        });
      }
      const refCheckResult = validateAndNormalizeRefs(mergedReferences);
      if (refCheckResult.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = refCheckResult.code;
        return respondMultimodeValidationError(res, requestId, asyncMode, 400, {
          error: refCheckResult.error,
          code: refCheckResult.code,
          status: 400,
          requestId,
        });
      }
      const refCheck = refCheckResult as Extract<typeof refCheckResult, { refs: string[] }>;
      const admission = checkImageExecutionAdmission(ctx, {
        provider: activeProvider, surface: "multimode", referenceCount: refCheck.refs.length,
      });
      if (admission) {
        finishStatus = "error";
        finishHttpStatus = admission.status;
        finishErrorCode = admission.code;
        return respondMultimodeValidationError(res, requestId, asyncMode, admission.status, {
          error: admission.message, code: admission.code, status: admission.status, requestId,
        });
      }
      const incomingProviderUrl = typeof req.body?.providerUrl === "string" && req.body.providerUrl.startsWith("http") ? req.body.providerUrl : null;
      const referencePayload = summarizeReferencePayload(mergedReferences);
      const started = startJob({
        requestId,
        kind: "multimode",
        prompt,
        meta: {
          kind: "multimode",
          quality,
          model: imageModel,
          ...(imageToolModel ? { imageToolModel } : {}),
          size: effectiveSize,
          maxImages,
          refsCount: referencePayload.refsCount,
          referenceBytes: referencePayload.referenceBytes,
          referenceB64Chars: referencePayload.referenceB64Chars,
          composerPrompt,
          composerInsertedPrompts,
        },
      });
      if (started && isStartJobFailure(started)) {
        finishStatus = "error";
        finishHttpStatus = started.code === "TOO_MANY_JOBS" ? 429 : 409;
        finishErrorCode = started.code;
        if (started.code === "TOO_MANY_JOBS") {
          res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
        }
        return respondMultimodeValidationError(res, requestId, asyncMode, finishHttpStatus, {
          error: started.code === "TOO_MANY_JOBS"
            ? "Too many concurrent generation jobs"
            : "Request ID already in use",
          code: started.code,
          status: finishHttpStatus,
          requestId,
        });
      }
      jobOwned = true;
      registerJobAbortController(requestId, cancelController);
      if (asyncMode) res.status(202).json({ requestId });
      logEvent("multimode", "request", { requestId, quality, model: imageModel, size: effectiveSize, moderation, maxImages, refs: refCheck.refs.length, referenceBytes: referencePayload.referenceBytes, promptChars: typeof prompt === "string" ? prompt.length : 0, webSearchEnabled, });
      const startTime = Date.now();
      const mimeMap: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
      const mmFormat = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" ? "jpeg" : String(format);
      const mime = mimeMap[mmFormat] || "image/png";
      const sequenceId = `seq_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
      routeMaxImages = maxImages;
      routeSequenceId = sequenceId;
      routeStartTime = startTime;
      routeActiveProvider = activeProvider ?? "auto";
      routeQuality = quality;
      routeEffectiveSize = effectiveSize;
      routeModeration = moderation;
      routeImageModel = imageModel ?? null;
      routeImageToolModel = imageToolModel;
      routeWebSearchEnabled = webSearchEnabled ?? false;
      routePromptMode = normalizedPromptMode;
      routeQualityWarnings = qualityWarnings;
      routeComposerPrompt = composerPrompt;
      routeComposerInsertedPrompts = composerInsertedPrompts;
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });
      const persistAndSendImage = async ( image: MultimodeImage, index: number, totalReturned: number, status: ReturnType<typeof sequenceStatus>, ) => {
        if (persistedIndexes.has(index)) return;
        throwIfJobCanceled(requestId);
        // nai is here but NOT in mmFormat above: forcing jpeg would flatten
        // V5's straight_alpha transparency.
        const resultMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai"
          ? (image.mime || detectImageMimeFromB64(image.b64) || mime)
          : mime;
        const resultFormat = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(resultMime) : mmFormat;
        const createdAt = Date.now();
        const baseName = buildFilename({
          model: (activeProvider === "grok" || activeProvider === "grok-api") ? resolveGrokQualityModel(imageModel, quality) : imageModel,
          size: effectiveSize,
          createdAt,
          prompt,
          ext: resultFormat,
          index,
        });
        const meta = {
          kind: "multimode-image",
          generationStrategy: "one-call-text-sequence",
          sequenceId,
          sequenceIndex: index + 1,
          sequenceTotalRequested: maxImages,
          sequenceTotalReturned: totalReturned,
          sequenceStatus: status,
          stageLabel: String.fromCharCode(65 + index),
          requestId,
          prompt,
          userPrompt: prompt,
          revisedPrompt: image.revisedPrompt || null,
          promptMode: normalizedPromptMode,
          composerPrompt,
          composerInsertedPrompts,
          ...composerNegativePromptMeta(activeProvider, req.body),
          quality,
          size: effectiveSize,
          format: resultFormat,
          moderation,
          model: activeProvider === "grok" ? resolveGrokQualityModel(imageModel, quality) : imageModel,
          ...(imageToolModel ? { imageToolModel } : {}),
          provider: activeProvider,
          createdAt,
          usage: latestUsage,
          webSearchCalls: latestWebSearchCalls,
          webSearchEnabled,
         refsCount: refCheck.refs.length,
          ...(image.providerUrl ? { providerUrl: image.providerUrl } : {}),
          ...(Array.isArray(req.body?.presetIds) && req.body.presetIds.length > 0 ? { presetIds: req.body.presetIds } : {}),
          ...(appliedElementIds.length > 0 ? { elementIds: appliedElementIds } : {}),
       };
        const rawBuffer = Buffer.from(image.b64, "base64");
        const embedded = await embedImageMetadataBestEffort(rawBuffer, resultFormat, meta, {
          version: ctx.packageVersion,
        });
        const filename = await writeFileUnique(ctx.config.storage.generatedDir, baseName, embedded.buffer);
        const mmFilePath = join(ctx.config.storage.generatedDir, filename);
        await safeWriteSidecar(mmFilePath + ".json", meta);
        generateImageThumbnailFromBuffer(embedded.buffer, mmFilePath).catch(() => {});
        invalidateHistoryIndex();
        const item = {
          image: `data:${resultMime};base64,${image.b64}`,
          filename,
          createdAt,
          ...(image.providerUrl ? { providerUrl: image.providerUrl } : {}),
          revisedPrompt: image.revisedPrompt || null,
          sequenceId,
          sequenceIndex: index + 1,
          sequenceTotalRequested: maxImages,
          sequenceTotalReturned: totalReturned,
          sequenceStatus: status,
        };
        persistedIndexes.add(index);
        images.push(item);
        dualEmitMultimode(res, requestId, "image", item);
      };
      dualEmitMultimode(res, requestId, "phase", { phase: "streaming", requestId, sequenceId, maxImages });
      const { value: generated } = await (await prepareImageExecution(ctx, {
        surface: "multimode", provider: activeProvider, requestId,
        signal: cancelController.signal, prompt: generationPrompt, rawPrompt: prompt,
        references: refCheck.refDetails, providerUrl: incomingProviderUrl, maxImages,
        options: { model: imageModel, imageToolModel, quality, size: effectiveSize, moderation,
          mode: normalizedPromptMode, reasoningEffort, webSearchEnabled },
        nai: activeProvider === "nai" ? readNaiOptions(req.body) : {},
      }, {
        onPartialImage: (partial) => {
            if (isJobCanceled(requestId)) return;
            const pd = { image: `data:${mime};base64,${partial.b64}`, requestId, sequenceId, index: partial.index };
            if (!res.writableEnded && !res.destroyed) writeSse(res, "partial", pd);
            publish(requestId, "partial", pd);
          },
        onFinalImage: async (image, index) => {
          const totalReturned = images.length + 1;
          await persistAndSendImage(image, index, totalReturned, sequenceStatus(totalReturned, maxImages));
        },
      })).execute();
      throwIfJobCanceled(requestId);
      latestUsage = generated.usage || null;
      latestWebSearchCalls = generated.webSearchCalls || 0;
      latestExtraIgnored = generated.extraIgnored || 0;
      for (const [position, image] of generated.images.entries()) {
        const index = generated.originalIndexes?.[position] ?? position;
        await persistAndSendImage(
          image,
          index,
          generated.images.length,
          sequenceStatus(generated.images.length, maxImages),
        );
      }
      const returned = images.length;
      const status = sequenceStatus(returned, maxImages);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (returned === 0) {
        const representative = errInfo(generated.error);
        finishStatus = "error";
        finishHttpStatus = 422;
        finishErrorCode = representative.code || "EMPTY_RESPONSE";
        finishMeta = { sequenceId, filenames: [], imageCount: 0, maxImages, status, composerPrompt: routeComposerPrompt, composerInsertedPrompts: routeComposerInsertedPrompts };
        dualEmitMultimode(res, requestId, "error", { error: "No image data returned from the multimode stream", code: finishErrorCode, status: finishHttpStatus, requestId, sequenceId, requested: maxImages, returned, ...errorEnvelopeFields(generated.error) });
        logEvent("multimode", "empty_response", { requestId, sequenceId, maxImages, elapsedMs: Date.now() - startTime });
        return;
      }
      finishMeta = {
        sequenceId,
        filenames: images.map((image) => image.filename),
        imageCount: returned,
        maxImages,
        status,
        composerPrompt: routeComposerPrompt,
        composerInsertedPrompts: routeComposerInsertedPrompts,
      };
      finishHttpStatus = 200;
      dualEmitMultimode(res, requestId, "done", {
        ok: true,
        requestId,
        sequenceId,
        requested: maxImages,
        returned,
        status,
        elapsed,
        images,
        provider: activeProvider,
        quality,
        size: effectiveSize,
        moderation,
        model: imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        usage: latestUsage,
        webSearchCalls: latestWebSearchCalls,
        webSearchEnabled,
        warnings: qualityWarnings,
        extraIgnored: latestExtraIgnored,
        promptMode: normalizedPromptMode,
      });
      logEvent("multimode", "saved", { requestId, sequenceId, imageCount: returned, maxImages, status, elapsedMs: Date.now() - startTime, });
    } catch (e) {
      const err = errInfo(e);
      const ext = (err.raw && typeof err.raw === "object" ? err.raw as Record<string, unknown> : {});
      const fallbackCode = err.code || classifyUpstreamError(err.message);
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        finishHttpStatus = canceled.status;
        finishErrorCode = canceled.code;
        dualEmitMultimode(res, requestId, "error", { error: canceled.message, code: canceled.code, status: canceled.status, requestId, });
        return;
      }
      if ((fallbackCode === "RESPONSES_IMAGE_TIMEOUT" || err.status === 504) && images.length > 0) {
        const status = sequenceStatus(images.length, routeMaxImages);
        const elapsed = ((Date.now() - routeStartTime) / 1000).toFixed(1);
        finishStatus = "completed";
        finishHttpStatus = 206;
        finishMeta = {
          sequenceId: routeSequenceId,
          filenames: images.map((image) => image.filename),
          imageCount: images.length,
          maxImages: routeMaxImages,
          status,
          partialErrorCode: "RESPONSES_IMAGE_TIMEOUT",
          composerPrompt: routeComposerPrompt,
          composerInsertedPrompts: routeComposerInsertedPrompts,
        };
        dualEmitMultimode(res, requestId, "done", {
          ok: true,
          partial: true,
          requestId,
          sequenceId: routeSequenceId,
          requested: routeMaxImages,
          returned: images.length,
          status,
          elapsed,
          images,
          provider: routeActiveProvider,
          quality: routeQuality,
          size: routeEffectiveSize,
          moderation: routeModeration,
          model: routeImageModel,
          ...(routeImageToolModel ? { imageToolModel: routeImageToolModel } : {}),
          usage: latestUsage,
          webSearchCalls: latestWebSearchCalls,
          webSearchEnabled: routeWebSearchEnabled,
          warnings: routeQualityWarnings,
          extraIgnored: latestExtraIgnored,
          promptMode: routePromptMode,
          warning: {
            code: "RESPONSES_IMAGE_TIMEOUT",
            message: "The provider timed out after returning partial multimode results.",
          },
        });
        logEvent("multimode", "partial_timeout", { requestId, sequenceId: routeSequenceId, imageCount: images.length, maxImages: routeMaxImages, });
        return;
      }
      finishStatus = "error";
      finishHttpStatus = err.status || 500;
      finishErrorCode = fallbackCode || "MULTIMODE_GENERATE_FAILED";
      logError("multimode", "error", err.raw, { requestId, code: finishErrorCode });
      dualEmitMultimode(res, requestId, "error", { error: err.message, code: finishErrorCode, status: finishHttpStatus, requestId, ...upstreamLabelFields(ext), ...errorEnvelopeFields(err.raw) });
    } finally {
      if (jobOwned) finishJob(requestId, {
        canceled: finishCanceled,
        status: finishStatus,
        httpStatus: finishHttpStatus,
        errorCode: finishErrorCode,
        meta: finishMeta,
      });
      if (!res.writableEnded) res.end();
    }
}
