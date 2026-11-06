// 0.09.12.2 — Keep supported image tool qualities intact for OAuth.
// OAuth keeps low/medium/high; only explicitly selected API image models (2.5, 2.6) add qualities.
// Keep the API response, UI metadata, and image_generation payload aligned.

export const DEFAULT_IMAGE_QUALITY = "medium";
export const VALID_IMAGE_QUALITIES = new Set(["low", "medium", "high"]);
/** Images 2.6 (2026-11-04): adds complexity, markup edits, SVG and GIF output on the Image API. */
export const API_IMAGE_26_MODELS = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"] as const;
export const API_IMAGE_TOOL_MODELS = [
  ...API_IMAGE_26_MODELS, "gpt-image-2.5-sunburst", "gpt-image-2.5-flare",
] as const;
export const API_IMAGE_TOOL_QUALITIES = new Set([...VALID_IMAGE_QUALITIES, "xhigh", "max"]);
export const IMAGE_COMPLEXITIES = ["low", "medium", "high"] as const;
export type ImageComplexity = typeof IMAGE_COMPLEXITIES[number];

export function isApiImageToolModel(value: unknown): value is typeof API_IMAGE_TOOL_MODELS[number] {
  return typeof value === "string" && API_IMAGE_TOOL_MODELS.some((model) => model === value);
}

/** True for image models that accept the 2.6-only request fields (complexity, markup, gif, svg). */
export function isImage26Model(value: unknown): value is typeof API_IMAGE_26_MODELS[number] {
  return typeof value === "string" && API_IMAGE_26_MODELS.some((model) => model === value);
}

/**
 * complexity only exists on 2.6 image models. An invalid value is a caller error; a valid
 * value paired with a model that cannot take it is dropped, so a stale UI default never
 * fails a 2.5 or OAuth request.
 */
export function normalizeImageComplexity(provider: string, imageToolModel: unknown, value: unknown) {
  if (value === undefined || value === null || value === "") return { complexity: undefined };
  if (typeof value !== "string" || !IMAGE_COMPLEXITIES.some((level) => level === value)) {
    return {
      error: `complexity must be one of: ${IMAGE_COMPLEXITIES.join(", ")}`,
      code: "INVALID_IMAGE_COMPLEXITY",
      status: 400,
    };
  }
  if (provider !== "api" || !isImage26Model(imageToolModel)) return { complexity: undefined };
  return { complexity: value as ImageComplexity };
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
    ? API_IMAGE_TOOL_QUALITIES : VALID_IMAGE_QUALITIES;
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
