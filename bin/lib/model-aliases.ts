export const IMAGE_MODEL_ALIASES = {
  luna: "gpt-6-luna",
  sol: "gpt-6-sol",
  astra: "gpt-6-astra",
} as const;

export function canonicalizeImageModel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const model = String(value);
  return IMAGE_MODEL_ALIASES[model as keyof typeof IMAGE_MODEL_ALIASES] || model;
}
