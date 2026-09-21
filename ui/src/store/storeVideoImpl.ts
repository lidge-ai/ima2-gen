import type { GenerateItem, VideoContinuityLineage } from "../types";
import { postVideoGenerateStream } from "../lib/api";
import { addHistory } from "./storeGraphSave";
import { isVideoUrl } from "../lib/videoMedia";
import { frameExtraction } from "../lib/frameExtraction";
import {
  ACTIVE_VIDEO_PROMPT_GUIDANCE,
  buildVideoContinuityFromItem,
} from "../lib/videoContinuity";
import { composePrompt } from "./storePersistence";
import {
  type PersistedInFlight,
  saveInFlight,
  isCanceledGenerationError,
} from "./storeHelpers";
import type { AppState, ImageNodeData } from "./storeTypes";
import type { ClientNodeId } from "../lib/graph";
import { missingElementsBlock } from "./storeGenerateEntryImpl";
import { clearFlightAbort, registerFlightAbort } from "./flightAbortRegistry";
import { t } from "../i18n";
import { handleError } from "../lib/errorHandler";
import { resolveErrorSpec } from "../lib/errorCodes";
import { buildNodeErrorInfo } from "../lib/nodeErrorInfo";
import { compilePresets, type PresetProvider } from "../../../lib/presetCompiler.js";
import { getAllPresets } from "../lib/presets";

type StoreSet = (p: Partial<AppState>) => void;
type StoreGet = () => AppState;

