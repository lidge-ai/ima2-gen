import { mkdir } from "fs/promises";
import { safeWriteSidecar } from "../lib/atomicWrite.js";
import { join } from "path";
import { buildFilename, writeFileUnique } from "../lib/filename.js";
import type { Express, Request, Response } from "express";
import { detectImageMimeFromB64 } from "../lib/refs.js";
import { generateImageThumbnailFromBuffer } from "../lib/imageThumb.js";
import { classifyUpstreamError } from "../lib/errorClassify.js";
import { normalizeOAuthParams } from "../lib/oauthNormalize.js";
import { resolveProviderOptions } from "../lib/providerOptions.js";
import { prepareImageExecution } from "../lib/providers/execution/index.js";
import { checkImageExecutionAdmission } from "../lib/providers/execution/admission.js";
import { resolveGrokQualityModel } from "../lib/imageModels.js";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, isStartJobFailure, INFLIGHT_RETRY_AFTER_SECONDS } from "../lib/inflight.js";
import {
  isGenerationCanceledError,
  makeGenerationCanceledError,
  throwIfJobCanceled,
} from "../lib/generationCancel.js";
import { logEvent, logError } from "../lib/logger.js";
import { hasPngAlphaChannel, parsePngInfo } from "../lib/pngInfo.js";
import { verifyBufferAlpha } from "../lib/imageBackgroundParam.js";
import { decodeRawForAlpha } from "../lib/alphaDecode.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";

import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import { upstreamLabelFields } from "../lib/diagnosticLabel.js";
import { getProviderSurfaceSupport } from "../lib/providers/derive.js";
function validateModeration(ctx: RuntimeContext, moderation: unknown) {
  if (typeof moderation !== "string" || !ctx.config.oauth.validModeration.has(moderation)) {
    return { error: "moderation must be one of: auto, low" };
  }
  return { moderation };
}

function imageFormatFromMime(mime: string | null | undefined): "png" | "jpeg" | "webp" {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  return "png";
}

const MAX_EDIT_MASK_BYTES = 16 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function stripPngDataUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^data:image\/png;base64,/, "");
}

interface PngDecodeResult {
  b64?: string;
  buffer?: Buffer;
  info?: ReturnType<typeof parsePngInfo>;
  error?: string;
  code?: string;
}

function decodePngDataUrl(value: unknown, invalidCode: string, pngCode: string): PngDecodeResult {
  const b64 = stripPngDataUrl(value).replace(/\s+/g, "");
  if (!b64 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    return { error: "image must be valid base64", code: invalidCode };
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0 || buffer.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) {
    return { error: "image must be valid base64", code: invalidCode };
  }
  const info = parsePngInfo(buffer);
  if (info.error) return { error: "image must be a PNG image", code: pngCode };
  return { b64, buffer, info };
}

interface MaskValidationResult {
  mask?: string | null | undefined;
  maskBytes?: number | undefined;
  error?: string | undefined;
  code?: string | undefined;
}

function validateEditMask(imageB64: unknown, mask: unknown): MaskValidationResult {
  if (mask == null) return { mask: null, maskBytes: 0 };
  if (typeof mask !== "string" || mask.length === 0) {
    return { error: "mask must be a PNG data URL or base64 string", code: "INVALID_EDIT_MASK" };
  }
  const maskCheck = decodePngDataUrl(mask, "INVALID_EDIT_MASK_BASE64", "INVALID_EDIT_MASK_PNG");
  if (maskCheck.error || !maskCheck.buffer || !maskCheck.info) return maskCheck;
  if (maskCheck.buffer.length > MAX_EDIT_MASK_BYTES) {
    return { error: "mask is too large", code: "EDIT_MASK_TOO_LARGE" };
  }
  if (!hasPngAlphaChannel(maskCheck.info)) {
    return { error: "mask PNG must include an alpha channel", code: "EDIT_MASK_NO_ALPHA" };
  }
  const imageCheck = decodePngDataUrl(imageB64, "INVALID_EDIT_IMAGE_BASE64", "INVALID_EDIT_IMAGE_PNG");
  if (imageCheck.error || !imageCheck.info) return imageCheck;
  if (imageCheck.info.width !== maskCheck.info.width || imageCheck.info.height !== maskCheck.info.height) {
    return { error: "mask dimensions must match image dimensions", code: "EDIT_MASK_DIMENSION_MISMATCH" };
  }
  return { mask: maskCheck.b64, maskBytes: maskCheck.buffer.length };
}

