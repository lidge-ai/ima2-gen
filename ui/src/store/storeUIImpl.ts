import type { VideoResolutionUI, GenerateItem } from "../types";
import { cancelInflight } from "../lib/api";
import {
  getVisibleGalleryItems,
  resolveVisibleShortcutCurrent,
} from "../lib/galleryShortcuts";
import {
  deriveParentServerNodeIds,
} from "../lib/nodeGraph";
import {
  applyComponentSelection,
  applySelectedNodeIds,
} from "../lib/nodeSelection";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "../lib/devMode";
import { t } from "../i18n";
import {
  GALLERY_DEFAULT_SCOPE_STORAGE_KEY,
  GALLERY_SCOPE_STORAGE_KEY,
  HISTORY_STRIP_LAYOUT_STORAGE_KEY,
  RIGHT_PANEL_OPEN_STORAGE_KEY,
  UI_MODE_STORAGE_KEY,
} from "./persistenceRegistry";
import {
  loadSelectedFilename,
  loadVideoDefaults,
  loadGenerationDefaults,
  persistCanvasExportBackground,
} from "./storePersistence";
import {
  loadInFlight,
  retainHistoryItems,
  saveInFlight,
} from "./storeHelpers";
import type { GalleryScope, GraphNode, GraphEdge, StoreSet, StoreGet } from "./storeTypes";
import type { ClientNodeId } from "../lib/graph";
import type { ImaErrorCode } from "../lib/errorCodes";
import type { CanvasExportBackground, HexColor } from "../types/canvas";
import type { HistoryStripLayout, UIMode } from "../types";
import { abortFlight } from "./flightAbortRegistry";
import { loadCoreSelectionSnapshot } from "./coreSelectionPersistence";
import { normalizeImageQuality } from "../lib/imageModels";

export async function cancelInFlightJobImpl(
  requestId: string,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (!requestId) return;
  abortFlight(requestId);
  set((s) => {
    const next = s.inFlight.map((job) =>
      job.id === requestId ? { ...job, phase: "canceling" } : job,
    );
    saveInFlight(next);
    return { inFlight: next };
  });
  try {
    await cancelInflight(requestId);
    get().startInFlightPolling();
  } catch {
    get().showToast(t("toast.cancelFailed"), true);
  }
}

export function syncFromStorageImpl(set: StoreSet, get: StoreGet): void {
  const nextInflight = loadInFlight();
  const nextSelected = loadSelectedFilename();
  const nextSelection = loadCoreSelectionSnapshot();
  const nextVideo = loadVideoDefaults();
  const nextGeneration = loadGenerationDefaults();
  set((s) => {
    const matched = nextSelected
      ? s.history.find((h) => h.filename === nextSelected) ?? null
      : null;
    const normalized = matched
      ? resolveVisibleShortcutCurrent(s.history, matched)
      : null;
    const visibleFallback = getVisibleGalleryItems(s.history)[0] ?? null;
    const currentImage = s.currentImage?.canvasVersion
      ? resolveVisibleShortcutCurrent(s.history, s.currentImage) ?? visibleFallback
      : s.currentImage;
    return {
      inFlight: nextInflight,
      activeGenerations: nextInflight.length,
      ...nextSelection,
      imageToolModel: nextSelection.provider === "api" ? nextGeneration.imageToolModel ?? null : null,
      quality: normalizeImageQuality(nextSelection.provider, nextGeneration.imageToolModel, nextGeneration.quality ?? s.quality),
      videoDuration: nextVideo.duration,
      videoResolution: nextVideo.resolution as VideoResolutionUI,
      videoAspectRatio: nextVideo.aspectRatio,
      currentImage:
        nextSelected && currentImage?.filename !== nextSelected
          ? normalized ?? currentImage
          : currentImage,
    };
  });
  if (nextInflight.length > 0) get().startInFlightPolling();
}

export function applyMergedCanvasImageImpl(item: GenerateItem, set: StoreSet): void {
  set((s) => ({
    history: item.filename
      ? s.history.some((h) => h.filename === item.filename)
        ? s.history.map((h) => (h.filename === item.filename ? item : h))
        : retainHistoryItems([item, ...s.history], s.loadedHistoryRetainLimit + 1)
      : s.history,
    loadedHistoryRetainLimit: Math.max(
      s.loadedHistoryRetainLimit,
      Math.min(s.history.length + 1, s.loadedHistoryRetainLimit + 1),
    ),
  }));
}

export function addReferenceDataUrlImpl(dataUrl: string, set: StoreSet, get: StoreGet): void {
  set((s) =>
    s.referenceImages.length >= get().activeReferenceLimit()
      ? s
      : { referenceImages: [...s.referenceImages, dataUrl], providerUrlReference: null },
  );
}

export function addMetadataRestoreAsReferenceImpl(set: StoreSet, get: StoreGet): void {
  const pending = get().metadataRestore;
  if (!pending) return;
  if (pending.targetNodeId) {
    get().addNodeReferenceDataUrl(pending.targetNodeId, pending.image);
  } else {
    get().addReferenceDataUrl(pending.image);
  }
  set({ metadataRestore: null });
}

