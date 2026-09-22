import { validateAndNormalizeRefs } from "./refs.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { validateModeration } from "./routeHelpers.js";
import { validateGenerationPrompt } from "./generationInputValidation.js";
import { isSupportedMetadataFormat } from "./imageMetadataStore.js";

type NodeInputValidation =
  | {
      error: { code: string; message: string };
      code?: string;
      prompt?: never;
      refCheck?: never;
    }
  | {
      error?: never;
      code?: never;
      prompt: string;
      refCheck: Extract<ReturnType<typeof validateAndNormalizeRefs>, { refs: string[] }>;
    };

type ExtraParentValidation =
  | { error: { code: string; message: string }; ids?: never }
  | { error?: never; ids: string[] };

function isNodeSourceId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

export function validateExtraParentNodeIds(
  value: unknown,
  parentNodeId: string | null,
  maxCount: number,
): ExtraParentValidation {
  if (value === undefined) return { ids: [] };
  if (!Array.isArray(value)) {
    return { error: { code: "EXTRA_PARENT_IDS_NOT_ARRAY", message: "extraParentNodeIds must be an array." } };
  }
  const seen = new Set(parentNodeId ? [parentNodeId] : []);
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!isNodeSourceId(id)) {
      return { error: { code: "EXTRA_PARENT_ID_INVALID", message: `extraParentNodeIds[${index}] must be a valid node id.` } };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > maxCount) {
    return { error: { code: "EXTRA_PARENT_TOO_MANY", message: `extraParentNodeIds may not exceed ${maxCount} unique items.` } };
  }
  return { ids };
}

export function validateNodeInputs(
  ctx: RuntimeContext,
  prompt: unknown,
  references: unknown,
  moderation: string,
  format: unknown = "png",
): NodeInputValidation {
  const promptError = validateGenerationPrompt(prompt);
  if (promptError) return promptError;
  if (typeof format !== "string" || !isSupportedMetadataFormat(format)) {
    return { error: { code: "INVALID_FORMAT", message: "Format must be png, jpeg, jpg, or webp." } };
  }
  const refCheckResult = validateAndNormalizeRefs(references);
  if (refCheckResult.error) {
    return {
      error: { code: refCheckResult.code, message: refCheckResult.error },
      code: refCheckResult.code,
    };
  }
  const moderationCheck = validateModeration(ctx, moderation);
  if (moderationCheck.error) {
    return { error: { code: "INVALID_MODERATION", message: moderationCheck.error } };
  }
  return {
    prompt: prompt as string,
    refCheck: refCheckResult as Extract<typeof refCheckResult, { refs: string[] }>,
  };
}
