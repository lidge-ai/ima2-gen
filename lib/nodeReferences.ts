import type { RuntimeContext } from "./runtimeContext.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { loadParentNodeB64 } from "./nodeHelpers.js";
import { deriveReferenceLimit, getProviderSurfaceSupport } from "./providers/derive.js";
import type { CoreProviderId } from "./providers/registry.js";
import type { ExecutionReference } from "./providers/execution/types.js";

type ContextMode = "parent-plus-refs" | "parent-only";
type ReferenceFailure = { status: 400; code: string; message: string };

interface ResolveNodeReferencesInput {
  provider: CoreProviderId;
  parentB64: string | null;
  extraParentNodeIds: string[];
  userReferences: ExecutionReference[];
  contextMode: ContextMode;
}

interface ResolvedNodeReferences {
  executionReferences: ExecutionReference[];
  activeReferenceCount: number;
  reportedReferenceCount: number;
  inputImageCount: number;
  failure?: ReferenceFailure;
}

function providerLimitFailure(provider: CoreProviderId, limit: number): ReferenceFailure {
  if (provider === "atlascloud") {
    return { status: 400, code: "ATLASCLOUD_REF_TOO_MANY", message: `Atlas Cloud image editing supports up to ${limit} reference images.` };
  }
  if (provider === "minimax") {
    return { status: 400, code: "MINIMAX_REF_TOO_MANY", message: `MiniMax image editing supports up to ${limit} subject reference.` };
  }
  const label = provider === "agy" ? "Agy" : "Grok";
  return { status: 400, code: provider === "agy" ? "AGY_REF_TOO_MANY" : "GROK_REF_TOO_MANY",
    message: `${label} image editing supports up to ${limit} reference images.` };
}

function cappedProvider(provider: CoreProviderId): boolean {
  return provider === "grok" || provider === "agy" || provider === "grok-api"
    || provider === "gemini-api" || provider === "atlascloud" || provider === "minimax";
}

function usesParentOnlyUserReferences(provider: CoreProviderId): boolean {
  return provider === "atlascloud" || provider === "minimax";
}

async function loadExtraReferences(ctx: RuntimeContext, ids: string[]): Promise<ExecutionReference[]> {
  const references: ExecutionReference[] = [];
  for (const id of ids) {
    const b64 = await loadParentNodeB64(ctx, id);
    if (b64.length > ctx.config.limits.maxRefB64Bytes) {
      throw Object.assign(new Error(`Extra parent ${id} exceeds ${ctx.config.limits.maxRefB64Bytes} bytes.`), {
        code: "EXTRA_PARENT_TOO_LARGE",
        status: 400,
      });
    }
    references.push({ b64, declaredMime: null, detectedMime: detectImageMimeFromB64(b64) });
  }
  return references;
}

export async function resolveNodeReferences(
  ctx: RuntimeContext,
  input: ResolveNodeReferencesInput,
): Promise<ResolvedNodeReferences> {
  const { provider, parentB64, extraParentNodeIds, userReferences, contextMode } = input;
  const activeExtraParentCount = contextMode === "parent-only" ? 0 : extraParentNodeIds.length;
  if (activeExtraParentCount + userReferences.length > ctx.config.limits.maxRefCount) {
    return { executionReferences: [], activeReferenceCount: 0, reportedReferenceCount: 0, inputImageCount: 0,
      failure: { status: 400, code: "REF_TOO_MANY",
        message: `Extra parents and references may not exceed ${ctx.config.limits.maxRefCount} items combined.` } };
  }

  const extraReferences = contextMode === "parent-only"
    ? []
    : await loadExtraReferences(ctx, extraParentNodeIds);
  const executionReferences = [...extraReferences, ...userReferences];
  const activeReferenceCount = contextMode === "parent-only" && !usesParentOnlyUserReferences(provider)
    ? 0
    : executionReferences.length;
  const reportedReferenceCount = contextMode === "parent-only" ? 0 : executionReferences.length;
  const inputImageCount = Number(Boolean(parentB64)) + activeReferenceCount;
  const providerLimit = deriveReferenceLimit(provider, "edit");
  if (cappedProvider(provider) && providerLimit !== undefined && inputImageCount > providerLimit) {
    return { executionReferences, activeReferenceCount, reportedReferenceCount, inputImageCount,
      failure: providerLimitFailure(provider, providerLimit) };
  }
  if (getProviderSurfaceSupport(provider, "node")?.references === false && inputImageCount > 0) {
    return { executionReferences, activeReferenceCount, reportedReferenceCount, inputImageCount,
      failure: { status: 400, code: "NAI_REF_UNSUPPORTED",
        message: "NovelAI image generation does not accept input images yet." } };
  }
  return { executionReferences, activeReferenceCount, reportedReferenceCount, inputImageCount };
}
