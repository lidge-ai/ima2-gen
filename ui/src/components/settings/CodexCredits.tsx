export type QuotaTranslate = (key: string, params?: Record<string, string | number>) => string;
export interface CodexCreditsProps {
  balance: string | number | null;
  resetCreditCount: number | null;
  usableNow?: number | null;
  unlimited?: boolean;
  overage?: boolean;
  approxMessages?: number | null;
  t?: QuotaTranslate;
}

export function CodexCredits({ balance, resetCreditCount, usableNow, unlimited, overage, approxMessages,
  t = (key) => key }: CodexCreditsProps) {
  return <div className="quota-credits">
    <div>{t("settings.quota.credits.balance")}: <span data-testid="balance">
      {unlimited ? t("settings.quota.credits.unlimited") : balance ?? "—"}</span></div>
    {overage && <div>{t("settings.quota.credits.overage")}</div>}
    {approxMessages != null && <div>{t("settings.quota.credits.approxMessages", { count: approxMessages })}</div>}
    <div>{t("settings.quota.resetCredits.count")}: <span data-testid="reset-credit-count">{resetCreditCount ?? "—"}</span>
      {usableNow != null && <> · {t("settings.quota.resetCredits.usableNow", { count: usableNow })}</>}</div>
  </div>;
}
