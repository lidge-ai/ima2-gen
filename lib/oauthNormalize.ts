// 0.09.12.2 — Keep supported image tool qualities intact for OAuth.
// OAuth keeps low/medium/high; only explicitly selected API 2.5 tools add qualities.
// Keep the API response, UI metadata, and image_generation payload aligned.

export const DEFAULT_IMAGE_QUALITY = "medium";
export const VALID_IMAGE_QUALITIES = new Set(["low", "medium", "high"]);
export const API_IMAGE_TOOL_MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"] as const;
export const API_IMAGE_25_QUALITIES = new Set([...VALID_IMAGE_QUALITIES, "xhigh", "max"]);

export function isApiImageToolModel(value: unknown): value is typeof API_IMAGE_TOOL_MODELS[number] {
  return typeof value === "string" && API_IMAGE_TOOL_MODELS.some((model) => model === value);
}

export function normalizeImageToolModel(provider: string, value: unknown) {
  if (provider !== "api" || value === undefined || value === null || value === "") {
    return { imageToolModel: undefined };
  }
  if (isApiImageToolModel(value)) return { imageToolModel: value };
  return {
    error: `imageToolModel must be one of: ${API_IMAGE_TOOL_MODELS.join(", ")}`,
    code: "INVALID_IMAGE_TOOL_MODEL",
    status: 400,
  };
}

/**
 * @param {{ provider?: string, quality?: string }} input
 * @returns {{ quality: string, warnings: Array<{code:string,field:string,normalizedTo:string,reason:string}> }}
 */
export function normalizeOAuthParams(input: { provider?: string | undefined; quality?: string | undefined; imageToolModel?: unknown } | null | undefined) {
  const requested = typeof input?.quality === "string" ? input.quality : DEFAULT_IMAGE_QUALITY;

  const valid = input?.provider === "api" && isApiImageToolModel(input.imageToolModel)
    ? API_IMAGE_25_QUALITIES : VALID_IMAGE_QUALITIES;
  if (valid.has(requested)) {
    return { quality: requested, warnings: [] };
  }

  return {
    quality: DEFAULT_IMAGE_QUALITY,
    warnings: [
      {
        code: "QUALITY_DEFAULTED",
        field: "quality",
        normalizedTo: DEFAULT_IMAGE_QUALITY,
        reason: "invalid-quality",
      },
    ],
  };
}
