import { lazy, Suspense, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { ClassicWorkspace } from "./components/classic/ClassicWorkspace";
import { RightPanel } from "./components/RightPanel";
import { HistoryStrip } from "./components/HistoryStrip";
import { Toast } from "./components/Toast";
import { ErrorCard } from "./components/ErrorCard";
import { GalleryModal } from "./components/GalleryModal";
import { CustomSizeConfirmModal } from "./components/CustomSizeConfirmModal";
import { MetadataRestoreDialog } from "./components/MetadataRestoreDialog";
import { ProviderReadinessPopup } from "./components/ProviderReadinessPopup";
import { OnboardingPopup } from "./components/OnboardingPopup";
import { StarPrompt } from "./components/StarPrompt";
import { TrashUndoToast } from "./components/TrashUndoToast";
import { MobileSettingsToggle } from "./components/MobileSettingsToggle";
import { MobileAppBar } from "./components/MobileAppBar";
import { NavRail } from "./components/NavRail";
import { MobileComposeSheet } from "./components/MobileComposeSheet";
import { useAppStore, flushGraphSaveBeacon } from "./store/useAppStore";
import { stopInFlightPollingImpl } from "./store/storeInflightImpl";
import { isLanSessionLocked } from "./lib/lanSession";
import {
  GENERATION_DEFAULTS_STORAGE_KEY, IMAGE_MODEL_STORAGE_KEY, VIDEO_DEFAULTS_STORAGE_KEY,
} from "./store/persistenceRegistry";
import { onResync, ensureConnected, onConnectionStateChange } from "./lib/eventChannel";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "./lib/devMode";
import { useGalleryViewerNavigation } from "./hooks/useGalleryViewerNavigation";
import { useBrowserAttentionBadge } from "./hooks/useBrowserAttentionBadge";
import { useIsMobile } from "./hooks/useIsMobile";
import { useVisualViewportInset } from "./hooks/useVisualViewportInset";
import { resolveWorkspaceSettings } from "./lib/workspaceProfile";
import { useI18n } from "./i18n";

const LazyNodeCanvas = lazy(() =>
  import("./components/NodeCanvas").then((module) => ({ default: module.NodeCanvas })),
);
const LazySettingsWorkspace = lazy(() =>
  import("./components/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);
const LazyCardNewsWorkspace = lazy(() =>
  import("./components/card-news/CardNewsWorkspace").then((module) => ({ default: module.CardNewsWorkspace })),
);
const LazyAgentWorkspace = lazy(() =>
  import("./components/agent/AgentWorkspace").then((module) => ({ default: module.AgentWorkspace })),
);
const LazyAssetsWorkspace = lazy(() =>
  import("./components/assets/AssetsWorkspace").then((module) => ({ default: module.AssetsWorkspace })),
);
const LazyAssetGenWorkspace = lazy(() =>
  import("./components/assetgen/AssetGenWorkspace").then((module) => ({ default: module.AssetGenWorkspace })),
);
const HomeWorkspace = lazy(() =>
  import("./components/home/HomeWorkspace").then((module) => ({ default: module.HomeWorkspace })),
);
const LazyPromptLibraryPanel = lazy(() =>
  import("./components/PromptLibraryPanel").then((module) => ({ default: module.PromptLibraryPanel })),
);

function WorkspaceFallback() {
  return <main className="canvas canvas--lazy-loading" aria-busy="true" />;
}

export default function App() {
  useGalleryViewerNavigation();
  useVisualViewportInset();
  const { locale } = useI18n();
  const hydrateHistory = useAppStore((s) => s.hydrateHistory);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const syncCapabilities = useAppStore((s) => s.syncCapabilities);
  const startInFlightPolling = useAppStore((s) => s.startInFlightPolling);
  const reconcileInflight = useAppStore((s) => s.reconcileInflight);
  const syncFromStorage = useAppStore((s) => s.syncFromStorage);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const unseenGeneratedCount = useAppStore((s) => s.unseenGeneratedCount);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const workspaceProfile = useAppStore((s) => s.workspaceProfile);
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const uiMode =
    uiModeRaw === "agent" && ENABLE_AGENT_MODE ? "agent" :
      uiModeRaw === "card-news" && ENABLE_CARD_NEWS_MODE ? "card-news" :
      uiModeRaw === "node" && ENABLE_NODE_MODE ? "node" :
      uiModeRaw === "home" ? "home" :
      uiModeRaw === "assets" ? "assets" :
      uiModeRaw === "asset-gen" ? "asset-gen" :
        "classic";
  const isAgentMode = uiMode === "agent";
  const isAssetsMode = uiMode === "assets";
  const isAssetGenMode = uiMode === "asset-gen";
  const isHomeMode = uiMode === "home";
  const isMobile = useIsMobile();
  const workspaceSettings = resolveWorkspaceSettings(workspaceProfile);
  const promptStudioClassic =
    !isMobile &&
    uiMode === "classic" &&
    workspaceSettings.composerPlacement === "bottom" &&
    workspaceSettings.multimodeHistoryGrouping === "sequence";
  const showHistoryStrip = !promptStudioClassic && !isAgentMode && !isAssetsMode && !isAssetGenMode && !isHomeMode;

  useBrowserAttentionBadge(unseenGeneratedCount);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (isLanSessionLocked()) return;
    void syncCapabilities();
    hydrateHistory();
    if (ENABLE_AGENT_MODE || ENABLE_NODE_MODE) loadSessions();
    void reconcileInflight();
    startInFlightPolling();
    ensureConnected();
    onResync(() => reconcileInflight());
    onConnectionStateChange((state) => {
      if (state === "failed") console.warn("[SSE] connection failed after multiple retries");
    });
    return () => {
      stopInFlightPollingImpl();
      onResync(() => {});
      onConnectionStateChange(() => {});
    };
  }, [hydrateHistory, loadSessions, reconcileInflight, startInFlightPolling, syncCapabilities]);

  useEffect(() => {
    const onOpenAssetDetail = (event: Event) => {
      const assetId = (event as CustomEvent<{ assetId?: string }>).detail?.assetId;
      if (assetId) useAppStore.getState().openAssetDetail(assetId);
    };
    window.addEventListener("ima2:open-assets-detail", onOpenAssetDetail);
    return () => window.removeEventListener("ima2:open-assets-detail", onOpenAssetDetail);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "ima2.inFlight" || e.key === "ima2.selectedFilename"
        || e.key === GENERATION_DEFAULTS_STORAGE_KEY || e.key === IMAGE_MODEL_STORAGE_KEY
        || e.key === VIDEO_DEFAULTS_STORAGE_KEY) {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  useEffect(() => {
    const onHide = () => {
      flushGraphSaveBeacon(useAppStore.getState);
    };
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  return (
    <>
      <div
        className={`app${workspaceProfile === "prompt-studio" ? " app--prompt-studio" : ""}${settingsOpen ? " app--settings-open" : ""}${
          showHistoryStrip && historyStripLayout === "horizontal" ? " app--history-horizontal" : ""
        }${
          showHistoryStrip && historyStripLayout === "sidebar" ? " app--history-sidebar" : ""
        }`}
        data-history-strip-layout={historyStripLayout}
        data-mobile={isMobile ? "1" : undefined}
        data-ui-mode={uiMode}
      >
        <NavRail />
        {isHomeMode ? null : <Sidebar />}
        <MobileAppBar />
        {showHistoryStrip ? <HistoryStrip /> : null}
        <Suspense fallback={<WorkspaceFallback />}>
          {settingsOpen ? (
            <LazySettingsWorkspace />
          ) : uiMode === "classic" ? (
            promptStudioClassic ? <ClassicWorkspace /> : <Canvas />
          ) : uiMode === "node" ? (
            <LazyNodeCanvas />
          ) : uiMode === "card-news" ? (
            <LazyCardNewsWorkspace />
          ) : uiMode === "agent" ? (
            <LazyAgentWorkspace />
          ) : uiMode === "assets" ? (
            <LazyAssetsWorkspace />
          ) : uiMode === "asset-gen" ? (
            <LazyAssetGenWorkspace />
          ) : uiMode === "home" ? (
            <HomeWorkspace />
          ) : (
            <Canvas />
          )}
        </Suspense>
        {isMobile ? null : uiMode === "agent" ? null : uiMode === "card-news" ? null : uiMode === "assets" ? null : uiMode === "asset-gen" ? null : uiMode === "home" ? null : <RightPanel />}
      </div>
      <CustomSizeConfirmModal />
      <TrashUndoToast />
      <Toast />
      <ErrorCard />
      <GalleryModal />
      <MetadataRestoreDialog />
      <ProviderReadinessPopup />
      <OnboardingPopup />
      <StarPrompt />
      <MobileComposeSheet />
      <MobileSettingsToggle />
      {uiMode === "card-news" ? (
        <Suspense fallback={null}>
          <LazyPromptLibraryPanel />
        </Suspense>
      ) : null}
    </>
  );
}
