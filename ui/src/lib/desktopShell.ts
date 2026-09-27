// Minimal bridge exposed by desktop/preload.cjs to the served UI. Present only
// inside the Electron shell — browser sessions get nothing, so its presence is
// also the "am I in the desktop app" check. Keep in sync with preload.cjs.
export interface DesktopBridge {
  platform?: string;
  openSettings?: () => void;
}

declare global {
  interface Window {
    ima2Desktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.ima2Desktop ?? null;
}

export function isMacDesktop(): boolean {
  return desktopBridge()?.platform === "darwin";
}

export function isWindowsDesktop(): boolean {
  return desktopBridge()?.platform === "win32";
}

/**
 * Page zoom (⌘+/⌘−) of the desktop shell's web contents. The window-painted
 * controls — macOS traffic lights, Windows/Linux overlay caption buttons —
 * are drawn in screen points and never zoom, so the title row must be sized
 * in screen points too. The window has no frame (hiddenInset/hidden) and the
 * page fills it, so outer/inner width is the zoom factor on every desktop
 * platform.
 */
export function desktopZoomFactor(): number {
  if (typeof window === "undefined" || !desktopBridge()) return 1;
  const { outerWidth, innerWidth } = window;
  if (!outerWidth || !innerWidth) return 1;
  const zoom = outerWidth / innerWidth;
  return Number.isFinite(zoom) && zoom > 0.2 && zoom < 5 ? Math.round(zoom * 1000) / 1000 : 1;
}

/** Publish the zoom factor as --chrome-zoom so the title row can undo it. */
export function syncDesktopChromeZoom(): () => void {
  if (typeof window === "undefined" || !desktopBridge()) return () => {};
  const root = document.documentElement;
  const apply = () => root.style.setProperty("--chrome-zoom", String(desktopZoomFactor()));
  apply();
  // Zoom changes resize the layout viewport, so a resize listener catches both.
  window.addEventListener("resize", apply);
  return () => {
    window.removeEventListener("resize", apply);
    root.style.removeProperty("--chrome-zoom");
  };
}

/** Address of the local server that served this UI (host:port). */
export function serverHost(): string {
  return typeof window === "undefined" ? "" : window.location.host;
}
