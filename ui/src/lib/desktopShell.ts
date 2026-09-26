// Minimal bridge exposed by desktop/preload.cjs to the served UI. Present only
// inside the Electron shell — browser sessions get nothing, so its presence is
// also the "am I in the desktop app" check. Keep in sync with preload.cjs.
export interface DesktopBridge {
  platform?: string;
  openSettings?: () => void;
  openInBrowser?: () => void;
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

/** Address of the local server that served this UI (host:port). */
export function serverHost(): string {
  return typeof window === "undefined" ? "" : window.location.host;
}
