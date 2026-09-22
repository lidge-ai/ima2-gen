import { compressReferenceB64ForOAuth } from "../../referenceImageCompress.js";
import { detectImageMimeFromB64 } from "../../refs.js";
import { type RouteRuntimeContext, requireRuntimeContext } from "../../runtimeContext.js";
import {
  imageToolChoice,
  imageToolChoiceKind,
  tools,
  toolTypes,
} from "../../responsesTools.js";
import { emptyResponseError } from "../../responsesErrors.js";
import { retryPromptOnlyJsonImage } from "../../responsesFallback.js";
import {
  AUTO_PROMPT_FIDELITY_SUFFIX,
  DIRECT_PROMPT_FIDELITY_SUFFIX,
  EDIT_DEVELOPER_PROMPT,
  EDIT_NO_SEARCH_DEVELOPER_PROMPT,
  GENERATE_DEVELOPER_PROMPT,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  MULTIMODE_DEVELOPER_PROMPT,
  MULTIMODE_NO_SEARCH_DEVELOPER_PROMPT,
  buildEditTextPrompt,
  buildMultimodeSequencePrompt,
  buildUserTextPrompt,
} from "../../oauthProxy.js";
import { normalizeOAuthParams, normalizeImageToolModel } from "../../oauthNormalize.js";
import { postResponses } from "../../responsesTransport.js";
import type { ReferenceRef, GenerateOptions } from "./openaiTypes.js";

function normalizeRef(ref: ReferenceRef) {
  const b64 = typeof ref === "string" ? ref : ref?.b64;
  const detectedMime = typeof ref === "object" && ref?.detectedMime
    ? ref.detectedMime
    : detectImageMimeFromB64(b64);
  const declaredMime = typeof ref === "object" ? ref?.declaredMime : null;
  const mime = ["image/png", "image/jpeg", "image/webp"].includes(detectedMime as string)
    ? detectedMime
    : ["image/png", "image/jpeg", "image/webp"].includes(declaredMime as string)
      ? declaredMime
      : "image/png";
  return { type: "input_image", image_url: `data:${mime};base64,${b64}` };
}

export async function generateViaResponses(provider: string | undefined, prompt: string | undefined, quality: string | undefined, size: string | undefined, moderation: string = "low", references: ReferenceRef[] = [], requestId: string | null = null, mode: string = "auto", ctxRaw: RouteRuntimeContext = {}, options: GenerateOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const model = options.model || ctx.config?.imageModels?.default || "gpt-5.6-luna";
  const webSearchEnabled = options.webSearchEnabled !== false && options.searchMode !== "off";
  const toolModel = normalizeImageToolModel(provider ?? "oauth", options.imageToolModel);
  if (toolModel.error) throw Object.assign(new Error(toolModel.error), { code: toolModel.code, status: toolModel.status });
  if (quality === "xhigh" || quality === "max") {
    quality = normalizeOAuthParams({ provider, quality, imageToolModel: toolModel.imageToolModel }).quality;
  }
  const requestTools = tools(webSearchEnabled, { ...(toolModel.imageToolModel ? { model: toolModel.imageToolModel } : {}),
    quality,
    size,
    moderation,
    ...(options.partialImages ? { partial_images: options.partialImages } : {}),
    ...(options.background ? { background: options.background } : {}),
    ...(options.outputFormat ? { output_format: options.outputFormat } : {}),
  });
  const toolChoice = imageToolChoice(options.forceImageToolChoice ?? ctx.config?.oauth?.forceImageToolChoice !== false);
  const toolChoiceKind = imageToolChoiceKind(toolChoice);
  const referenceInputs = references.map(normalizeRef);
  const userContent = referenceInputs.length
    ? [...referenceInputs, { type: "input_text", text: buildUserTextPrompt(prompt, mode, { webSearchEnabled, size }) }]
    : buildUserTextPrompt(prompt, mode, { webSearchEnabled, size });
  const result = await postResponses({
    ctx,
    provider,
    scope: provider === "api" ? "api-generate" : "oauth",
    requestId,
    maxImages: 1,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.onPartialImage !== undefined ? { onPartialImage: options.onPartialImage } : {}),
    ...(options.onFinalImage !== undefined ? { onFinalImage: options.onFinalImage } : {}),
    payload: {
      model,
      input: [
        { role: "developer", content: webSearchEnabled ? GENERATE_DEVELOPER_PROMPT : GENERATE_NO_SEARCH_DEVELOPER_PROMPT },
        { role: "user", content: userContent },
      ],
      tools: requestTools,
      tool_choice: toolChoice,
      reasoning: { effort: options.reasoningEffort || "low" },
      stream: true,
    },
  });
  const image = result.images[0];
  if (!image?.b64) {
    if (options.allowPromptOnlyOAuthFallback === true) {
      const fallback = await retryPromptOnlyJsonImage({
        postResponses,
        ctx,
        provider,
        prompt,
        mode,
        model,
        quality,
        size,
        moderation,
        requestId,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        initial: result,
        referenceInputs,
        webSearchDroppedOnRetry: webSearchEnabled,
        ...(options.reasoningEffort !== undefined ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(options.background !== undefined ? { background: options.background } : {}),
        ...(options.outputFormat !== undefined ? { outputFormat: options.outputFormat } : {}),
      });
      if (fallback) return fallback;
    }
    throw emptyResponseError("No image data received from Responses API", result, {
      provider,
      model,
      quality,
      size,
      moderation,
      webSearchEnabled,
      refsCount: referenceInputs.length,
      inputImageCount: referenceInputs.length,
      promptChars: typeof prompt === "string" ? prompt.length : 0,
      toolTypes: toolTypes(requestTools),
      toolChoiceKind,
    });
  }
  return { b64: image.b64, usage: result.usage, webSearchCalls: result.webSearchCalls, revisedPrompt: image.revisedPrompt, text: result.text };
}

