import { useI18n } from "../i18n";

const USER_COOKIE = "ima2_web_user";
const MODE_COOKIE = "ima2_web_auth";

function readCookie(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try { return decodeURIComponent(rest.join("=")); } catch { return null; }
  }
  return null;
}

/** Email the web instance's sign-in gate put in a readable cookie (lib/webAccess); absent on a local install. */
export function readWebUser(cookie: string): string | null {
  const email = readCookie(cookie, USER_COOKIE);
  return email && email.includes("@") ? email : null;
}

/**
 * Who is signed in on the shared web instance. Google sign-in logs out with a
 * same-origin POST (this app's session only); Cloudflare Access uses its own
 * logout path.
 */
export function WebAccountBadge() {
  const { t } = useI18n();
  const cookie = typeof document === "undefined" ? "" : document.cookie;
  const email = readWebUser(cookie);
  if (!email) return null;
  const google = readCookie(cookie, MODE_COOKIE) === "google";
  return (
    <div className="web-account-badge" role="status">
      <span className="web-account-badge__email">{t("webAccess.signedInAs", { email })}</span>
      {google ? (
        <form className="web-account-badge__form" method="post" action="/auth/logout">
          <button className="web-account-badge__logout" type="submit">{t("webAccess.logout")}</button>
        </form>
      ) : (
        <a className="web-account-badge__logout" href="/cdn-cgi/access/logout">{t("webAccess.logout")}</a>
      )}
    </div>
  );
}
