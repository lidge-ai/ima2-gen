import type { FinalImageHandler } from "../../responsesParse.js";

export type ReferenceRef = string | { b64?: string | undefined; detectedMime?: string | null; declaredMime?: string | null };

export interface GenerateOptions {
  webSearchEnabled?: boolean | undefined;
  searchMode?: string | undefined;
  onPartialImage?: ((partial: { b64: string | undefined; index: number | null | undefined }) => void) | null;
  onFinalImage?: FinalImageHandler | null | undefined;
  model?: string | undefined;
  imageToolModel?: string | undefined;
  partialImages?: number | undefined;
  reasoningEffort?: string | undefined;
  maxImages?: number | undefined;
  references?: ReferenceRef[] | undefined;
  mask?: string | undefined;
  signal?: AbortSignal | null | undefined;
  forceImageToolChoice?: boolean | undefined;
  allowPromptOnlyOAuthFallback?: boolean | undefined;
  /**
   * image_generation `background` value ("auto" | "opaque" | "transparent").
   * Resolved by lib/imageBackgroundParam.ts — the OAuth path receives "auto"
   * for transparent requests because gpt-image-2-codex rejects the forced
   * value; the prompt carries the cutout intent instead.
   */
  background?: string | undefined;
  /** Alpha-capable output format ("png" | "webp") when transparency is requested. */
  outputFormat?: string | undefined;
}
