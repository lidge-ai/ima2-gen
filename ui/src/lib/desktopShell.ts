// Minimal bridge exposed by desktop/preload.cjs to the served UI. Present only
// inside the Electron shell — browser sessions get nothing. Keep in sync with
// preload.cjs.
export interface DesktopBridge {
  platform?: string;
}

declare global {
  interface Window {
    ima2Desktop?: DesktopBridge;
  }
}

export function isMacDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return window.ima2Desktop?.platform === "darwin";
}
