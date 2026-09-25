import { useRef, type RefObject } from "react";
import { useAppStore } from "../store/useAppStore";
import { GenProviderModelSelect } from "./GenProviderModelSelect";
import { BrandMark } from "./BrandMark";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "../lib/devMode";
import { rememberMobileComposeSheetOpener } from "../lib/mobileComposeSheetFocus";

export function MobileAppBar() {
  const { t } = useI18n();
  const openComposeSheet = useAppStore((s) => s.openComposeSheet);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const uiMode =
    uiModeRaw === "agent" && ENABLE_AGENT_MODE ? "agent" :
      uiModeRaw === "card-news" && ENABLE_CARD_NEWS_MODE ? "card-news" :
      uiModeRaw === "node" && ENABLE_NODE_MODE ? "node" :
      uiModeRaw === "home" ? "home" :
      uiModeRaw === "assets" ? "assets" :
      uiModeRaw === "asset-gen" ? "asset-gen" :
        "classic";
  const isMobile = useIsMobile();
  const libraryOpenerRef = useRef<HTMLButtonElement>(null);
  const controlsOpenerRef = useRef<HTMLButtonElement>(null);
  const composeFabRef = useRef<HTMLButtonElement>(null);
  const openFrom = (
    tab: "prompt" | "controls" | "library",
    ref: RefObject<HTMLButtonElement | null>,
  ) => {
    if (ref.current) rememberMobileComposeSheetOpener(ref.current);
    if (tab === "library") openComposeSheet("library");
    else if (tab === "controls") openComposeSheet("controls");
    else openComposeSheet("prompt");
  };

  if (!isMobile || settingsOpen || uiMode !== "classic") return null;

  return (
    <header className="mobile-app-bar" role="banner">
      <div className="mobile-app-bar__brand">
        <BrandMark className="logo-mark" />
        <div className="mobile-app-bar__brand-copy">
          <span className="mobile-app-bar__title">{t("appBar.brand")}</span>
          <span className="mobile-app-bar__mode">{t("appBar.modeImage")}</span>
        </div>
      </div>
      <div className="mobile-app-bar__actions">
        <button
          ref={libraryOpenerRef}
          type="button"
          className="mobile-app-bar__icon-button"
          onClick={() => openFrom("library", libraryOpenerRef)}
          aria-label={t("promptLibrary.title")}
          title={t("promptLibrary.title")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          ref={controlsOpenerRef}
          type="button"
          className="mobile-app-bar__icon-button"
          onClick={() => openFrom("controls", controlsOpenerRef)}
          aria-label={t("appBar.controls")}
          title={t("appBar.controls")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          ref={composeFabRef}
          type="button"
          className="mobile-app-bar__generate"
          onClick={() => openFrom("prompt", composeFabRef)}
          aria-label={t("appBar.generateAria")}
          title={t("appBar.generate")}
          style={{ width: 44, padding: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z" />
            <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
          </svg>
        </button>
      </div>
      <div className="mobile-app-bar__selection">
        <GenProviderModelSelect compact />
      </div>
    </header>
  );
}
