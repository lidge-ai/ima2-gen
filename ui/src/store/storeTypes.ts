import type { ImageToolModel } from "../types";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { CanvasExportBackground, HexColor } from "../types/canvas";
import type {
  Count,
  Format,
  GenerateItem,
  EmbeddedGenerationMetadata,
  ImageModel,
  Moderation,
  MultimodeSequenceStatus,
  Provider,
  Quality,
  SettingsSection,
  SizePreset,
  UIMode,
  VideoResolutionUI,
  VideoContinuityLineage,
  HistoryStripLayout,
} from "../types";
import type { SpriteCuratorTarget } from "../types/spriteAtlas";
import type { NaiOptions, NaiOptionOverrides } from "../lib/naiOptions";
import type { HistoryCursor, SessionSummary, PromptItem, PromptFolder } from "../lib/api";
import type { ClientNodeId } from "../lib/graph";
import type { NodeBatchMode } from "../lib/nodeBatch";
import type { ImaErrorCode } from "../lib/errorCodes";
import type { CustomSizeAdjustmentReason } from "../lib/size";
import type { ReasoningEffort } from "../lib/reasoning";
import type { GalleryShortcutAction } from "../lib/galleryShortcuts";
import type { WorkspaceProfile } from "../lib/workspaceProfile";
import type { McpInputRole, McpPresetValue } from "../lib/mcpProviders";
import type { McpReferenceSelection } from "../lib/mcpSelection";
import type { Locale } from "../i18n";
import type { SpriteRecipeDraft, SpriteRecipeRecord, SpriteRecipeSummary } from "../types/spriteRecipe";
import type { ReferenceTraySlice, TrayItem } from "../lib/referenceTray";
export type AssetGenWorkflow = "generate" | "sprite";

export type GalleryScope = "current-session" | "all";

