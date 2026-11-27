import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { quoteAmount } from "./MediaEstimate";
import { useMediaQuote } from "./useMediaQuote";
import type { MediaReadiness } from "./useMediaReadiness";

/**
 * One line under Generate while a media model is selected: why it cannot run yet, or what it is
 * expected to cost. It is the same estimate the settings panel breaks down.
 */
export function MediaGenerateHint({ id, readiness }: { id: string; readiness: MediaReadiness }) {
  const { t } = useI18n();
  const { selection, resolved, blocker } = readiness;
  const view = useMediaQuote(resolved?.route, selection);
  const name = selection.label ?? selection.model;
  const failed = useAppStore((s) => s.mediaFailure?.selection?.model === selection.model);
  let text: string;
  if (blocker?.code === "key") text = t("mediaPicker.blockKey", { provider: blocker.route.label });
  else if (blocker?.code === "input") text = t(`mediaPicker.problem.${blocker.problem.code}`, { min: blocker.problem.min, max: blocker.problem.max, have: blocker.problem.have });
  else if (failed) text = t("mediaPicker.failure.hint", { model: name });
  else {
    const amount = quoteAmount(view, t);
    text = amount ? t("mediaPicker.estimate.hint", { model: name, amount })
      : view.quote.state === "local" ? t("mediaPicker.estimate.hintLocal", { model: name })
      : view.quote.state === "usage" ? t("mediaPicker.estimate.hintUsage", { model: name }) : t("mediaPicker.estimate.hintNoPrice", { model: name });
  }
  return <p id={id} className={`generate-row__media${blocker ? " generate-row__media--blocked" : ""}`} role="status">{text}</p>;
}
