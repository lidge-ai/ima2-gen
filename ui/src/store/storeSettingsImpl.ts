import type { ImageToolModel } from "../types";
import { normalizeImageQuality } from "../lib/imageModels";
import type { Provider, Quality, SizePreset, Format, Moderation, ImageModel, Count } from "../types";
import type { ReasoningEffort } from "../lib/reasoning";
import {
  setCoreProviderSelection, setCoreImageSelection, setCoreVideoSelection,
  setCoreComfyWorkflowSelection, setCoreComfyVideoSelection,
} from "./storeCoreSelectionImpl";
import { parseRequestedCustomSide } from "../lib/size";
import type { NaiOptions, NaiOptionOverrides } from "../lib/naiOptions";
import { getEffectiveVideoSourceCount } from "../lib/videoSourceCount";
import {
  composePrompt,
  loadMcpSelection,
  saveMcpSelection,
  saveReasoningEffort,
  saveWebSearchEnabled,
  saveGenerationDefaultsPatch,
  saveNaiOverrides,
  normalizeCount,
} from "./storePersistence";
import type { StoreSet, StoreGet } from "./storeTypes";
import { getCachedMcpProviders, startMcpGeneration, type McpModelCapabilities, type McpPresetValue } from "../lib/mcpProviders";
import { jsonFetch } from "../lib/api-core";
import { isVideoItem } from "../lib/videoMedia";
import {
  buildMcpGenerationInput,
  defaultMcpPresetSelection,
  emptyMcpReferenceSelection,
  hasInvalidMcpReferenceTags,
  mcpReferenceTag,
  normalizeMcpReferenceSelection,
  reconcileMcpReferenceSelection,
  reconcileMcpPresetSelection,
  sameMcpReferenceSelection,
  sameMcpPresetSelection,
  type McpReferenceSelection,
  type McpMediaKind,
} from "../lib/mcpSelection";
import { t } from "../i18n";
import { resolveErrorSpec } from "../lib/errorCodes";

let coreGenerateAction: ReturnType<StoreGet>["generate"] | null = null;
type McpTempReferenceBatch = {
  ok: boolean;
  batchId: string;
  files: Array<{ filename: string; tag?: string }>;
};
function mcpGenerationErrorMessage(error: unknown): string {
  if (resolveErrorSpec(error).code === "JOB_TRACKING_TIMEOUT") return t("toast.jobTrackingTimeout");
  const candidate = error as { code?: string; message?: string };
  const code = candidate.code ?? candidate.message ?? "";
  if (code.startsWith("MCP_INPUT_ROLE_UNSUPPORTED") || candidate.message?.startsWith("MCP_INPUT_ROLE_UNSUPPORTED")) {
    return t("mcp.errorUnsupportedInput");
  }
  if (code === "MCP_END_FRAME_REQUIRES_START") return t("mcp.errorEndRequiresStart");
  if (code === "INVALID_MCP_REFERENCES") return t("mcp.errorInvalidReferences");
  if (code === "INVALID_START_FRAME") return t("mcp.errorInvalidFrame");
  if (code.startsWith("INVALID_MCP_TEMP_REFERENCE") || code === "MCP_TEMP_REFERENCES_FAILED") {
    return t("mcp.errorTempReferences");
  }
  if (code === "MCP_NOT_CONNECTED" || code === "MCP_PROVIDER_UNKNOWN") return t("mcp.selectionUnavailable");
  return t("mcp.generateFailed");
}
async function prepareMcpTempReferences(selection: McpReferenceSelection): Promise<{
  selection: McpReferenceSelection;
  batchId: string | null;
}> {
  const local = selection.references.filter((reference) => reference.dataUrl);
  if (local.length === 0) return { selection, batchId: null };
  const batch = await jsonFetch<McpTempReferenceBatch>("/api/mcp/temp-references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: local.map((reference) => ({ dataUrl: reference.dataUrl, ...(reference.tag ? { tag: reference.tag } : {}) })) }),
  });
  if (batch.files.length !== local.length) throw new Error("MCP_TEMP_REFERENCES_FAILED");
  let localIndex = 0;
  const references = selection.references.map((reference) => {
    if (!reference.dataUrl) return reference;
    const uploaded = batch.files[localIndex++];
    return { filename: uploaded.filename, ...(reference.tag ? { tag: reference.tag } : {}) };
  });
  return { selection: { ...selection, references }, batchId: batch.batchId };
}

