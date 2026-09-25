import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { atomicWriteJson } from "./atomicWrite.js";
import { join } from "node:path";
import { ulid } from "ulid";
import { buildFilename, writeFileUnique } from "./filename.js";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import { logEvent } from "./logger.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { resolveProviderOptions } from "./providerOptions.js";
import { generateViaResponses } from "./responsesImageAdapter.js";
import { generateViaGrok, type GrokReferenceImage } from "./grokImageAdapter.js";
import { generateViaAgy } from "./agyImageAdapter.js";
import { generateViaAtlasCloud } from "./atlasCloudImageAdapter.js";
import { generateViaMinimax } from "./minimaxImageAdapter.js";
import { generateViaNai } from "./naiImageAdapter.js";
import { DEFAULT_GROK_PLANNER_MODEL } from "../config.js";
import { generateVideoViaGrok, type GrokVideoGenerateResult } from "./grokVideoAdapter.js";
import { GROK_VIDEO_MODEL_15, GROK_VIDEO_MODEL_BASE, resolveGrokQualityModel, validateVideoResolutionForRequest } from "./imageModels.js";
import { parseVideoParams } from "./agentGenerationPlanner.js";
import {
  isVideoGenerationError,
  normalizeVideoGenerationRequest,
} from "./videoGenerationRequest.js";
import {
  appendAgentTurn,
  getAgentImages,
  getAgentSession,
  importAgentImage,
} from "./agentStore.js";
import type { AgentSourceImagePolicy, AgentToolCallSummary } from "./agentTypes.js";
import { errInfo } from "./errInfo.js";
import { type RuntimeContext } from "./runtimeContext.js";
import { type AgentRunOptions, forceImagePrompt, isTextOnlyResult, textOnlyError, notFound } from "./agentRuntime.js";

// Spelled out rather than derived from the default, so moving the default does not
// silently drop a model agents are allowed to ask for.
const AGENT_GROK_PLANNER_MODELS = new Set([DEFAULT_GROK_PLANNER_MODEL, "grok-4.6", "grok-4.5", "grok-4.3"]);

export async function generateAgentImageWithRetry(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  manifest: string,
  webSearchEnabled: boolean,
  options: AgentRunOptions,
) {
  options.onProgressStage?.("requesting");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const forcedPrompt = attempt === 0 ? prompt : forceImagePrompt(prompt);
      const result = await generateAgentImage(ctx, sessionId, forcedPrompt, manifest, webSearchEnabled, options);
      if (result.image) return result;
    } catch (error) {
      lastError = error;
      if (!isTextOnlyResult(error)) throw error;
      if (attempt === 1) break;
      appendAgentTurn({
        sessionId,
        role: "tool",
        text: "ima2.generate_image retry: text-only result rejected",
        status: "error",
      });
    }
  }
  throw textOnlyError(lastError);
}

