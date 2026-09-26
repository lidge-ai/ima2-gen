import { lazy, Suspense, useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { GenerationControlsPanel } from "./GenerationControlsPanel";
import { isPromptBuilderEnabled } from "../lib/workspaceProfile";
import { useModalFocus } from "../hooks/useModalFocus";

const LazyPromptLibraryPanel = lazy(() =>
  import("./PromptLibraryPanel").then((module) => ({ default: module.PromptLibraryPanel })),
);

const LazyPromptBuilderPanel = lazy(() =>
  import("./prompt-builder/PromptBuilderPanel").then((module) => ({
    default: module.PromptBuilderPanel,
  })),
);

const LazyGenerationRequestLogPanel = lazy(() =>
  import("./GenerationRequestLogPanel").then((module) => ({
    default: module.GenerationRequestLogPanel,
  })),
);

type RightPanelTab = "settings" | "library" | "builder" | "log";

export function RightPanel() {
  const open = useAppStore((s) => s.rightPanelOpen);
  const toggle = useAppStore((s) => s.toggleRightPanel);
  const promptLibraryOpen = useAppStore((s) => s.promptLibraryOpen);
  const setPromptLibraryOpen = useAppStore((s) => s.setPromptLibraryOpen);
  const promptBuilderOpen = useAppStore((s) => s.promptBuilderOpen);
  const togglePromptBuilder = useAppStore((s) => s.togglePromptBuilder);
  const workspaceProfile = useAppStore((s) => s.workspaceProfile);
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 800px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const [logOpen, setLogOpen] = useState(false);
  const builderEnabled = isPromptBuilderEnabled(workspaceProfile) && !isMobile;
  const drawerOpen = isMobile ? open : true;
  const drawerRef = useModalFocus<HTMLElement>(isMobile && open, toggle);

  const activeTab: RightPanelTab = logOpen
    ? "log"
    : promptBuilderOpen && builderEnabled
      ? "builder"
      : promptLibraryOpen
        ? "library"
        : "settings";

  const setTab = (tab: RightPanelTab) => {
    setLogOpen(tab === "log");
    if (tab === "builder") {
      if (!promptBuilderOpen) togglePromptBuilder();
      if (promptLibraryOpen) setPromptLibraryOpen(false);
    } else if (tab === "library") {
      if (promptBuilderOpen) togglePromptBuilder();
      if (!promptLibraryOpen) setPromptLibraryOpen(true);
    } else {
      if (promptBuilderOpen) togglePromptBuilder();
      if (promptLibraryOpen) setPromptLibraryOpen(false);
    }
  };

  return (
    <>
      {isMobile && open ? (
        <div
          className="right-panel-backdrop"
          role="button"
          aria-label={t("panel.closeSettings")}
          onClick={toggle}
        />
      ) : null}
      <aside
        ref={drawerRef}
        className={`right-panel${open ? "" : " collapsed"}${isMobile && drawerOpen ? " drawer-open" : ""}`}
        aria-label={t("panel.detailSettings")}
        aria-modal={isMobile && open ? "true" : undefined}
        role={isMobile && open ? "dialog" : undefined}
        tabIndex={isMobile ? -1 : undefined}
      >
        {!isMobile && (
          <button
            type="button"
            className="right-panel-toggle"
            aria-expanded={open}
            aria-controls="right-panel-body"
            onClick={toggle}
            title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
          >
            {open ? ">" : "<"}
          </button>
        )}
        <div
          id="right-panel-body"
          className="right-panel-body"
          hidden={!open}
        >
          <div className="right-panel-tabs" role="tablist" aria-label={t("panel.detailSettings")}>
            {builderEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "builder"}
                aria-controls="right-panel-tab-builder"
                title={t("promptBuilder.title")}
                className={`right-panel-tabs__button${activeTab === "builder" ? " active" : ""}`}
                onClick={() => setTab("builder")}
              >
                {t("promptBuilder.title")}
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "log"}
              aria-controls="right-panel-tab-log"
              title={t("generationLog.title")}
              className={`right-panel-tabs__button${builderEnabled ? "" : " right-panel-tabs__button--full"}${activeTab === "log" ? " active" : ""}`}
              onClick={() => setTab("log")}
            >
              {t("generationLog.title")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "library"}
              aria-controls="right-panel-tab-library"
              title={t("promptLibrary.title")}
              className={`right-panel-tabs__button right-panel-tabs__button--full${activeTab === "library" ? " active" : ""}`}
              onClick={() => setTab("library")}
            >
              {t("promptLibrary.title")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "settings"}
              aria-controls="right-panel-tab-settings"
              title={t("panel.detailSettings")}
              className={`right-panel-tabs__button right-panel-tabs__button--full${activeTab === "settings" ? " active" : ""}`}
              onClick={() => setTab("settings")}
            >
              {t("panel.detailSettings")}
            </button>
          </div>
          {activeTab === "builder" && builderEnabled ? (
            <div id="right-panel-tab-builder" role="tabpanel">
              <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
                <LazyPromptBuilderPanel variant="sidebar" />
              </Suspense>
            </div>
          ) : activeTab === "library" ? (
            <div id="right-panel-tab-library" role="tabpanel">
              <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
                <LazyPromptLibraryPanel variant="embedded" />
              </Suspense>
            </div>
          ) : activeTab === "log" ? (
            <div id="right-panel-tab-log" role="tabpanel">
              <Suspense fallback={<div className="prompt-library-panel__loading">{t("common.loading")}</div>}>
                <LazyGenerationRequestLogPanel />
              </Suspense>
            </div>
          ) : (
            <div id="right-panel-tab-settings" role="tabpanel">
              <GenerationControlsPanel />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
