import { PromptComposer } from "./PromptComposer";
import { BrandMark } from "./BrandMark";
import { GenerateButton } from "./GenerateButton";
import { InFlightList } from "./InFlightList";
import { InFlightBadge } from "./composer/InFlightBadge";
import { SessionPicker } from "./SessionPicker";
import { GenProviderModelSelect } from "./GenProviderModelSelect";
import { CardNewsComposer } from "./card-news/CardNewsComposer";
import { SidebarHistory } from "./history/SidebarHistory";
import { useAppStore } from "../store/useAppStore";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "../lib/devMode";
import { useI18n } from "../i18n";
import { resolveWorkspaceSettings } from "../lib/workspaceProfile";
import { useIsMobile } from "../hooks/useIsMobile";

const DESKTOP_INFLIGHT_PANEL_ID = "sidebar-inflight-panel";

export function SidebarStack() {
  const { t } = useI18n();
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const workspaceProfile = useAppStore((s) => s.workspaceProfile);
  const referenceImages = useAppStore((s) => s.referenceImages);
  const clearReferences = useAppStore((s) => s.clearReferences);
  const isMobile = useIsMobile();
  const uiMode =
    uiModeRaw === "agent" && ENABLE_AGENT_MODE ? "agent" :
      uiModeRaw === "card-news" && ENABLE_CARD_NEWS_MODE ? "card-news" :
      uiModeRaw === "node" && ENABLE_NODE_MODE ? "node" :
      uiModeRaw === "assets" ? "assets" :
      uiModeRaw === "asset-gen" ? "asset-gen" :
        "classic";
  const workspaceSettings = resolveWorkspaceSettings(workspaceProfile);
  const promptStudioDesktop =
    !isMobile &&
    uiMode === "classic" &&
    workspaceSettings.composerPlacement === "bottom" &&
    workspaceSettings.multimodeHistoryGrouping === "sequence";

  return (
    <>
      <SidebarChrome />
      {uiMode === "classic" ? (
        promptStudioDesktop ? (
          <>
            <SidebarHistory />
          </>
        ) : (
          <>
            <PromptComposer />
            <div className="sidebar-generate-with-inflight">
              <GenerateButton />
              <InFlightBadge variant="popup" panelId={DESKTOP_INFLIGHT_PANEL_ID} />
            </div>
          </>
        )
      ) : uiMode === "card-news" ? (
        <>
          <CardNewsComposer />
        </>
      ) : uiMode === "node" ? (
        <>
          <SessionPicker />
          {referenceImages.length > 0 ? (
            <div className="node-mode-ref-warning" role="status">
              <strong>{t("node.classicRefsParkedTitle")}</strong>
              <span>{t("node.classicRefsParkedBody")}</span>
              <button type="button" onClick={clearReferences}>
                {t("node.clearParkedRefs")}
              </button>
            </div>
          ) : null}
          <div className="sidebar__node-hint">
            {t("sidebar.nodeModeHint")}
          </div>
          <InFlightList />
        </>
      ) : null}
    </>
  );
}

export function SidebarChrome() {
  const isMobile = useIsMobile();
  return (
    <>
      <div className="logo">
        <BrandMark className="logo-mark" />
        <div className="logo-copy">
          <div className="logo-title">ima2</div>
          <div className="logo-title logo-title--gen">gen</div>
        </div>
        <div className="logo-actions">
          <PromptLibraryButton />
          <GenProviderModelSelect compact={isMobile} />
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">
        <SidebarStack />
      </div>
    </aside>
  );
}

function PromptLibraryButton() {
  const { t } = useI18n();
  const toggle = useAppStore((s) => s.togglePromptLibrary);
  const promptLibraryOpen = useAppStore((s) => s.promptLibraryOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const openPromptLibrary = () => {
    if (!promptLibraryOpen && !rightPanelOpen) toggleRightPanel();
    toggle();
  };

  return (
    <button
      type="button"
      className="settings-button"
      onClick={openPromptLibrary}
      title={t("promptLibrary.title")}
      aria-label={t("promptLibrary.title")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
