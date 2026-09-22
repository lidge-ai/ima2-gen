import type { Request, Response } from "express";
import { mkdir } from "fs/promises";
import { newNodeId, saveNode, loadAssetB64, } from "./nodeStore.js";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, isStartJobFailure, INFLIGHT_RETRY_AFTER_SECONDS } from "./inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError, throwIfJobCanceled, } from "./generationCancel.js";
import { detectImageMimeFromB64, summarizeReferencePayload } from "./refs.js";
import { classifyUpstreamError } from "./errorClassify.js";
import { normalizeOAuthParams } from "./oauthNormalize.js";
import { resolveProviderOptions } from "./providerOptions.js";
import { resolveGrokQualityModel } from "./imageModels.js";
import { prepareImageExecution } from "./providers/execution/index.js";
import { checkImageExecutionAdmission } from "./providers/execution/admission.js";
import { readNaiOptions } from "./naiOptions.js";
import { isNonRetryableGenerationError, normalizeGenerationFailure, type UpstreamErr } from "./generationErrors.js";
import { logEvent, logError } from "./logger.js";
import { errInfo } from "./errInfo.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { imageFormatFromMime, writeSse, dataUrlFromB64 } from "./routeHelpers.js";
import { validateNodeInputs } from "./nodeValidation.js";
import { publish } from "./eventBus.js";
import { publishJobEvent } from "./ssePublish.js";
import { type NodeGenerateBody, asUpstream, wantsSse, writeNodeError, loadParentNodeB64, nodeErrorDetails, } from "./nodeHelpers.js";
import { normalizeBodyRequestId, validateGenerationPrompt } from "./generationInputValidation.js";
import { deriveReferenceLimit, getProviderSurfaceSupport } from "./providers/derive.js";
import { errorEnvelopeFields } from "./errors/envelope.js";
export async function runNodeGeneration(req: Request, res: Response, ctx: RuntimeContext) {
    const body = (req.body ?? {}) as NodeGenerateBody;
    const promptError = validateGenerationPrompt(body.prompt);
    if (promptError) return res.status(400).json(promptError);
    const asyncMode = body.async === true;
    const streamResponse = !asyncMode && wantsSse(req);
    const parentNodeId = (typeof body.parentNodeId === "string" ? body.parentNodeId : null);
    const requestId = normalizeBodyRequestId(body.requestId, req.id);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    const clientNodeId = typeof body.clientNodeId === "string" ? body.clientNodeId : null;
    let finishMeta: Record<string, unknown> = {};
    let finishStatus = "completed";
    let finishHttpStatus: number | undefined;
    let finishErrorCode: string | undefined;
    let finishCanceled = false;
    let jobOwned = false;
    const cancelController = new AbortController();
    const referencePayload = summarizeReferencePayload(body.references);
    try {
      const {
        prompt: rawPrompt,
        quality: rawQuality = "medium",
        size = "1024x1024",
        format = "png",
        moderation = "low",
        references = [],
        externalSrc = null,
        mode: promptMode = "auto",
        contextMode: rawContextMode = "parent-plus-refs",
        searchMode: rawSearchMode = "on",
        model: rawModel,
        imageToolModel: rawImageToolModel,
        reasoningEffort: rawReasoningEffort,
      } = body;
      const { provider = "oauth" } = body;
      const { quality, warnings: qualityWarnings } = normalizeOAuthParams({ provider, quality: rawQuality, imageToolModel: rawImageToolModel });
      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";
      const contextMode = rawContextMode === "parent-only" ? "parent-only"
        : rawContextMode === "ancestry" ? "ancestry" : "parent-plus-refs";
      const searchMode = rawSearchMode === "off" || rawSearchMode === "auto"
        ? rawSearchMode : "on";
      // Node mode has no comfy dispatch in this unit; without this the request
      // falls through to generateViaResponses and bills OAuth. The envelope is
      // this file's nested shape, not the flat one generate uses.
      // Removed in wp7.
      if (getProviderSurfaceSupport(provider, "node")?.supported === false) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "COMFY_SURFACE_UNSUPPORTED";
        return res.status(400).json({
          error: { code: "COMFY_SURFACE_UNSUPPORTED", message: "provider 'comfy' is not supported on this surface yet" },
          parentNodeId,
        });
      }
      const providerOptions = resolveProviderOptions(ctx, {
        provider,
        rawModel,
        rawImageToolModel,
        rawReasoningEffort,
        rawSize: size,
        rawWebSearchEnabled: body.webSearchEnabled,
        searchMode,
      });
      if (providerOptions.error !== undefined) {
        finishStatus = "error";
        finishHttpStatus = providerOptions.status;
        finishErrorCode = providerOptions.code;
        return res.status(providerOptions.status).json({
          error: { code: providerOptions.code, message: providerOptions.error },
          parentNodeId,
        });
      }
      const imageModel = providerOptions.model;
      const imageToolModel = providerOptions.imageToolModel;
      const reasoningEffort = providerOptions.reasoningEffort;
      const effectiveSize = providerOptions.size;
      const webSearchEnabled = providerOptions.webSearchEnabled;
      const activeProvider = providerOptions.provider;
      const effectiveImageModel = (activeProvider === "grok" || activeProvider === "grok-api")
        ? resolveGrokQualityModel(imageModel, quality)
        : imageModel;
      if (contextMode === "ancestry") {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "CONTEXT_MODE_UNSUPPORTED";
        return res.status(400).json({
          error: { code: "CONTEXT_MODE_UNSUPPORTED", message: "Ancestry context is not supported yet." },
          parentNodeId,
        });
      }
      // Only API/OAuth persist the requested format; other providers select their output format.
      const validation = validateNodeInputs(ctx, rawPrompt, references, moderation,
        activeProvider === "api" || activeProvider === "oauth" ? format : undefined);
      if (validation.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = validation.error.code;
        return res.status(400).json({
          error: validation.error,
          ...(validation.code ? { code: validation.code } : {}),
          parentNodeId,
        });
      }
      const prompt = validation.prompt;
      // Element inputs (higgsfield 120): ids/revisions recorded into the
      // sidecar; notes appended only for the upstream generation call so the
      // stored prompt stays raw.
      const elementIds = Array.isArray(body.elementIds) ? body.elementIds.filter((id: unknown) => typeof id === "string" && id) : [];
      const elementRevisions = body.elementRevisions && typeof body.elementRevisions === "object" ? body.elementRevisions : null;
      const elementNotes = Array.isArray(body.elementNotes) ? body.elementNotes.filter((note: unknown) => typeof note === "string" && note.trim()) : [];
      const generationPrompt = elementNotes.length ? `${prompt}\n\nElement notes:\n${elementNotes.join("\n")}` : prompt;
      const refCheck = validation.refCheck;
      const startTime = Date.now();
      let parentB64: string | null = null;
      if (parentNodeId) {
        parentB64 = await loadParentNodeB64(ctx, parentNodeId);
      } else if (typeof externalSrc === "string" && externalSrc.length > 0) {
        parentB64 = await loadAssetB64(ctx.rootDir, externalSrc, ctx.config.storage.generatedDir);
      }
      const operation = parentB64 ? "edit" : "generate";
      const referenceDiagnostics = refCheck.referenceDiagnostics || [];
      const generateReferenceDiagnostics = operation === "generate" ? referenceDiagnostics : [];
      const referenceMismatchCount = generateReferenceDiagnostics.filter((ref) => ref.warnings?.includes("mime_mismatch")).length;
      const refsForRequest = contextMode === "parent-only" ? [] : (refCheck.refDetails || refCheck.refs);
      const parentImagePresent = !!parentB64;
      const inputImageCount = (parentImagePresent ? 1 : 0) + refsForRequest.length;
      const providerReferenceLimit = deriveReferenceLimit(activeProvider, "edit");
      if ((activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api") && inputImageCount > providerReferenceLimit!) {
        finishStatus = "error";
        finishHttpStatus = 400;
        const code = activeProvider === "agy" ? "AGY_REF_TOO_MANY" : "GROK_REF_TOO_MANY";
        return res.status(400).json({
          error: {
            code,
            message: `${activeProvider === "agy" ? "Agy" : "Grok"} image editing supports up to ${providerReferenceLimit} reference images.`,
          },
          code,
          parentNodeId,
        });
      }
      if (activeProvider === "atlascloud" && inputImageCount > providerReferenceLimit!) {
        finishStatus = "error";
        finishHttpStatus = 400;
        return res.status(400).json({
          error: {
            code: "ATLASCLOUD_REF_TOO_MANY",
            message: `Atlas Cloud image editing supports up to ${providerReferenceLimit} reference images.`,
          },
          code: "ATLASCLOUD_REF_TOO_MANY",
          parentNodeId,
        });
      }
      if (activeProvider === "minimax" && inputImageCount > providerReferenceLimit!) {
        finishStatus = "error";
        finishHttpStatus = 400;
        return res.status(400).json({
          error: {
            code: "MINIMAX_REF_TOO_MANY",
            message: `MiniMax image editing supports up to ${providerReferenceLimit} subject reference.`,
          },
          code: "MINIMAX_REF_TOO_MANY",
          parentNodeId,
        });
      }
      // Node mode chains images, so a parent node is exactly the reference the
      // adapter cannot use. Refuse instead of generating something unrelated.
      if (getProviderSurfaceSupport(activeProvider ?? "", "node")?.references === false && inputImageCount > 0) {
        finishStatus = "error";
        finishHttpStatus = 400;
        return res.status(400).json({
          error: {
            code: "NAI_REF_UNSUPPORTED",
            message: "NovelAI image generation does not accept input images yet.",
          },
          code: "NAI_REF_UNSUPPORTED",
          parentNodeId,
        });
      }
      const admission = checkImageExecutionAdmission(ctx, {
        provider: activeProvider, surface: "node", referenceCount: inputImageCount,
      });
      if (admission) {
        finishStatus = "error";
        finishHttpStatus = admission.status;
        finishErrorCode = admission.code;
        return res.status(admission.status).json({
          error: { code: admission.code, message: admission.message },
          code: admission.code, parentNodeId, requestId,
        });
      }
      const started = startJob({
        requestId,
        kind: "node",
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
        meta: {
          kind: "node",
          sessionId,
          parentNodeId,
          clientNodeId,
          refsCount: referencePayload.refsCount,
          referenceBytes: referencePayload.referenceBytes,
          referenceB64Chars: referencePayload.referenceB64Chars,
        },
      });
      if (started && isStartJobFailure(started)) {
        finishStatus = "error";
        finishHttpStatus = started.code === "TOO_MANY_JOBS" ? 429 : 409;
        finishErrorCode = started.code;
        if (started.code === "TOO_MANY_JOBS") {
          res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
        }
        return writeNodeError(
          res,
          finishHttpStatus,
          started.code,
          started.code === "TOO_MANY_JOBS"
            ? "Too many concurrent generation jobs"
            : "Request ID already in use",
          parentNodeId,
          {},
          requestId,
        );
      }
      jobOwned = true;
      registerJobAbortController(requestId, cancelController);
      if (asyncMode) res.status(202).json({ requestId });
      logEvent("node", "request", {
        requestId,
        operation,
        sessionId,
        parentNodeId,
        clientNodeId,
        quality,
        model: effectiveImageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        size: effectiveSize,
        moderation,
        refs: refsForRequest.length,
        referenceBytes: referencePayload.referenceBytes,
        referenceMismatchCount,
        refDetectedMimes: [...new Set(generateReferenceDiagnostics.map((ref) => ref.detectedMime).filter(Boolean))].join(","),
        refDeclaredMimes: [...new Set(generateReferenceDiagnostics.map((ref) => ref.declaredMime).filter(Boolean))].join(","),
        inputImageCount,
        parentImagePresent,
        contextMode,
        searchMode,
        webSearchEnabled,
        promptChars: prompt.length,
        promptMode: normalizedPromptMode,
      });
      const emitProgress = streamResponse || asyncMode;
      if (streamResponse) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        writeSse(res, "phase", { requestId, phase: "streaming" });
        publish(requestId, "phase", { requestId, phase: "streaming" });
      } else if (asyncMode) {
        publish(requestId, "phase", { requestId, phase: "streaming" });
      }
      let b64: string | undefined, usage: unknown, webSearchCalls = 0, revisedPrompt: string | null = null;
      const execution = await prepareImageExecution(ctx, {
        surface: "node", provider: activeProvider, requestId,
        signal: cancelController.signal, prompt: generationPrompt, rawPrompt: prompt,
        references: refCheck.refDetails, sourceImage: parentB64, contextMode, searchMode,
        partialImages: emitProgress ? 2 : 0,
        options: { model: effectiveImageModel, imageToolModel, quality, size: effectiveSize, moderation,
          mode: normalizedPromptMode, reasoningEffort, webSearchEnabled },
        nai: activeProvider === "nai" ? readNaiOptions(req.body) : {},
      }, emitProgress ? {
        onPartialImage: (partial) => {
          if (isJobCanceled(requestId)) return;
          const pd = { requestId, image: dataUrlFromB64(format, partial.b64 ?? ""), index: partial.index };
          if (streamResponse) writeSse(res, "partial", pd);
          publish(requestId, "partial", pd);
        },
      } : undefined);
      let resultFormat = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" ? "jpeg" : format;
      const maxAttempts = inputImageCount > 0 ? 1 : 2;
      let lastErr: UpstreamErr | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          logEvent("node", "attempt", {
            requestId,
            attempt,
            operation,
            sessionId,
            parentNodeId,
            clientNodeId,
            model: effectiveImageModel,
            ...(imageToolModel ? { imageToolModel } : {}),
            moderation,
            quality,
            size: effectiveSize,
            refs: refsForRequest.length,
            inputImageCount,
            parentImagePresent,
            contextMode,
            searchMode,
            webSearchEnabled,
          });
          const { value: r } = await execution.execute();
          throwIfJobCanceled(requestId);
          if (r.b64) {
            b64 = r.b64;
            usage = r.usage;
            webSearchCalls = r.webSearchCalls || 0;
            revisedPrompt = r.revisedPrompt || null;
            // nai belongs here, never in the jpeg initializer above: this
            // overwrite is what lets a straight_alpha PNG stay a PNG.
            if (activeProvider === "grok" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai") {
              resultFormat = imageFormatFromMime(("mime" in r ? r.mime : undefined) || detectImageMimeFromB64(r.b64) || "image/jpeg");
            }
            break;
          }
          lastErr = { message: "Empty response (safety refusal)" };
        } catch (e) {
          lastErr = asUpstream(e);
          if (isNonRetryableGenerationError(lastErr)) break;
        }
        if (attempt + 1 < maxAttempts) {
          logEvent("node", "retry", {
            requestId,
            attempt: attempt + 1,
            operation,
            parentNodeId,
            clientNodeId,
            errorCode: lastErr?.code,
            errorEventType: lastErr?.eventType,
            errorEventCount: lastErr?.eventCount,
          });
        }
      }
      if (!b64) {
        const finalErr = normalizeGenerationFailure(lastErr, {
          safetyMessage: lastErr?.message || "Empty response after generation attempt",
        });
        finishStatus = "error";
        finishHttpStatus = finalErr.status || 500;
        finishErrorCode = finalErr.code || "NODE_GEN_FAILED";
        logEvent("node", "final_error", {
          requestId,
          operation,
          finalCode: finishErrorCode,
          upstreamCode: lastErr?.upstreamCode || lastErr?.code,
          errorEventType: lastErr?.eventType,
          errorEventCount: lastErr?.eventCount,
          diagnosticReason: lastErr?.diagnosticReason,
          retryKind: lastErr?.retryKind,
          referencesDroppedOnRetry: lastErr?.referencesDroppedOnRetry,
          attempts: maxAttempts,
          outerHttpAlreadyCommitted: res.headersSent,
          sseErrorSent: streamResponse,
        });
        return writeNodeError(
          res,
          finishHttpStatus ?? 500,
          finishErrorCode ?? "NODE_GEN_FAILED",
          finalErr.message,
          parentNodeId,
          nodeErrorDetails(finalErr, lastErr),
          requestId,
        );
      }
      const nodeId = newNodeId();
      throwIfJobCanceled(requestId);
      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      const meta = {
        nodeId,
        parentNodeId,
        sessionId,
        clientNodeId,
        prompt,
        userPrompt: prompt,
        revisedPrompt,
        promptMode: normalizedPromptMode,
        options: { quality, size: effectiveSize, format: resultFormat, moderation },
        model: effectiveImageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        reasoningEffort,
        createdAt: Date.now(),
        createdAtIso: new Date().toISOString(),
        elapsed,
        usage: usage || null,
        webSearchCalls,
        webSearchEnabled,
        ...(elementIds.length ? { elementIds, elementRevisions } : {}),
        contextMode,
        searchMode,
        provider: activeProvider,
        kind: parentB64 ? "edit" : "generate",
        requestId,
        refsCount: refsForRequest.length,
        quality,
        size: effectiveSize,
        format: resultFormat,
        moderation,
      };
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });
      throwIfJobCanceled(requestId);
      const { filename } = await saveNode(ctx.rootDir, {
        nodeId,
        b64,
        meta,
        ext: resultFormat,
        generatedDir: ctx.config.storage.generatedDir,
      });
      finishMeta = { nodeId, filename, imageChars: b64.length };
      finishHttpStatus = 200;
      logEvent("node", "saved", {
        requestId,
        nodeId,
        filename,
        imageChars: b64.length,
        elapsedMs: Date.now() - startTime,
      });
      const payload = {
        nodeId,
        parentNodeId,
        requestId,
        image: dataUrlFromB64(resultFormat, b64),
        filename,
        url: `/generated/${filename}`,
        elapsed,
        usage,
        webSearchCalls,
        webSearchEnabled,
        provider: activeProvider,
        model: effectiveImageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        reasoningEffort,
        size: effectiveSize,
        format: resultFormat,
        moderation,
        refsCount: refsForRequest.length,
        contextMode,
        searchMode,
        warnings: qualityWarnings,
        revisedPrompt,
        promptMode: normalizedPromptMode,
      };
      publishJobEvent(requestId, "done", payload);
      if (res.writableEnded) {
        // async mode — response already sent
      } else if (streamResponse) {
        writeSse(res, "done", payload);
        res.end();
      } else {
        res.json(payload);
      }
    } catch (e) {
      const err = errInfo(e);
      const ext = (err.raw && typeof err.raw === "object" ? err.raw as Record<string, unknown> : {});
      const code = err.code || classifyUpstreamError(err.message) || "NODE_GEN_FAILED";
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        finishHttpStatus = canceled.status;
        finishErrorCode = canceled.code;
        return writeNodeError(
          res,
          canceled.status,
          canceled.code,
          canceled.message,
          parentNodeId,
          {},
          requestId,
        );
      }
      finishStatus = "error";
      finishHttpStatus = err.status || 500;
      finishErrorCode = code;
      logError("node", "error", err.raw, { requestId, code, parentNodeId, sessionId, clientNodeId });
      writeNodeError(res, err.status || 500, code, err.message, parentNodeId, {
        // Recover identity from the thrown object itself. Copying only
        // pre-attached rawCode/errorClass left MiniMax 402 empty when the
        // adapter throw skipped normalizeGenerationFailure.
        ...errorEnvelopeFields(err.raw),
        upstreamCode: ext.upstreamCode || null,
        upstreamType: ext.upstreamType || null,
        upstreamParam: ext.upstreamParam || null,
      }, requestId);
    } finally {
      if (jobOwned) finishJob(requestId, {
        canceled: finishCanceled,
        status: finishStatus,
        httpStatus: finishHttpStatus,
        errorCode: finishErrorCode,
        meta: finishMeta,
      });
    }
}
