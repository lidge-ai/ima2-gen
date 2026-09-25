// window.open policy for the main content view. The served UI opens child
// windows for same-app pages and for the MCP OAuth flow, which opens
// "about:blank" synchronously (to beat popup blockers) and then navigates the
// returned popup to the provider's authorizationUrl — denying about:blank here
// makes window.open return null and the connect flow throws MCP_POPUP_BLOCKED
// before the user ever sees the sign-in page.
//
// Pure module — Electron-free so node:test can exercise it.

export function isLocalServerUrl(target, serverUrl) {
  if (!serverUrl) return false;
  try {
    return new URL(target).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

/** Only web pages may leave the app; deep links and file URLs stay inside. */
export function isExternalWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Decide what to do with a window.open target:
 * - "allow":   open a real in-app window (local server pages, about:blank
 *              placeholders that will be navigated later),
 * - "external": bounce to the system browser,
 * - "deny":    drop silently (about:/javascript:/file:/app-scheme URLs should
 *              never reach the OS handler).
 */
export function resolveWindowOpen(url, serverUrl) {
  if (url === "about:blank" || url.startsWith("about:blank#")) return "allow";
  if (isLocalServerUrl(url, serverUrl)) return "allow";
  if (isExternalWebUrl(url)) return "external";
  return "deny";
}
