import type { RuntimeContext } from "./runtimeContext.js";
import { normalizeImageToolModel } from "./oauthNormalize.js";
import { ATLASCLOUD_TEXT_TO_IMAGE_MODEL } from "./atlasCloudImageAdapter.js";
import { API_FALLBACK_IMAGE_MODEL, coerceReasoningEffortForModel, normalizeImageModel, normalizeReasoningEffort, normalizeGrokImageModel, normalizeGeminiApiModel, normalizeMinimaxImageModel, normalizeNaiImageModel, normalizeComfyWorkflowModel } from "./imageModels.js";

export interface ProviderOptionsInput {
  provider?: string | undefined;
  rawModel?: string | undefined;
  rawImageToolModel?: unknown;
  rawReasoningEffort?: string | undefined;
  rawSize?: string | undefined;
  rawWebSearchEnabled?: unknown;
  searchMode?: string | undefined;
}

export function resolveProviderOptions(ctx: RuntimeContext | null | undefined, {
  provider = "oauth",
  rawModel,
  rawImageToolModel,
  rawReasoningEffort,
  rawSize = "1024x1024",
  rawWebSearchEnabled = true,
  searchMode = "on",
}: ProviderOptionsInput = {}) {
  if (provider === "agy") {
    return {
      provider: "agy" as const,
      model: "nano-banana-2",
      reasoningEffort: "none",
      size: "1024x1024",
      webSearchEnabled: false,
    };
  }

  if (provider === "gemini-api") {
    const geminiModelCheck = normalizeGeminiApiModel(rawModel || "nano-banana-2");
    if (geminiModelCheck.error !== undefined) return { error: geminiModelCheck.error, code: geminiModelCheck.code, status: geminiModelCheck.status };
    return {
      provider: "gemini-api" as const,
      model: geminiModelCheck.model,
      reasoningEffort: "none",
      size: rawSize || "1024x1024",
      webSearchEnabled: false,
    };
  }

  if (provider === "atlascloud") {
    return {
      provider: "atlascloud" as const,
      model: rawModel || ATLASCLOUD_TEXT_TO_IMAGE_MODEL,
      reasoningEffort: "none",
      size: rawSize || "1024x1024",
      webSearchEnabled: false,
    };
  }

  if (provider === "minimax") {
    const minimaxCfg: { defaultImageModel?: string } = ctx?.config?.minimaxProvider || {};
    const modelInput = rawModel || minimaxCfg.defaultImageModel;
    const minimaxModelCheck = normalizeMinimaxImageModel(modelInput);
    if (minimaxModelCheck.error !== undefined) return { error: minimaxModelCheck.error, code: minimaxModelCheck.code, status: minimaxModelCheck.status };
    return {
      provider: "minimax" as const,
      model: minimaxModelCheck.model,
      reasoningEffort: "none",
      size: rawSize || "1024x1024",
      webSearchEnabled: false,
    };
  }

  if (provider === "nai") {
    const naiCfg: { defaultImageModel?: string } = ctx?.config?.naiProvider || {};
    const naiModelCheck = normalizeNaiImageModel(rawModel || naiCfg.defaultImageModel);
    if (naiModelCheck.error !== undefined) return { error: naiModelCheck.error, code: naiModelCheck.code, status: naiModelCheck.status };
    return {
      provider: "nai" as const,
      model: naiModelCheck.model,
      reasoningEffort: "none",
      // NovelAI's native portrait aspect, and the reference client's default.
      // rawSize carries a "1024x1024" default parameter, so an explicit
      // comparison is needed for the caller-didn't-choose case.
      size: !rawSize || rawSize === "1024x1024" ? "832x1216" : rawSize,
      webSearchEnabled: false,
    };
  }

  if (provider === "comfy") {
    // Shape only here; the pipeline confirms the workflow exists because that
    // read is async and this function is not.
    const comfyCheck = normalizeComfyWorkflowModel(rawModel);
    if (comfyCheck.error !== undefined) return { error: comfyCheck.error, code: comfyCheck.code, status: comfyCheck.status };
    const workflow = ctx?.comfyWorkflows?.find((entry) => entry.id === comfyCheck.model);
    if (workflow?.mediaKind === "video") {
      return {
        // The workflow is runnable; it just belongs on the other endpoint. The
        // old wording said execution was unsupported, which stopped being true
        // once the video path landed.
        error: "This ComfyUI workflow produces video. Send it to /api/video/generate instead.",
        code: "COMFY_VIDEO_WRONG_ENDPOINT",
        status: 400,
      };
    }
    return {
      provider: "comfy" as const,
      model: comfyCheck.model,
      reasoningEffort: "none",
      size: rawSize || "1024x1024",
      webSearchEnabled: false,
    };
  }

  if (provider === "grok") {
    const grokCfg: { defaultImageModel?: string } = ctx?.config?.grokProvider || {};
    const modelInput = rawModel || grokCfg.defaultImageModel;
    const grokModelCheck = normalizeGrokImageModel(modelInput);
    if (grokModelCheck.error !== undefined) return { error: grokModelCheck.error, code: grokModelCheck.code, status: grokModelCheck.status };
    return {
      provider: "grok" as const,
      model: grokModelCheck.model,
      reasoningEffort: "none",
      size: rawSize,
      // Honor the caller's toggle (070 QA: forced true ran a real web search
      // on every grok generation, ignoring webSearchEnabled:false).
      webSearchEnabled: rawWebSearchEnabled !== false && searchMode !== "off",
    };
  }

  if (provider === "grok-api") {
    const grokCfg: { defaultImageModel?: string } = ctx?.config?.grokProvider || {};
    const modelInput = rawModel || grokCfg.defaultImageModel;
    const grokModelCheck = normalizeGrokImageModel(modelInput);
    if (grokModelCheck.error !== undefined) return { error: grokModelCheck.error, code: grokModelCheck.code, status: grokModelCheck.status };
    return {
      provider: "grok-api" as const,
      model: grokModelCheck.model,
      reasoningEffort: "none",
      size: rawSize,
      webSearchEnabled: rawWebSearchEnabled !== false && searchMode !== "off",
    };
  }

  const activeProvider = provider === "api" ? "api" : "oauth";
  const toolModelCheck = normalizeImageToolModel(activeProvider, rawImageToolModel);
  if (toolModelCheck.error !== undefined) return { error: toolModelCheck.error, code: toolModelCheck.code, status: toolModelCheck.status };
  const apiConfig: { defaultImageModel?: string; defaultReasoningEffort?: string; defaultSize?: string; allowWebSearch?: boolean } = ctx?.config?.apiProvider || {};
  const modelInput = activeProvider === "api"
    ? (rawModel || apiConfig.defaultImageModel || API_FALLBACK_IMAGE_MODEL)
    : rawModel;
  const modelCheck = normalizeImageModel(ctx, modelInput, activeProvider);
  if (modelCheck.error !== undefined) return { error: modelCheck.error, code: modelCheck.code, status: modelCheck.status };

  const reasoningInput = activeProvider === "api"
    ? (rawReasoningEffort || apiConfig.defaultReasoningEffort || "low")
    : rawReasoningEffort;
  const reasoningCheck = normalizeReasoningEffort(ctx, reasoningInput);
  if (reasoningCheck.error !== undefined) {
    return { error: reasoningCheck.error, code: reasoningCheck.code, status: reasoningCheck.status };
  }
  // Applied after validation so an unsupported model/effort pairing cannot reach
  // the upstream request. See coerceReasoningEffortForModel.
  const effort = coerceReasoningEffortForModel(modelCheck.model, reasoningCheck.effort);

  const size = activeProvider === "api" && (typeof rawSize !== "string" || rawSize.length === 0)
    ? (apiConfig.defaultSize || "1024x1024")
    : rawSize;
  const webSearchEnabled = activeProvider === "api"
    ? apiConfig.allowWebSearch !== false && rawWebSearchEnabled !== false && searchMode !== "off"
    : rawWebSearchEnabled !== false && searchMode !== "off";

  return {
    provider: activeProvider as "api" | "oauth",
    imageToolModel: toolModelCheck.imageToolModel,
    model: modelCheck.model,
    reasoningEffort: effort,
    size,
    webSearchEnabled,
  };
}
