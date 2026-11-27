/**
 * Comfy adapter (#150) — the first runtime-catalog lane.
 *
 * MiniMax and Atlas Cloud project a compile-time model list and answer "am I
 * authenticated" from an API key. Comfy has neither: its models are workflows
 * the user registered, and it has no credential at all. What decides whether
 * the lane is usable is whether any workflow exists, because an empty store
 * makes every generation a guaranteed 400 — which is exactly what the UI needs
 * to say.
 *
 * Both methods read ctx.comfyWorkflows rather than the store. The interface is
 * synchronous while the store is async, and the contract suite injects lane
 * state exclusively through RuntimeContext — a module-level cache could not be
 * empty and non-empty for the two calls that suite makes. Generation does not
 * use this projection: lib/comfyImageAdapter reads the store directly, so a
 * context lagging one write can never run a stale graph.
 */
import { generateViaComfy } from "../../comfyImageAdapter.js";
import type {
  ExecutionProgress, ExecutionSurface, ImageExecutionRequest, PreparedImageExecution,
} from "../execution/types.js";
import { detectImageMimeFromB64 } from "../../refs.js";
import { requireRuntimeContext, type RuntimeContext } from "../../runtimeContext.js";
import type { CoreProviderModel } from "../types.js";
import type { AuthResult, ProviderAdapterV1, ProviderError } from "./types.js";

const LANE_ID = "comfy" as const;
const ERROR_PREFIX = "COMFY_";

/** Transient upstream conditions, not bad input. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return typeof candidate.status === "number" ? candidate.status
    : typeof candidate.statusCode === "number" ? candidate.statusCode
    : undefined;
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

export function createComfyAdapter(ctx: RuntimeContext): ProviderAdapterV1 {
  return {
    laneId: LANE_ID,
    prepareImageExecution: prepareLaneImageExecution,

    validateAuth(): AuthResult {
      const workflows = (ctx.comfyWorkflows ?? []).filter((workflow) => workflow.mediaKind === "image");
      return workflows.length > 0
        ? { ok: true }
        : { ok: false, reason: "No ComfyUI workflow registered" };
    },

    listModels(): readonly CoreProviderModel[] {
      // NOT getProvider(LANE_ID).models — that is [] by construction for a
      // runtime-catalog lane. Edit support is per workflow: only a graph with a
      // reference-image binding can accept an input image.
      return (ctx.comfyWorkflows ?? [])
        .filter((workflow) => workflow.mediaKind === "image")
        .map((workflow) => ({
        id: workflow.id,
        kind: "image" as const,
        supports: {
          generate: true,
          edit: Boolean(workflow.bind.refImage),
          mask: false,
          streaming: false,
        },
        }));
    },

    normalizeError,
  };
}

function prepareClassic(
  ctx: RuntimeContext, request: Extract<ImageExecutionRequest, { surface: "classic" }>, progress: ExecutionProgress,
): PreparedImageExecution<"classic"> {
  const { prompt: generationPrompt, requestId } = request;
  const { model: imageModel, size: effectiveSize } = request.options;
  // Capture scalars at prepare; ctx, refs, signal and lane options stay live.
  return { execute: async () => {
    const value = await generateViaComfy(generationPrompt, requireRuntimeContext(ctx), {
      model: imageModel, size: effectiveSize, signal: request.signal,
      requestId, references: request.references,
      ...request.comfy, onQueue: progress.onQueue,
    });
    return { kind: "single", value };
  } };
}

function prepareEdit(
  ctx: RuntimeContext, request: Extract<ImageExecutionRequest, { surface: "edit" }>,
): PreparedImageExecution<"edit"> {
  return { execute: async () => {
    const { prompt, sourceImage, signal, requestId, options } = request;
    const references = [{ b64: sourceImage, declaredMime: null, detectedMime: detectImageMimeFromB64(sourceImage) || null }];
    const editPrompt = `Edit this image: ${prompt}`;
    const params = { model: options.model, size: options.size, signal, ...(requestId !== undefined ? { requestId } : {}), references };
    const value = await generateViaComfy(editPrompt, ctx, params);
    return { kind: "single", value };
  } };
}

function prepareLaneImageExecution<R extends ImageExecutionRequest>(
  ctx: RuntimeContext, request: R, progress?: ExecutionProgress,
): Promise<PreparedImageExecution<R["surface"]>>;
async function prepareLaneImageExecution(
  ctx: RuntimeContext, request: ImageExecutionRequest, progress: ExecutionProgress = {},
): Promise<PreparedImageExecution<ExecutionSurface>> {
  switch (request.surface) {
    case "classic": return prepareClassic(ctx, request, progress);
    case "node": return { execute: async () => {
      throw new Error(`Unsupported node execution provider: ${request.provider}`);
    } };
    case "edit": return prepareEdit(ctx, request);
    case "multimode": return { execute: async () => {
      throw new Error(`Unsupported legacy multimode provider: ${request.provider}`);
    } };
  }
}

function normalizeError(error: unknown): ProviderError {
  const status = readStatus(error);
  const rawCode = readCode(error);
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error
    : "ComfyUI request failed";
  const code = rawCode?.startsWith(ERROR_PREFIX)
    ? rawCode
    : rawCode
      ? `${ERROR_PREFIX}${rawCode}`
      : `${ERROR_PREFIX}UNKNOWN`;
  const retryable = status === undefined ? false : RETRYABLE_STATUSES.has(status);
  return {
    code,
    message,
    ...(status === undefined ? {} : { status }),
    retryable,
  };
}
