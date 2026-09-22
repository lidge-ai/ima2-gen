import { normalizeImageQuality } from "../lib/imageModels";
import { saveGenerationDefaultsPatch } from "./storePersistence";
import type { ImageModel, Provider } from "../types";
import { isCoreProviderId } from "../generated/providers";
import {
  providerForImageModel, reconcileCoreSelection, rememberCoreSelection, selectCoreProvider,
  type CoreSelectionState,
} from "../lib/coreSelection";
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
  const next = reconcileCoreSelection({
    provider: current.provider === "grok-api" ? "grok-api" : "grok",
    imageModel: current.imageModel,
    videoModelSelected: normalizeVideoModelValue(model) || GROK_VIDEO_MODEL_15,
  });
  commitSelection(current, next, set);
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
