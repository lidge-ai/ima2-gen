/**
 * Adapter lookup (#150): seven lanes expose synchronous readiness and metadata.
 * NAI, MiniMax, Atlas Cloud and Comfy also own their image execution surfaces.
 * OAuth, Grok proxy and Antigravity await an async readiness contract.
 */
import type { RuntimeContext } from "../../runtimeContext.js";
import type { CoreProviderId } from "../registry.js";
import { createApiAdapter } from "./api.js";
import { createGrokApiAdapter } from "./grok-api.js";
import { createGeminiApiAdapter } from "./gemini-api.js";
import { createAtlasCloudAdapter } from "./atlascloud.js";
import { createApi88Adapter } from "./88api.js";
import { createComfyAdapter } from "./comfy.js";
import { createMinimaxAdapter } from "./minimax.js";
import { createNaiAdapter } from "./nai.js";
import type { ProviderAdapterV1 } from "./types.js";

type AdapterFactory = (ctx: RuntimeContext) => ProviderAdapterV1;

const ADAPTER_FACTORIES: Partial<Record<CoreProviderId, AdapterFactory>> = {
  api: createApiAdapter,
  "grok-api": createGrokApiAdapter,
  "gemini-api": createGeminiApiAdapter,
  minimax: createMinimaxAdapter,
  atlascloud: createAtlasCloudAdapter,
  "88api": createApi88Adapter,
  comfy: createComfyAdapter,
  nai: createNaiAdapter,
};

export function getProviderAdapter(ctx: RuntimeContext, laneId: CoreProviderId): ProviderAdapterV1 | null {
  const factory = ADAPTER_FACTORIES[laneId];
  return factory ? factory(ctx) : null;
}

/** Every registered adapter, so the contract suite covers new ones automatically. */
export function listProviderAdapters(ctx: RuntimeContext): ProviderAdapterV1[] {
  return Object.values(ADAPTER_FACTORIES)
    .filter((factory): factory is AdapterFactory => typeof factory === "function")
    .map((factory) => factory(ctx));
}

export type { AuthResult, ProviderAdapterV1, ProviderError } from "./types.js";
