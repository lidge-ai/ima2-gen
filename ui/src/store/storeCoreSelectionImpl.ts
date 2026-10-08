import { normalizeImageQuality } from "../lib/imageModels";
import { saveGenerationDefaultsPatch, saveVideoDefaults } from "./storePersistence";
import type { ImageModel, Provider } from "../types";
import { isCoreProviderId } from "../generated/providers";
import {
  providerForImageModel, reconcileCoreSelection, rememberCoreSelection, selectCoreProvider,
  type CoreSelectionState,
} from "../lib/coreSelection";
import { API88_DEFAULT_VIDEO_MODEL, api88VideoAxes, api88UiVideoSpec } from "../lib/api88Video";
import { GROK_VIDEO_MODEL_15, normalizeVideoModelValue } from "../lib/imageModels";
import {
  loadCoreSelectionMemory, persistCoreSelection, saveCoreSelectionMemory,
} from "./coreSelectionPersistence";
import type { StoreGet, StoreSet } from "./storeTypes";

function currentSelection(get: StoreGet): CoreSelectionState {
  const { provider, imageModel, videoModelSelected, comfyWorkflow, comfyVideoWorkflow } = get();
  return reconcileCoreSelection({ provider, imageModel, videoModelSelected, comfyWorkflow, comfyVideoWorkflow });
}

function commitSelection(
  current: CoreSelectionState,
  next: CoreSelectionState,
  set: StoreSet,
  clearSlot?: "image" | "video",
): void {
  const memory = loadCoreSelectionMemory();
  memory[current.provider] = { ...memory[current.provider], ...rememberCoreSelection(current) };
  const nextLane = { ...memory[next.provider], ...rememberCoreSelection(next) };
  // Absence retains an inactive choice; only an explicit null action deletes it.
  if (clearSlot) delete nextLane[clearSlot];
  memory[next.provider] = nextLane;
  saveCoreSelectionMemory(memory);
  persistCoreSelection(next);
  set((state) => {
    const imageToolModel = next.provider === "api" ? state.imageToolModel : null;
    const quality = normalizeImageQuality(next.provider, imageToolModel, state.quality);
    saveGenerationDefaultsPatch({ imageToolModel, quality });
    return { ...next, imageToolModel, quality };
  });
}

export function setCoreProviderSelection(provider: Provider, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  if (provider === current.provider) return;
  const remembered = isCoreProviderId(provider) ? loadCoreSelectionMemory()[provider] : undefined;
  const next = selectCoreProvider(current, provider, remembered);
  commitSelection(current, next, set);
}

export function setCoreImageSelection(model: ImageModel, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  const next = reconcileCoreSelection({
    provider: providerForImageModel(current.provider, model), imageModel: model,
    videoModelSelected: false,
  });
  commitSelection(current, next, set);
}

export function setCoreVideoSelection(model: string | undefined, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  const provider = current.provider === "88api" ? "88api"
    : current.provider === "grok-api" ? "grok-api" : "grok";
  const fallback = provider === "88api" ? API88_DEFAULT_VIDEO_MODEL : GROK_VIDEO_MODEL_15;
  const next = reconcileCoreSelection({ provider, imageModel: current.imageModel,
    videoModelSelected: normalizeVideoModelValue(model, provider) || fallback });
  commitSelection(current, next, set);
  if (provider === "88api") {
    const axes = api88VideoAxes(get(), get().activeVideoRefCount() > 0);
    set({ videoDuration: axes.duration, videoResolution: axes.resolution, videoAspectRatio: axes.aspectRatio });
    saveVideoDefaults(axes);
    const imageMode = api88UiVideoSpec(next.videoModelSelected)?.imageMode;
    if (imageMode === "source") get().setVideoSingleRefMode("image-to-video");
    if (imageMode === "reference") get().setVideoSingleRefMode("reference-to-video");
  }
}

export function setCoreComfyWorkflowSelection(id: string | null, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  const next = reconcileCoreSelection({
    ...current, provider: "comfy", comfyWorkflow: id, comfyVideoWorkflow: null,
  });
  commitSelection(current, next, set, id === null ? "image" : undefined);
}

export function setCoreComfyVideoSelection(id: string | null, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  const next = reconcileCoreSelection({
    ...current, provider: "comfy", comfyVideoWorkflow: id, videoModelSelected: false,
  });
  commitSelection(current, next, set, id === null ? "video" : undefined);
}
