/**
 * Grok image model and quality resolution (xAI, 2026-11).
 * grok-imagine-image-pro retired 2026-05-15 into -quality, and -quality retired on
 * 2026-11-02 into grok-imagine-image-2.0 at low quality. 2.0 accepts quality
 * low | medium | auto (no high); the base grok-imagine-image takes no quality field.
 */
export const XAI_IMAGE_2_MODEL = "grok-imagine-image-2.0";
export const RETIRED_GROK_IMAGE_MODELS: ReadonlySet<string> = new Set(["grok-imagine-image-quality", "grok-imagine-image-pro"]);

export type GrokImageQuality = "low" | "medium" | "auto";
const QUALITY_MAP: Readonly<Record<string, GrokImageQuality>> = { low: "low", medium: "medium", high: "medium", auto: "auto" };

export interface GrokImageRequest { model: string; quality?: GrokImageQuality }

export function migrateGrokImageModel(model: string): string {
  return RETIRED_GROK_IMAGE_MODELS.has(model) ? XAI_IMAGE_2_MODEL : model;
}

/** Resolve model and quality together so a retired id keeps its low default. */
export function resolveGrokImageRequest(model: string, quality: unknown): GrokImageRequest {
  const explicit = typeof quality === "string" ? QUALITY_MAP[quality] : undefined;
  if (RETIRED_GROK_IMAGE_MODELS.has(model)) return { model: XAI_IMAGE_2_MODEL, quality: explicit ?? "low" };
  if (quality === "high" || model === XAI_IMAGE_2_MODEL) return { model: XAI_IMAGE_2_MODEL, quality: explicit ?? "auto" };
  return { model };
}

export function withGrokImageQuality(payload: Record<string, unknown>, request: GrokImageRequest): Record<string, unknown> {
  return request.quality ? { ...payload, quality: request.quality } : payload;
}

/**
 * Image routes default an omitted quality to "medium" for every provider. On a Grok lane
 * that default would override the documented 2.0 defaults, so an omitted quality becomes
 * "low" for a retired id and "auto" for native 2.0 (plan R1-F1/R2-F2; PR #434 review #4).
 */
export function grokRouteQuality(provider: unknown, model: unknown, requested: unknown, normalized: string): string {
  if ((provider !== "grok" && provider !== "grok-api") || typeof requested === "string") return normalized;
  if (typeof model === "string" && RETIRED_GROK_IMAGE_MODELS.has(model)) return "low";
  return model === XAI_IMAGE_2_MODEL ? "auto" : normalized;
}