export function toggleRightPanelImpl(set: StoreSet, get: StoreGet): void {
  const next = !get().rightPanelOpen;
  try {
    localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  set({ rightPanelOpen: next });
}

export function setGalleryScopeImpl(scope: GalleryScope, set: StoreSet): void {
  try {
    localStorage.setItem(GALLERY_SCOPE_STORAGE_KEY, scope);
  } catch {}
  set({ galleryScope: scope });
}

export function setGalleryDefaultScopeImpl(scope: GalleryScope, set: StoreSet): void {
  try {
    localStorage.setItem(GALLERY_DEFAULT_SCOPE_STORAGE_KEY, scope);
    localStorage.setItem(GALLERY_SCOPE_STORAGE_KEY, scope);
  } catch {}
  set({ galleryDefaultScope: scope, galleryScope: scope });
}

export function setUIModeImpl(m: UIMode, set: StoreSet): void {
  const next =
    m === "agent" && !ENABLE_AGENT_MODE ? "classic" :
      m === "card-news" && !ENABLE_CARD_NEWS_MODE ? "classic" :
      m === "node" && !ENABLE_NODE_MODE ? "classic" :
        m;
  try { localStorage.setItem(UI_MODE_STORAGE_KEY, next); } catch {}
  set({ uiMode: next });
}

export function setHistoryStripLayoutImpl(layout: HistoryStripLayout, set: StoreSet): void {
  try { localStorage.setItem(HISTORY_STRIP_LAYOUT_STORAGE_KEY, layout); } catch {}
  set({ historyStripLayout: layout });
}

export function showToastImpl(message: string, error: boolean, set: StoreSet): void {
  const createdAt = Date.now();
  const entry = { message, error, id: createdAt + Math.random(), createdAt };
  set((s) => ({ toast: entry, toastLog: [...s.toastLog, entry].slice(-50) }));
}

export function dismissToastImpl(id: number, set: StoreSet): void {
  set((s) => {
    const toastLog = s.toastLog.filter((toast) => toast.id !== id);
    return {
      toastLog,
      toast: s.toast?.id === id ? toastLog[toastLog.length - 1] ?? null : s.toast,
    };
  });
}

export function showErrorCardImpl(
  code: ImaErrorCode,
  params: { fallbackMessage?: string; cardKey?: string; cta?: "reauth" | "reload" | "retry" | "dismiss" } | undefined,
  set: StoreSet,
): void {
  const createdAt = Date.now();
  const entry = { code, cardKey: params?.cardKey, cta: params?.cta, fallbackMessage: params?.fallbackMessage, id: createdAt + Math.random(), createdAt };
  set((s) => ({ errorCard: entry, errorCardLog: [...s.errorCardLog, entry] }));
}

export function dismissErrorCardImpl(id: number | undefined, set: StoreSet): void {
  set((s) => {
    if (id == null) return { errorCard: null, errorCardLog: [] };
    const errorCardLog = s.errorCardLog.filter((card) => card.id !== id);
    return {
      errorCardLog,
      errorCard: s.errorCard?.id === id ? errorCardLog[errorCardLog.length - 1] ?? null : s.errorCard,
    };
  });
}

export function setGraphNodesImpl(graphNodes: GraphNode[], set: StoreSet, get: StoreGet): void {
  set({ graphNodes: deriveParentServerNodeIds(graphNodes, get().graphEdges) });
  get().scheduleGraphSave();
}

export function setGraphEdgesImpl(graphEdges: GraphEdge[], set: StoreSet, get: StoreGet): void {
  set({ graphEdges, graphNodes: deriveParentServerNodeIds(get().graphNodes, graphEdges) });
  get().scheduleGraphSave();
}

export function toggleNodeSelectionModeImpl(set: StoreSet, get: StoreGet): void {
  const next = !get().nodeSelectionMode;
  set({
    nodeSelectionMode: next,
    ...(next ? {} : { graphNodes: applySelectedNodeIds(get().graphNodes, []) }),
  });
}

export function selectNodeGraphImpl(
  clientId: ClientNodeId,
  additive: boolean,
  set: StoreSet,
  get: StoreGet,
): void {
  set({
    graphNodes: applyComponentSelection(get().graphNodes, get().graphEdges, clientId, additive),
  });
}

export function cancelNodeBatchImpl(set: StoreSet, get: StoreGet): void {
  if (!get().nodeBatchRunning) return;
  set({ nodeBatchStopping: true });
  get().showToast(t("nodeBatch.stopQueued"));
}

export function setCanvasPanImpl(x: number, y: number, set: StoreSet): void {
  const cap = 4000;
  set({
    canvasPanX: Math.max(-cap, Math.min(cap, x)),
    canvasPanY: Math.max(-cap, Math.min(cap, y)),
  });
}

export function setCanvasExportBackgroundImpl(
  mode: CanvasExportBackground,
  set: StoreSet,
  get: StoreGet,
): void {
  set({ canvasExportBackground: mode });
  persistCanvasExportBackground(mode, get().canvasExportMatteColor);
}

export function setCanvasExportMatteColorImpl(
  color: HexColor,
  set: StoreSet,
  get: StoreGet,
): void {
  set({ canvasExportMatteColor: color });
  persistCanvasExportBackground(get().canvasExportBackground, color);
}
