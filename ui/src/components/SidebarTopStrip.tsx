import { useI18n } from "../i18n";
import { desktopBridge } from "../lib/desktopShell";
import { IconSettings } from "./NavRail";

interface SidebarTopStripProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Id of the sidebar element the toggle controls; omitted in sidebar-less modes. */
  controlsId?: string;
  /** When provided, renders the right-panel toggle at the same row's far right. */
  panelCollapsed?: boolean;
  onPanelToggle?: () => void;
}

function IconPanelLeft() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IconPanelRight() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

/**
 * Fixed strip across the top of the nav rail + sidebar columns. Inside the
 * desktop shell on macOS it also carries the traffic-light inset (painted by
 * the window itself), so the collapse toggle lines up on the same row. The
 * strip is a window-drag region; the buttons inside it are not.
 */
export function SidebarTopStrip({ collapsed, onToggle, controlsId, panelCollapsed, onPanelToggle }: SidebarTopStripProps) {
  const { t } = useI18n();
  const bridge = desktopBridge();
  const toggleLabel = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");
  const panelLabel = panelCollapsed ? t("panel.toggleShow") : t("panel.toggleHide");
  return (
    <>
      <div className="sidebar-top" role="toolbar" aria-label={t("nav.ariaLabel")}>
        <button
          type="button"
          className="sidebar-top__btn"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls={controlsId}
          title={toggleLabel}
        >
          <IconPanelLeft />
        </button>
        {bridge?.openSettings ? (
          <button
            type="button"
            className="sidebar-top__btn sidebar-top__btn--trailing"
            onClick={() => bridge.openSettings?.()}
            aria-label={t("nav.desktopSettings")}
            title={t("nav.desktopSettings")}
          >
            <IconSettings />
          </button>
        ) : null}
      </div>
      {onPanelToggle ? (
        <div className="panel-top" role="toolbar" aria-label={t("panel.detailSettings")}>
          <button
            type="button"
            className="sidebar-top__btn"
            onClick={onPanelToggle}
            aria-label={panelLabel}
            aria-expanded={!panelCollapsed}
            aria-controls="right-panel-body"
            title={panelLabel}
          >
            <IconPanelRight />
          </button>
        </div>
      ) : null}
    </>
  );
}
