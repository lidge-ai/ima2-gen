export const IMAGE_MODEL_ALIASES = {
  luna: "gpt-6-luna",
  terra: "gpt-6.1-terra",
  sol: "gpt-6.2-sol",
  astra: "gpt-6.2-astra",
} as const;

export function canonicalizeImageModel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const model = String(value);
  return IMAGE_MODEL_ALIASES[model as keyof typeof IMAGE_MODEL_ALIASES] || model;
}