export async function generateMultimodeViaResponses(provider: string | undefined, prompt: string | undefined, quality: string | undefined, size: string | undefined, moderation: string = "low", references: ReferenceRef[] = [], requestId: string | null = null, mode: string = "auto", ctxRaw: RouteRuntimeContext = {}, options: GenerateOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const maxGeneratedImages = Math.max(
    1,
    Math.trunc(Number(ctx.config.limits.maxGeneratedImages) || 24),
  );
  const maxImages = Math.min(
    maxGeneratedImages,
    Math.max(1, Math.trunc(Number(options.maxImages) || 1)),
  );
  const model = options.model || ctx.config?.imageModels?.default || "gpt-5.6-luna";
  const webSearchEnabled = options.webSearchEnabled !== false && options.searchMode !== "off";
  const toolModel = normalizeImageToolModel(provider ?? "oauth", options.imageToolModel);
  if (toolModel.error) throw Object.assign(new Error(toolModel.error), { code: toolModel.code, status: toolModel.status });
  if (quality === "xhigh" || quality === "max") {
    quality = normalizeOAuthParams({ provider, quality, imageToolModel: toolModel.imageToolModel }).quality;
  }
  const requestTools = tools(webSearchEnabled, { ...(toolModel.imageToolModel ? { model: toolModel.imageToolModel } : {}), quality, size, moderation, ...(options.partialImages ? { partial_images: options.partialImages } : {}) });
  const userText = buildMultimodeSequencePrompt(
    mode === "direct"
      ? `${prompt}${DIRECT_PROMPT_FIDELITY_SUFFIX}`
      : `${prompt}${webSearchEnabled ? "" : ""}${AUTO_PROMPT_FIDELITY_SUFFIX}`,
    maxImages,
    { webSearchEnabled, size },
  );
  const referenceInputs = references.map(normalizeRef);
  const userContent = referenceInputs.length
    ? [...referenceInputs, { type: "input_text", text: userText }]
    : userText;
  return await postResponses({
    ctx,
    provider,
    scope: provider === "api" ? "api-multimode" : "oauth-multimode",
    requestId,
    maxImages,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.onPartialImage !== undefined ? { onPartialImage: options.onPartialImage } : {}),
    ...(options.onFinalImage !== undefined ? { onFinalImage: options.onFinalImage } : {}),
    payload: {
      model,
      input: [
        { role: "developer", content: webSearchEnabled ? MULTIMODE_DEVELOPER_PROMPT : MULTIMODE_NO_SEARCH_DEVELOPER_PROMPT },
        { role: "user", content: userContent },
      ],
      tools: requestTools,
      tool_choice: "required",
      reasoning: { effort: options.reasoningEffort || "low" },
      stream: true,
    },
  });
}

