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

/** Only web pages may leave the app; deep links and file URLs never reach the OS. */
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

/**
 * Decide whether an in-app child window may navigate to `url`. Popup windows
 * (e.g. the MCP OAuth placeholder) are allowed precisely so their opener can
 * steer them to an authorizationUrl — that assignment bypasses
 * resolveWindowOpen entirely, so the policy here is what stands between the
 * app and a server- or page-supplied `javascript:`/`file:` target.
 * Web pages and our own server pages may navigate; everything else is blocked.
 */
export function resolvePopupNavigation(url, serverUrl) {
  if (isLocalServerUrl(url, serverUrl)) return "allow";
  if (isExternalWebUrl(url)) return "allow";
  return "deny";
}

/**
 * Server redirects and subframe navigations never pass through will-navigate,
 * so they get a narrower gate: in-page web schemes stay allowed (iframes use
 * about:/data:/blob:), and anything else — the custom schemes that would hand
 * a URL to a local app handler — is blocked.
 */
const IN_PAGE_SCHEMES = new Set(["http:", "https:", "about:", "data:", "blob:"]);

export function resolveSubNavigation(url) {
  try {
    return IN_PAGE_SCHEMES.has(new URL(url).protocol) ? "allow" : "deny";
  } catch {
    return "deny";
  }
}

/**
 * Electron grants the openExternal permission by default, so a web page in a
 * popup could still reach an OS scheme handler. Keep every other permission's
 * default (granted) and only let web URLs leave through openExternal.
 */
export function resolvePermission(permission, details) {
  if (permission === "openExternal") return isExternalWebUrl(details?.externalURL ?? "");
  return true;
}

/**
 * Give every webContents created in the app the popup navigation policy:
 * will-navigate gated by resolvePopupNavigation, will-redirect and
 * will-frame-navigate gated by resolveSubNavigation, a setWindowOpenHandler
 * sharing resolveWindowOpen, and an openExternal permission gate on its
 * session. The main content view still installs its own handlers afterwards
 * (setWindowOpenHandler replaces, and its will-navigate listener stacks —
 * either may preventDefault).
 */
export function installPopupPolicy({ app, shell, getServerUrl }) {
  const gatedSessions = new WeakSet();
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "devtools") return; // keep DevTools' own behavior
    const session = contents.session;
    if (session && !gatedSessions.has(session)) {
      gatedSessions.add(session);
      session.setPermissionRequestHandler((_wc, permission, callback, details) => {
        callback(resolvePermission(permission, details));
      });
    }
    contents.setWindowOpenHandler(({ url }) => {
      const outcome = resolveWindowOpen(url, getServerUrl());
      if (outcome === "allow") return { action: "allow" };
      if (outcome === "external") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (resolvePopupNavigation(url, getServerUrl()) === "deny") event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (resolveSubNavigation(event.url ?? url) === "deny") event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame && resolveSubNavigation(event.url) === "deny") event.preventDefault();
    });
  });
}
