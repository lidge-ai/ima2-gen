import { config } from "../config.js";
import type { AgentGenerationSettings } from "./agentTypes.js";
import { deriveProviderIdSet } from "./providers/derive.js";
import { API_FALLBACK_IMAGE_MODEL, FALLBACK_IMAGE_MODEL, migrateOAuthImageModel } from "./imageModels.js";
import { deriveSupportedImageModels } from "./providers/derive.js";

const OAUTH_IMAGE_MODELS = deriveSupportedImageModels("oauth");
const API_IMAGE_MODELS = deriveSupportedImageModels("api");

/**
 * GPT OAuth keeps only GPT-6 and the API-key lane its own list, so an agent that switches lanes
 * without naming a model must not carry the other lane's id: a legacy OAuth id moves to its GPT-6
 * tier, and a GPT-6 id the API lane does not serve falls back to the API default.
 */
function modelForLane(provider: string, model: string): string {
  if (provider === "oauth") return migrateOAuthImageModel(model);
  if (provider === "api" && OAUTH_IMAGE_MODELS.has(model) && !API_IMAGE_MODELS.has(model)) {
    return config.apiProvider?.defaultImageModel || API_FALLBACK_IMAGE_MODEL;
  }
  return model;
}

const PROVIDERS = deriveProviderIdSet();
const QUALITIES = new Set(["low", "medium", "high"]);
const FORMATS = new Set(["png", "jpeg", "webp"]);
const MODERATIONS = new Set(["auto", "low"]);
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const GENERATION_STRATEGIES = new Set(["auto", "manual"]);
const MAX_AGENT_VARIANTS = Math.max(1, Math.trunc(config.limits.maxGeneratedImages));
const MAX_AGENT_PARALLELISM = Math.max(1, Math.trunc(config.limits.maxParallel));

export const DEFAULT_AGENT_GENERATION_SETTINGS: AgentGenerationSettings = {
  provider: "oauth",
  model: FALLBACK_IMAGE_MODEL,
  quality: "medium",
  size: "1024x1024",
  format: "png",
  moderation: "low",
  reasoningEffort: "none",
  webSearchEnabled: true,
  generationStrategy: "auto",
  variants: 1,
  maxAutoVariants: MAX_AGENT_VARIANTS,
  parallelism: 2,
};

export function normalizeAgentGenerationSettings(
  value: unknown,
  fallback: AgentGenerationSettings = DEFAULT_AGENT_GENERATION_SETTINGS,
): AgentGenerationSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const provider = cleanEnum(input.provider, PROVIDERS, fallback.provider);
  return {
    provider,
    model: modelForLane(provider, cleanString(input.model, fallback.model)),
    quality: cleanEnum(input.quality, QUALITIES, fallback.quality),
    size: cleanSize(input.size, fallback.size),
    format: cleanEnum(input.format, FORMATS, fallback.format),
    moderation: cleanEnum(input.moderation, MODERATIONS, fallback.moderation),
    reasoningEffort: cleanEnum(input.reasoningEffort, REASONING_EFFORTS, fallback.reasoningEffort),
    webSearchEnabled: typeof input.webSearchEnabled === "boolean" ? input.webSearchEnabled : fallback.webSearchEnabled,
    generationStrategy: cleanEnum(input.generationStrategy, GENERATION_STRATEGIES, fallback.generationStrategy),
    variants: cleanPositiveInt(input.variants, fallback.variants, 1, MAX_AGENT_VARIANTS),
    maxAutoVariants: cleanPositiveInt(input.maxAutoVariants, fallback.maxAutoVariants, 1, MAX_AGENT_VARIANTS),
    parallelism: cleanPositiveInt(input.parallelism, fallback.parallelism, 1, MAX_AGENT_PARALLELISM),
  };
}

export function mergeAgentGenerationSettings(
  current: AgentGenerationSettings,
  patch: unknown,
): AgentGenerationSettings {
  return normalizeAgentGenerationSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) }, current);
}

function cleanEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === "string" && allowed.has(value) ? value as T : fallback;
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function cleanSize(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed === "auto") return trimmed;
  return /^\d{3,4}x\d{3,4}$/.test(trimmed) ? trimmed : fallback;
}

function cleanPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}