export async function editViaResponses(provider: string | undefined, prompt: string | undefined, imageB64: string | undefined, quality: string | undefined, size: string | undefined, moderation: string = "low", mode: string = "auto", ctxRaw: RouteRuntimeContext = {}, requestId: string | null = null, options: GenerateOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const model = options.model || ctx.config?.imageModels?.default || "gpt-5.6-luna";
  const webSearchEnabled = options.webSearchEnabled !== false && options.searchMode !== "off";
  const toolModel = normalizeImageToolModel(provider ?? "oauth", options.imageToolModel);
  if (toolModel.error) throw Object.assign(new Error(toolModel.error), { code: toolModel.code, status: toolModel.status });
  if (quality === "xhigh" || quality === "max") {
    quality = normalizeOAuthParams({ provider, quality, imageToolModel: toolModel.imageToolModel }).quality;
  }
  const requestTools = tools(webSearchEnabled, { ...(toolModel.imageToolModel ? { model: toolModel.imageToolModel } : {}), quality, size, moderation });
  const toolChoice = imageToolChoice(options.forceImageToolChoice ?? ctx.config?.oauth?.forceImageToolChoice !== false);
  const toolChoiceKind = imageToolChoiceKind(toolChoice);
  const imageForRequest = await compressReferenceB64ForOAuth(imageB64, {
    maxB64Bytes: ctx.config?.limits?.maxRefB64Bytes,
    force: true,
  });
  const referenceImages = await Promise.all((Array.isArray(options.references) ? options.references : []).map((ref: ReferenceRef) =>
    compressReferenceB64ForOAuth(typeof ref === "string" ? ref : ref?.b64, {
      maxB64Bytes: ctx.config?.limits?.maxRefB64Bytes,
      force: true,
    }),
  ));
  const maskContent = typeof options.mask === "string" && options.mask.length > 0
    ? [
        { type: "input_image", image_url: `data:image/png;base64,${options.mask}` },
        { type: "input_text", text: "The previous image is an edit mask guide. Use it as prompt guidance for where the edit should apply; it is not a visible final image element." },
      ]
    : [];
  const userContent = [
    { type: "input_image", image_url: `data:image/jpeg;base64,${imageForRequest.b64}` },
    ...referenceImages.map(({ b64 }) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${b64}` })),
    ...maskContent,
    { type: "input_text", text: buildEditTextPrompt(prompt, mode, { webSearchEnabled, size }) },
  ];
  const result = await postResponses({
    ctx,
    provider,
    scope: provider === "api" ? "api-edit" : "oauth-edit",
    requestId,
    maxImages: 1,
    signal: options.signal,
    payload: {
      model,
      input: [
        { role: "developer", content: webSearchEnabled ? EDIT_DEVELOPER_PROMPT : EDIT_NO_SEARCH_DEVELOPER_PROMPT },
        { role: "user", content: userContent },
      ],
      tools: requestTools,
      tool_choice: toolChoice,
      reasoning: { effort: options.reasoningEffort || "low" },
      stream: true,
    },
  });
  const image = result.images[0];
  if (!image?.b64) {
    throw emptyResponseError("No image data received from Responses edit", result, {
      provider,
      model,
      quality,
      size,
      moderation,
      webSearchEnabled,
      refsCount: referenceImages.length,
      inputImageCount: 1 + referenceImages.length + (maskContent.length ? 1 : 0),
      promptChars: typeof prompt === "string" ? prompt.length : 0,
      toolTypes: toolTypes(requestTools),
      toolChoiceKind,
    });
  }
  return { b64: image.b64, usage: result.usage, revisedPrompt: image.revisedPrompt, webSearchCalls: result.webSearchCalls };
}