function selectedElementIds(state: AppState): string[] {
  const ids = (state as AppState & { selectedElementIds?: unknown }).selectedElementIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Resolves which lane a video request belongs to.
 *
 * Both call sites used to cast the provider to grok unconditionally, so a comfy
 * workflow selected in the UI still submitted a Grok generation. Lanes that
 * cannot do video keep folding to grok, which is the historical behavior.
 */
function videoLaneFields(state: AppState): { provider: "grok" | "grok-api" | "comfy"; model?: string } {
  if (state.provider === "comfy" && state.comfyVideoWorkflow) {
    return { provider: "comfy", model: state.comfyVideoWorkflow };
  }
  const provider = state.provider === "grok-api" ? "grok-api" : "grok";
  const model = typeof state.videoModelSelected === "string" ? state.videoModelSelected : undefined;
  return model ? { provider, model } : { provider };
}

function toPresetProvider(provider: AppState["provider"]): PresetProvider {
  if (provider === "grok" || provider === "grok-api") return "grok";
  if (provider === "gemini-api") return "gemini";
  return "gpt";
}

export async function runVideoGenerateImpl(
  nodeId: ClientNodeId | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const node = nodeId ? get().graphNodes.find((n) => n.id === nodeId) : null;
  const refs = node ? (node.data.referenceImages ?? []) : get().referenceImages;
  const singleRefAsSource = refs.length === 1 && get().videoSingleRefMode === "image-to-video";
  const userPrompt = node ? node.data.prompt.trim() : composePrompt(get().prompt, get().insertedPrompts);
  if (!userPrompt.trim()) {
    get().showToast(ACTIVE_VIDEO_PROMPT_GUIDANCE, true);
    return;
  }
  const presetState = get();
  const compiled = compilePresets({
    catalog: getAllPresets(),
    presetIds: presetState.selectedPresetIds,
    provider: toPresetProvider(presetState.provider),
    mode: "video",
  });
  const prompt = compiled.promptFragment
    ? `${compiled.promptFragment} ${userPrompt}`
    : userPrompt;

  let parentSourceFilename: string | undefined;
  let parentVideoFrameRef: string | undefined;
  let parentVideoContinuity: VideoContinuityLineage | null = node ? node.data.videoContinuity ?? null : get().videoContinuityLineage;
  let continueFromVideo: string | undefined;
  if (node && refs.length === 0 && node.data.parentServerNodeId) {
    const parentNode = get().graphNodes.find(
      (n) => n.data.serverNodeId === node.data.parentServerNodeId,
    );
    if (parentNode?.data.imageUrl) {
      if (isVideoUrl(parentNode.data.imageUrl)) {
        try {
          // This caller knows the generated filename (it derives `continueFromVideo`
          // from the same URL below), so it can take the server ffmpeg path. ffmpeg
          // picks a real frame from the tail; the browser's `duration - 0.1` seek can
          // land on a black fade-out frame.
          const parentFilename = parentNode.data.imageUrl.replace(/^\/generated\//, "");
          parentVideoFrameRef = (await frameExtraction.extractFrame(
            { kind: "generated", filename: parentFilename },
            "last",
          )).dataUrl;
          parentVideoContinuity = parentNode.data.videoContinuity ?? buildVideoContinuityFromItem({
            filename: parentFilename,
            prompt: parentNode.data.prompt,
            userPrompt: parentNode.data.prompt,
            revisedPrompt: parentNode.data.prompt,
            createdAt: Date.now(),
            videoContinuity: null,
          });
          continueFromVideo = parentFilename;
        } catch {
          get().showToast(t("video.continuationFallbackT2V"), true);
        }
      } else {
        parentSourceFilename = parentNode.data.imageUrl.replace(/^\/generated\//, "");
      }
    }
  }

  const startedAt = Date.now();
  const autoSelectStartedAt = startedAt;
  const flightId = `vid_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
  const controller = new AbortController();
  registerFlightAbort(flightId, controller);
  const requestSessionId = get().activeSessionId;
  const nextInFlight: PersistedInFlight[] = [
    ...get().inFlight,
    { id: flightId, prompt, startedAt, kind: "video" as const, sessionId: requestSessionId, clientNodeId: nodeId ?? null },
  ];
  saveInFlight(nextInFlight);

  if (node) {
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status: "pending" as const, pendingRequestId: flightId, pendingPhase: "queued", pendingStartedAt: startedAt, partialImageUrl: null, error: undefined, errorInfo: null } }
          : n,
      ),
    });
  }

  set({ inFlight: nextInFlight, activeGenerations: nextInFlight.length, videoProgress: 0 });
  get().startInFlightPolling();
  try {
    const providerUrl = get().providerUrlReference;
    const payload = {
      prompt,
      requestId: flightId,
      ...videoLaneFields(get()),
      // One attachment is ambiguous and the user owns the answer: animate this exact
      // picture (first frame) or carry its subject into a new scene (reference). Two or
      // more can only be references. v3.8.0 forced every count into the reference slot,
      // which silently took first-frame workflows away from anyone dragging in a single
      // photo — devlog/_plan/260820_grok15_multi_reference_video/060_single_ref_mode_restore.md
      referenceImages: refs.length > 0 && !singleRefAsSource ? refs : undefined,
      sourceImage: singleRefAsSource ? refs[0] : (refs.length > 0 ? undefined : parentVideoFrameRef),
      sourceFilename: refs.length === 0 && !parentVideoFrameRef ? parentSourceFilename : undefined,
      continueFromVideo,
      continuityLineage: parentVideoContinuity,
      duration: get().videoDuration,
      resolution: get().videoResolution,
      aspectRatio: get().videoAspectRatio,
      // Sent only when a voice is selected: the route treats an absent field and an
      // empty array differently, and an empty array would advertise reference-to-video
      // for a request that has nothing to reference.
      ...(get().videoReferenceVoices.length > 0 ? { referenceAudios: get().videoReferenceVoices } : {}),
      topic: get().videoTopic || undefined,
      storyboard: get().storyboardActive || undefined,
      presetIds: compiled.appliedPresetIds,
      elementIds: selectedElementIds(get()),
      sessionId: requestSessionId,
      clientNodeId: nodeId ?? null,
      ...(providerUrl ? { providerUrl } : {}),
    };
    const result = await postVideoGenerateStream(
      payload,
      {
        onPlanning: () => set({ inFlight: get().inFlight.map((f) => f.id === flightId ? { ...f, phase: "planning" } : f) }),
        onSubmitted: () => set({ inFlight: get().inFlight.map((f) => f.id === flightId ? { ...f, phase: "streaming" } : f) }),
        onProgress: ({ progress }) => set({ videoProgress: progress ?? null }),
      },
      { signal: controller.signal },
    );

    if (node && result && get().activeSessionId === requestSessionId) {
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  serverNodeId: result.filename.replace(/\.[^.]+$/, ""),
                  // Video thay mat anh o imageUrl. Giu lai anh nguon de con
                  // sinh lai video duoc - khong giu thi node thanh video la
                  // cut duong, vi animate can mot ANH lam dau vao.
                  videoSourceUrl: n.data.videoSourceUrl ?? n.data.imageUrl,
                  imageUrl: result.url,
                  status: "ready" as const,
                  error: undefined,
                  errorInfo: null,
                  pendingRequestId: null,
                  pendingPhase: null,
                  pendingStartedAt: null,
                  elapsed: result.elapsed ?? undefined,
                  // The server reports the model it actually ran; prefer that over the
                  // requested one so a provider fallback is visible rather than hidden.
                  model: result.effectiveModel ?? result.requestedModel ?? node.data.model ?? null,
                  videoContinuity: result.videoContinuity ?? parentVideoContinuity,
                  video: {
                    ...(result.video as Record<string, unknown> ?? {}),
                    ...(result.videoSeries?.topic ? { topic: result.videoSeries.topic } : {}),
                  } as ImageNodeData["video"],
                },
              }
            : n,
        ),
      });
      get().scheduleGraphSave();
      void get().flushGraphSave("video-node-complete");
    }
    if (result) {
      const videoItem: GenerateItem = {
        image: result.url,
        filename: result.filename,
        url: result.url,
        mediaType: "video",
        prompt,
        elapsed: result.elapsed,
        video: result.video as Record<string, unknown> ?? {},
        videoSeries: result.videoSeries ?? null,
        videoContinuity: result.videoContinuity ?? null,
        revisedPrompt: result.revisedPrompt ?? null,
        requestId: result.requestId ?? flightId,
        createdAt: Date.now(),
        sessionId: requestSessionId,
      };
      await addHistory(videoItem, set, get, { autoSelectStartedAt });
    }
  } catch (error) {
    if (isCanceledGenerationError(error)) {
      if (node && get().activeSessionId === requestSessionId) {
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: n.data.imageUrl ? ("ready" as const) : ("empty" as const),
                    pendingRequestId: null,
                    pendingPhase: null,
                    pendingStartedAt: null,
                    error: undefined,
                    errorInfo: null,
                  },
                }
              : n,
          ),
        });
      }
    } else {
      const trackingExpired = resolveErrorSpec(error).code === "JOB_TRACKING_TIMEOUT";
      const message = trackingExpired ? handleError(error, get()).message
        : error instanceof Error ? error.message : "Video generation failed";
      const errorInfo = trackingExpired ? { ...buildNodeErrorInfo(error), message } : null;
      if (node && get().activeSessionId === requestSessionId) {
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "error" as const, pendingRequestId: null, pendingPhase: null, pendingStartedAt: null, error: message, errorInfo } }
              : n,
          ),
        });
      }
      if (!trackingExpired) get().showToast(message, true);
    }
  } finally {
    const remaining = get().inFlight.filter((f) => f.id !== flightId);
    saveInFlight(remaining);
    clearFlightAbort(flightId);
    set({ inFlight: remaining, activeGenerations: remaining.length, videoProgress: null });
    get().startInFlightPolling();
  }
}

export async function animateImageImpl(
  filename: string,
  prompt: string | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<boolean> {
  const p = prompt?.trim();
  if (!p) {
    get().showToast(ACTIVE_VIDEO_PROMPT_GUIDANCE, true);
    throw new Error(ACTIVE_VIDEO_PROMPT_GUIDANCE);
  }
  // Missing element selections block animate too (higgsfield 110 EM-09) —
  // elementIds flow into the I2V request below. Returns false when blocked so
  // callers do not show a success toast (Euler round 2).
  if (missingElementsBlock(get)) return false;
  const presetState = get();
  const compiled = compilePresets({
    catalog: getAllPresets(),
    presetIds: presetState.selectedPresetIds,
    provider: toPresetProvider(presetState.provider),
    mode: "video",
  });
  const finalPrompt = compiled.promptFragment
    ? `${compiled.promptFragment} ${p}`
    : p;
  const startedAt = Date.now();
  const autoSelectStartedAt = startedAt;
  const flightId = `vid_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
  const controller = new AbortController();
  registerFlightAbort(flightId, controller);
  const nextInFlight: PersistedInFlight[] = [
    ...get().inFlight,
    { id: flightId, prompt: finalPrompt, startedAt, kind: "video" as const, sessionId: get().activeSessionId, clientNodeId: null },
  ];
  saveInFlight(nextInFlight);
  set({ inFlight: nextInFlight, activeGenerations: nextInFlight.length, videoProgress: 0 });
  get().startInFlightPolling();
  try {
    const payload = {
      prompt: finalPrompt,
      presetIds: compiled.appliedPresetIds,
      elementIds: selectedElementIds(get()),
      requestId: flightId,
      ...videoLaneFields(get()),
      mode: "image-to-video" as const,
      sourceFilename: filename,
      duration: 5,
      resolution: "480p",
      aspectRatio: "auto",
    };
    const result = await postVideoGenerateStream(
      payload,
      {
        onPlanning: () => set({ inFlight: get().inFlight.map((f) => f.id === flightId ? { ...f, phase: "planning" } : f) }),
        onSubmitted: () => set({ inFlight: get().inFlight.map((f) => f.id === flightId ? { ...f, phase: "streaming" } : f) }),
        onProgress: ({ progress }) => set({ videoProgress: progress ?? null }),
      },
      { signal: controller.signal },
    );
    const videoItem: GenerateItem = {
      image: result.url,
      filename: result.filename,
      url: result.url,
      mediaType: "video",
      prompt: finalPrompt,
      elapsed: result.elapsed,
      video: result.video as Record<string, unknown> ?? {},
      videoSeries: result.videoSeries ?? null,
      videoContinuity: result.videoContinuity ?? null,
      revisedPrompt: result.revisedPrompt ?? null,
      requestId: result.requestId ?? flightId,
      createdAt: Date.now(),
      sessionId: get().activeSessionId,
    };
    await addHistory(videoItem, set, get, { autoSelectStartedAt });
  } catch (error) {
    if (!isCanceledGenerationError(error)) {
      if (resolveErrorSpec(error).code === "JOB_TRACKING_TIMEOUT") handleError(error, get());
      else get().showToast(error instanceof Error ? error.message : "Video generation failed", true);
    }
    return false;
  } finally {
    const remaining = get().inFlight.filter((f) => f.id !== flightId);
    saveInFlight(remaining);
    clearFlightAbort(flightId);
    set({ inFlight: remaining, activeGenerations: remaining.length, videoProgress: null });
    get().startInFlightPolling();
  }
  return true;

}