export type AssetItem = {
  id: string;
  kind: "image" | "video" | "element" | "preset" | "template";
  name: string;
  filePath: string | null;
  folderId: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type AssetFolder = { id: string; name: string; parentId: string | null; createdAt: number; updatedAt: number };
export type AssetsFilters = { kind: string | null; folderId: string | null; tag: string | null; q: string };

export type VideoDefaults = {
  model: string | false;
  duration: number;
  resolution: string;
  aspectRatio: string;
  /**
   * What a lone tray reference means. One image is ambiguous — as a first frame it
   * gets animated, as a reference it guides a new scene — and only the user knows
   * which they meant.
   */
  singleRefMode: "image-to-video" | "reference-to-video";
};

export type PersistedInFlight = {
  id: string;
  prompt: string;
  startedAt: number;
  composerPrompt?: string;
  composerInsertedPrompts?: InsertedPrompt[];
  phase?: string;
  sessionId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: string | null;
  kind?: "classic" | "node" | "multimode" | "video" | "mcp-image" | "mcp-video" | `mcp-action-${string}`;
};

export type ServerInFlightJob = {
  requestId: string;
  kind?: string;
  prompt?: string;
  startedAt: number;
  phase?: string;
  meta?: Record<string, unknown>;
};

export type ServerTerminalJob = ServerInFlightJob & {
  status?: "completed" | "error" | "canceled";
  finishedAt?: number;
  durationMs?: number;
  httpStatus?: number;
  errorCode?: string;
};

export type InflightQueryScope = {
  kind: NonNullable<PersistedInFlight["kind"]>;
  sessionId?: string;
};

export type InsertedPrompt = {
  id: string;
  name: string;
  text: string;
  placement?: "before" | "after";
};

export type GraphSaveReason =
  | "debounced"
  | "manual"
  | "switch-session"
  | "recovery"
  | "beforeunload"
  | "queued"
  | "edge-disconnect"
  | "node-complete"
  | "video-node-complete";
export type GraphSaveResult = "saved" | "skipped" | "conflict" | "failed";

export type ImageNodeStatus =
  | "empty"
  | "pending"
  | "reconciling"
  | "ready"
  | "stale"
  | "asset-missing"
  | "error";

export type ImageNodeData = {
  clientId: ClientNodeId;
  serverNodeId: string | null;
  parentServerNodeId: string | null;
  /** Cha phu: chi lay ANH cua tung node lam tham chieu, khong phai anh goc dem di sua. */
  extraParentServerNodeIds?: string[];
  prompt: string;
  imageUrl: string | null;
  status: ImageNodeStatus;
  pendingRequestId: string | null;
  recoveryRequestId?: string | null;
  pendingPhase?: string | null;
  pendingStartedAt?: number | null;
  partialImageUrl?: string | null;
  error?: string;
  /** Structured error state for the inline node card (020, wp2). */
  errorInfo?: import("../lib/nodeErrorInfo").NodeErrorInfo | null;
  elapsed?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  webSearchCalls?: number;
  model?: string | null;
  size?: string | null;
  /** Per-node provider override written by branch variants (settingsPatch). */
  provider?: string | null;
  referenceImages?: string[];
  video?: { duration?: number; resolution?: string; aspectRatio?: string; topic?: string } | null;
  videoContinuity?: VideoContinuityLineage | null;
};

export type GraphNode = FlowNode<ImageNodeData>;
export type GraphEdge = FlowEdge;

export type GraphHistoryEntry = import("../lib/nodeHistory").GraphSnapshotEntry;

export type ToastEntry = { message: string; error: boolean; id: number; createdAt: number };
export type ToastState = ToastEntry | null;
export type ErrorCardEntry = { code: ImaErrorCode; cardKey?: string; cta?: "reauth" | "reload" | "retry" | "dismiss"; fallbackMessage?: string; id: number; createdAt: number };
export type ComposeSheetTab = "prompt" | "controls" | "library";

export type TrashPendingState = {
  filename: string;
  trashId: string;
  item: GenerateItem;
  expiresAt: number;
} | null;

export type CustomSizeConfirmState = {
  requestedW: number;
  requestedH: number;
  adjustedW: number;
  adjustedH: number;
  reasons: CustomSizeAdjustmentReason[];
  continuation:
    | { kind: "classic" }
    | { kind: "multimode" }
    | { kind: "node"; clientId: ClientNodeId }
    | { kind: "node-in-place"; clientId: ClientNodeId }
    | { kind: "node-variation"; clientId: ClientNodeId };
} | null;

export type MetadataRestoreState = {
  filename: string;
  image: string;
  metadata: EmbeddedGenerationMetadata;
  source: "xmp" | "png-comment" | string;
  targetNodeId?: ClientNodeId | null;
} | null;

export type MultimodeSequenceState = {
  sequenceId: string;
  requestId: string;
  requested: number;
  returned: number;
  images: GenerateItem[];
  partials: Array<{ image: string; index?: number | null }>;
  status: MultimodeSequenceStatus;
  elapsed?: string;
  error?: string | null;
};

export type GenerationDefaults = Partial<{
  provider: Provider;
  mcpProvider: string | null;
  mcpModel: string | null;
  comfyWorkflow: string | null;
  comfyVideoWorkflow: string | null;
  mcpMediaKind: "image" | "video";
  mcpRatio: string | null;
  mcpParameters: Record<string, McpPresetValue>;
  imageToolModel: ImageToolModel | null;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
  count: Count;
  multimode: boolean;
  multimodeMaxImages: Count;
  promptMode: "auto" | "direct";
  prompt: string;
  negativePrompt: string;
  insertedPrompts: InsertedPrompt[];
  presetIds: string[];
}>;

export type PresetState = {
  selectedPresetIds: string[];
  addPreset: (id: string) => void;
  removePreset: (id: string) => void;
  togglePreset: (id: string) => void;
  clearPresets: () => void;
  restorePresetIds: (ids: string[]) => void;
};

export type AppState = PresetState & ReferenceTraySlice & {
  // Element-mention catalog (higgsfield 110): full AssetItem records upserted
  // on selection so tray chips survive a fresh store; missing ids block
  // generation until removed or re-synced.
  elementCatalog: AssetItem[] | null;
  missingElementIds: string[];
  addElementFromMention: (asset: AssetItem) => TrayItem | null;
  syncElementCatalog: (records: AssetItem[]) => void;
  /** Cross-surface "open this asset's detail" request (e.g. element node
   * double-click on the canvas). AssetsWorkspace consumes and clears it. */
  pendingAssetDetailId: string | null;
  openAssetDetail: (assetId: string) => void;
  assetGenWorkflow: AssetGenWorkflow;
  setAssetGenWorkflow: (value: AssetGenWorkflow) => void;
  spriteRecipes: SpriteRecipeSummary[];
  activeSpriteRecipeId: string | null;
  activeSpriteRecipe: SpriteRecipeRecord | null;
  spriteRecipeDraft: SpriteRecipeDraft;
  spriteRecipeDirty: boolean;
  spriteRecipeLoading: boolean;
  spriteRecipeSaving: boolean;
  spriteRecipeGenerating: boolean;
  spriteRecipeError: string | null;
  spriteSelectedStates: string[];
  spritePartialPreviews: Record<string, string>;
  loadSpriteRecipes: () => Promise<void>;
  selectSpriteRecipe: (id: string | null) => Promise<void>;
  updateSpriteRecipeDraft: (patch: Partial<SpriteRecipeDraft>) => void;
  saveSpriteRecipe: () => Promise<string | null>;
  generateSpriteAnchor: () => Promise<void>;
  approveSpriteAnchor: (assetId: string) => Promise<void>;
  generateSpriteRows: (stateKeys?: string[]) => Promise<void>;
  cancelSpriteJob: (requestId: string) => Promise<void>;
  assets: AssetItem[];
  assetsFolders: AssetFolder[];
  addElementId: (id: string) => void;
  removeElementId: (id: string) => void;
  assetsTags: string[];
  assetsLoading: boolean;
  assetsLoadError: boolean;
  assetsCursor: string | null;
  assetsFilters: AssetsFilters;
  assetGenPrompt: string;
  assetGenBackground: import("../types").AssetGenBackgroundPreset;
  assetGenProvider: Provider;
  assetGenKind: "image" | "video";
  assetGenVideoDuration: number;
  assetGenVideoResolution: "480p" | "720p";
  assetGenVideoAspect: "1:1" | "16:9" | "9:16";
  setAssetGenVideoDuration: (v: number) => void;
  setAssetGenVideoResolution: (v: "480p" | "720p") => void;
  setAssetGenVideoAspect: (v: "1:1" | "16:9" | "9:16") => void;
  assetGenItems: GenerateItem[];
  assetGenSaveFailures: string[];
  assetGenLastError: string | null;
  setAssetGenLastError: (v: string | null) => void;
  keyingTarget: GenerateItem | null;
  setKeyingTarget: (item: GenerateItem | null) => void;
  vectorizeTarget: GenerateItem | null;
  setVectorizeTarget: (item: GenerateItem | null) => void;
  spriteCuratorTarget: SpriteCuratorTarget | null;
  setCuratorTarget: (target: SpriteCuratorTarget | null) => void;
  addAssetGenDerivedItem: (item: GenerateItem) => void;
  selectedProjectId: string | null;
  setSelectedProject: (id: string | null) => void;
  loadAssetFolders: () => Promise<void>;
  retryAssetGenSave: (requestId: string) => Promise<void>;
  setAssetGenPrompt: (v: string) => void;
  setAssetGenBackground: (v: import("../types").AssetGenBackgroundPreset) => void;
  setAssetGenProvider: (v: Provider) => void;
  setAssetGenKind: (v: "image" | "video") => void;
  generateAssetGen: () => Promise<void>;
  loadAssets: (reset?: boolean) => Promise<void>;
  loadMoreAssets: () => Promise<void>;
  setAssetsFilters: (patch: Partial<AssetsFilters>) => void;
  saveToAssets: (item: GenerateItem) => Promise<boolean>;
  updateAssetItem: (id: string, patch: { name?: string; folderId?: string | null; notes?: string; tags?: string[]; metadata?: Record<string, unknown> }) => Promise<boolean>;
  deleteAssetItem: (id: string) => Promise<boolean>;
  createAssetFolder: (name: string, parentId?: string | null) => Promise<boolean>;
  renameAssetFolder: (id: string, name: string) => Promise<boolean>;
  moveAssetFolder: (id: string, parentId: string | null) => Promise<boolean>;
  deleteAssetFolder: (id: string) => Promise<boolean>;
  provider: Provider;
  imageToolModel: ImageToolModel | null;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  grokAspectRatio: string;
  grokResolution: "1k" | "2k";
  format: Format;
  moderation: Moderation;
  imageModel: ImageModel;
  reasoningEffort: ReasoningEffort;
  webSearchEnabled: boolean;
  count: Count;
  multimode: boolean;
  multimodeMaxImages: Count;
  multimodeSequences: Record<string, MultimodeSequenceState>;
  activeFlightIds: Set<string>;
  multimodePreviewFlightId: string | null;
  promptMode: "auto" | "direct";
  prompt: string;
  negativePrompt: string;
  /** Sparse: only the NovelAI fields the user explicitly changed (020). */
  naiOptionOverrides: NaiOptionOverrides;
  /** Display defaults from /api/capabilities; null until it answers. */
  naiServerDefaults: NaiOptionOverrides | null;
  referenceLimit: number;
  providerUrlReference: string | null;
  canvasReferenceImage: string | null;
  syncCapabilities: () => Promise<void>;
  addReferences: (files: File[]) => Promise<void>;
  addReferenceDataUrl: (dataUrl: string) => void;
  removeReference: (index: number) => void;
  clearReferences: () => void;
  setProviderUrlReference: (url: string | null) => void;
  useCurrentAsReference: () => Promise<void>;
  useImageAsReference: (item: GenerateItem) => Promise<void>;
  attachCanvasVersionReference: (item: GenerateItem, overrideSource?: string) => Promise<void>;
  activeGenerations: number;
  unseenGeneratedCount: number;
  inFlight: PersistedInFlight[];
  cancelInFlightJob: (requestId: string) => Promise<void>;
  startInFlightPolling: () => void;
  reconcileInflight: () => Promise<void>;
  reconcileGraphPending: () => Promise<void>;
  syncFromStorage: () => void;
  currentImage: GenerateItem | null;
  lastHistorySelectedAt: number;
  applyMergedCanvasImage: (item: GenerateItem) => void;
  addGeneratedHistoryItem: (item: GenerateItem) => Promise<void>;
  history: GenerateItem[];
  historyNextCursor: HistoryCursor | null;
  historyLoadingOlder: boolean;
  favoriteHistoryNextCursor: HistoryCursor | null;
  favoriteHistoryLoadingOlder: boolean;
  loadedHistoryRetainLimit: number;
  loadOlderHistory: () => Promise<void>;
  loadFavoriteHistory: () => Promise<void>;
  loadOlderFavoriteHistory: () => Promise<void>;
  trashPending: TrashPendingState;
  toast: ToastState;
  toastLog: ToastEntry[];
  customSizeConfirm: CustomSizeConfirmState;
  metadataRestore: MetadataRestoreState;
  readDroppedImageMetadata: (file: File, targetNodeId?: ClientNodeId | null) => Promise<boolean>;
  applyMetadataRestore: () => void;
  cancelMetadataRestore: () => void;
  addMetadataRestoreAsReference: () => void;
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  composeSheetOpen: boolean;
  composeSheetTab: ComposeSheetTab;
  openComposeSheet: (tab?: ComposeSheetTab) => void;
  setComposeSheetTab: (tab: ComposeSheetTab) => void;
  closeComposeSheet: () => void;
  galleryOpen: boolean;
  openGallery: () => void;
  closeGallery: () => void;
  galleryScope: GalleryScope;
  galleryDefaultScope: GalleryScope;
  setGalleryScope: (scope: GalleryScope) => void;
  setGalleryDefaultScope: (scope: GalleryScope) => void;

  settingsOpen: boolean;
  activeSettingsSection: SettingsSection;
  readinessPopupOpen: boolean;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveSettingsSection: (section: SettingsSection) => void;
  openReadinessPopup: () => void;
  closeReadinessPopup: () => void;

  uiMode: UIMode;
  setUIMode: (m: UIMode) => void;

  historyStripLayout: HistoryStripLayout;
  setHistoryStripLayout: (layout: HistoryStripLayout) => void;

  locale: Locale;
  setLocale: (l: Locale) => void;

  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  setGraphNodes: (n: GraphNode[]) => void;
  setGraphEdges: (e: GraphEdge[]) => void;
  graphHistoryPast: GraphHistoryEntry[];
  graphHistoryFuture: GraphHistoryEntry[];
  recordGraphHistory: (label: string) => void;
  undoGraph: () => boolean;
  redoGraph: () => boolean;
  nodeSelectionMode: boolean;
  nodeBatchRunning: boolean;
  nodeBatchStopping: boolean;
  toggleNodeSelectionMode: () => void;
  selectAllGraphNodes: () => void;
  selectNodeGraph: (clientId: ClientNodeId, additive: boolean) => void;
  clearNodeSelection: () => void;
  runNodeBatch: (mode: NodeBatchMode) => Promise<void>;
  cancelNodeBatch: () => void;
  addRootNode: () => ClientNodeId;
  createRootNodeFromHistoryItem: (item: GenerateItem) => ClientNodeId;
  addChildNode: (parentClientId: ClientNodeId) => ClientNodeId;
  addSiblingNode: (sourceClientId: ClientNodeId) => ClientNodeId;
  duplicateBranchRoot: (sourceClientId: ClientNodeId) => ClientNodeId;
  addChildNodeAt: (
    parentClientId: ClientNodeId,
    position: { x: number; y: number },
    sourceHandle?: string | null,
  ) => ClientNodeId;
  connectNodes: (
    sourceClientId: ClientNodeId,
    targetClientId: ClientNodeId,
    sourceHandle?: string | null,
    targetHandle?: string | null,
  ) => void;
  updateNodePrompt: (clientId: ClientNodeId, prompt: string) => void;
  addNodeReferences: (clientId: ClientNodeId, files: File[]) => Promise<void>;
  addNodeReferenceDataUrl: (clientId: ClientNodeId, dataUrl: string) => void;
  addNodeReferenceFromUrl: (clientId: ClientNodeId, src: string, filename?: string) => Promise<void>;
  removeNodeReference: (clientId: ClientNodeId, index: number) => void;
  clearNodeReferences: (clientId: ClientNodeId) => void;
  generateNode: (clientId: ClientNodeId) => Promise<void>;
  generateNodeInPlace: (clientId: ClientNodeId) => Promise<void>;
  generateNodeVariation: (clientId: ClientNodeId, sizeOverride?: string) => Promise<void>;
  runGenerateNode: (clientId: ClientNodeId, sizeOverride?: string) => Promise<void>;
  runGenerateNodeInPlace: (
    clientId: ClientNodeId,
    options?: {
      sizeOverride?: string;
      parentServerNodeIdOverride?: string | null;
      suppressToast?: boolean;
    },
  ) => Promise<string | null>;
  deleteNode: (clientId: ClientNodeId) => void;
  deleteNodes: (clientIds: ClientNodeId[]) => void;
  disconnectEdge: (edgeId: string) => void;
  disconnectEdges: (edgeIds: string[]) => void;

  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSessionGraphVersion: number | null;
  sessionLoading: boolean;
  loadSessions: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  createAndSwitchSession: (title?: string) => Promise<void>;
  renameCurrentSession: (title: string) => Promise<void>;
  deleteSessionById: (id: string) => Promise<void>;
  scheduleGraphSave: () => void;
  flushGraphSave: (reason?: GraphSaveReason) => Promise<void>;

  setProvider: (p: Provider) => void;
  /** Hydrated lazily by the sidebar MCP selector until the store bootstrap owns this lane. */
  mcpProvider?: string | null;
  mcpModel?: string | null;
  /**
   * Selected comfy workflow id.
   *
   * Separate from imageModel because that field is a literal union generated
   * from the static registry, and a user-registered workflow id can never be a
   * member of it. Mirrors how mcpModel carries a runtime-catalog selection.
   */
  comfyWorkflow?: string | null;
  /**
   * Selected comfy VIDEO workflow id.
   *
   * Kept apart from videoModelSelected because that field is normalized through
   * normalizeVideoModelValue, which only recognizes Grok ids and rewrites
   * anything else. Widening it would change what every consumer of that
   * normalizer means by "video model".
   */
  comfyVideoWorkflow?: string | null;
  mcpMediaKind?: "image" | "video";
  mcpRatio?: string | null;
  mcpParameters?: Record<string, McpPresetValue>;
  mcpInputRoles?: McpInputRole[];
  mcpReferenceSelection?: McpReferenceSelection;
  mcpCharacterElementId?: string | null;
  setImageToolModel: (model: ImageToolModel | null) => void;
  setQuality: (q: Quality) => void;
  setSizePreset: (s: SizePreset) => void;
  setCustomSize: (w: number, h: number) => void;
  setGrokAspectRatio: (ar: string) => void;
  setGrokResolution: (r: "1k" | "2k") => void;
  setFormat: (f: Format) => void;
  setModeration: (m: Moderation) => void;
  setImageModel: (m: ImageModel) => void;
  videoModelSelected: string | false;
  videoDuration: number;
  videoResolution: VideoResolutionUI;
  videoSingleRefMode: "image-to-video" | "reference-to-video";
  videoAspectRatio: string;
  /** Preset voice ids for reference-to-video. Max 3, grok-imagine-video-1.5 only. */
  videoReferenceVoices: string[];
  videoTopic: string;
  videoContinuityLineage: VideoContinuityLineage | null;
  videoProgress: number | null;
  selectVideoModel: (model?: string) => void;
  setComfyWorkflow: (workflowId: string | null) => void;
  setComfyVideoWorkflow: (workflowId: string | null) => void;
  setVideoDuration: (n: number) => void;
  setVideoResolution: (r: VideoResolutionUI) => void;
  setVideoAspectRatio: (a: string) => void;
  toggleVideoReferenceVoice: (voiceId: string) => void;
  setVideoSingleRefMode: (m: "image-to-video" | "reference-to-video") => void;
  setVideoTopic: (topic: string) => void;
  setVideoContinuityLineage: (lineage: VideoContinuityLineage | null) => void;
  activeVideoRefCount: () => number;
  runVideoGenerate: (nodeId?: string) => Promise<void>;
  animateImage: (filename: string, prompt?: string) => Promise<boolean>;
  setReasoningEffort: (e: ReasoningEffort) => void;
  setNaiOption: <K extends keyof NaiOptions>(key: K, value: NaiOptions[K]) => void;
  resetNaiOptions: () => void;
  setNegativePrompt: (value: string) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setCount: (c: Count) => void;
  setMultimode: (enabled: boolean) => void;
  setMultimodeMaxImages: (c: Count) => void;
  generateMultimode: (sizeOverride?: string) => Promise<void>;
  cancelMultimode: () => void;
  setPromptMode: (m: "auto" | "direct") => void;
  setPrompt: (p: string) => void;
  insertedPrompts: InsertedPrompt[];
  insertPromptToComposer: (prompt: InsertedPrompt) => void;
  removeInsertedPromptFromComposer: (id: string) => void;
  moveInsertedPromptInComposer: (id: string, direction: "up" | "down") => void;
  clearInsertedPrompts: () => void;
  selectHistory: (item: GenerateItem) => void;
  showHistorySequence: (sequenceId: string) => void;
  markGeneratedResultsSeen: () => void;
  selectHistoryShortcutTarget: (action: GalleryShortcutAction) => void;
  trashHistoryItem: (item: GenerateItem) => Promise<void>;
  trashHistorySequence: (sequenceId: string) => Promise<void>;
  restorePendingTrash: () => Promise<void>;
  clearPendingTrash: () => void;
  permanentlyDeleteHistoryItemByClick: (item: GenerateItem) => Promise<void>;
  permanentlyDeleteHistoryItemByShortcut: (item: GenerateItem) => Promise<void>;
  removeFromHistory: (filename: string) => void;
  addHistoryItem: (item: GenerateItem) => void;
  importLocalImageToHistory: (file: File) => Promise<GenerateItem | null>;
  generate: () => Promise<void>;
  runGenerate: (sizeOverride?: string) => Promise<void>;
  confirmCustomSizeAdjustment: () => Promise<void>;
  cancelCustomSizeAdjustment: () => void;
  hydrateHistory: () => void;
  showToast: (message: string, error?: boolean) => void;
  dismissToast: (id: number) => void;
  errorCard: ErrorCardEntry | null;
  errorCardLog: ErrorCardEntry[];
  showErrorCard: (code: ImaErrorCode, params?: { fallbackMessage?: string; cardKey?: string; cta?: "reauth" | "reload" | "retry" | "dismiss" }) => void;
  dismissErrorCard: (id?: number) => void;
  getResolvedSize: () => string;

  workspaceProfile: WorkspaceProfile;
  setWorkspaceProfile: (profile: WorkspaceProfile) => void;

  promptBuilderOpen: boolean;
  togglePromptBuilder: () => void;
  storyboardActive: boolean;
  toggleStoryboard: () => void;

  promptLibraryOpen: boolean;
  setPromptLibraryOpen: (open: boolean) => void;
  togglePromptLibrary: () => void;
  promptLibrary: { prompts: PromptItem[]; folders: PromptFolder[] };
  promptLibraryLoading: boolean;
  loadPromptLibrary: () => Promise<void>;
  savePromptToLibrary: (payload: { name?: string; text: string; tags?: string[]; folderId?: string; mode?: "auto" | "direct" }) => Promise<void>;
  deletePromptFromLibrary: (id: string) => Promise<void>;
  togglePromptFavorite: (id: string) => Promise<void>;
  importPromptsToLibrary: (files: File[]) => Promise<void>;
  galleryFavorites: Set<string>;
  toggleGalleryFavorite: (item: GenerateItem) => Promise<boolean | null>;
  browserId: string;

  canvasOpen: boolean;
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  canvasExportBackground: CanvasExportBackground;
  canvasExportMatteColor: HexColor;
  openCanvas: () => void;
  closeCanvas: () => void;
  setCanvasZoom: (zoom: number) => void;
  resetCanvasZoom: () => void;
  setCanvasPan: (x: number, y: number) => void;
  resetCanvasPan: () => void;
  setCanvasExportBackground: (mode: CanvasExportBackground) => void;
  setCanvasExportMatteColor: (color: HexColor) => void;
};

export type StoreSet = (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type StoreGet = () => AppState;
