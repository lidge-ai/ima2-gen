import { mkdir, readFile } from "fs/promises";
import { safeWriteSidecar, atomicWriteJson } from "./atomicWrite.js";
import { isAbsolute, join } from "path";
import { randomBytes } from "crypto";
import { buildFilename, writeFileUnique } from "./filename.js";
import type { Request, Response } from "express";
import { detectImageMimeFromB64, summarizeReferencePayload, validateAndNormalizeRefs } from "./refs.js";
import { generateImageThumbnailFromBuffer } from "./imageThumb.js";
import { classifyUpstreamError } from "./errorClassify.js";
import { appendGenerationRequestLog } from "./generationRequestLog.js";
import { normalizeOAuthParams } from "./oauthNormalize.js";
import { resolveProviderOptions } from "./providerOptions.js";
import { prepareImageExecution } from "./providers/execution/index.js";
import { checkImageExecutionAdmission } from "./providers/execution/admission.js";
import { resolveGrokQualityModel } from "./imageModels.js";
import { composerNegativePromptMeta, readNaiOptions } from "./naiOptions.js";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, isStartJobFailure, setJobPhase, INFLIGHT_RETRY_AFTER_SECONDS, } from "./inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError, throwIfJobCanceled, } from "./generationCancel.js";
import { logEvent, logError } from "./logger.js";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import { normalizeComposerInsertedPrompts, normalizeComposerPrompt, } from "./composerSnapshot.js";
import { errInfo } from "./errInfo.js";
import { type RuntimeContext } from "./runtimeContext.js";
import { STORYBOARD_PREFIX } from "./storyboardPrefix.js";
import { parseBackgroundPreset, backgroundPromptSuffix, backgroundPlannerConstraint } from "./backgroundPresets.js";
import { sizeNudgeSuffix } from "./sizeNudge.js";
import { resolveImageBackgroundParams, validateTransparentFormat, validateTransparentProvider, verifyBufferAlpha, makeTransparentResultError } from "./imageBackgroundParam.js";
import { decodeRawForAlpha } from "./alphaDecode.js";
import { validateModeration, imageFormatFromMime, upstreamErrorFields } from "./routeHelpers.js";
import { publish } from "./eventBus.js";
import { publishJobEvent } from "./ssePublish.js";
import { normalizeBodyRequestId, validateBoundedCount, validateGenerationPrompt } from "./generationInputValidation.js";
import { getElementById } from "./assetsStore.js";
import { compileElements, ELEMENT_CAPACITY_DEFAULTS, type ElementDefinition, type ExistingReferenceInput } from "./elementCompiler.js";
import { deriveReferenceLimit, getProviderSurfaceSupport } from "./providers/derive.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  fingerprintRequest,
  IdempotencyFingerprintConflict,
  IdempotencyKeyInvalid,
  readIdempotencyKey,
} from "./jobs/idempotency.js";
export async function runGeneratePipeline(req: Request, res: Response, ctx: RuntimeContext) {
    const requestId = normalizeBodyRequestId(req.body?.requestId, req.id);
    const asyncMode = req.body?.async === true;
    let idempotencyKey: string | null = null;
    let finishStatus = "completed";
    let finishHttpStatus: number | undefined;
    let finishErrorCode: string | undefined;
    let finishErrorMessage: string | undefined;
    let finishMeta: Record<string, unknown> = {};
    let finishCanceled = false;
    let jobOwned = false;
    const cancelController = new AbortController();
    const fail = (status: number, payload: Record<string, unknown>) => {
      finishStatus = "error";
      finishHttpStatus = status;
      finishErrorCode = typeof payload.code === "string" ? payload.code : finishErrorCode;
      // The human-readable reason for the request log (260819): producers put
      // it in payload.error, MCP-shaped payloads in payload.message.
      finishErrorMessage = typeof payload.error === "string" ? payload.error
        : typeof payload.message === "string" ? payload.message
        : finishErrorMessage;
      // Recorded here rather than from an event subscriber: synchronous
      // generation is the default and never publishes a terminal event.
      completeIdempotencyKey(idempotencyKey, "error", { ...payload, status });
      if (asyncMode && res.headersSent) {
        // #151 stage 2: terminal failure carries the canonical envelope.
        publishJobEvent(requestId, "error", { ...payload, status, requestId });
        return;
      }
      return res.status(status).json(payload);
    };
    const succeed = (payload: Record<string, unknown>) => {
      completeIdempotencyKey(idempotencyKey, "completed", payload);
      if (asyncMode) {
        publishJobEvent(requestId, "done", payload);
        return;
      }
      res.json(payload);
    };
    try {
      // Idempotency is resolved before any validation or provider work, so a
      // replay costs nothing and cannot start a second paid generation.
      try {
        idempotencyKey = readIdempotencyKey(req.get("idempotency-key"), req.body?.idempotencyKey);
      } catch (keyError: unknown) {
        const message = keyError instanceof Error ? keyError.message : "invalid Idempotency-Key";
        return res.status(400).json({ error: message, code: "IDEMPOTENCY_KEY_INVALID", requestId });
      }
      if (idempotencyKey) {
        const fingerprint = fingerprintRequest(req.body);
        let claim;
        try {
          claim = claimIdempotencyKey(idempotencyKey, requestId, "classic", fingerprint);
        } catch (claimError: unknown) {
          if (claimError instanceof IdempotencyFingerprintConflict) {
            return res.status(409).json({
              error: claimError.message,
              code: "IDEMPOTENCY_KEY_CONFLICT",
              requestId,
            });
          }
          if (claimError instanceof IdempotencyKeyInvalid) {
            return res.status(400).json({ error: claimError.message, code: "IDEMPOTENCY_KEY_INVALID", requestId });
          }
          throw claimError;
        }
        if (claim.outcome === "duplicate") {
          const { record } = claim;
          // Finished: hand back the stored outcome. Still running: point the
          // caller at the request that owns it, so it can follow that job's
          // events instead of starting a rival one.
          if (record.terminalPayload) {
            const status = record.terminalStatus === "error"
              ? Number(record.terminalPayload.status) || 500
              : 200;
            return res.status(status).json({ ...record.terminalPayload, idempotentReplay: true });
          }
          return res.status(202).json({ requestId: record.requestId, async: true, idempotentReplay: true });
        }
      }
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const clientNodeId = typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;
      const {
        prompt,
        quality: rawQuality = "medium",
        size = "1024x1024",
        format = "png",
        moderation = "low",
        provider = "auto",
        n = 1,
        references = [],
        mode: promptMode = "auto",
        model: rawModel,
        imageToolModel: rawImageToolModel,
        reasoningEffort: rawReasoningEffort,
        webSearchEnabled: rawWebSearchEnabled = true,
      } = req.body;
      const promptError = validateGenerationPrompt(prompt);
      if (promptError) return fail(400, promptError);

      const maxGeneratedImages = Math.max(
        1,
        Math.trunc(Number(ctx.config.limits.maxGeneratedImages) || 1),
      );
      const countResult = validateBoundedCount(n, 1, maxGeneratedImages, "n");
      if ("error" in countResult) return fail(400, countResult);
      const count = countResult.value;
      const storyboardActive = req.body?.storyboard === true;
      const storyboardPrefix = storyboardActive ? STORYBOARD_PREFIX : "";
      const backgroundParse = parseBackgroundPreset(req.body?.backgroundPreset);
      if ("error" in backgroundParse) {
        return fail(400, { error: backgroundParse.error, code: backgroundParse.code });
      }
      const backgroundPreset = backgroundParse.preset;
      // `format` is the canonical request field (default "png"). Validating
      // req.body.outputFormat instead would let format:"jpeg" slip past and
      // then get transcoded to JPEG on save, destroying the alpha channel.
      const formatConflict = validateTransparentFormat(backgroundPreset, format);
      if (formatConflict) {
        return fail(400, { error: formatConflict.error, code: formatConflict.code });
      }
      // Atlas Cloud talks to the gpt-image-2 API directly and accepts the
      // forced value; the OAuth proxy does not (see lib/imageBackgroundParam.ts).
      const composerPrompt = normalizeComposerPrompt(req.body?.composerPrompt);
      const composerInsertedPrompts = normalizeComposerInsertedPrompts(
        req.body?.composerInsertedPrompts,
      );
      const { quality, warnings: qualityWarnings } = normalizeOAuthParams({ provider, quality: rawQuality, imageToolModel: rawImageToolModel });
      const providerOptions = resolveProviderOptions(ctx, {
        provider,
        rawModel,
        rawImageToolModel,
        rawReasoningEffort,
        rawSize: size,
        rawWebSearchEnabled,
      });
      if (providerOptions.error !== undefined) {
        return fail(providerOptions.status, { error: providerOptions.error, code: providerOptions.code });
      }
      const imageModel = providerOptions.model;
      const imageToolModel = providerOptions.imageToolModel;
      const reasoningEffort = providerOptions.reasoningEffort;
      const effectiveSize = providerOptions.size;
      const webSearchEnabled = providerOptions.webSearchEnabled;
      const activeProvider = providerOptions.provider;
      // Resolved AFTER provider resolution on purpose: the raw request `provider`
      // defaults to "auto", so only `activeProvider` names the lane that will
      // actually run. Atlas Cloud talks to the gpt-image-2 API directly and
      // accepts a forced transparent background; the OAuth proxy rejects it
      // (see lib/imageBackgroundParam.ts).
      const backgroundParams = resolveImageBackgroundParams({
        preset: backgroundPreset,
        supportsForcedTransparent: activeProvider === "atlascloud",
        requestedFormat: typeof format === "string" ? format : undefined,
      });
      // Grok/Gemini/Agy/MiniMax have no background parameter and their branches
      // force JPEG, so a transparent request there would return an opaque image
      // recorded as a cutout. Refuse instead of billing for a wrong result.
      const providerConflict = validateTransparentProvider(backgroundPreset, activeProvider);
      if (providerConflict) {
        return fail(400, { error: providerConflict.error, code: providerConflict.code });
      }

      // --- Element injection (after provider resolution) ---
      const rawElementIds: string[] = Array.isArray(req.body?.elementIds)
        ? req.body.elementIds.filter((id: unknown) => typeof id === "string" && id)
        : [];
      let elementNotesFragment = "";
      const elementResolvedRefs: string[] = [];
      let appliedElementIds: string[] = [];
      let elementDroppedRefs: Array<{ path: string; reason: string; elementId?: string }> = [];
      let elementRefReadFailures: Array<{ path: string; elementId?: string }> = [];
      if (rawElementIds.length > 0) {
        try {
          const elementMap = new Map<string, ElementDefinition>();
          for (const eid of rawElementIds) {
            const record = getElementById(eid);
            if (record?.metadata) {
              const meta = typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata;
              elementMap.set(eid, {
                id: eid,
                name: meta.name ?? record.name,
                kind: meta.elementKind ?? "character",
                refs: Array.isArray(meta.refs) ? meta.refs : [],
                notes: meta.notes,
                defaultStrength: meta.defaultStrength,
                createdAt: record.createdAt ?? 0,
                updatedAt: record.updatedAt ?? 0,
              });
            }
          }
          const providerKey = (activeProvider === "grok" || activeProvider === "grok-api") ? "grok"
            : activeProvider === "gemini-api" ? "gemini"
            : activeProvider === "agy" ? "gpt" : "gpt";
          const modeKey = "image" as const;
          const capacity = ELEMENT_CAPACITY_DEFAULTS[providerKey]?.[modeKey] ?? { maxTotalRefs: 6, maxRefsPerElement: 6 };
          const compiled = compileElements({
            elementIds: rawElementIds,
            elements: elementMap,
            existingRefs: references.map((r: string): ExistingReferenceInput => ({ source: "composer", path: r })),
            provider: providerKey,
            mode: modeKey,
            capacity,
            missingPolicy: "collect",
          });
          elementNotesFragment = compiled.notesFragment;
          appliedElementIds = compiled.elementIds;
          elementDroppedRefs = compiled.droppedRefs;
          elementRefReadFailures = [];
          for (const slot of compiled.referenceSlots) {
            try {
              // Element refs are generated-dir-relative filenames; only
              // absolute paths bypass the join (070 QA: cwd-relative resolve
              // in the compiler silently dropped every ref).
              const refPath = isAbsolute(slot.path) ? slot.path : join(ctx.config.storage.generatedDir, slot.path);
              const buf = await readFile(refPath);
              const mime = slot.path.endsWith(".png") ? "image/png" : "image/jpeg";
              elementResolvedRefs.push(`data:${mime};base64,${buf.toString("base64")}`);
            } catch {
              elementRefReadFailures.push({ path: slot.path, elementId: slot.elementId });
              logEvent("generate", "element_ref_read_failed", { requestId, path: slot.path, elementId: slot.elementId });
            }
          }
        } catch (e) {
          logEvent("generate", "element_compile_failed", { requestId, error: errInfo(e) });
        }
      }
      const mergedReferences = [...references, ...elementResolvedRefs];

      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";
      const elementSuffix = elementNotesFragment ? `\n${elementNotesFragment}` : "";
      // Restating the size in the prompt measurably improves the odds on lanes
      // that treat `size` as a hint (#173). Opt out with sizeNudge: false when
      // the extra sentence would fight the prompt.
      const sizeNudge = req.body?.sizeNudge === false ? null : sizeNudgeSuffix(req.body?.size);
      const generationPrompt = storyboardPrefix + prompt + elementSuffix
        + (backgroundPreset ? ` ${backgroundPromptSuffix(backgroundPreset, "image")}` : "")
        + (sizeNudge ? ` ${sizeNudge}` : "");
      const moderationCheck = validateModeration(ctx, moderation);
      if (moderationCheck.error) return fail(400, { error: moderationCheck.error });
      const referencePayload = summarizeReferencePayload(mergedReferences as string[]);
      const refCheckResult = validateAndNormalizeRefs(mergedReferences as string[]);
      if (refCheckResult.error) {
        return fail(400, { error: refCheckResult.error, code: refCheckResult.code });
      }
      const refCheck = refCheckResult as Extract<typeof refCheckResult, { refs: string[] }>;
      const incomingProviderUrl = typeof req.body?.providerUrl === "string" && req.body.providerUrl.startsWith("http")
        ? req.body.providerUrl
        : null;
      const providerRefCount = activeProvider === "grok" || activeProvider === "grok-api"
        ? refCheck.refs.length + (incomingProviderUrl ? 1 : 0)
        : refCheck.refs.length;
      const providerReferenceLimit = deriveReferenceLimit(activeProvider, "edit");
      if ((activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api") && providerRefCount > providerReferenceLimit!) {
        return fail(400, {
          error: `${activeProvider === "agy" ? "Agy" : "Grok"} image editing supports up to ${providerReferenceLimit} reference images`,
          code: activeProvider === "agy" ? "AGY_REF_TOO_MANY" : "GROK_REF_TOO_MANY",
          requestId,
        });
      }
      if (activeProvider === "atlascloud" && providerRefCount > providerReferenceLimit!) {
        return fail(400, {
          error: `Atlas Cloud image editing supports up to ${providerReferenceLimit} reference images`,
          code: "ATLASCLOUD_REF_TOO_MANY",
          requestId,
        });
      }
      if (activeProvider === "minimax" && providerRefCount > providerReferenceLimit!) {
        return fail(400, {
          error: `MiniMax image editing supports up to ${providerReferenceLimit} subject reference`,
          code: "MINIMAX_REF_TOO_MANY",
          requestId,
        });
      }
      // Refuse loudly rather than dropping the input: lib/naiImageAdapter.ts is
      // text-to-image only, so a reference passed here would be ignored and the
      // user would get an unrelated image back believing they had edited one.
      if (getProviderSurfaceSupport(activeProvider ?? "", "generate")?.references === false && providerRefCount > 0) {
        return fail(400, {
          error: "NovelAI image generation does not accept reference images yet",
          code: "NAI_REF_UNSUPPORTED",
          requestId,
        });
      }
      const admission = checkImageExecutionAdmission(ctx, {
        provider: activeProvider, surface: "classic", referenceCount: providerRefCount,
      });
      if (admission) {
        return fail(admission.status, { error: admission.message, code: admission.code, requestId });
      }
      const started = startJob({
        requestId,
        kind: "classic",
        prompt,
        meta: {
          kind: "classic",
          sessionId,
          parentNodeId: null,
          clientNodeId,
          quality,
          model: imageModel,
          ...(imageToolModel ? { imageToolModel } : {}),
          size: effectiveSize,
          n: count,
          refsCount: providerRefCount,
          referenceBytes: referencePayload.referenceBytes,
          referenceB64Chars: referencePayload.referenceB64Chars,
          composerPrompt,
          composerInsertedPrompts,
        },
      });
      if (started && isStartJobFailure(started)) {
        const status = started.code === "TOO_MANY_JOBS" ? 429 : 409;
        if (started.code === "TOO_MANY_JOBS") {
          res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
        }
        return fail(status, {
          error: started.code === "TOO_MANY_JOBS"
            ? "Too many concurrent generation jobs"
            : "Request ID already in use",
          code: started.code,
          requestId,
        });
      }
      jobOwned = true;
      registerJobAbortController(requestId, cancelController);
      if (asyncMode) {
        res.status(202).json({ requestId, async: true });
      }
      setJobPhase(requestId, "streaming");
      if (asyncMode) publish(requestId, "phase", { requestId, phase: "streaming" });
      const client = req.get("x-ima2-client") || "ui";
      const referenceDiagnostics = refCheck.referenceDiagnostics || [];
      const referenceMismatchCount = referenceDiagnostics.filter((ref) => ref.warnings?.includes("mime_mismatch")).length;
      logEvent("generate", "request", {
        requestId,
        client,
        provider: activeProvider,
        quality,
        model: imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        size: effectiveSize,
        moderation,
        n: count,
        refs: providerRefCount,
        referenceBytes: referencePayload.referenceBytes,
        referenceMismatchCount,
        refDetectedMimes: [...new Set(referenceDiagnostics.map((ref) => ref.detectedMime).filter(Boolean))].join(","),
        refDeclaredMimes: [...new Set(referenceDiagnostics.map((ref) => ref.declaredMime).filter(Boolean))].join(","),
        sessionId,
        clientNodeId,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        promptMode: normalizedPromptMode,
        webSearchEnabled,
      });
      const startTime = Date.now();
      const mimeMap: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
      const providerForcesJpeg = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax";
      // An alpha-bearing result must never be persisted through a lossy opaque
      // format: embedImageMetadata re-encodes with sharp.toFormat(), so a JPEG
      // here silently flattens the transparency we just asked for.
      const effectiveFormat = backgroundParams
        ? (backgroundParams.outputFormat ?? "png")
        : (providerForcesJpeg ? "jpeg" : String(format));
      const mime = mimeMap[effectiveFormat] || "image/png";
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });
      const execution = await prepareImageExecution(ctx, {
        surface: "classic", provider: activeProvider, requestId,
        signal: cancelController.signal, prompt: generationPrompt, rawPrompt: prompt,
        references: refCheck.refDetails, providerUrl: incomingProviderUrl,
        options: { model: imageModel, imageToolModel, quality, size: effectiveSize, moderation,
          mode: normalizedPromptMode, reasoningEffort, webSearchEnabled },
        background: backgroundParams,
        backgroundConstraint: backgroundPreset ? backgroundPlannerConstraint(backgroundPreset) : undefined,
        nai: activeProvider === "nai" ? readNaiOptions(req.body) : {},
        comfy: {
          ...(typeof req.body?.seed === "number" ? { seed: req.body.seed } : {}),
          ...(req.body?.comfyParams && typeof req.body.comfyParams === "object"
            ? { params: req.body.comfyParams as Record<string, number | string | boolean> }
            : {}),
        },
      }, {
        onQueue: (info) => {
          const phase = info.running ? "streaming" : "queued";
          setJobPhase(requestId, phase);
          if (asyncMode) {
            publish(requestId, "phase", { requestId, phase, queuePosition: info.position });
          }
        },
      });
      const generateOne = async () => {
        const { value } = await execution.execute();
        throwIfJobCanceled(requestId);
        return value;
      };
      const results = await Promise.allSettled(Array.from({ length: count }, generateOne));
      throwIfJobCanceled(requestId);
      // Alpha is verified for EVERY result before anything is written. Doing it
      // inside the write loop would let an earlier image land on disk before a
      // later opaque one failed the batch, so the error would claim "nothing was
      // saved" while an orphan file existed (adversarial review 260821 round 4).
      if (backgroundParams) {
        for (const r of results) {
          if (r.status !== "fulfilled" || !r.value.b64) continue;
          const verdict = await verifyBufferAlpha(Buffer.from(r.value.b64, "base64"), decodeRawForAlpha);
          if (verdict.hasAlpha === false) {
            const { reason } = verdict;
            logEvent("generate", "transparent_result_opaque", { requestId, provider: activeProvider, reason });
            throw makeTransparentResultError(activeProvider, reason);
          }
        }
      }
      const images: Array<{
        image: string;
        filename: string;
        revisedPrompt: string | null;
        providerUrl?: string | undefined;
        createdAt: number;
      }> = [];
      let totalUsage: Record<string, number> | null = null;
      let totalWebSearchCalls = 0;
      let firstRetryMeta: Record<string, unknown> | null = null;
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.b64) {
          throwIfJobCanceled(requestId);
          const valueWithMime = r.value as typeof r.value & { mime?: string };
          // When alpha was requested, trust the BYTES, never a provider-supplied
          // Content-Type. Atlas reads its mime from the download response header
          // (lib/atlasCloudImageAdapter.ts), and a transparent PNG mislabeled
          // "image/jpeg" would otherwise be re-encoded to JPEG by
          // embedImageMetadata's sharp.toFormat() and lose its alpha channel.
          // Comfy is in this list but deliberately NOT in providerForcesJpeg: a
          // workflow may end in a background-removal node, and forcing JPEG
          // would flatten the alpha it just produced.
          // nai is here and deliberately NOT in providerForcesJpeg above: V5's
          // straight_alpha returns a real RGBA PNG (measured 42.1% transparent
          // pixels), and forcing jpeg would flatten it during the toFormat()
          // re-encode in embedImageMetadata.
          const providerReportsMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" || activeProvider === "comfy";
          // Lazily decoded: only alpha requests always need the byte check, and
          // the provider-mime path keeps its original short-circuit order.
          const detectMime = () => detectImageMimeFromB64(r.value.b64);
          const resultMime = backgroundParams
            ? (detectMime() || mime)
            : providerReportsMime
              ? (valueWithMime.mime || detectMime() || mime)
              : mime;
          const resultFormat = backgroundParams
            ? imageFormatFromMime(resultMime)
            : providerReportsMime
              ? imageFormatFromMime(resultMime)
              : effectiveFormat;
          const retryValue = r.value as typeof r.value & {
            retryKind?: string | undefined;
            initialEventCount?: number | undefined;
            initialEventTypes?: unknown | undefined;
            hadReferences?: boolean | undefined;
            referencesDroppedOnRetry?: boolean | undefined;
            developerPromptDroppedOnRetry?: boolean | undefined;
            webSearchDroppedOnRetry?: boolean | undefined;
          };
          if (!firstRetryMeta && retryValue.retryKind) {
            firstRetryMeta = {
              retryKind: retryValue.retryKind,
              initialEventCount: retryValue.initialEventCount ?? null,
              initialEventTypes: retryValue.initialEventTypes || null,
              hadReferences: retryValue.hadReferences ?? null,
              referencesDroppedOnRetry: retryValue.referencesDroppedOnRetry ?? null,
              developerPromptDroppedOnRetry: retryValue.developerPromptDroppedOnRetry ?? null,
              webSearchDroppedOnRetry: retryValue.webSearchDroppedOnRetry ?? null,
            };
          }
          const createdAt = Date.now();
          const baseName = buildFilename({
            model: (activeProvider === "grok" || activeProvider === "grok-api") ? resolveGrokQualityModel(imageModel, quality) : imageModel,
            size: effectiveSize,
            createdAt,
            prompt,
            ext: resultFormat,
            index: images.length,
          });
          const valueWithProviderUrl = r.value as typeof r.value & { providerUrl?: unknown };
          const providerUrl = typeof valueWithProviderUrl.providerUrl === "string"
            ? valueWithProviderUrl.providerUrl
            : undefined;
          // Read through one widened view, the way providerUrl above is: the
          // adapters return a union and only the comfy arm carries these.
          const comfyValue = r.value as typeof r.value & {
            promptId?: unknown;
            origin?: unknown;
            effectiveModel?: unknown;
          };
          const comfyMeta = activeProvider === "comfy" && typeof comfyValue.promptId === "string"
            ? {
              comfyPromptId: comfyValue.promptId,
              comfyOrigin: typeof comfyValue.origin === "string" ? comfyValue.origin : undefined,
              comfyWorkflow: typeof comfyValue.effectiveModel === "string" ? comfyValue.effectiveModel : undefined,
            }
            : {};
          const meta = {
            kind: "classic",
            requestId,
            sessionId,
            clientNodeId,
            prompt,
            userPrompt: prompt,
            revisedPrompt: r.value.revisedPrompt || null,
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
            reasoningEffort,
            provider: activeProvider,
            createdAt,
            ...(providerUrl ? { providerUrl } : {}),
            usage: r.value.usage || null,
            webSearchCalls: r.value.webSearchCalls || 0,
            webSearchEnabled,
           refsCount: providerRefCount,
           ...(backgroundPreset ? { backgroundPreset } : {}),
            // Paired on purpose: a ComfyUI prompt_id is instance-local, so
            // asking a second instance about an id from the first returns
            // "not found" and reads as a job that vanished.
            ...comfyMeta,
            ...(Array.isArray(req.body?.presetIds) && req.body.presetIds.length > 0 ? { presetIds: req.body.presetIds } : {}),
            ...(appliedElementIds.length > 0 ? { elementIds: appliedElementIds } : {}),
            ...(elementDroppedRefs.length > 0 ? { droppedRefs: elementDroppedRefs } : {}),
            ...(elementRefReadFailures.length > 0 ? { refReadFailures: elementRefReadFailures } : {}),
          };
          const rawBuffer = Buffer.from(r.value.b64, "base64");
          const embedded = await embedImageMetadataBestEffort(rawBuffer, resultFormat, meta, {
            version: ctx.packageVersion,
          });
          if (!embedded.embedded) {
            logEvent("generate", "metadata_embed_skipped", { requestId, filename: baseName, code: embedded.code, warning: embedded.warning, });
          }
          const filename = await writeFileUnique(ctx.config.storage.generatedDir, baseName, embedded.buffer);
          const filePath = join(ctx.config.storage.generatedDir, filename);
          await safeWriteSidecar(filePath + ".json", meta);
          generateImageThumbnailFromBuffer(embedded.buffer, filePath).catch(() => {});
          invalidateHistoryIndex();
          images.push({
            image: `data:${resultMime};base64,${r.value.b64}`,
            filename,
            revisedPrompt: r.value.revisedPrompt || null,
            ...(providerUrl ? { providerUrl } : {}),
            createdAt,
          });
          if (r.value.usage) {
            const usageValue = r.value.usage;
            if (!totalUsage) totalUsage = { ...usageValue };
            else {
              const tu = totalUsage;
              Object.keys(usageValue).forEach((k) => {
                if (typeof usageValue[k] === "number") tu[k] = (tu[k] || 0) + usageValue[k];
              });
            }
          }
          if (typeof r.value.webSearchCalls === "number") {
            totalWebSearchCalls = activeProvider === "grok" || activeProvider === "grok-api"
              ? Math.max(totalWebSearchCalls, r.value.webSearchCalls)
              : totalWebSearchCalls + r.value.webSearchCalls;
          }
        } else if (r.status === "rejected") {
          logError("generate", "parallel_failed", r.reason, { requestId });
        }
      }
      if (images.length === 0) {
        const firstErr = results.find((r) => r.status === "rejected")?.reason;
        if (firstErr?.code) {
          const status = firstErr.status || 500;
          if (isGenerationCanceledError(firstErr)) {
            finishCanceled = true;
            return fail(firstErr.status, {
              error: firstErr.message,
              code: firstErr.code,
              requestId,
            });
          }
          return fail(status, {
            error: firstErr.message,
            code: firstErr.code,
            ...upstreamErrorFields(firstErr),
            requestId,
          });
        }
        return fail(500, { error: "All generation attempts failed", code: "GENERATE_ALL_FAILED", requestId });
      }
      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      // Patch elapsed into sidecars after the generation loop (best effort).
      await Promise.all(
        images.map(async ({ filename }) => {
          try {
            const sidecarPath = join(ctx.config.storage.generatedDir, filename + ".json");
            const sidecarMeta = JSON.parse(await readFile(sidecarPath, "utf-8"));
            sidecarMeta.elapsed = elapsed;
            await atomicWriteJson(sidecarPath, sidecarMeta);
          } catch {
            /* best-effort elapsed patch */
          }
        }),
      );
      const firstRevised = images[0]?.revisedPrompt || null;
      const extra = {
        usage: totalUsage,
        provider: activeProvider,
        reasoningEffort,
        webSearchCalls: totalWebSearchCalls,
        quality,
        size: effectiveSize,
        moderation,
        model: imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        warnings: qualityWarnings,
        revisedPrompt: firstRevised,
        promptMode: normalizedPromptMode,
        webSearchEnabled,
        ...(firstRetryMeta || {}),
      };
      const firstImage = images[0];
      if (count === 1 && firstImage) {
        finishHttpStatus = 200;
        finishMeta = { filenames: [firstImage.filename], imageCount: 1 };
        logEvent("generate", "saved", { requestId, imageCount: 1, elapsedMs: Date.now() - startTime, filename: firstImage.filename, });
        succeed({
          image: firstImage.image,
          elapsed,
          filename: firstImage.filename,
          requestId,
          providerUrl: firstImage.providerUrl ?? null,
          createdAt: firstImage.createdAt,
          ...extra,
        });
      } else {
        finishHttpStatus = 200;
        finishMeta = { filenames: images.map((image) => image.filename), imageCount: images.length };
        logEvent("generate", "saved", { requestId, imageCount: images.length, elapsedMs: Date.now() - startTime, });
        succeed({ images, elapsed, count: images.length, requestId, ...extra });
      }
    } catch (e) {
      const err = errInfo(e);
      const ext = (err.raw && typeof err.raw === "object" ? err.raw as Record<string, unknown> : {});
      const fallbackCode = err.code || classifyUpstreamError(err.message);
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        return fail(canceled.status, {
          error: canceled.message,
          code: canceled.code,
          requestId,
        });
      }
      finishErrorCode = fallbackCode || "GENERATE_FAILED";
      logError("generate", "error", err.raw, { requestId, code: finishErrorCode });
      fail(err.status || 500, {
        error: err.message,
        code: finishErrorCode,
        ...upstreamErrorFields(ext),
        requestId,
      });
    } finally {
      if (jobOwned) finishJob(requestId, {
        canceled: finishCanceled,
        status: finishStatus,
        httpStatus: finishHttpStatus,
        errorCode: finishErrorCode,
        meta: finishMeta,
      });
      appendGenerationRequestLog(ctx.config.storage.generationRequestLogFile, {
        id: randomBytes(8).toString("hex"),
        requestId,
        createdAt: Date.now(),
        prompt: typeof req.body?.prompt === "string" ? req.body.prompt : "",
        requested: parseInt(req.body?.n) || 1,
        succeeded: finishStatus === "completed" ? ((finishMeta.imageCount as number) ?? 1) : 0,
        error: finishStatus === "error" ? (finishErrorCode ?? "unknown") : null,
        errorMessage: finishStatus === "error" ? (finishErrorMessage ?? null) : null,
      }).catch(() => {});
    }
}
