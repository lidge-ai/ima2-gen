import { useI18n } from "../../i18n";
import { getMediaCatalog } from "../../lib/mediaCatalogStore";
import { failureAction, type MediaFailure } from "../../lib/mediaFailure";
import { useAppStore } from "../../store/useAppStore";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function reason(failure: MediaFailure, provider: string, t: Translate): string {
  const category = failure.category;
  return category === "auth" ? t("mediaPicker.failure.auth", { provider }) : category === "quota" ? t("mediaPicker.failure.quota", { provider })
    : category === "rate-limit" ? t("mediaPicker.failure.rateLimit", { provider }) : category === "timeout" ? t("mediaPicker.failure.timeout", { provider })
    : category === "upstream" ? t("mediaPicker.failure.upstream", { provider }) : category === "moderation" ? t("mediaPicker.failure.moderation", { provider })
    : category === "invalid-request" ? t("mediaPicker.failure.invalid", { provider }) : category === "not-found" ? t("mediaPicker.failure.notFound", { provider })
    : t("mediaPicker.failure.unknown");
}

/**
 * The last failed media job: what went wrong in plain words, the provider's own message, and the one
 * thing to do about it. It stays through a reload until it is dismissed or a later job succeeds.
 */
export function MediaFailureCard() {
  const { t } = useI18n();
  const failure = useAppStore((s) => s.mediaFailure);
  const dismiss = useAppStore((s) => s.dismissMediaFailure);
  const retry = useAppStore((s) => s.retryMediaFailure);
  const askKey = useAppStore((s) => s.promptMediaKey);
  if (!failure) return null;
  const adapter = getMediaCatalog().adapters.find((item) => item.id === failure.adapter);
  const provider = adapter?.label ?? failure.adapter;
  const model = failure.selection?.label ?? failure.selection?.model ?? provider;
  const action = failureAction(failure.category, failure.retryable);
  const editPrompt = () => { document.querySelector<HTMLTextAreaElement>(".composer__textarea")?.focus(); };
  return (
    <section className="media-failure" role="alert">
      <h4 className="media-failure__title">{t("mediaPicker.failure.title", { model })}</h4>
      <p>{reason(failure, provider, t)}</p>
      <div className="media-failure__actions">
        {action === "key" ? <button type="button" className="modal__btn" onClick={() => askKey(failure)}>{t("mediaPicker.failure.actionKey")}</button> : null}
        {action === "billing" && adapter?.consoleUrl ? (
          <a className="modal__btn" href={adapter.consoleUrl} target="_blank" rel="noreferrer">{t("mediaPicker.failure.actionBilling", { provider })}<span className="sr-only"> {t("mediaPicker.key.newTab")}</span></a>
        ) : null}
        {action === "retry" && failure.selection ? <button type="button" className="modal__btn" onClick={() => void retry()}>{t("mediaPicker.failure.actionRetry")}</button> : null}
        {action === "prompt" ? <button type="button" className="modal__btn" onClick={editPrompt}>{t("mediaPicker.failure.actionPrompt")}</button> : null}
        <button type="button" className="modal__btn modal__btn--secondary" onClick={dismiss}>{t("mediaPicker.dismiss")}</button>
      </div>
      {failure.message || failure.code ? (
        <details className="media-details"><summary>{t("mediaPicker.details")}</summary>
          <p className="media-error-detail"><code>{failure.code}</code>{failure.message ? " " + failure.message : ""}</p></details>
      ) : null}
    </section>
  );
}
