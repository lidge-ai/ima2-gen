import { useI18n } from "../i18n";

const USER_COOKIE = "ima2_web_user";
const LOGOUT_URL = "/cdn-cgi/access/logout";

/** Email the web instance's Access gate put in a readable cookie (lib/webAccess); absent on a local install. */
export function readWebUser(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== USER_COOKIE) continue;
    try {
      const email = decodeURIComponent(rest.join("="));
      return email.includes("@") ? email : null;
    } catch { return null; }
  }
  return null;
}

/** Who is signed in on the shared web instance, with a Cloudflare Access log-out link. */
export function WebAccountBadge() {
  const { t } = useI18n();
  const email = typeof document === "undefined" ? null : readWebUser(document.cookie);
  if (!email) return null;
  return (
    <div className="web-account-badge" role="status">
      <span className="web-account-badge__email">{t("webAccess.signedInAs", { email })}</span>
      <a className="web-account-badge__logout" href={LOGOUT_URL}>{t("webAccess.logout")}</a>
    </div>
  );
}
