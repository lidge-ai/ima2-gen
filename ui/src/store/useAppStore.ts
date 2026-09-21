// All localStorage keys this store touches MUST be listed in
// ./persistenceRegistry.ts. The contract test
// tests/settings-persistence-contract.test.js enforces this invariant.
// Legacy generation-controls contract: GENERATION_DEFAULTS_STORAGE_KEY = "ima2.generationDefaults".
import { create } from "zustand";
import type { VideoResolutionUI } from "../types";
import { getBrowserId } from "../lib/api";
import { loadCoreSelectionSnapshot } from "./coreSelectionPersistence";
import {
  GALLERY_DEFAULT_SCOPE_STORAGE_KEY,
  GALLERY_SCOPE_STORAGE_KEY,
} from "./persistenceRegistry";
import { applySelectedNodeIds } from "../lib/nodeSelection";
import { loadLocale, saveLocale } from "../i18n";
import {
  loadRightPanelOpen,
  loadUIMode,
  loadHistoryStripLayout,
  loadGalleryScope,
  loadCanvasExportBackground,
  loadReasoningEffort,
  loadWebSearchEnabled,
  loadVideoDefaults,
  saveVideoDefaults,
  loadGenerationDefaults,
  loadNaiOverrides,
} from "./storePersistence";
import {
  HISTORY_LIMIT,
  DEFAULT_REFERENCE_IMAGE_LIMIT,
  saveInFlight,
} from "./storeHelpers";
import { syncCapabilitiesImpl } from "./storeCapabilitiesImpl";
import {
  scheduleGraphSaveImpl,
  flushGraphSaveImpl,
  addHistory,
} from "./storeGraphSave";
import { makeSnapshot, mergeAfterRestore, popRedo, popUndo, pushHistory } from "../lib/nodeHistory";
import { deriveParentServerNodeIds } from "../lib/nodeGraph";
import {
  runGenerateNodeInPlaceImpl,
  runNodeBatchImpl,
} from "./storeNodeGenImpl";
import {
  generateMultimodeImpl,
  runGenerateImpl,
} from "./storeGenImpl";
import {
  runVideoGenerateImpl,
  animateImageImpl,
} from "./storeVideoImpl";
import {
  startInFlightPollingImpl,
  reconcileInflightImpl,
} from "./storeInflightImpl";
import {
  addRootNodeImpl,
  createRootNodeFromHistoryItemImpl,
  addChildNodeImpl,
  addSiblingNodeImpl,
  addChildNodeAtImpl,
  duplicateBranchRootImpl,
  updateNodePromptImpl,
  datVaiTroNodeImpl,
  deleteNodeImpl,
  deleteNodesImpl,
  disconnectEdgesImpl,
  connectNodesImpl,
} from "./storeGraphNodeImpl";
import {
  addNodeReferencesImpl, addNodeReferenceDataUrlImpl,
  addNodeReferenceFromUrlImpl,
  removeNodeReferenceImpl, clearNodeReferencesImpl,
} from "./storeNodeRefImpl";
import {
  loadOlderHistoryImpl,
  loadFavoriteHistoryImpl,
  loadOlderFavoriteHistoryImpl,
  selectHistoryImpl,
  showHistorySequenceImpl,
  selectHistoryShortcutTargetImpl,
  trashHistoryItemImpl,
  trashHistorySequenceImpl,
  restorePendingTrashImpl,
  permanentlyDeleteHistoryItemImpl,
  removeFromHistoryImpl,
  addHistoryItemImpl,
  importLocalImageToHistoryImpl,
  hydrateHistoryImpl,
} from "./storeHistoryImpl";
import {
  loadSessionsImpl,
  switchSessionImpl,
  reconcileGraphPendingImpl,
  createAndSwitchSessionImpl,
  renameCurrentSessionImpl,
  deleteSessionByIdImpl,
} from "./storeSessionImpl";
import {
  addReferencesImpl,
  addTrayAttachmentsImpl,
  addTrayAttachmentDataUrlImpl,
  addTrayElementImpl,
  syncElementCatalogImpl,
  removeTrayItemImpl,
  removeTrayElementImpl,
  clearTrayImpl,
  addReferenceDataUrlImpl,
  readDroppedImageMetadataImpl,
  applyMetadataRestoreImpl,
  removeReferenceImpl,
  clearReferencesImpl,
  attachCanvasVersionReferenceImpl,
  useCurrentAsReferenceImpl,
  useImageAsReferenceImpl,
} from "./storeReferenceImpl";
import {
  setProviderImpl, setQualityImpl, setSizePresetImpl, setCustomSizeImpl,
  setGrokAspectRatioImpl, setGrokResolutionImpl, setFormatImpl, setModerationImpl,
  setImageModelImpl, selectVideoModelImpl, setComfyWorkflowImpl, setComfyVideoWorkflowImpl, activeVideoRefCountImpl,
  setReasoningEffortImpl, setWebSearchEnabledImpl, setCountImpl,
  setMultimodeImpl, setMultimodeMaxImagesImpl, setPromptModeImpl, setPromptImpl,
  setNegativePromptImpl, setNaiOptionImpl, resetNaiOptionsImpl,
  getResolvedSizeImpl,
} from "./storeSettingsImpl";
import {
  insertPromptToComposerImpl, removeInsertedPromptFromComposerImpl,
  moveInsertedPromptInComposerImpl, clearInsertedPromptsImpl,
  loadPromptLibraryImpl, savePromptToLibraryImpl, deletePromptFromLibraryImpl,
  togglePromptFavoriteImpl, importPromptsToLibraryImpl, toggleGalleryFavoriteImpl,
} from "./storePromptImpl";
import {
  generateImpl, cancelMultimodeImpl, confirmCustomSizeAdjustmentImpl,
  generateNodeImpl, generateNodeInPlaceImpl, generateNodeVariationImpl,
  runGenerateNodeImpl,
} from "./storeGenerateEntryImpl";
import {
  cancelInFlightJobImpl, syncFromStorageImpl, applyMergedCanvasImageImpl,
  addMetadataRestoreAsReferenceImpl,
  toggleRightPanelImpl, setGalleryScopeImpl, setGalleryDefaultScopeImpl,
  setUIModeImpl, setHistoryStripLayoutImpl,
  showToastImpl, dismissToastImpl, showErrorCardImpl, dismissErrorCardImpl,
  setGraphNodesImpl, setGraphEdgesImpl, toggleNodeSelectionModeImpl,
  selectNodeGraphImpl, cancelNodeBatchImpl, setCanvasPanImpl,
  setCanvasExportBackgroundImpl, setCanvasExportMatteColorImpl,
} from "./storeUIImpl";
import {
  loadAssetsImpl, loadMoreAssetsImpl, setAssetsFiltersImpl, saveToAssetsImpl,
  updateAssetItemImpl, deleteAssetItemImpl, createAssetFolderImpl,
  renameAssetFolderImpl, moveAssetFolderImpl, deleteAssetFolderImpl,
} from "./storeAssetsImpl";
import { generateAssetGenImpl, retryAssetGenSaveImpl } from "./storeAssetGenImpl";
import { refreshFoldersImpl } from "./storeAssetsImpl";
import { createPresetSlice } from "./storePresetImpl";
import { createEmptySpriteRecipeDraft } from "../types/spriteRecipe";
import { approveSpriteAnchorImpl, cancelSpriteJobImpl, generateSpriteAnchorImpl, generateSpriteRowsImpl, loadSpriteRecipesImpl, saveSpriteRecipeImpl, selectSpriteRecipeImpl, updateSpriteRecipeDraftImpl } from "./storeSpriteRecipeImpl";

