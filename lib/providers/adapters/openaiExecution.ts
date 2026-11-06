import { config } from "../../../config.js";
import { createOAuthJobDeadline, normalizeOAuthTimeout, OAuthJobAbort, throwIfOAuthAborted } from "../../oauthJobDeadline.js";
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

/** One prepared OAuth operation owns its remaining budget across caller retries. */
function withPreparedOAuthBudget<T>(ctx: RuntimeContext, request: OpenaiRequest,
  run: (signal: AbortSignal) => Promise<T>): () => Promise<T> {
  if (request.provider === "api") return () => run(request.signal);
  let deadlineAt: number | undefined;
  return async () => {
    throwIfOAuthAborted(request.signal);
    if (deadlineAt === undefined) {
      const duration = normalizeOAuthTimeout(ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs);
      deadlineAt = duration > 0 ? performance.now() + duration : Infinity;
    }
    const remaining = deadlineAt - performance.now();
    if (remaining <= 0) throw new OAuthJobAbort("job-timeout");
    const lifetime = createOAuthJobDeadline(remaining, request.signal);
    try {
      return await run(lifetime.signal);
    } finally {
      lifetime.dispose();
    }
  };
}

export function isOpenaiRequest(request: ImageExecutionRequest): request is OpenaiRequest {
  return request.provider === "oauth" || request.provider === "api";
}

function prepareOpenaiClassic(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "classic" }>,
  _progress?: ExecutionProgress,
): PreparedImageExecution<"classic"> {
  const { provider: activeProvider, prompt: generationPrompt, requestId, background: backgroundParams } = request;
  const { model: imageModel, imageToolModel, complexity, imageOutput, quality, size: effectiveSize, moderation,
    mode: normalizedPromptMode, reasoningEffort, webSearchEnabled } = request.options;
  // Scalars are captured at prepare; references and ctx stay live per attempt.
  // API keeps the caller signal live; OAuth uses the invocation deadline signal.
  const generateOne = async (signal: AbortSignal): Promise<SingleImageExecutionResult> => {
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
            model: imageModel, imageToolModel, complexity, imageOutput,
            reasoningEffort,
            webSearchEnabled,
            signal: activeProvider === "api" ? request.signal : signal,
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
  return { execute: withPreparedOAuthBudget(ctx, request, async (signal) => {
    return { kind: "single" as const, value: await generateOne(signal) };
  }) };
}

async function executeOpenaiNode(
  ctx: RuntimeContext, request: Extract<OpenaiRequest, { surface: "node" }>,
  progress?: ExecutionProgress,
): Promise<SingleImageExecutionResult> {
  const { provider, sourceImage: parentB64, prompt: generationPrompt,
    references, requestId, signal, searchMode, options } = request;
  const { model, imageToolModel, complexity, size, quality, moderation, mode, reasoningEffort, webSearchEnabled } = options;
  const refsForRequest = request.contextMode === "parent-only" ? [] : references;
  return parentB64
    ? await editViaResponses(provider, generationPrompt, parentB64, quality, size, moderation, mode, ctx, requestId, {
        model, imageToolModel, complexity, references: refsForRequest, searchMode, reasoningEffort, webSearchEnabled, signal,
      })
    : await generateViaResponses(provider, generationPrompt, quality, size, moderation,
        refsForRequest, requestId, mode, ctx, {
          model, imageToolModel, complexity, reasoningEffort, webSearchEnabled, signal,
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
    { model: options.model, imageToolModel: options.imageToolModel, complexity: options.complexity, reasoningEffort: options.reasoningEffort,
      webSearchEnabled: options.webSearchEnabled,
      ...(request.mask !== null ? { mask: request.mask } : {}),
      ...(request.markup ? { markup: request.markup } : {}), signal },
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
    { model: options.model, imageToolModel: options.imageToolModel, complexity: options.complexity, maxImages, reasoningEffort: options.reasoningEffort,
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
    case "node": return { execute: withPreparedOAuthBudget(ctx, request, async (signal) => {
      return { kind: "single" as const, value: await executeOpenaiNode(ctx, { ...request, signal }, progress) };
    }) };
    case "edit": return { execute: withPreparedOAuthBudget(ctx, request, async (signal) => {
      return { kind: "single" as const, value: await executeOpenaiEdit(ctx, { ...request, signal }) };
    }) };
    case "multimode": return { execute: withPreparedOAuthBudget(ctx, request, async (signal) => {
      return { kind: "sequence" as const, value: await executeOpenaiMultimode(ctx, { ...request, signal }, progress) };
    }) };
  }
}
