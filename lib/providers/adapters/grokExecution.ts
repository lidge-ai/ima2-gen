import type { RuntimeContext } from "../../runtimeContext.js";
import { planGrokImage } from "../../grokImagePlanner.js";
import { resolveGrokCredential, type GrokCredential } from "../../grokRuntime.js";
import { resolveGrokQualityModel } from "../../imageModels.js";
import { toGrokReferences } from "../../nodeHelpers.js";
import { generateViaGrok, editViaGrok } from "./grokOperations.js";
import { generateMultimodeViaGrok } from "./grokMultimodeOperations.js";
import type {
  ExecutionProgress, ExecutionSurface, ImageExecutionRequest, PreparedImageExecution,
  SingleImageExecutionResult, SequenceImageExecutionResult,
} from "../execution/types.js";

export type GrokRequest = ImageExecutionRequest & { provider: "grok" | "grok-api" };

export function isGrokRequest(request: ImageExecutionRequest): request is GrokRequest {
  return request.provider === "grok" || request.provider === "grok-api";
}

async function prepareGrokClassic(
  ctx: RuntimeContext, request: Extract<GrokRequest, { surface: "classic" }>,
): Promise<PreparedImageExecution<"classic">> {
  const { provider: activeProvider, prompt: generationPrompt, requestId } = request;
  const { model: imageModel, quality, size: effectiveSize, webSearchEnabled } = request.options;
  const grokRefs = request.providerUrl
    ? [{ b64: "", url: request.providerUrl, declaredMime: "image/png", detectedMime: "image/png" }, ...request.references]
    : request.references;
  // Keep classic's once-per-batch key and shared plan capture before any image attempt.
  const credential = await resolveGrokCredential(ctx, activeProvider, { signal: request.signal });
  const sharedGrokPlan = await planGrokImage(generationPrompt, ctx, {
    model: resolveGrokQualityModel(imageModel, quality),
    size: effectiveSize,
    signal: request.signal,
    requestId,
    referenceCount: grokRefs.length,
    references: grokRefs,
    credential,
    backgroundConstraint: request.backgroundConstraint,
    webSearchEnabled,
  });
  return { execute: async () => {
    const grokModel = resolveGrokQualityModel(imageModel, quality);
    const value = await generateViaGrok(generationPrompt, ctx, {
      model: grokModel,
      size: effectiveSize,
      signal: request.signal,
      requestId,
      plannedPrompt: sharedGrokPlan?.prompt,
      webSearchCalls: sharedGrokPlan?.webSearchCalls,
      references: grokRefs,
      credential,
      quality,
    });
    return { kind: "single", value };
  } };
}

async function prepareGrokNode(
  ctx: RuntimeContext, request: Extract<GrokRequest, { surface: "node" }>,
): Promise<PreparedImageExecution<"node">> {
  // The outer execution boundary checks current presence; retries retain this credential.
  const credential = await resolveGrokCredential(ctx, request.provider, { signal: request.signal });
  return { execute: async () => {
    return { kind: "single", value: await executeGrokNode(ctx, request, credential) };
  } };
}

async function executeGrokNode(
  ctx: RuntimeContext, request: Extract<GrokRequest, { surface: "node" }>,
  credential: GrokCredential,
): Promise<SingleImageExecutionResult> {
  const { sourceImage: parentB64, prompt: generationPrompt, references, requestId, signal, options } = request;
  const { model, size, webSearchEnabled, quality } = options;
  const refsForRequest = request.contextMode === "parent-only" ? [] : references;
  return await generateViaGrok(generationPrompt, ctx, {
    model, size, requestId, signal,
    references: toGrokReferences(parentB64, refsForRequest),
    credential,
    webSearchEnabled,
    quality,
  });
}

async function executeGrokEdit(
  ctx: RuntimeContext, request: Extract<GrokRequest, { surface: "edit" }>,
): Promise<SingleImageExecutionResult> {
  const { provider, rawPrompt, sourceImage, signal, requestId, options } = request;
  const credential = await resolveGrokCredential(ctx, provider, { signal });
  return await editViaGrok(rawPrompt, sourceImage, ctx, {
    model: resolveGrokQualityModel(options.model, options.quality),
    size: options.size, signal, requestId, credential, quality: options.quality,
  });
}

async function executeGrokMultimode(
  ctx: RuntimeContext, request: Extract<GrokRequest, { surface: "multimode" }>,
  progress: ExecutionProgress,
): Promise<SequenceImageExecutionResult> {
  const { provider, prompt, references, signal, requestId, options, maxImages } = request;
  const credential = await resolveGrokCredential(ctx, provider, { signal });
  const grokRefs = request.providerUrl
    ? [{ b64: "", url: request.providerUrl }, ...references] : references;
  return await generateMultimodeViaGrok(prompt, ctx, {
    model: resolveGrokQualityModel(options.model, options.quality), maxImages,
    size: options.size, signal, requestId, references: grokRefs, credential,
    onFinalImage: progress.onFinalImage,
    webSearchEnabled: options.webSearchEnabled,
    quality: options.quality,
  });
}

export function prepareGrokExecution<R extends GrokRequest>(
  ctx: RuntimeContext, request: R, progress?: ExecutionProgress,
): Promise<PreparedImageExecution<R["surface"]>>;
export async function prepareGrokExecution(
  ctx: RuntimeContext, request: GrokRequest, progress: ExecutionProgress = {},
): Promise<PreparedImageExecution<ExecutionSurface>> {
  switch (request.surface) {
    case "classic": return await prepareGrokClassic(ctx, request);
    case "node": return await prepareGrokNode(ctx, request);
    case "edit": return { execute: async () => {
      return { kind: "single", value: await executeGrokEdit(ctx, request) };
    } };
    case "multimode": return { execute: async () => {
      return { kind: "sequence", value: await executeGrokMultimode(ctx, request, progress) };
    } };
  }
}
