/** The shared web instance's sign-in gate (lib/webAccess) leaves these readable cookies; a local install has neither. */
const USER_COOKIE = "ima2_web_user";
const MODE_COOKIE = "ima2_web_auth";

export function readCookie(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try { return decodeURIComponent(rest.join("=")); } catch { return null; }
  }
  return null;
}

/** Email the web instance's sign-in gate put in a readable cookie; absent on a local install. */
export function readWebUser(cookie: string): string | null {
  const email = readCookie(cookie, USER_COOKIE);
  return email && email.includes("@") ? email : null;
}

/** How the web instance signs people in, when it does. */
export function readWebAuthMode(cookie: string): string | null {
  return readCookie(cookie, MODE_COOKIE);
}

/**
 * True when this page is served by the shared web instance. Display only: the server refuses
 * host-only routes there on its own (lib/webAccess/routePolicy.ts).
 */
export function isWebInstance(cookie: string = typeof document === "undefined" ? "" : document.cookie): boolean {
  return readWebUser(cookie) !== null;
}