async function generateAgentImage(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  manifest: string,
  webSearchEnabled: boolean,
  options: AgentRunOptions,
) {
  const requestId = options.requestId ?? `agent_${ulid()}`;
  const grokPlannerModel = isAgentGrokPlannerModel(options.model) ? options.model : undefined;
  // Agent Mode has no comfy dispatch in this unit. This surface has no response
  // object, so it throws the way its other provider failures do. Without it the
  // run reaches generateViaResponses and bills OAuth. Removed in wp7.
  if ((options.provider ?? "oauth") === "comfy") {
    const err = new Error("provider 'comfy' is not supported on this surface yet") as Error & { code?: string | undefined; status?: number | undefined };
    err.code = "COMFY_SURFACE_UNSUPPORTED";
    err.status = 400;
    throw err;
  }
  const providerOptions = resolveProviderOptions(ctx, {
    provider: options.provider ?? "oauth",
    rawModel: grokPlannerModel ? undefined : options.model,
    rawReasoningEffort: options.reasoningEffort,
    rawSize: options.size ?? "1024x1024",
    rawWebSearchEnabled: webSearchEnabled,
    searchMode: webSearchEnabled ? "on" : "off",
  });
  if (providerOptions.error !== undefined) {
    const err = new Error(providerOptions.error) as Error & { code?: string | undefined; status?: number | undefined };
    err.code = providerOptions.code;
    err.status = providerOptions.status;
    throw err;
  }
  const activeProvider = providerOptions.provider;
  const effectiveModel = activeProvider === "grok"
    ? resolveGrokQualityModel(providerOptions.model, options.quality)
    : providerOptions.model;
  const response = activeProvider === "agy"
    ? await generateViaAgy(`${manifest}\n\nUser request:\n${prompt}`, {
        requestId,
        ...(options.signal ? { signal: options.signal } : {}),
      })
    : activeProvider === "atlascloud" 
    ? await generateViaAtlasCloud(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel,
        size: providerOptions.size,
        quality: options.quality ?? "medium",
        requestId,
        ...(options.signal ? { signal: options.signal } : {}),
        references: await loadAgentCurrentImageReferences(ctx, sessionId, options.sourceImagePolicy ?? "none"),
      })
    : activeProvider === "minimax"
    ? await generateViaMinimax(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel,
        size: providerOptions.size,
        requestId,
        ...(options.signal ? { signal: options.signal } : {}),
        references: await loadAgentCurrentImageReferences(ctx, sessionId, options.sourceImagePolicy ?? "none"),
      })
    : activeProvider === "nai"
    ? await generateViaNai(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel,
        size: providerOptions.size,
        requestId,
        ...(options.signal ? { signal: options.signal } : {}),
        // Intentionally no references: the adapter is text-to-image only, and
        // silently forwarding the session's current image would misrepresent
        // the result as an edit.
      })
    : activeProvider === "grok"
    ? await generateViaGrok(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel,
        size: providerOptions.size,
        requestId,
        ...(options.signal ? { signal: options.signal } : {}),
        references: await loadAgentCurrentImageReferences(ctx, sessionId, options.sourceImagePolicy ?? "none"),
        plannerModel: grokPlannerModel,
      })
    : await generateViaResponses(
        activeProvider,
        `${manifest}\n\nUser request:\n${prompt}`,
        options.quality ?? "medium",
        providerOptions.size,
        options.moderation ?? "low",
        // The session image must reach the model here too. atlascloud/minimax/grok
        // all forward it; this branch used to pass [], so on the default OAuth/API
        // path the model was asked to edit an image it could not see and answered in
        // prose - which classifies as a retryable no-image result (issue #192).
        await loadAgentCurrentImageReferences(ctx, sessionId, options.sourceImagePolicy ?? "none"),
        requestId,
        "auto",
        ctx,
        {
          model: providerOptions.model,
          reasoningEffort: providerOptions.reasoningEffort,
          webSearchEnabled,
          signal: options.signal,
        },
      );
  const format = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai"
    ? imageFormatFromMime(("mime" in response ? response.mime : undefined) || detectImageMimeFromB64(response.b64) || "image/jpeg")
    : options.format ?? "png";
  if (!response.b64) {
    // agy and atlascloud can resolve with an empty payload (0-byte artifact or a
    // 0-byte HTTP 200 body). Without this guard persistAgentImage writes a 0-byte
    // file and registers it as a real image, which is worse than an error.
    const emptyErr = new Error("Provider returned an empty image.") as Error & { code?: string | undefined; status?: number | undefined };
    emptyErr.code = "PROVIDER_EMPTY_IMAGE";
    emptyErr.status = 502;
    throw emptyErr;
  }
  const image = await persistAgentImage(ctx, sessionId, prompt, format, providerOptions.size, requestId, response, {
    provider: String(activeProvider),
    model: String(effectiveModel),
  });
  const responseText = "text" in response && typeof response.text === "string" ? response.text : null;
  return { image, webSearchCalls: response.webSearchCalls || 0, text: responseText, provider: activeProvider };
}

async function loadAgentCurrentImageReferences(
  ctx: RuntimeContext,
  sessionId: string,
  policy: AgentSourceImagePolicy,
): Promise<GrokReferenceImage[]> {
  if (policy === "none") {
    logEvent("agent", "grok_ref_policy", { sessionId, policy, attached: false });
    return [];
  }
  const session = getAgentSession(sessionId);
  const currentImage = session?.lastImageId
    ? getAgentImages(sessionId).find((image) => image.id === session.lastImageId)
    : null;
  if (!currentImage?.filename) {
    logEvent("agent", "grok_ref_policy", { sessionId, policy, attached: false });
    return [];
  }
  try {
    const b64 = (await readFile(join(ctx.config.storage.generatedDir, currentImage.filename))).toString("base64");
    const mime = detectImageMimeFromB64(b64);
    logEvent("agent", "grok_ref_policy", { sessionId, policy, attached: true, filename: currentImage.filename });
    return [{ b64, declaredMime: mime, detectedMime: mime }];
  } catch (error) {
    const err = errInfo(error);
    logEvent("agent", "grok_ref_missing", { sessionId, filename: currentImage.filename, code: err.code, message: err.message });
    return [];
  }
}