export function registerEditRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.post("/api/edit", async (req: Request, res: Response) => {
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : req.id;
    let finishStatus = "completed";
    let finishHttpStatus;
    let finishErrorCode;
    let finishMeta = {};
    let finishCanceled = false;
    let jobOwned = false;
    const cancelController = new AbortController();
    try {
      const {
        prompt,
        image: imageB64,
        mask: rawMask,
        quality: rawQuality = "medium",
        size = "1024x1024",
        moderation = "low",
        provider = "oauth",
        mode: promptMode = "auto",
        model: rawModel,
        imageToolModel: rawImageToolModel,
        reasoningEffort: rawReasoningEffort,
        webSearchEnabled: rawWebSearchEnabled = true,
      } = req.body;
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
        finishStatus = "error";
        finishHttpStatus = providerOptions.status;
        finishErrorCode = providerOptions.code;
        return res.status(providerOptions.status).json({ error: providerOptions.error, code: providerOptions.code });
      }
      const imageModel = providerOptions.model;
      const imageToolModel = providerOptions.imageToolModel;
      const reasoningEffort = providerOptions.reasoningEffort;
      const effectiveSize = providerOptions.size;
      const webSearchEnabled = providerOptions.webSearchEnabled;
      const activeProvider = providerOptions.provider;
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";

      const admission = checkImageExecutionAdmission(ctx, {
        provider: activeProvider, surface: "edit", referenceCount: imageB64 ? 1 : 0,
      });
      if (admission) {
        finishStatus = "error";
        finishHttpStatus = admission.status;
        finishErrorCode = admission.code;
        return res.status(admission.status).json({
          error: admission.message, code: admission.code, requestId,
          ...errorEnvelopeFields({ code: admission.code, status: admission.status }),
        });
      }

      const started = startJob({
        requestId,
        kind: "classic",
        prompt,
        meta: {
          kind: "edit",
          sessionId,
          quality,
          model: imageModel,
          ...(imageToolModel ? { imageToolModel } : {}),
          size: effectiveSize,
        },
      });
      if (started && isStartJobFailure(started)) {
        const status = started.code === "TOO_MANY_JOBS" ? 429 : 409;
        if (started.code === "TOO_MANY_JOBS") {
          res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
        }
        return res.status(status).json({
          error: started.code === "TOO_MANY_JOBS"
            ? "Too many concurrent generation jobs"
            : "Request ID already in use",
          code: started.code,
          requestId,
        });
      }
      jobOwned = true;
      registerJobAbortController(requestId, cancelController);

      if (!prompt || !imageB64) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "INVALID_EDIT_INPUT";
        return res.status(400).json({ error: "Prompt and image are required" });
      }
      // Comfy joins this list because inpainting needs a LoadImageMask node,
      // which is a binding-schema extension rather than a request flag.
      // NovelAI joins this list because its infill is a distinct action with its
      // own model ids, not a mask flag on generate; accepting a mask here would
      // silently drop it.
      if (getProviderSurfaceSupport(activeProvider ?? "", "edit")?.mask === false && rawMask) {
        finishStatus = "error";
        finishHttpStatus = 400;
        const code = activeProvider === "agy" ? "AGY_MASK_UNSUPPORTED" : activeProvider === "gemini-api" ? "GEMINI_API_MASK_UNSUPPORTED" : activeProvider === "atlascloud" ? "ATLASCLOUD_MASK_UNSUPPORTED" : activeProvider === "minimax" ? "MINIMAX_MASK_UNSUPPORTED" : activeProvider === "nai" ? "NAI_MASK_UNSUPPORTED" : activeProvider === "comfy" ? "COMFY_MASK_UNSUPPORTED" : "GROK_MASK_UNSUPPORTED";
        const label = activeProvider === "agy" ? "Agy" : activeProvider === "gemini-api" ? "Gemini API" : activeProvider === "atlascloud" ? "Atlas Cloud" : activeProvider === "minimax" ? "MiniMax" : activeProvider === "nai" ? "NovelAI" : activeProvider === "comfy" ? "ComfyUI" : "Grok";
        return res.status(400).json({ error: `${label} provider does not support mask editing`, code, ...errorEnvelopeFields({ code, status: 400 }) });
      }
      // The edit route always carries a source image, and lib/naiImageAdapter.ts
      // is text-to-image only. Dispatching here would ignore that image and
      // return an unrelated generation, so the lane refuses instead. NovelAI's
      // img2img and infill are separate actions and a follow-on unit.
      if (getProviderSurfaceSupport(activeProvider ?? "", "edit")?.supported === false) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "NAI_EDIT_UNSUPPORTED";
        return res.status(400).json({
          error: "NovelAI image editing is not supported yet",
          code: "NAI_EDIT_UNSUPPORTED",
          ...errorEnvelopeFields({ code: "NAI_EDIT_UNSUPPORTED", status: 400 }),
        });
      }
      const maskCheck = validateEditMask(imageB64, rawMask);
      if (maskCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = maskCheck.code;
        return res.status(400).json({ error: maskCheck.error, code: maskCheck.code, ...errorEnvelopeFields({ code: maskCheck.code, status: 400 }) });
      }
      const moderationCheck = validateModeration(ctx, moderation);
      if (moderationCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "INVALID_MODERATION";
        return res.status(400).json({ error: moderationCheck.error });
      }

      logEvent("edit", "request", {
        requestId,
        client: req.get("x-ima2-client") || "ui",
        provider: activeProvider,
        quality,
        model: imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        size: effectiveSize,
        moderation,
        sessionId,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        promptMode: normalizedPromptMode,
        webSearchEnabled,
        inputImageChars: typeof imageB64 === "string" ? imageB64.length : 0,
        maskPresent: Boolean(maskCheck.mask),
        maskBytes: maskCheck.maskBytes ?? 0,
      });
      const startTime = Date.now();
      const { value: r } = await (await prepareImageExecution(ctx, {
        surface: "edit", provider: activeProvider, requestId,
        signal: cancelController.signal, prompt, rawPrompt: prompt,
        sourceImage: imageB64, mask: maskCheck.mask ?? null, references: [],
        options: { model: imageModel, imageToolModel, quality, size: effectiveSize, moderation,
          mode: normalizedPromptMode, reasoningEffort, webSearchEnabled },
      })).execute();
      const resultB64 = r.b64;
      const usage = r.usage;
      const revisedPrompt = r.revisedPrompt ?? undefined;
      const webSearchCalls = r.webSearchCalls;
      const resultMimeFromProvider = r.mime;
      const providerUrl = r.providerUrl ?? null;
      throwIfJobCanceled(requestId);

      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });
      throwIfJobCanceled(requestId);
      const editMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai"
        ? (resultMimeFromProvider || detectImageMimeFromB64(resultB64) || "image/png")
        : "image/png";
      const editExt = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(editMime) : "png";
      const editBuffer = Buffer.from(resultB64, "base64");
      const createdAt = Date.now();
      // Semantic alpha verification: at least one pixel with alpha < 255.
      // Never trust provider mime for transparency claims (same doctrine as
      // the generate path); a failed decode reports alphaVerified: false.
      let alphaVerified = false;
      let alphaReason: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable" | null = null;
      try {
        const verdict = (await verifyBufferAlpha(editBuffer, decodeRawForAlpha)) as {
          hasAlpha: boolean;
          reason?: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable";
        };
        alphaVerified = verdict.hasAlpha === true;
        if (!alphaVerified) alphaReason = verdict.reason ?? "undetectable";
      } catch {
        alphaVerified = false;
        alphaReason = "undetectable";
      }
      const filename = await writeFileUnique(
        ctx.config.storage.generatedDir,
        buildFilename({
          model: (activeProvider === "grok" || activeProvider === "grok-api") ? resolveGrokQualityModel(imageModel, quality) : (imageModel || activeProvider),
          size: effectiveSize,
          createdAt,
          prompt,
          ext: editExt,
        }),
        editBuffer,
      );
      const editFilePath = join(ctx.config.storage.generatedDir, filename);
      generateImageThumbnailFromBuffer(editBuffer, editFilePath).catch(() => {});
      const meta = {
        prompt,
        userPrompt: prompt,
        revisedPrompt: revisedPrompt || null,
        promptMode: normalizedPromptMode,
        quality,
        size: effectiveSize,
        moderation,
        model: imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        reasoningEffort,
        elapsed,
        format: editExt,
        provider: activeProvider,
        kind: "edit",
        requestId,
        createdAt,
        alphaVerified,
        alphaReason,
        usage: usage || null,
        webSearchCalls,
        webSearchEnabled,
        ...(providerUrl ? { providerUrl } : {}),
      };
      await safeWriteSidecar(join(ctx.config.storage.generatedDir, filename + ".json"), meta);
      invalidateHistoryIndex();
      finishHttpStatus = 200;
      finishMeta = { filename, imageChars: resultB64.length };
      logEvent("edit", "saved", {
        requestId,
        filename,
        imageChars: resultB64.length,
        elapsedMs: Date.now() - startTime,
      });

      res.json({
        image: `data:${editMime};base64,${resultB64}`,
        elapsed,
        reasoningEffort,
        filename,
        alphaVerified,
        alphaReason,
        usage,
        provider: activeProvider,
        model: activeProvider === "grok" ? resolveGrokQualityModel(imageModel, quality) : imageModel,
        ...(imageToolModel ? { imageToolModel } : {}),
        moderation,
        warnings: qualityWarnings,
        revisedPrompt: revisedPrompt || null,
        promptMode: normalizedPromptMode,
        webSearchCalls,
        webSearchEnabled,
        providerUrl,
        createdAt,
      });
    } catch (e) {
      const err = errInfo(e);
      const ext = (err.raw && typeof err.raw === "object" ? err.raw as Record<string, unknown> : {});
      const fallbackCode = err.code || classifyUpstreamError(err.message);
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        finishHttpStatus = canceled.status;
        finishErrorCode = canceled.code;
        return res.status(canceled.status).json({
          error: canceled.message,
          code: canceled.code,
          requestId,
          ...errorEnvelopeFields(canceled),
        });
      }
      finishStatus = "error";
      finishHttpStatus = err.status || 500;
      finishErrorCode = fallbackCode || "EDIT_FAILED";
      logError("edit", "error", err.raw, { requestId, code: finishErrorCode });
      res.status(err.status || 500).json({
        error: err.message,
        code: fallbackCode,
        ...errorEnvelopeFields(err.raw),
        ...upstreamLabelFields(ext),
        diagnosticReason: ext.diagnosticReason || null,
        retryKind: ext.retryKind || null,
        initialEventCount: ext.initialEventCount ?? null,
        initialEventTypes: ext.initialEventTypes || null,
        referencesDroppedOnRetry: ext.referencesDroppedOnRetry ?? null,
        developerPromptDroppedOnRetry: ext.developerPromptDroppedOnRetry ?? null,
        webSearchDroppedOnRetry: ext.webSearchDroppedOnRetry ?? null,
        fallbackEventCount: ext.fallbackEventCount ?? null,
        fallbackEventTypes: ext.fallbackEventTypes || null,
        fallbackImageCallSeen: ext.fallbackImageCallSeen ?? null,
        fallbackImageResultCount: ext.fallbackImageResultCount ?? null,
        errorEventCount: ext.eventCount ?? null,
        eventTypes: ext.eventTypes || null,
        webSearchCalls: ext.webSearchCalls ?? null,
        responseDiagnostics: ext.responseDiagnostics || null,
        toolTypes: ext.toolTypes || null,
        toolChoiceKind: ext.toolChoiceKind || null,
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
    }
  });
}
