import { useEffect, useState } from "react";
import { useCardNewsStore } from "../../store/cardNewsStore";
import { useI18n } from "../../i18n";
import { useIsMobile } from "../../hooks/useIsMobile";
import { ImageTemplatePicker } from "./ImageTemplatePicker";
import { RoleTemplatePicker } from "./RoleTemplatePicker";
import { CardDeckRail } from "./CardDeckRail";
import { CardStage } from "./CardStage";
import { CardInspector } from "./CardInspector";

const CARD_NEWS_MOBILE_NOTICE_KEY = "ima2:cardNewsMobileNoticeShown";

function CardNewsMobileNotice() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(CARD_NEWS_MOBILE_NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!isMobile || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(CARD_NEWS_MOBILE_NOTICE_KEY, "1");
    } catch { /* best-effort: storage may be unavailable; dismissal still applies for this view */ }
    setDismissed(true);
  };

  return (
    <div className="card-news-mobile-notice" role="status">
      <span>{t("mobile.cardNewsBanner")}</span>
      <button type="button" onClick={dismiss}>
        {t("mobile.dismiss")}
      </button>
    </div>
  );
}

export function CardNewsWorkspace() {
  const { t } = useI18n();
  const hydrate = useCardNewsStore((s) => s.hydrate);
  const error = useCardNewsStore((s) => s.error);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <main className="card-news-workspace" aria-label={t("cardNews.workspace")}>
      <CardNewsMobileNotice />
      <div className="card-news-setup">
        <ImageTemplatePicker />
        <RoleTemplatePicker />
      </div>
      <div className="card-news-main">
        {error ? <div className="card-news-error" role="alert">{error}</div> : null}
        <CardStage />
        <CardDeckRail />
      </div>
      <CardInspector />
    </main>
  );
}
