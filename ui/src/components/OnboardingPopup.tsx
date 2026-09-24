import { useState } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { useGrokStatus } from "../hooks/useGrokStatus";
import { useKeyStatus } from "../hooks/useKeyStatus";
import { useModalFocus } from "../hooks/useModalFocus";
import { ONBOARDING_DISMISSED_STORAGE_KEY } from "../store/persistenceRegistry";
import { BrandMark } from "./BrandMark";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function Step({ num, current, title, hint }: { num: number; current?: boolean; title: string; hint: string }) {
  return (
    <li className={current ? "onboarding__step is-current" : "onboarding__step"} aria-current={current ? "step" : undefined}>
      <span className="onboarding__step-num" aria-hidden="true">{num}</span>
      <span>
        <span className="onboarding__step-title">{title}</span>
        <span className="onboarding__step-hint">{hint}</span>
      </span>
    </li>
  );
}

function Choice({ title, body, badge, primary, onChoose }: {
  title: string;
  body: string;
  badge?: string;
  primary?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={primary ? "onboarding__choice onboarding__choice--primary" : "onboarding__choice"}
      onClick={onChoose}
      data-modal-initial-focus={primary ? true : undefined}
    >
      <span className="onboarding__choice-head">
        <span>{title}</span>
        {badge ? <span className="onboarding__badge">{badge}</span> : null}
      </span>
      <span className="onboarding__choice-body">{body}</span>
    </button>
  );
}

// First-run welcome. Shows only when GPT OAuth, Grok and Gemini are ALL signed out,
// until the user skips it or picks a provider. Escape or a backdrop click only hides
// it for this page load. Step 3 is the StarPrompt, shown after the first image.
export function OnboardingPopup() {
  const { t } = useI18n();
  const openSettings = useAppStore((s) => s.openSettings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const oauth = useOAuthStatus();
  const grok = useGrokStatus();
  const { data: keyStatus } = useKeyStatus();
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  const [hiddenForNow, setHiddenForNow] = useState(false);

  // Only decide once every status has loaded — avoid a flash while null/loading.
  const loaded = oauth !== null && grok !== null && keyStatus != null;
  const oauthUnauth = oauth?.status === "auth_required" || oauth?.status === "offline";
  const grokUnauth = grok?.status === "offline" || grok?.status === "error";
  const geminiUnauth = keyStatus
    ? !keyStatus.gemini?.configured && !keyStatus.vertex?.configured
    : false;
  const allUnauthenticated = loaded && oauthUnauth && grokUnauth && geminiUnauth;
  const open = !dismissed && !hiddenForNow && !settingsOpen && allUnauthenticated;

  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, "1");
    } catch {
      /* ignore storage errors */
    }
    setDismissed(true);
  };
  const hideForNow = () => setHiddenForNow(true);
  const choose = () => {
    dismiss();
    openSettings("providers");
  };
  const modalRef = useModalFocus<HTMLDivElement>(open, hideForNow);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop onboarding-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) hideForNow();
      }}
    >
      <div
        ref={modalRef}
        className="modal onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
      >
        <section className="onboarding__intro">
          <BrandMark className="onboarding__mark" />
          <h2 id="onboarding-title" className="onboarding__title">{t("onboarding.title")}</h2>
          <p className="onboarding__lead">{t("onboarding.lead")}</p>
          <ol className="onboarding__steps" aria-label={t("onboarding.stepsLabel")}>
            <Step num={1} current title={t("onboarding.steps.signIn.title")} hint={t("onboarding.steps.signIn.hint")} />
            <Step num={2} title={t("onboarding.steps.firstImage.title")} hint={t("onboarding.steps.firstImage.hint")} />
            <Step num={3} title={t("onboarding.steps.star.title")} hint={t("onboarding.steps.star.hint")} />
          </ol>
        </section>
        <section className="onboarding__pick">
          <div className="onboarding__choices">
            <Choice
              primary
              title={t("onboarding.choices.chatgpt.title")}
              body={t("onboarding.choices.chatgpt.body")}
              badge={t("onboarding.recommended")}
              onChoose={choose}
            />
            <Choice title={t("onboarding.choices.grok.title")} body={t("onboarding.choices.grok.body")} onChoose={choose} />
            <Choice title={t("onboarding.choices.apiKey.title")} body={t("onboarding.choices.apiKey.body")} onChoose={choose} />
          </div>
          <div className="onboarding__footer">
            <p className="onboarding__privacy">{t("onboarding.privacy")}</p>
            <button type="button" className="modal__btn modal__btn--secondary" onClick={dismiss}>
              {t("onboarding.skip")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
