import type { RuntimeContext } from "../../runtimeContext.js";
import { generateViaApi88Image } from "../../api88/imageTransport.js";
import { api88Key } from "../../api88/catalog.js";
import { getProvider } from "../registry.js";
import type { CoreProviderModel } from "../types.js";
import type { ProviderAdapterV1, ProviderError } from "./types.js";
import type { ExecutionSurface, ImageExecutionRequest, PreparedImageExecution, ExecutionProgress } from "../execution/types.js";

function normalizeError(error: unknown): ProviderError {
  const record = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const status = typeof record.status === "number" ? record.status : typeof record.statusCode === "number" ? record.statusCode : undefined;
  const raw = typeof record.code === "string" ? record.code : undefined;
  return {
    code: raw?.startsWith("API88_") ? raw : raw ? `API88_${raw}` : "API88_UNKNOWN",
    message: error instanceof Error ? error.message : typeof error === "string" ? error : "88API request failed",
    ...(status !== undefined ? { status } : {}),
    retryable: status !== undefined && [408, 425, 429, 500, 502, 503, 504].includes(status),
  };
}

export function createApi88Adapter(ctx: RuntimeContext): ProviderAdapterV1 {
  return {
    laneId: "88api",
    validateAuth: () => api88Key(ctx, "image") ? { ok: true } : { ok: false, reason: "88API image key missing" },
    listModels: (): readonly CoreProviderModel[] => getProvider("88api").models,
    normalizeError,
    prepareImageExecution: prepareLaneImageExecution,
  };
}

function prepareSingle(ctx: RuntimeContext, request: Exclude<ImageExecutionRequest, { surface: "multimode" }>): PreparedImageExecution<"classic" | "node" | "edit"> {
  return { execute: async () => {
    const sourceImage = request.surface === "classic" ? undefined : request.sourceImage;
    const refs = request.surface === "node" && request.contextMode === "parent-only" ? [] : request.references;
    const value = await generateViaApi88Image(request.prompt, ctx, {
      model: request.options.model, size: request.options.size, references: refs, sourceImage,
      requestId: request.requestId, signal: request.signal,
      providerUrl: request.surface === "classic" ? request.providerUrl : undefined,
      mask: request.surface === "edit" ? request.mask : undefined,
    });
    return { kind: "single", value };
  } };
}

function prepareMultimode(ctx: RuntimeContext, request: Extract<ImageExecutionRequest, { surface: "multimode" }>): PreparedImageExecution<"multimode"> {
  return { execute: async () => {
    const result = await generateViaApi88Image(request.prompt, ctx, {
      model: request.options.model, size: request.options.size, references: request.references,
      requestId: request.requestId, signal: request.signal, providerUrl: request.providerUrl,
    });
    return { kind: "sequence", value: {
      images: [{ b64: result.b64, mime: result.mime,
        ...(result.revisedPrompt !== undefined ? { revisedPrompt: result.revisedPrompt } : {}),
        ...(result.providerUrl ? { providerUrl: result.providerUrl } : {}) }],
      usage: result.usage, webSearchCalls: result.webSearchCalls,
    } };
  } };
}

function prepareLaneImageExecution<R extends ImageExecutionRequest>(ctx: RuntimeContext, request: R, progress?: ExecutionProgress): Promise<PreparedImageExecution<R["surface"]>>;
async function prepareLaneImageExecution(ctx: RuntimeContext, request: ImageExecutionRequest, _progress?: ExecutionProgress): Promise<PreparedImageExecution<ExecutionSurface>> {
  return request.surface === "multimode" ? prepareMultimode(ctx, request) : prepareSingle(ctx, request);
}
