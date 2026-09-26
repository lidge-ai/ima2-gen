import { useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAppStore } from "../store/useAppStore";
import { ENABLE_AGENT_MODE, ENABLE_NODE_MODE } from "../lib/devMode";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";
import type { UIMode } from "../types";

/* ── Hash ↔ mode mapping ── */

const HASH_TO_MODE: Record<string, UIMode | "settings"> = {
  "#home": "home",
  "#create": "classic",
  "#canvas": "classic", // canvas-mode is a sub-state of classic for now
  "#node": "node",
  "#agent": "agent",
  "#assets": "assets",
  "#asset-gen": "asset-gen",
};

export const MODE_TO_HASH: Record<string, string> = {
  home: "#home",
  classic: "#create",
  node: "#node",
  agent: "#agent",
  assets: "#assets",
  "asset-gen": "#asset-gen",
};

function resolveHash(): { mode: UIMode; settings: boolean } | null {
  const h = location.hash;
  if (h === "#settings") return { mode: "classic", settings: true };
  const m = HASH_TO_MODE[h];
  if (m && m !== "settings") return { mode: m, settings: false };
  return null;
}

/* ── Icons (14×14 stroke, Lucide style) ── */

export function IconCreate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function IconNode() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="8" height="6" rx="1" />
      <rect x="14" y="12" width="8" height="6" rx="1" />
      <path d="M10 9h4" />
      <path d="M14 15V9a2 2 0 0 1 2-2h0" />
    </svg>
  );
}

export function IconAgent() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-30 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(30 12 12)" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconAssets() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M8 12h8" />
    </svg>
  );
}

function IconAssetGen() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <path d="M3 12l3.5-3.5a1.4 1.4 0 0 1 2 0L13 13" />
      <path d="M19 14v6" />
      <path d="M16 17h6" />
    </svg>
  );
}

/* ── Rail items ── */

type RailItem = {
  id: string;
  mode?: UIMode;
  settingsAction?: boolean;
  icon: () => ReactNode;
  labelKey: string;
  enabled: boolean;
  bottom?: boolean;
};

const RAIL_ITEMS: RailItem[] = [
  { id: "home", mode: "home", icon: IconHome, labelKey: "nav.home", enabled: true },
  { id: "create", mode: "classic", icon: IconCreate, labelKey: "nav.create", enabled: true },
  { id: "node", mode: "node", icon: IconNode, labelKey: "nav.node", enabled: ENABLE_NODE_MODE },
  { id: "agent", mode: "agent", icon: IconAgent, labelKey: "nav.agent", enabled: ENABLE_AGENT_MODE },
  { id: "assets", mode: "assets", icon: IconAssets, labelKey: "nav.assets", enabled: true },
  { id: "asset-gen", mode: "asset-gen", icon: IconAssetGen, labelKey: "nav.assetGen", enabled: true },
  { id: "settings", settingsAction: true, icon: IconSettings, labelKey: "nav.settings", enabled: true, bottom: true },
];

/* ── Component ── */

export function NavRail() {
  const { t } = useI18n();
  const uiMode = useAppStore((s) => s.uiMode);
  const setUIMode = useAppStore((s) => s.setUIMode);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const isMobile = useIsMobile();
  const mobileNavRef = useRef<HTMLElement>(null);

  const revealMobileItem = useCallback((button: HTMLElement | null) => {
    const nav = mobileNavRef.current;
    if (!nav || !button) return;
    const navRect = nav.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < navRect.left) nav.scrollLeft -= navRect.left - buttonRect.left;
    else if (buttonRect.right > navRect.right) nav.scrollLeft += buttonRect.right - navRect.right;
  }, []);

  useEffect(() => {
    if (isMobile) revealMobileItem(mobileNavRef.current?.querySelector<HTMLElement>(".nav-rail__btn.is-active") ?? null);
  }, [isMobile, uiMode, settingsOpen, revealMobileItem]);

  const navigate = useCallback((item: RailItem) => {
    if (item.settingsAction) {
      if (settingsOpen) {
        closeSettings();
        history.replaceState(null, "", MODE_TO_HASH[uiMode] || "#create");
      } else {
        openSettings();
        history.replaceState(null, "", "#settings");
      }
      return;
    }
    if (item.mode) {
      if (settingsOpen) closeSettings();
      setUIMode(item.mode);
      history.replaceState(null, "", MODE_TO_HASH[item.mode] || "#create");
    }
  }, [uiMode, settingsOpen, setUIMode, openSettings, closeSettings]);

  // Sync hash → state on mount and popstate
  useEffect(() => {
    const sync = () => {
      const resolved = resolveHash();
      if (!resolved) return;
      if (resolved.settings) {
        openSettings();
      } else {
        if (settingsOpen) closeSettings();
        setUIMode(resolved.mode);
      }
    };
    sync(); // initial
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enabledItems = RAIL_ITEMS.filter((it) => it.enabled);
  const topItems = enabledItems.filter((it) => !it.bottom);
  const bottomItems = enabledItems.filter((it) => it.bottom);

  const isActive = (item: RailItem) => {
    if (item.settingsAction) return settingsOpen;
    return !settingsOpen && item.mode === uiMode;
  };

  const renderItem = (item: RailItem) => (
    <button
      key={item.id}
      type="button"
      className={`nav-rail__btn${isActive(item) ? " is-active" : ""}`}
      onClick={() => navigate(item)}
      aria-label={t(item.labelKey)}
      aria-current={isActive(item) ? "page" : undefined}
    >
      <item.icon />
      <span className="nav-rail__label" aria-hidden="true">{t(item.labelKey)}</span>
    </button>
  );

  if (isMobile) {
    return (
      <nav ref={mobileNavRef} className="nav-rail nav-rail--mobile" aria-label={t("nav.ariaLabel")}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement) revealMobileItem(event.target.closest<HTMLElement>(".nav-rail__btn"));
        }}>
        {enabledItems.map(renderItem)}
      </nav>
    );
  }

  return (
    <nav className="nav-rail" aria-label={t("nav.ariaLabel")}>
      <div className="nav-rail__top">{topItems.map(renderItem)}</div>
      <div className="nav-rail__bottom">{bottomItems.map(renderItem)}</div>
    </nav>
  );
}
