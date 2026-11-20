/** Migrate saved OpenAI image model ids while retaining their lane. */
export const LEGACY_OPENAI_IMAGE_MODELS: Readonly<Record<string, string>> = {
  "gpt-6-sol": "gpt-6.2-sol",
  "gpt-6.1-sol": "gpt-6.2-sol",
  "gpt-6-astra": "gpt-6.2-astra",
  "gpt-5.6-sol": "gpt-6.2-sol",
  "gpt-5.6-terra": "gpt-6.1-terra",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.5": "gpt-6-luna",
  "gpt-5.4": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-6-luna",
};

export function migrateOpenAIImageModel(model: string): string {
  return LEGACY_OPENAI_IMAGE_MODELS[model] ?? model;
}
