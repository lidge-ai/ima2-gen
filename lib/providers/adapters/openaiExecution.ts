import type { RuntimeContext } from "../../runtimeContext.js";
import { isNonRetryableGenerationError, normalizeGenerationFailure, type UpstreamErr } from "../../generationErrors.js";
import { throwIfJobCanceled } from "../../generationCancel.js";
import { logEvent } from "../../logger.js";
import { generateViaResponses, editViaResponses, generateMultimodeViaResponses } from "./openaiOperations.js";
import type {
  ExecutionProgress, ExecutionSurface, ImageExecutionRequest, PreparedImageExecution,
  SingleImageExecutionResult, SequenceImageExecutionResult,
} from "../execution/types.js";

export type OpenaiRequest = ImageExecutionRequest & { provider: "oauth" | "api" };

export function isOpenaiRequest(request: ImageExecutionRequest): request is OpenaiRequest {
  return request.provider === "oauth" || request.provider === "api";
}

function prepareOpenaiClassic(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "classic" }>,
  _progress?: ExecutionProgress,
): PreparedImageExecution<"classic"> {
  const { provider: activeProvider, prompt: generationPrompt, requestId, background: backgroundParams } = request;
  const { model: imageModel, imageToolModel, quality, size: effectiveSize, moderation,
    mode: normalizedPromptMode, reasoningEffort, webSearchEnabled } = request.options;
  // Scalars are captured at prepare; references, signal and ctx stay live per attempt.
  const generateOne = async (): Promise<SingleImageExecutionResult> => {
    const MAX_RETRIES = 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const r = await generateViaResponses(
          activeProvider,
          generationPrompt,
          quality,
          effectiveSize,
          moderation,
          request.references,
          requestId,
          normalizedPromptMode,
          ctx,
          {
            model: imageModel, imageToolModel,
            reasoningEffort,
            webSearchEnabled,
            signal: request.signal,
            allowPromptOnlyOAuthFallback: activeProvider !== "api",
            ...(backgroundParams ? { background: backgroundParams.background } : {}),
            ...(backgroundParams?.outputFormat ? { outputFormat: backgroundParams.outputFormat } : {}),
          },
        );
        throwIfJobCanceled(requestId);
        if (r.b64) return r;
        lastErr = new Error("Empty response (safety refusal)");
      } catch (e) {
        lastErr = e;
        if (isNonRetryableGenerationError(e as UpstreamErr | null | undefined)) break;
      }
      if (attempt < MAX_RETRIES) {
        const errCode = (lastErr && typeof lastErr === "object" && "code" in lastErr)
          ? (lastErr as { code?: unknown }).code
          : undefined;
        logEvent("generate", "retry", { requestId, attempt: attempt + 1, errorCode: errCode });
      }
    }
    throw normalizeGenerationFailure(lastErr as UpstreamErr | null | undefined, {
      safetyMessage: "Content generation refused after retries",
    });
  };
  return { execute: async () => {
    return { kind: "single", value: await generateOne() };
  } };
}

async function executeOpenaiNode(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "node" }>,
  progress?: ExecutionProgress,
): Promise<SingleImageExecutionResult> {
  const { provider, sourceImage: parentB64, prompt: generationPrompt,
    references, requestId, signal, searchMode, options } = request;
  const { model, imageToolModel, size, quality, moderation, mode, reasoningEffort, webSearchEnabled } = options;
  const refsForRequest = request.contextMode === "parent-only" ? [] : references;
  return parentB64
    ? await editViaResponses(provider, generationPrompt, parentB64, quality, size, moderation, mode, ctx, requestId, {
        model, imageToolModel, references: refsForRequest, searchMode, reasoningEffort, webSearchEnabled, signal,
      })
    : await generateViaResponses(provider, generationPrompt, quality, size, moderation,
        refsForRequest, requestId, mode, ctx, {
          model, imageToolModel, reasoningEffort, webSearchEnabled, signal,
          partialImages: request.partialImages,
          onPartialImage: progress?.onPartialImage ?? null,
        });
}

async function executeOpenaiEdit(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "edit" }>,
): Promise<SingleImageExecutionResult> {
  const { provider, rawPrompt, sourceImage, signal, requestId, options } = request;
  const result = await editViaResponses(
    provider, rawPrompt, sourceImage, options.quality, options.size,
    options.moderation, options.mode, ctx, requestId,
    { model: options.model, imageToolModel: options.imageToolModel, reasoningEffort: options.reasoningEffort,
      webSearchEnabled: options.webSearchEnabled,
      ...(request.mask !== null ? { mask: request.mask } : {}), signal },
  );
  // Preserve native retry metadata; only Responses had these caller defaults.
  return { ...result, usage: result.usage ?? null, webSearchCalls: result.webSearchCalls ?? 0 };
}

async function executeOpenaiMultimode(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "multimode" }>,
  progress: ExecutionProgress,
): Promise<SequenceImageExecutionResult> {
  const { provider, prompt, references, signal, requestId, options, maxImages } = request;
  return generateMultimodeViaResponses(
    provider, prompt, options.quality, options.size, options.moderation,
    references, requestId, options.mode, ctx,
    { model: options.model, imageToolModel: options.imageToolModel, maxImages, reasoningEffort: options.reasoningEffort,
      webSearchEnabled: options.webSearchEnabled,
      ...(progress.onPartialImage !== undefined ? { onPartialImage: progress.onPartialImage } : {}),
      ...(progress.onFinalImage !== undefined ? { onFinalImage: progress.onFinalImage } : {}), signal },
  );
}

export function prepareOpenaiExecution<R extends OpenaiRequest>(
  ctx: RuntimeContext, request: R, progress?: ExecutionProgress,
): Promise<PreparedImageExecution<R["surface"]>>;
export async function prepareOpenaiExecution(
  ctx: RuntimeContext, request: OpenaiRequest, progress: ExecutionProgress = {},
): Promise<PreparedImageExecution<ExecutionSurface>> {
  switch (request.surface) {
    case "classic": return prepareOpenaiClassic(ctx, request, progress);
    case "node": return { execute: async () => {
      return { kind: "single", value: await executeOpenaiNode(ctx, request, progress) };
    } };
    case "edit": return { execute: async () => {
      return { kind: "single", value: await executeOpenaiEdit(ctx, request) };
    } };
    case "multimode": return { execute: async () => {
      return { kind: "sequence", value: await executeOpenaiMultimode(ctx, request, progress) };
    } };
  }
}
