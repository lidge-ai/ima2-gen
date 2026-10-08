import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AccountSettings } from "./AccountSettings";
import { ImageModelSelect } from "./ImageModelSelect";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect";
import { WebSearchToggle } from "./WebSearchToggle";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { HistoryStripLayoutToggle } from "./HistoryStripLayoutToggle";
import { WorkspaceProfileSettings } from "./settings/WorkspaceProfileSettings";
import { GrokPlannerSelect } from "./settings/GrokPlannerSelect";
import { McpProviderConnections } from "./settings/McpProviderConnections";
import { ComfyWorkflowManager } from "./settings/ComfyWorkflowManager";
import { PromptBuilderSettings } from "./settings/PromptBuilderSettings";
import { useAppStore } from "../store/useAppStore";
import type { GalleryScope } from "../store/useAppStore";
import { useI18n } from "../i18n";
import type { SettingsSection } from "../types";
import { Select } from "./controls";
import { LanSessionControls } from "./LanSignIn";

const SETTINGS_SECTIONS: SettingsSection[] = [
  "providers",
  "workspace",
  "general",
];

type SettingsSectionBlockProps = {
  id: SettingsSection;
  setRef: (id: SettingsSection, element: HTMLElement | null) => void;
  children: ReactNode;
};

function SettingsSectionBlock({ id, setRef, children }: SettingsSectionBlockProps) {
  const { t } = useI18n();

  return (
    <section
      id={id}
      ref={(element) => setRef(id, element)}
      className="settings-section"
      aria-labelledby={`settings-section-${id}`}
    >
      <header className="settings-section__header">
        <h3 id={`settings-section-${id}`}>
          {t(`settings.sections.${id}.title`)}
        </h3>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsWorkspace() {
  const { t } = useI18n();
  const active = useAppStore((s) => s.activeSettingsSection);
  const setActive = useAppStore((s) => s.setActiveSettingsSection);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const openReadinessPopup = useAppStore((s) => s.openReadinessPopup);
  const galleryDefaultScope = useAppStore((s) => s.galleryDefaultScope);
  const setGalleryDefaultScope = useAppStore((s) => s.setGalleryDefaultScope);
  const provider = useAppStore((s) => s.provider);
  const contentRef = useRef<HTMLElement | null>(null);
  const unlockTimerRef = useRef<number | null>(null);
  const isProgrammaticScroll = useRef(false);
  const sectionRefs = useRef<Record<SettingsSection, HTMLElement | null>>({
    providers: null,
    workspace: null,
    general: null,
  });

  const setSectionRef = (id: SettingsSection, element: HTMLElement | null) => {
    sectionRefs.current[id] = element;
  };

  const scrollToSection = (section: SettingsSection) => {
    setActive(section);
    isProgrammaticScroll.current = true;
    const content = contentRef.current;
    const target = sectionRefs.current[section];
    if (content && target) {
      const contentTop = content.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      const scrollMarginTop = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
      content.scrollTo({
        top: content.scrollTop + targetTop - contentTop - scrollMarginTop,
        behavior: "auto",
      });
    }
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
    }
    unlockTimerRef.current = window.setTimeout(() => {
      isProgrammaticScroll.current = false;
      unlockTimerRef.current = null;
    }, 120);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.id as SettingsSection | undefined;
        if (id && SETTINGS_SECTIONS.includes(id)) setActive(id);
      },
      { root, threshold: [0.35, 0.6] },
    );
    for (const section of SETTINGS_SECTIONS) {
      const element = sectionRefs.current[section];
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [setActive]);

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current !== null) {
        window.clearTimeout(unlockTimerRef.current);
      }
    };
  }, []);

  return (
    <main className="settings-workspace" aria-labelledby="settings-title">
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h2 id="settings-title">{t("settings.title")}</h2>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={closeSettings}
            aria-label={t("settings.closeAria")}
            title={t("settings.closeTitle")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav settings-nav--mobile" aria-label={t("settings.navAria")}>
            <div className="settings-mobile-nav" role="list">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section}
                  type="button"
                  className={`settings-mobile-nav__item${active === section ? " is-active" : ""}`}
                  onClick={() => scrollToSection(section)}
                  aria-current={active === section ? "true" : undefined}
                >
                  <span>{t(`settings.sections.${section}.title`)}</span>
                  <small>{t(`settings.sections.${section}.hint`)}</small>
                </button>
              ))}
            </div>
          </nav>
          <nav className="settings-nav" aria-label={t("settings.navAria")}>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                className={`settings-nav__item${active === section ? " is-active" : ""}`}
                onClick={() => scrollToSection(section)}
                aria-label={t("settings.jumpTo", {
                  section: t(`settings.sections.${section}.title`),
                })}
              >
                <span>{t(`settings.sections.${section}.title`)}</span>
                <small>{t(`settings.sections.${section}.hint`)}</small>
              </button>
            ))}
          </nav>

          <section ref={contentRef} className="settings-content" aria-label={t("settings.contentAria")}>
            <SettingsSectionBlock id="providers" setRef={setSectionRef}>
              <AccountSettings />
              <McpProviderConnections />
              <ComfyWorkflowManager />
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("readiness.settingsTitle")}</h4>
                  <p>{t("readiness.settingsBody")}</p>
                </div>
                <div className="settings-row__control">
                  <button type="button" className="settings-action-btn" onClick={openReadinessPopup}>
                    {t("readiness.open")}
                  </button>
                </div>
              </article>
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("settings.imageModel.title")}</h4>
                  <p>{t("settings.imageModel.body")}</p>
                  <p className="settings-row__microcopy">
                    {provider === "88api" ? t("settings.api88.compatibility") : t("settings.imageModel.unsupportedHelp")}
                  </p>
                </div>
                <div className="settings-row__control">
                  <ImageModelSelect variant="settings" />
                </div>
              </article>
              <PromptBuilderSettings />
              {provider === "88api" ? (
                <article className="settings-row"><div className="settings-row__copy">
                  <h4>{t("settings.api88.title")}</h4><p>{t("settings.api88.compatibility")}</p>
                </div></article>
              ) : provider === "grok" ? (
                <>
                  <article className="settings-row">
                    <div className="settings-row__copy">
                      <h4>{t("settings.grokCompatibility.title")}</h4>
                      <p>{t("settings.grokCompatibility.body")}</p>
                    </div>
                  </article>
                  <GrokPlannerSelect />
                </>
              ) : provider === "agy" || provider === "gemini-api" ? (
                <article className="settings-row">
                  <div className="settings-row__copy">
                    <h4>{provider === "gemini-api" ? t("provider.geminiApiCompatTitle") : t("provider.agyCompatTitle")}</h4>
                    <p>{provider === "gemini-api" ? t("provider.geminiApiCompatBodyLong") : t("provider.agyCompatBodyLong")}</p>
                  </div>
                </article>
              ) : (
                <>
                  <article className="settings-row">
                    <div className="settings-row__copy">
                      <h4>{t("settings.reasoning.title")}</h4>
                      <p>{t("settings.reasoning.body")}</p>
                    </div>
                    <div className="settings-row__control">
                      <ReasoningEffortSelect />
                    </div>
                  </article>
                  <article className="settings-row">
                    <div className="settings-row__copy">
                      <h4>{t("settings.webSearch.title")}</h4>
                      <p>{t("settings.webSearch.body")}</p>
                    </div>
                    <div className="settings-row__control">
                      <WebSearchToggle />
                    </div>
                  </article>
                </>
              )}
            </SettingsSectionBlock>

            <SettingsSectionBlock id="workspace" setRef={setSectionRef}>
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("workspace.sectionTitle")}</h4>
                  <p>{t("workspace.sectionBody")}</p>
                </div>
                <div className="settings-row__control">
                  <WorkspaceProfileSettings />
                </div>
              </article>
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("settings.appearance.historyStripLayoutTitle")}</h4>
                  <p>{t("settings.appearance.historyStripLayoutBody")}</p>
                </div>
                <div className="settings-row__control">
                  <HistoryStripLayoutToggle />
                </div>
              </article>
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("settings.gallery.defaultScopeTitle")}</h4>
                  <p>{t("settings.gallery.defaultScopeBody")}</p>
                </div>
                <div className="settings-row__control">
                  <Select
                    ariaLabel={t("settings.gallery.defaultScopeTitle")}
                    value={galleryDefaultScope}
                    onChange={(v) => setGalleryDefaultScope(v as GalleryScope)}
                    items={[
                      { value: "current-session", label: t("gallery.scope.current") },
                      { value: "all", label: t("gallery.scope.all") },
                    ]}
                  />
                </div>
              </article>
            </SettingsSectionBlock>

            <SettingsSectionBlock id="general" setRef={setSectionRef}>
              <LanSessionControls />
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("settings.language.title")}</h4>
                  <p>{t("settings.language.body")}</p>
                </div>
                <div className="settings-row__control">
                  <LanguageToggle />
                </div>
              </article>
              <article className="settings-row">
                <div className="settings-row__copy">
                  <h4>{t("settings.theme.title")}</h4>
                  <p>{t("settings.theme.body")}</p>
                </div>
                <div className="settings-row__control">
                  <ThemeToggle />
                </div>
              </article>
            </SettingsSectionBlock>
          </section>
        </div>
      </div>
    </main>
  );
}
