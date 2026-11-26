import { useAppStore } from "../store/useAppStore";
import { useId } from "react";
import { useI18n } from "../i18n";
import { MediaGenerateHint } from "./media/MediaGenerateHint";
import { useMediaReadiness } from "./media/useMediaReadiness";

export function GenerateButton() {
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const generate = useAppStore((s) => s.generate);
  const openReadinessPopup = useAppStore((s) => s.openReadinessPopup);
  const missingElementIds = useAppStore((s) => s.missingElementIds ?? []);
  const { t } = useI18n();

  const loading = activeGenerations > 0;
  const missingBlocked = missingElementIds.length > 0;
  // A selected media model can be blocked for a reason the hint below the button states (no key yet,
  // images that do not fit the task). The button stays focusable so that reason is announced with it.
  const media = useMediaReadiness();
  const hintId = useId();
  const mediaBlocked = media !== null && media.blocker !== null;

  return (
    <div className={`generate-row${media ? " generate-row--media" : ""}`}>
      <button
        type="button"
        className={`generate-btn foil-hover${loading ? " generate-btn--active" : ""}`}
        disabled={missingBlocked}
        title={missingBlocked ? t("toast.missingElements") : undefined}
        aria-disabled={mediaBlocked || undefined}
        aria-describedby={media ? hintId : undefined}
        onClick={() => { if (!mediaBlocked) void generate(); }}
      >
        {t("generate.button")}
        {loading ? (
          <span className="generate-btn__count" aria-label={t("generate.buttonLoading", { n: activeGenerations })}>
            {activeGenerations}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="generate-row__readiness"
        onClick={openReadinessPopup}
        title={t("readiness.openTitle")}
        aria-label={t("readiness.openTitle")}
      >
        ?
      </button>
      {media ? <MediaGenerateHint id={hintId} readiness={media} /> : null}
    </div>
  );
}
