import { useI18n } from "../../i18n";
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
  let text: string;
  if (blocker?.code === "key") text = t("mediaPicker.blockKey", { provider: blocker.route.label });
  else if (blocker?.code === "input") text = t(`mediaPicker.problem.${blocker.problem.code}`, { min: blocker.problem.min, max: blocker.problem.max, have: blocker.problem.have });
  else {
    const amount = quoteAmount(view, t);
    text = amount ? t("mediaPicker.estimate.hint", { model: name, amount }) : t("mediaPicker.estimate.hintNoPrice", { model: name });
  }
  return <p id={id} className={`generate-row__media${blocker ? " generate-row__media--blocked" : ""}`} role="status">{text}</p>;
}
