import { useI18n } from "../i18n";
import { readWebAuthMode, readWebUser } from "../lib/webInstance";

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
  const google = readWebAuthMode(cookie) === "google";
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