async function deleteMcpTempReferences(batchId: string): Promise<void> {
  try {
    await jsonFetch(`/api/mcp/temp-references/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  } catch (error) {
    console.error("[mcp] temporary reference cleanup failed", error);
  }
}

async function submitMcpGeneration(input: NonNullable<ReturnType<typeof buildMcpGenerationInput>>, get: StoreGet, waitForSettlement: boolean): Promise<void> {
  let settleGeneration = () => {};
  const generationSettled = new Promise<void>((resolve) => { settleGeneration = resolve; });
  await startMcpGeneration(input, {
    onDone: () => {
      get().hydrateHistory();
      settleGeneration();
    },
    onError: (error) => {
      get().showToast(mcpGenerationErrorMessage(error), true);
      settleGeneration();
    },
  });
  if (!waitForSettlement) {
    await get().reconcileInflight();
    get().startInFlightPolling();
    return;
  }
  let followupError: unknown = null;
  try {
    await get().reconcileInflight();
    get().startInFlightPolling();
  } catch (error) {
    followupError = error;
  }
  await generationSettled;
  if (followupError) throw followupError;
}

async function runMcpGenerate(get: StoreGet): Promise<void> {
  const state = get();
  // Execution lock comes from the server record, not a provider-id hardcode
  // (260723). When the cache has no record, skip the pre-block and let the
  // server adapter reject with the authoritative code (double guard).
  const mcpRecord = state.mcpProvider
    ? getCachedMcpProviders().find((entry) => entry.id === state.mcpProvider)
    : undefined;
  if (mcpRecord?.executable === false) {
    get().showToast(t("mcp.higgsfieldLocked"), true);
    return;
  }
  const prompt = composePrompt(state.prompt, state.insertedPrompts);
  if (!prompt) return;
  const referenceSelection = state.mcpReferenceSelection ?? emptyMcpReferenceSelection();
  if (hasInvalidMcpReferenceTags(referenceSelection)) {
    get().showToast(t("mcp.referenceTagInvalid"), true);
    return;
  }
  // @element mentions: map selected element assets to tagged references
  // (Runway multi-reference syntax). tag = sanitized element name, so the
  // prompt can address each image as @tag; the server uploads the files and
  // forwards provider-hosted URLs via the model's image_references role.
  const selectedIds: string[] = (state as unknown as { selectedElementIds?: string[] }).selectedElementIds ?? [];
  // wp4: character binding and @element mentions never mix (server 409 mirror).
  if (state.mcpCharacterElementId && selectedIds.length > 0) {
    get().showToast(t("mcp.characterSlotConflictHint"), true);
    return;
  }
  const elementReferences = selectedIds
    .map((id) => state.assets.find((asset) => asset.id === id))
    .flatMap((asset) => {
      const refs = (asset?.metadata as { refs?: unknown } | undefined)?.refs;
      if (!Array.isArray(refs)) return [];
      const tag = asset?.name ? mcpReferenceTag(asset.name) : null;
      return refs
        .filter((ref): ref is string => typeof ref === "string")
        .map((filename) => ({ filename, ...(tag ? { tag } : {}) }));
    })
    .slice(0, 3);
  let tempBatchId: string | null = null;
  try {
    const prepared = await prepareMcpTempReferences(referenceSelection);
    tempBatchId = prepared.batchId;
    const input = buildMcpGenerationInput({
      mcpProvider: state.mcpProvider, mcpModel: state.mcpModel, mcpMediaKind: state.mcpMediaKind,
      mcpRatio: state.mcpRatio, mcpParameters: state.mcpParameters, mcpInputRoles: state.mcpInputRoles ?? [],
      mcpReferenceSelection: prepared.selection, currentImageFilename: state.currentImage?.filename ?? null,
      mcpCharacterElementId: state.mcpCharacterElementId ?? null,
      ...(elementReferences.length > 0 ? { elementReferences } : {}),
    }, prompt, `mcp_ui_${Date.now()}`);
    if (!input) return;
    await submitMcpGeneration(input, get, Boolean(tempBatchId));
  } catch (error) {
    get().showToast(mcpGenerationErrorMessage(error), true);
  } finally {
    if (tempBatchId) await deleteMcpTempReferences(tempBatchId);
  }
}

function clearMcpLane(set: StoreSet): void {
  saveMcpSelection(null, null, "image");
  // Persisted clear-to-Auto: an in-memory reset alone would leave a stale
  // stored ratio behind (audit R3-1).
  saveGenerationDefaultsPatch({ mcpRatio: null, mcpParameters: {} });
  set({
    mcpProvider: null,
    mcpModel: null,
    mcpMediaKind: "image",
    mcpRatio: null,
    mcpParameters: {},
    mcpInputRoles: [],
    mcpReferenceSelection: emptyMcpReferenceSelection(),
    mcpCharacterElementId: null,
    ...(coreGenerateAction ? { generate: coreGenerateAction } : {}),
  });
}

export function setMcpProviderImpl(
  mcpProvider: string | null,
  set: StoreSet,
  get: StoreGet,
  persistedModel: string | null = null,
  persistedKind?: McpMediaKind,
): void {
  if (!mcpProvider) {
    clearMcpLane(set);
    return;
  }
  if (!coreGenerateAction) coreGenerateAction = get().generate;
  const mcpModel = get().mcpProvider === mcpProvider
    ? get().mcpModel ?? persistedModel
    : persistedModel;
  // Live provider switches (persistedKind omitted) preserve the current kind;
  // only hydration passes the stored value explicitly (audit R2-4).
  const mcpMediaKind: McpMediaKind = persistedKind ?? get().mcpMediaKind ?? "image";
  const switchingProvider = get().mcpProvider !== mcpProvider;
  saveMcpSelection(mcpProvider, mcpModel, mcpMediaKind);
  saveGenerationDefaultsPatch({
    count: 1,
    multimode: false,
    ...(switchingProvider ? { mcpRatio: null, mcpParameters: {} } : {}),
  });
  set({
    mcpProvider,
    mcpModel,
    mcpMediaKind,
    ...(switchingProvider ? {
      mcpRatio: null,
      mcpParameters: {},
      mcpInputRoles: [],
      mcpReferenceSelection: emptyMcpReferenceSelection(),
    } : {}),
    count: 1,
    multimode: false,
    generate: () => runMcpGenerate(get),
  });
}

export function setMcpModelImpl(mcpModel: string | null, set: StoreSet, get: StoreGet): void {
  saveMcpSelection(get().mcpProvider ?? null, mcpModel, get().mcpMediaKind ?? "image");
  saveGenerationDefaultsPatch({ mcpRatio: null, mcpParameters: {} });
  set({
    mcpModel,
    mcpRatio: null,
    mcpParameters: {},
    mcpInputRoles: [],
    mcpReferenceSelection: emptyMcpReferenceSelection(),
  });
}

export function setMcpModelWithKindImpl(
  mcpModel: string,
  kind: McpMediaKind,
  set: StoreSet,
  get: StoreGet,
  capabilities?: McpModelCapabilities,
): void {
  const presets = defaultMcpPresetSelection(capabilities);
  let referenceSelection = capabilities
    ? reconcileMcpReferenceSelection(capabilities.inputRoles, get().mcpReferenceSelection)
    : emptyMcpReferenceSelection();
  const currentImage = get().currentImage;
  if (
    capabilities?.inputRoles.includes("start_image")
    && !referenceSelection.startFrameFilename
    && currentImage?.filename
    && !isVideoItem(currentImage)
  ) {
    referenceSelection = { ...referenceSelection, startFrameFilename: currentImage.filename };
  }
  saveMcpSelection(get().mcpProvider ?? null, mcpModel, kind);
  saveGenerationDefaultsPatch({ mcpRatio: presets.ratio, mcpParameters: presets.parameters });
  set({
    mcpModel,
    mcpMediaKind: kind,
    mcpRatio: presets.ratio,
    mcpParameters: presets.parameters,
    mcpInputRoles: capabilities ? [...capabilities.inputRoles] : [],
    mcpReferenceSelection: referenceSelection,
  });
}

export function setMcpMediaKindImpl(kind: McpMediaKind, set: StoreSet, get: StoreGet): void {
  if ((get().mcpMediaKind ?? "image") === kind) return;
  // Switching kind invalidates the previous kind's model selection.
  saveMcpSelection(get().mcpProvider ?? null, null, kind);
  saveGenerationDefaultsPatch({ mcpRatio: null, mcpParameters: {} });
  set({
    mcpMediaKind: kind,
    mcpModel: null,
    mcpRatio: null,
    mcpParameters: {},
    mcpInputRoles: [],
    mcpReferenceSelection: emptyMcpReferenceSelection(),
  });
}

export function setMcpRatioImpl(ratio: string | null, set: StoreSet): void {
  saveGenerationDefaultsPatch({ mcpRatio: ratio });
  set({ mcpRatio: ratio });
}

export function setMcpParameterImpl(name: string, value: McpPresetValue | null, set: StoreSet, get: StoreGet): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) return;
  const parameters = { ...(get().mcpParameters ?? {}) };
  if (value === null) delete parameters[name];
  else parameters[name] = value;
  saveGenerationDefaultsPatch({ mcpParameters: parameters });
  set({ mcpParameters: parameters });
}

export function setMcpReferenceSelectionImpl(selection: McpReferenceSelection, set: StoreSet, get: StoreGet): void {
  const next = reconcileMcpReferenceSelection(
    get().mcpInputRoles ?? [],
    normalizeMcpReferenceSelection(selection),
  );
  const current = get().mcpReferenceSelection ?? emptyMcpReferenceSelection();
  if (!sameMcpReferenceSelection(current, next)) set({ mcpReferenceSelection: next });
}

/** Called once by the sidebar catalog completion event. It is deliberately not
 * a state-watching effect, and writes only when persisted values are stale. */
export function reconcileMcpPresetStateImpl(capabilities: McpModelCapabilities, set: StoreSet, get: StoreGet): void {
  const current = { ratio: get().mcpRatio ?? null, parameters: get().mcpParameters ?? {} };
  const next = reconcileMcpPresetSelection(capabilities, current.ratio, current.parameters);
  const currentReferences = get().mcpReferenceSelection ?? emptyMcpReferenceSelection();
  const nextReferences = reconcileMcpReferenceSelection(capabilities.inputRoles, currentReferences);
  const rolesChanged = JSON.stringify(get().mcpInputRoles ?? []) !== JSON.stringify(capabilities.inputRoles);
  const presetsChanged = !sameMcpPresetSelection(current, next);
  const referencesChanged = !sameMcpReferenceSelection(currentReferences, nextReferences);
  if (!presetsChanged && !referencesChanged && !rolesChanged) return;
  if (presetsChanged) saveGenerationDefaultsPatch({ mcpRatio: next.ratio, mcpParameters: next.parameters });
  set({
    ...(presetsChanged ? { mcpRatio: next.ratio, mcpParameters: next.parameters } : {}),
    mcpInputRoles: [...capabilities.inputRoles],
    mcpReferenceSelection: nextReferences,
  });
}

export function hydrateMcpSelectionImpl(set: StoreSet, get: StoreGet): void {
  const selection = loadMcpSelection();
  if (selection.provider) {
    setMcpProviderImpl(selection.provider, set, get, selection.model, selection.kind);
    saveGenerationDefaultsPatch({ mcpRatio: selection.ratio, mcpParameters: selection.parameters });
    set({ mcpRatio: selection.ratio, mcpParameters: selection.parameters });
  }
}

export function setProviderImpl(provider: Provider, set: StoreSet, get: StoreGet): void {
  clearMcpLane(set);
  setCoreProviderSelection(provider, set, get);
}

export function setImageToolModelImpl(imageToolModel: ImageToolModel | null, set: StoreSet, get: StoreGet): void {
  if (get().provider !== "api") imageToolModel = null;
  const quality = normalizeImageQuality(get().provider, imageToolModel, get().quality);
  saveGenerationDefaultsPatch({ imageToolModel, quality });
  set({ imageToolModel, quality });
}

export function setQualityImpl(quality: Quality, set: StoreSet, get: StoreGet): void {
  quality = normalizeImageQuality(get().provider, get().imageToolModel, quality);
  saveGenerationDefaultsPatch({ quality });
  set({ quality });
}

export function setSizePresetImpl(sizePreset: SizePreset, set: StoreSet): void {
  saveGenerationDefaultsPatch({ sizePreset });
  set({ sizePreset });
}

export function setCustomSizeImpl(w: number, h: number, set: StoreSet, get: StoreGet): void {
  const customW = parseRequestedCustomSide(w, get().customW);
  const customH = parseRequestedCustomSide(h, get().customH);
  saveGenerationDefaultsPatch({ customW, customH });
  set({ customW, customH });
}

export function setGrokAspectRatioImpl(grokAspectRatio: string, set: StoreSet): void {
  saveGenerationDefaultsPatch({ grokAspectRatio });
  set({ grokAspectRatio });
}

export function setGrokResolutionImpl(grokResolution: "1k" | "2k", set: StoreSet): void {
  saveGenerationDefaultsPatch({ grokResolution });
  set({ grokResolution });
}

export function setFormatImpl(format: Format, set: StoreSet): void {
  saveGenerationDefaultsPatch({ format });
  set({ format });
}

export function setModerationImpl(moderation: Moderation, set: StoreSet): void {
  saveGenerationDefaultsPatch({ moderation });
  set({ moderation });
}

export function setImageModelImpl(imageModel: ImageModel, set: StoreSet, get: StoreGet): void {
  clearMcpLane(set);
  setCoreImageSelection(imageModel, set, get);
}

export function selectVideoModelImpl(model: string | undefined, set: StoreSet, get: StoreGet): void {
  clearMcpLane(set);
  setCoreVideoSelection(model, set, get);
}

export function setComfyWorkflowImpl(workflowId: string | null, set: StoreSet, get: StoreGet): void {
  clearMcpLane(set);
  setCoreComfyWorkflowSelection(workflowId, set, get);
}

export function setComfyVideoWorkflowImpl(workflowId: string | null, set: StoreSet, get: StoreGet): void {
  clearMcpLane(set);
  setCoreComfyVideoSelection(workflowId, set, get);
}

export function activeVideoRefCountImpl(get: StoreGet): number {
  return getEffectiveVideoSourceCount(get());
}

export function setReasoningEffortImpl(reasoningEffort: ReasoningEffort, set: StoreSet): void {
  saveReasoningEffort(reasoningEffort);
  set({ reasoningEffort });
}

export function setWebSearchEnabledImpl(webSearchEnabled: boolean, set: StoreSet): void {
  saveWebSearchEnabled(webSearchEnabled);
  set({ webSearchEnabled });
}

export function setCountImpl(count: Count, set: StoreSet): void {
  const next = normalizeCount(count);
  saveGenerationDefaultsPatch({ count: next });
  set({ count: next });
}

export function setMultimodeImpl(enabled: boolean, set: StoreSet, get: StoreGet): void {
  if (enabled && get().uiMode !== "classic") return;
  saveGenerationDefaultsPatch({ multimode: enabled });
  const s = get();
  set({
    multimode: enabled,
    multimodeSequences: enabled ? s.multimodeSequences : {},
    multimodePreviewFlightId: enabled ? s.multimodePreviewFlightId : null,
  });
}

export function setMultimodeMaxImagesImpl(count: Count, set: StoreSet): void {
  const next = normalizeCount(count);
  saveGenerationDefaultsPatch({ multimodeMaxImages: next });
  set({ multimodeMaxImages: next });
}

export function setPromptModeImpl(promptMode: "auto" | "direct", set: StoreSet): void {
  saveGenerationDefaultsPatch({ promptMode });
  set({ promptMode });
}

export function setPromptImpl(prompt: string, set: StoreSet): void {
  saveGenerationDefaultsPatch({ prompt });
  set({ prompt });
}

export function setNegativePromptImpl(negativePrompt: string, set: StoreSet): void {
  // Persisted with the composer draft: an image whose undesired-content prompt
  // is unrecoverable cannot be reproduced.
  saveGenerationDefaultsPatch({ negativePrompt });
  set({ negativePrompt });
}

/**
 * Records ONE override. Fields the user never touches stay absent, so they keep
 * resolving from the operator's configuration rather than freezing at whatever
 * this client shipped with (020).
 */
export function setNaiOptionImpl<K extends keyof NaiOptions>(
  key: K,
  value: NaiOptions[K],
  set: StoreSet,
  get: StoreGet,
): void {
  const naiOptionOverrides: NaiOptionOverrides = { ...get().naiOptionOverrides, [key]: value };
  saveNaiOverrides(naiOptionOverrides);
  // In-memory update is unconditional: a quota failure must not cost the user
  // their current session's choice.
  set({ naiOptionOverrides });
}

/** Clears every override, returning all ten fields to operator configuration. */
export function resetNaiOptionsImpl(set: StoreSet): void {
  saveNaiOverrides({});
  set({ naiOptionOverrides: {} });
}

export function getResolvedSizeImpl(get: StoreGet): string {
  const { provider, sizePreset, customW, customH, grokAspectRatio, grokResolution } = get();
  if (provider === "grok" || provider === "grok-api") {
    return `grok:${grokAspectRatio}:${grokResolution}`;
  }
  return sizePreset === "custom" ? `${customW}x${customH}` : sizePreset;
}