function imageFormatFromMime(mime: string | null | undefined): "png" | "jpeg" | "webp" {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function persistAgentImage(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  format: string,
  size: string,
  requestId: string,
  response: { b64: string; revisedPrompt?: string | null | undefined; usage?: unknown | undefined; webSearchCalls?: number | undefined; mime?: string | undefined; text?: string | null | undefined },
  generation: { provider: string; model: string },
) {
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const createdAt = Date.now();
  const baseName = buildFilename({ model: generation.model, size, createdAt, prompt, ext: format });
  const meta = {
    kind: "agent",
    requestId,
    sessionId,
    prompt,
    userPrompt: prompt,
    revisedPrompt: response.revisedPrompt ?? null,
    provider: generation.provider,
    model: generation.model,
    createdAt,
    usage: response.usage ?? null,
    webSearchCalls: response.webSearchCalls ?? 0,
  };
  const embedded = await embedImageMetadataBestEffort(Buffer.from(response.b64, "base64"), format, meta, {
    version: ctx.packageVersion,
  });
  const filename = await writeFileUnique(ctx.config.storage.generatedDir, baseName, embedded.buffer);
  const filePath = join(ctx.config.storage.generatedDir, filename);
  try {
    await atomicWriteJson(`${filePath}.json`, meta);
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
  invalidateHistoryIndex();
  logEvent("agent", "saved", { requestId, sessionId, filename });
  return importAgentImage(sessionId, {
    id: `ai_${ulid()}`,
    filename,
    url: `/generated/${filename}`,
    prompt,
    revisedPrompt: response.revisedPrompt ?? null,
    createdAt,
  });
}

export async function runAgentVideoGeneration(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  options: AgentRunOptions & { skipUserTurn?: boolean | undefined; assistantText?: string | null | undefined } = {},
) {
  const session = getAgentSession(sessionId);
  if (!session) throw notFound(sessionId);
  if (!options.skipUserTurn) {
    appendAgentTurn({ sessionId, role: "user", text: prompt, status: "complete" });
  }
  const requestId = options.requestId ?? `agent_video_${ulid()}`;
  const startedAt = Date.now();

  // Attach the session's current image unless the planner said not to. The image path
  // has always honored this policy; the video path ignored it, so "make something new"
  // still got the previous image welded on as the first frame.
  //
  // The planner also chooses what the image MEANS. A first frame reproduces the source
  // shot; a reference carries the subject into a new one. Chat has no reference tray,
  // so without the planner saying which, reference-to-video was unreachable here.
  // devlog/_plan/260820_grok15_multi_reference_video/020_agent_reference_loss.md
  const requestedMode = options.videoParams?.mode;
  const attachPolicy = options.sourceImagePolicy ?? "auto";
  let sourceImage: string | undefined;
  let referenceImages: string[] | undefined;
  if (attachPolicy !== "none" && session.lastImageId) {
    const images = getAgentImages(sessionId);
    const lastImage = images.find((img) => img.id === session.lastImageId);
    if (lastImage?.filename && !lastImage.filename.endsWith(".mp4")) {
      try {
        const { loadAssetB64 } = await import("./nodeStore.js");
        const b64 = await loadAssetB64(ctx.rootDir, lastImage.filename, ctx.config.storage.generatedDir);
        if (requestedMode === "reference-to-video") referenceImages = [b64];
        else sourceImage = b64;
      } catch { /* fallback to T2V */ }
    }
  }

  // LLM-planned params win; the prompt regex remains the fallback extractor.
  const parsedParams = parseVideoParams(prompt);
  // Route the agent through the same normalizer the HTTP surface uses, so defaults and
  // validation cannot drift between "generate from chat" and "generate from the app".
  const normalized = normalizeVideoGenerationRequest({
    prompt,
    sourceImage,
    ...(referenceImages ? { referenceImages } : {}),
    ...(requestedMode ? { mode: requestedMode } : {}),
    duration: options.videoParams?.duration ?? parsedParams.duration,
    resolution: options.videoParams?.resolution ?? parsedParams.resolution,
    aspectRatio: options.videoParams?.aspectRatio ?? parsedParams.aspectRatio,
    requestId,
  });
  if (isVideoGenerationError(normalized)) {
    throw Object.assign(new Error(normalized.error), {
      status: normalized.status,
      code: normalized.code,
    });
  }
  const videoParams = normalized.request;
  const videoModel = videoParams.resolution === "1080p"
    ? GROK_VIDEO_MODEL_15
    : GROK_VIDEO_MODEL_BASE;
  // Reference-to-video has no 1080p (xAI returns 400). Say so instead of quietly
  // downgrading the resolution — silently altering the request is the defect this
  // work-phase exists to remove. Same helper the HTTP route uses, so the two surfaces
  // cannot drift apart again.
  const resolutionCheck = validateVideoResolutionForRequest(videoModel, videoParams.resolution, videoParams.mode, {
    allowTextCanvasShim: true,
  });
  if (!("ok" in resolutionCheck)) {
    throw Object.assign(new Error(resolutionCheck.error), {
      status: resolutionCheck.status,
      code: resolutionCheck.code,
    });
  }

  options.onProgressStage?.("requesting");
  const result = await generateVideoViaGrok(prompt, ctx, {
    model: videoModel,
    mode: videoParams.mode,
    sourceImage,
    ...(videoParams.referenceImages ? { referenceImages: videoParams.referenceImages } : {}),
    ...(videoParams.referenceAudios ? { referenceAudios: videoParams.referenceAudios } : {}),
    duration: videoParams.duration,
    resolution: videoParams.resolution,
    aspectRatio: videoParams.aspectRatio as "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3",
    requestId,
    signal: options.signal ?? undefined,
    plannerModel: isAgentGrokPlannerModel(options.model) ? options.model : undefined,
    onEvent: (event) => {
      if (event.phase === "submitted" || event.phase === "progress") {
        options.onProgressStage?.("polling");
      }
    },
  });
  options.onProgressStage?.("downloading");
  const video = await persistAgentVideo(ctx, sessionId, prompt, requestId, result);
  const finishedAt = Date.now();
  const toolCall: AgentToolCallSummary = {
    id: `tc_video_${ulid()}`,
    name: "ima2.generate_video",
    status: "complete",
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    requestId,
    inputSummary: prompt,
    outputSummary: `Generated video ${video.filename}.`,
    imageIds: [video.id],
  };
  appendAgentTurn({
    sessionId,
    role: "tool",
    text: "ima2.generate_video",
    imageIds: [video.id],
    status: "complete",
    raw: { toolCalls: [toolCall] },
  });
  const assistantTurn = appendAgentTurn({
    sessionId,
    role: "assistant",
    text: options.assistantText?.trim() || `Generated 1 video artifact. ${result.revisedPrompt}`,
    imageIds: [video.id],
    status: "complete",
  });
  return { assistantTurn, imageIds: [video.id], webFindingIds: [] };
}

function isAgentGrokPlannerModel(model: string | null | undefined): model is string {
  return typeof model === "string" && AGENT_GROK_PLANNER_MODELS.has(model);
}

async function persistAgentVideo(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  requestId: string,
  result: Pick<
    GrokVideoGenerateResult,
    | "videoBuffer"
    | "revisedPrompt"
    | "usage"
    | "webSearchCalls"
    | "requestedModel"
    | "effectiveModel"
    | "modelFallback"
    | "duration"
    | "resolution"
    | "aspectRatio"
    | "mode"
    | "xaiVideoRequestId"
  >,
) {
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
  const filename = `${Date.now()}_${rand}_agent.mp4`;
  const meta = {
    kind: "agent",
    mediaType: "video",
    requestId,
    sessionId,
    prompt,
    userPrompt: prompt,
    revisedPrompt: result.revisedPrompt,
    provider: "grok",
    model: result.effectiveModel,
    requestedModel: result.requestedModel,
    effectiveModel: result.effectiveModel,
    modelFallback: result.modelFallback,
    createdAt: Date.now(),
    usage: result.usage,
    webSearchCalls: result.webSearchCalls,
    video: {
      duration: result.duration,
      resolution: result.resolution,
      aspectRatio: result.aspectRatio,
      mode: result.mode,
      xaiVideoRequestId: result.xaiVideoRequestId,
      requestedModel: result.requestedModel,
      effectiveModel: result.effectiveModel,
      modelFallback: result.modelFallback,
    },
  };
  const filePath = join(ctx.config.storage.generatedDir, filename);
  await writeFile(filePath, result.videoBuffer);
  try {
    await atomicWriteJson(`${filePath}.json`, meta);
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
  invalidateHistoryIndex();
  logEvent("agent", "video_saved", { requestId, sessionId, filename });
  return importAgentImage(sessionId, {
    id: `ai_${ulid()}`,
    filename,
    url: `/generated/${filename}`,
    prompt,
    revisedPrompt: result.revisedPrompt,
    createdAt: Date.now(),
  });
}
