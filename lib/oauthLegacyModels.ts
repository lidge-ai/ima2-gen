/**
 * GPT OAuth keeps only GPT-6 (sol / luna / astra). Earlier OAuth ids stay usable in saved
 * defaults, sessions and scripts by mapping to the matching GPT-6 tier, inside the same lane
 * and billing. The API-key lane keeps its own list and is never remapped.
 *
 * Dependency-free so the CLI resolver can share it without loading server modules.
 */
export const LEGACY_OAUTH_IMAGE_MODELS: Readonly<Record<string, string>> = {
  "gpt-5.6-sol": "gpt-6-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.6-terra": "gpt-6-luna",
  "gpt-5.5": "gpt-6-luna",
  "gpt-5.4": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-6-luna",
};

/** Map a legacy OAuth image model id onto its GPT-6 replacement; anything else is unchanged. */
export function migrateOAuthImageModel(model: string): string {
  return LEGACY_OAUTH_IMAGE_MODELS[model] ?? model;
}