export type { GalleryScope, ComposeSheetTab, ImageNodeStatus, ImageNodeData, GraphNode, GraphEdge, MultimodeSequenceState, AssetItem, AssetFolder, AssetsFilters } from "./storeTypes";
export { flushGraphSaveBeacon, selectCurrentSessionId } from "./storeGraphSave";
import type { AppState } from "./storeTypes";
import { effectiveReferenceLimit } from "../lib/referenceLimits";
import { physicalVideoSourceCount as countPhysicalVideoSources } from "../lib/referenceTray";
import { emptyMcpReferenceSelection } from "../lib/mcpSelection";
const storedGenerationDefaults = loadGenerationDefaults();
const storedVideoDefaults = loadVideoDefaults();
const initialSelection = loadCoreSelectionSnapshot();

export const useAppStore = create<AppState>((set, get, store) => ({
  ...createPresetSlice(set, get, store),
  assets: [],
  assetGenWorkflow: "generate",
  setAssetGenWorkflow: (value) => set({ assetGenWorkflow: value }),
  spriteRecipes: [], activeSpriteRecipeId: null, activeSpriteRecipe: null,
  spriteRecipeDraft: createEmptySpriteRecipeDraft(), spriteRecipeDirty: false,
  spriteRecipeLoading: false, spriteRecipeSaving: false, spriteRecipeGenerating: false,
  spriteRecipeError: null, spriteSelectedStates: [], spritePartialPreviews: {},
  loadSpriteRecipes: () => loadSpriteRecipesImpl(set, get),
  selectSpriteRecipe: (id) => selectSpriteRecipeImpl(id, set, get),
  updateSpriteRecipeDraft: (patch) => updateSpriteRecipeDraftImpl(patch, set),
  saveSpriteRecipe: () => saveSpriteRecipeImpl(set, get),
  generateSpriteAnchor: () => generateSpriteAnchorImpl(set, get),
  approveSpriteAnchor: (assetId) => approveSpriteAnchorImpl(assetId, set, get),
  generateSpriteRows: (keys) => generateSpriteRowsImpl(keys, set, get),
  cancelSpriteJob: (requestId) => cancelSpriteJobImpl(requestId, set, get),
  assetsFolders: [],
  assetsTags: [],
  assetsLoading: false,
  assetsLoadError: false,
  assetsCursor: null,
  assetsFilters: { kind: null, folderId: null, tag: null, q: "" },
  assetGenPrompt: "",
  assetGenBackground: "chroma-green",
  assetGenProvider: initialSelection.provider === "grok" || initialSelection.provider === "grok-api" ? initialSelection.provider : "oauth",
  assetGenKind: "image",
  assetGenVideoDuration: 5,
  assetGenVideoResolution: "720p",
  assetGenVideoAspect: "1:1",
  setAssetGenVideoDuration: (v) => set({ assetGenVideoDuration: v }),
  setAssetGenVideoResolution: (v) => set({ assetGenVideoResolution: v }),
  setAssetGenVideoAspect: (v) => set({ assetGenVideoAspect: v }),
  assetGenItems: [],
  assetGenSaveFailures: [],
  assetGenLastError: null,
  setAssetGenLastError: (v) => set({ assetGenLastError: v }),
  keyingTarget: null,
  setKeyingTarget: (item) => set({ keyingTarget: item }),
  vectorizeTarget: null,
  setVectorizeTarget: (item) => set({ vectorizeTarget: item }),
  spriteCuratorTarget: null,
  setCuratorTarget: (target) => set({ spriteCuratorTarget: target }),
  addAssetGenDerivedItem: (item) => set((state) => (
    item.filename && state.assetGenItems.some((entry) => entry.filename === item.filename)
      ? {}
      : { assetGenItems: [item, ...state.assetGenItems] }
  )),
  selectedProjectId: null,
  setSelectedProject: (id) => {
    set({ selectedProjectId: id });
    // Keep the assets tab in sync: project selection maps to the folder filter.
    setAssetsFiltersImpl({ folderId: id }, set, get);
  },
  loadAssetFolders: () => refreshFoldersImpl(set),
  retryAssetGenSave: (requestId) => retryAssetGenSaveImpl(requestId, set, get),
  setAssetGenPrompt: (v) => set({ assetGenPrompt: v }),
  setAssetGenBackground: (v) => set({ assetGenBackground: v }),
  setAssetGenProvider: (v) => set((state) => ({
    assetGenProvider: v,
    // Grok has no transparent-background parameter, so switching to it must
    // not leave a stale "transparent" selection that silently returns an
    // opaque image.
    ...((v === "grok" || v === "grok-api") && state.assetGenBackground === "transparent"
      ? { assetGenBackground: "chroma-green" as const }
      : {}),
  })),
  setAssetGenKind: (v) => set({ assetGenKind: v }),
  generateAssetGen: () => generateAssetGenImpl(set, get),
  loadAssets: (reset) => loadAssetsImpl(reset, set, get),
  loadMoreAssets: () => loadMoreAssetsImpl(set, get),
  setAssetsFilters: (patch) => setAssetsFiltersImpl(patch, set, get),
  saveToAssets: (item) => saveToAssetsImpl(item, set, get),
  updateAssetItem: (id, patch) => updateAssetItemImpl(id, patch, set),
  deleteAssetItem: (id) => deleteAssetItemImpl(id, set),
  createAssetFolder: (name, parentId) => createAssetFolderImpl(name, parentId, set),
  renameAssetFolder: (id, name) => renameAssetFolderImpl(id, name, set),
  moveAssetFolder: (id, parentId) => moveAssetFolderImpl(id, parentId, set),
  deleteAssetFolder: (id) => deleteAssetFolderImpl(id, set),
  ...initialSelection,
  quality: storedGenerationDefaults.quality ?? "medium",
  sizePreset: storedGenerationDefaults.sizePreset ?? "1024x1024",
  customW: storedGenerationDefaults.customW ?? 1920,
  customH: storedGenerationDefaults.customH ?? 1088,
  grokAspectRatio: (storedGenerationDefaults as any).grokAspectRatio ?? "1:1",
  grokResolution: (storedGenerationDefaults as any).grokResolution ?? "1k",
  format: storedGenerationDefaults.format ?? "png",
  moderation: storedGenerationDefaults.moderation ?? "low",
  count: storedGenerationDefaults.count ?? 1,
  multimode: storedGenerationDefaults.multimode ?? false,
  multimodeMaxImages: storedGenerationDefaults.multimodeMaxImages ?? 4,
  multimodeSequences: {},
  activeFlightIds: new Set(),
  multimodePreviewFlightId: null,
  promptMode: storedGenerationDefaults.promptMode ?? "auto",
  prompt: storedGenerationDefaults.prompt ?? "",
  negativePrompt: storedGenerationDefaults.negativePrompt ?? "",
  naiOptionOverrides: loadNaiOverrides(),
  naiServerDefaults: null,
  insertedPrompts: storedGenerationDefaults.insertedPrompts ?? [],
  mcpInputRoles: [],
  mcpReferenceSelection: emptyMcpReferenceSelection(),
  mcpCharacterElementId: null,
  trayItems: [],
  nextAttachmentOrdinal: 1,
  retiredTags: {},
  elementCatalog: null,
  missingElementIds: [],
  pendingAssetDetailId: null,
  referenceImages: [],
  selectedElementIds: [],
  referenceLimit: DEFAULT_REFERENCE_IMAGE_LIMIT,
  activeReferenceLimit: () => effectiveReferenceLimit({
    provider: get().provider,
    serverLimit: get().referenceLimit,
    videoModelSelected: Boolean(get().videoModelSelected),
    mcpProvider: get().mcpProvider ?? null,
  }),
  providerUrlReference: null,
  canvasReferenceImage: null,
  physicalVideoSourceCount: () => countPhysicalVideoSources(get().trayItems),

  // Workspace Profile
  workspaceProfile: ((): import("../lib/workspaceProfile").WorkspaceProfile => {
    try { const v = localStorage.getItem("ima2.workspaceProfile"); return v === "prompt-studio" ? "prompt-studio" : "default"; } catch { return "default"; }
  })(),

  // Prompt Builder panel
  promptBuilderOpen: false,
  storyboardActive: false,

  // Prompt Library state (0.23)
  promptLibraryOpen: false,
  promptLibrary: { prompts: [], folders: [] },
  promptLibraryLoading: false,
  galleryFavorites: new Set(),
  browserId: getBrowserId(),

  // Canvas Mode state (0.24)
  canvasOpen: false,
  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  canvasExportBackground: loadCanvasExportBackground().mode,
  canvasExportMatteColor: loadCanvasExportBackground().matteColor,

  syncCapabilities: () => syncCapabilitiesImpl(set),
  addTrayAttachments: async (inputs) => addTrayAttachmentsImpl(inputs, set, get),
  addTrayAttachmentDataUrl: (dataUrl, origin) => addTrayAttachmentDataUrlImpl(dataUrl, origin, set, get),
  addTrayElement: (elementId) => addTrayElementImpl(elementId, set, get),
  addElementFromMention: (asset) => addTrayElementImpl(asset.id, set, get, asset),
  syncElementCatalog: (records) => syncElementCatalogImpl(records, set, get),
  openAssetDetail: (assetId) => set({ uiMode: "assets", pendingAssetDetailId: assetId }),
  removeTrayItem: (tokenId) => removeTrayItemImpl(tokenId, set, get),
  clearTray: () => clearTrayImpl(set, get),
  addElementId: (id) => { addTrayElementImpl(id, set, get); },
  removeElementId: (id) => removeTrayElementImpl(id, set, get),
  addReferences: (files) => addReferencesImpl(files, set, get),
  addReferenceDataUrl: (dataUrl) => addReferenceDataUrlImpl(dataUrl, set, get),
  metadataRestore: null,
  readDroppedImageMetadata: (file, targetNodeId = null) => readDroppedImageMetadataImpl(file, targetNodeId, set, get),
  applyMetadataRestore: () => applyMetadataRestoreImpl(set, get),
  cancelMetadataRestore: () => set({ metadataRestore: null }),
  addMetadataRestoreAsReference: () => addMetadataRestoreAsReferenceImpl(set, get),
  removeReference: (index) => removeReferenceImpl(index, set, get),
  setProviderUrlReference: (url) => set({ providerUrlReference: url }),
  clearReferences: () => clearReferencesImpl(set, get),
  attachCanvasVersionReference: (item, overrideSource) => attachCanvasVersionReferenceImpl(item, set, get, overrideSource),
  useCurrentAsReference: () => useCurrentAsReferenceImpl(set, get),
  useImageAsReference: (item) => useImageAsReferenceImpl(item, set, get),
  activeGenerations: 0,
  unseenGeneratedCount: 0,
  inFlight: [],
  cancelInFlightJob: (requestId) => cancelInFlightJobImpl(requestId, set, get),
  startInFlightPolling: () => {
    startInFlightPollingImpl(set, get);
  },
  reconcileInflight: async () => {
    await reconcileInflightImpl(set, get);
  },
  syncFromStorage: () => syncFromStorageImpl(set, get),
  currentImage: null,
  lastHistorySelectedAt: 0,
  applyMergedCanvasImage: (item) => applyMergedCanvasImageImpl(item, set),
  addGeneratedHistoryItem: async (item) => {
    await addHistory(item, set, get);
  },
  history: [],
  historyNextCursor: null,
  historyLoadingOlder: false,
  favoriteHistoryNextCursor: null,
  favoriteHistoryLoadingOlder: false,
  loadedHistoryRetainLimit: HISTORY_LIMIT,
  loadOlderHistory: async () => loadOlderHistoryImpl(set, get),
loadFavoriteHistory: async () => loadFavoriteHistoryImpl(set, get),
loadOlderFavoriteHistory: async () => loadOlderFavoriteHistoryImpl(set, get),
trashPending: null,
  toast: null,
  toastLog: [],
  customSizeConfirm: null,
  errorCard: null,
  errorCardLog: [],
  rightPanelOpen: loadRightPanelOpen(),
  toggleRightPanel: () => toggleRightPanelImpl(set, get),
  composeSheetOpen: false,
  composeSheetTab: "prompt",
  openComposeSheet: (tab = "prompt") => set({ composeSheetOpen: true, composeSheetTab: tab }),
  setComposeSheetTab: (tab) => set({ composeSheetTab: tab }),
  closeComposeSheet: () => set({ composeSheetOpen: false }),
  galleryOpen: false,
  openGallery: () =>
    set((s) => ({ galleryOpen: true, galleryScope: s.galleryDefaultScope })),
  closeGallery: () => set({ galleryOpen: false }),
  galleryScope: loadGalleryScope(GALLERY_SCOPE_STORAGE_KEY),
  galleryDefaultScope: loadGalleryScope(GALLERY_DEFAULT_SCOPE_STORAGE_KEY),
  setGalleryScope: (scope) => setGalleryScopeImpl(scope, set),
  setGalleryDefaultScope: (scope) => setGalleryDefaultScopeImpl(scope, set),

  reasoningEffort: loadReasoningEffort(),
  webSearchEnabled: loadWebSearchEnabled(),

  settingsOpen: false,
  activeSettingsSection: "providers",
  readinessPopupOpen: false,
  openSettings: (section = "providers") =>
    set({ settingsOpen: true, activeSettingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen, activeSettingsSection: s.settingsOpen ? s.activeSettingsSection : "providers" })),
  setActiveSettingsSection: (section) => set({ activeSettingsSection: section }),
  openReadinessPopup: () => set({ readinessPopupOpen: true }),
  closeReadinessPopup: () => set({ readinessPopupOpen: false }),

  uiMode: loadUIMode(),
  setUIMode: (m) => setUIModeImpl(m, set),

  historyStripLayout: loadHistoryStripLayout(),
  setHistoryStripLayout: (layout) => setHistoryStripLayoutImpl(layout, set),

  locale: loadLocale(),
  setLocale: (l) => {
    saveLocale(l);
    set({ locale: l });
  },

  graphNodes: [],
  graphEdges: [],
  graphHistoryPast: [],
  graphHistoryFuture: [],
  recordGraphHistory: (label) => {
    const s = get();
    set({
      graphHistoryPast: pushHistory(s.graphHistoryPast, makeSnapshot(s.graphNodes, s.graphEdges, label)),
      graphHistoryFuture: [],
    });
  },
  undoGraph: () => {
    const s = get();
    const shift = popUndo(
      s.graphHistoryPast,
      makeSnapshot(s.graphNodes, s.graphEdges, "current"),
      s.graphHistoryFuture,
    );
    if (!shift) return false;
    const merged = mergeAfterRestore(shift.restored, s.graphNodes);
    set({
      graphNodes: deriveParentServerNodeIds(merged.nodes, merged.edges),
      graphEdges: merged.edges,
      graphHistoryPast: shift.past,
      graphHistoryFuture: shift.future,
    });
    get().scheduleGraphSave();
    return true;
  },
  redoGraph: () => {
    const s = get();
    const shift = popRedo(
      s.graphHistoryPast,
      makeSnapshot(s.graphNodes, s.graphEdges, "current"),
      s.graphHistoryFuture,
    );
    if (!shift) return false;
    const merged = mergeAfterRestore(shift.restored, s.graphNodes);
    set({
      graphNodes: deriveParentServerNodeIds(merged.nodes, merged.edges),
      graphEdges: merged.edges,
      graphHistoryPast: shift.past,
      graphHistoryFuture: shift.future,
    });
    get().scheduleGraphSave();
    return true;
  },
  setGraphNodes: (graphNodes) => setGraphNodesImpl(graphNodes, set, get),
  setGraphEdges: (graphEdges) => setGraphEdgesImpl(graphEdges, set, get),
  disconnectEdge: (edgeId) => {
    get().disconnectEdges([edgeId]);
  },
  disconnectEdges: (edgeIds) => disconnectEdgesImpl(edgeIds, set, get),
  nodeSelectionMode: false,
  nodeBatchRunning: false,
  nodeBatchStopping: false,
  toggleNodeSelectionMode: () => toggleNodeSelectionModeImpl(set, get),
  selectAllGraphNodes: () => {
    set({ graphNodes: applySelectedNodeIds(get().graphNodes, get().graphNodes.map((n) => n.id)) });
  },
  selectNodeGraph: (clientId, additive) => selectNodeGraphImpl(clientId, additive, set, get),
  clearNodeSelection: () => {
    set({ graphNodes: applySelectedNodeIds(get().graphNodes, []) });
  },
  cancelNodeBatch: () => cancelNodeBatchImpl(set, get),

  sessions: [],
  activeSessionId: null,
  activeSessionGraphVersion: null,
  sessionLoading: false,

  async loadSessions() { await loadSessionsImpl(set, get); },
async switchSession(id) { await switchSessionImpl(id, set, get); },
async reconcileGraphPending() { await reconcileGraphPendingImpl(set, get); },
async createAndSwitchSession(title?: string) { await createAndSwitchSessionImpl(title, set, get); },
async renameCurrentSession(title) { await renameCurrentSessionImpl(title, set, get); },
async deleteSessionById(id) { await deleteSessionByIdImpl(id, set, get); },
scheduleGraphSave() {
    scheduleGraphSaveImpl(get, set);
  },

  async flushGraphSave(reason = "manual") {
    await flushGraphSaveImpl(get, set, reason);
  },

  addRootNode: () => addRootNodeImpl(set, get),
createRootNodeFromHistoryItem: (item) => createRootNodeFromHistoryItemImpl(item, set, get),
addChildNode: (parentClientId) => addChildNodeImpl(parentClientId, set, get),

  addSiblingNode: (sourceClientId) => addSiblingNodeImpl(sourceClientId, set, get),

  updateNodePrompt: (clientId, prompt) => updateNodePromptImpl(clientId, prompt, set, get),
  datVaiTroNode: (clientId, vaiTro) => datVaiTroNodeImpl(clientId, vaiTro, set, get),
addNodeReferences: async (clientId, files) => addNodeReferencesImpl(clientId, files, set, get),
addNodeReferenceDataUrl: (clientId, dataUrl) => addNodeReferenceDataUrlImpl(clientId, dataUrl, set, get),
addNodeReferenceFromUrl: async (clientId, src, filename) => addNodeReferenceFromUrlImpl(clientId, src, filename, set, get),
removeNodeReference: (clientId, index) => removeNodeReferenceImpl(clientId, index, set, get),
clearNodeReferences: (clientId) => clearNodeReferencesImpl(clientId, set, get),
duplicateBranchRoot: (sourceClientId) => duplicateBranchRootImpl(sourceClientId, set, get),

  generateNode: (clientId) => generateNodeImpl(clientId, set, get),

  generateNodeInPlace: (clientId) => generateNodeInPlaceImpl(clientId, set, get),

  generateNodeVariation: (clientId, sizeOverride) => generateNodeVariationImpl(clientId, sizeOverride, set, get),

  runGenerateNode: (clientId, sizeOverride) => runGenerateNodeImpl(clientId, sizeOverride, set, get),

  async runGenerateNodeInPlace(clientId, options = {}) {
    return runGenerateNodeInPlaceImpl(clientId, options, set, get, saveInFlight);
  },

  async runNodeBatch(mode) {
    await runNodeBatchImpl(mode, set, get);
  },

  deleteNode: (clientId) => deleteNodeImpl(clientId, set, get),
deleteNodes: (clientIds) => deleteNodesImpl(clientIds, set, get),
addChildNodeAt: (parentClientId, position, sourceHandle) => addChildNodeAtImpl(parentClientId, position, sourceHandle, set, get),

  connectNodes: (sourceClientId, targetClientId, sourceHandle, targetHandle) => connectNodesImpl(sourceClientId, targetClientId, sourceHandle, targetHandle, set, get),
  setProvider: (provider) => setProviderImpl(provider, set, get),
  setQuality: (quality) => setQualityImpl(quality, set),
  setSizePreset: (sizePreset) => setSizePresetImpl(sizePreset, set),
  setCustomSize: (w, h) => setCustomSizeImpl(w, h, set, get),
  setGrokAspectRatio: (grokAspectRatio) => setGrokAspectRatioImpl(grokAspectRatio, set),
  setGrokResolution: (grokResolution) => setGrokResolutionImpl(grokResolution, set),
  setFormat: (format) => setFormatImpl(format, set),
  setModeration: (moderation) => setModerationImpl(moderation, set),
  setImageModel: (imageModel) => setImageModelImpl(imageModel, set, get),
  videoDuration: storedVideoDefaults.duration,
  videoResolution: storedVideoDefaults.resolution as VideoResolutionUI,
  videoSingleRefMode: storedVideoDefaults.singleRefMode,
  videoAspectRatio: storedVideoDefaults.aspectRatio,
  // Not persisted with the other video defaults on purpose: a voice belongs to the
  // scene being written, and reviving yesterday's cast on a fresh prompt would be a
  // surprise the user has to notice and undo.
  videoReferenceVoices: [],
  videoTopic: "",
  videoContinuityLineage: null,
  videoProgress: null,
  selectVideoModel: (model) => selectVideoModelImpl(model, set, get),
  setComfyWorkflow: (workflowId) => setComfyWorkflowImpl(workflowId, set, get),
  setComfyVideoWorkflow: (workflowId) => setComfyVideoWorkflowImpl(workflowId, set, get),
  setVideoDuration: (videoDuration) => { set({ videoDuration }); saveVideoDefaults({ duration: videoDuration }); },
  setVideoResolution: (videoResolution) => { set({ videoResolution }); saveVideoDefaults({ resolution: videoResolution }); },
  setVideoAspectRatio: (videoAspectRatio) => { set({ videoAspectRatio }); saveVideoDefaults({ aspectRatio: videoAspectRatio }); },
  toggleVideoReferenceVoice: (voiceId) => {
    const current = get().videoReferenceVoices;
    const next = current.includes(voiceId)
      ? current.filter((id) => id !== voiceId)
      // xAI refuses a fourth voice with 400 "Too many reference audio clips". Stopping
      // here keeps the prompt's <AUDIO_n> tags matching what was actually sent.
      : current.length >= 3 ? current : [...current, voiceId];
    set({ videoReferenceVoices: next });
  },
  setVideoSingleRefMode: (videoSingleRefMode) => { set({ videoSingleRefMode }); saveVideoDefaults({ singleRefMode: videoSingleRefMode }); },
  setVideoTopic: (videoTopic) => set({ videoTopic }),
  setVideoContinuityLineage: (videoContinuityLineage) => set({ videoContinuityLineage }),
  activeVideoRefCount: () => activeVideoRefCountImpl(get),
  runVideoGenerate: async (nodeId) => {
    await runVideoGenerateImpl(nodeId, set, get);
  },
  animateImage: async (filename, prompt) => {
    return animateImageImpl(filename, prompt, set, get);
  },
  setReasoningEffort: (reasoningEffort) => setReasoningEffortImpl(reasoningEffort, set),
  setWebSearchEnabled: (webSearchEnabled) => setWebSearchEnabledImpl(webSearchEnabled, set),
  setCount: (count) => setCountImpl(count, set),
  setMultimode: (enabled) => setMultimodeImpl(enabled, set, get),
  setMultimodeMaxImages: (count) => setMultimodeMaxImagesImpl(count, set),
  setPromptMode: (promptMode) => setPromptModeImpl(promptMode, set),
  setPrompt: (prompt) => setPromptImpl(prompt, set),
  setNegativePrompt: (value) => setNegativePromptImpl(value, set),
  setNaiOption: (key, value) => setNaiOptionImpl(key, value, set, get),
  resetNaiOptions: () => resetNaiOptionsImpl(set),
  insertPromptToComposer: (prompt) => insertPromptToComposerImpl(prompt, set),
  removeInsertedPromptFromComposer: (id) => removeInsertedPromptFromComposerImpl(id, set),
  moveInsertedPromptInComposer: (id, direction) => moveInsertedPromptInComposerImpl(id, direction, set),
  clearInsertedPrompts: () => clearInsertedPromptsImpl(set),

  selectHistory: (item) => selectHistoryImpl(item, set, get),
showHistorySequence: (sequenceId) => showHistorySequenceImpl(sequenceId, set, get),
markGeneratedResultsSeen: () => set({ unseenGeneratedCount: 0 }),

  selectHistoryShortcutTarget: (action) => selectHistoryShortcutTargetImpl(action, set, get),
trashHistoryItem: async (item) => trashHistoryItemImpl(item, set, get),
trashHistorySequence: async (sequenceId) => trashHistorySequenceImpl(sequenceId, set, get),
restorePendingTrash: async () => restorePendingTrashImpl(set, get),
clearPendingTrash: () => set({ trashPending: null }),

  permanentlyDeleteHistoryItemByClick: async (item) => {
    await get().permanentlyDeleteHistoryItemByShortcut(item);
  },

  permanentlyDeleteHistoryItemByShortcut: async (item) => permanentlyDeleteHistoryItemImpl(item, set, get),
removeFromHistory: (filename) => removeFromHistoryImpl(filename, set, get),
addHistoryItem: (item) => addHistoryItemImpl(item, set, get),
importLocalImageToHistory: async (file) => importLocalImageToHistoryImpl(file, set, get),

  getResolvedSize: () => getResolvedSizeImpl(get),

  generate: () => generateImpl(set, get),

  async generateMultimode(sizeOverride) {
    await generateMultimodeImpl(sizeOverride, set, get);
  },

  cancelMultimode: () => cancelMultimodeImpl(set, get),

  async runGenerate(sizeOverride) {
    await runGenerateImpl(sizeOverride, set, get);
  },

  confirmCustomSizeAdjustment: () => confirmCustomSizeAdjustmentImpl(set, get),

  cancelCustomSizeAdjustment: () => set({ customSizeConfirm: null }),

  hydrateHistory() {
    hydrateHistoryImpl(set, get);
  },

  showToast: (message, error = false) => showToastImpl(message, error, set),
  dismissToast: (id) => dismissToastImpl(id, set),
  showErrorCard: (code, params) => showErrorCardImpl(code, params, set),
  dismissErrorCard: (id) => dismissErrorCardImpl(id, set),

  // ── Workspace Profile actions ──
  setWorkspaceProfile(profile) {
    set({ workspaceProfile: profile });
    try { localStorage.setItem("ima2.workspaceProfile", profile); } catch { /* non-critical */ }
  },
  togglePromptBuilder() {
    set((s) => ({ promptBuilderOpen: !s.promptBuilderOpen }));
  },
  toggleStoryboard() {
    set((s) => ({ storyboardActive: !s.storyboardActive }));
  },

  // ── Prompt Library actions (0.23) ──
  setPromptLibraryOpen(open) {
    set({ promptLibraryOpen: open });
  },
  togglePromptLibrary() {
    set((s) => ({ promptLibraryOpen: !s.promptLibraryOpen }));
  },

  loadPromptLibrary: () => loadPromptLibraryImpl(set),

  savePromptToLibrary: (payload) => savePromptToLibraryImpl(payload, set, get),

  deletePromptFromLibrary: (id) => deletePromptFromLibraryImpl(id, set, get),

  togglePromptFavorite: (id) => togglePromptFavoriteImpl(id, set, get),

  importPromptsToLibrary: (files) => importPromptsToLibraryImpl(files, set, get),

  toggleGalleryFavorite: (item) => toggleGalleryFavoriteImpl(item, set, get),

  // Canvas Mode actions (0.24)
  openCanvas: () => set({ canvasOpen: true, canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),
  closeCanvas: () => set({ canvasOpen: false }),
  setCanvasZoom: (zoom) => set({ canvasZoom: Math.max(0.5, Math.min(3, zoom)) }),
  resetCanvasZoom: () => set({ canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),
  setCanvasPan: (x, y) => setCanvasPanImpl(x, y, set),
  resetCanvasPan: () => set({ canvasPanX: 0, canvasPanY: 0 }),
  setCanvasExportBackground: (mode) => setCanvasExportBackgroundImpl(mode, set, get),
  setCanvasExportMatteColor: (color) => setCanvasExportMatteColorImpl(color, set, get),
}));
