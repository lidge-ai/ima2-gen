import { quotaDetails, useQuotaDetails } from "./QuotaDetails";

export type QuotaTranslate = (key: string, params?: Record<string, string | number>) => string;
export interface CodexCreditsProps {
  balance: string | number | null;
  locale?: string;
  resetCreditCount: number | null;
  usableNow?: number | null;
  unlimited?: boolean;
  overage?: boolean;
  approxMessages?: number | null;
  t?: QuotaTranslate;
}

export function CodexCredits({ balance, locale, resetCreditCount, usableNow, unlimited, overage, approxMessages,
  t = (key) => key }: CodexCreditsProps) {
  const details = useQuotaDetails();
  const numericBalance = balance !== null && String(balance).trim() !== "" ? Number(balance) : NaN;
  const formattedBalance = Number.isFinite(numericBalance) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(numericBalance) : balance ?? "—";
  const summary = <>{t("settings.quota.credits.balance")}: <span data-testid="balance" title={balance == null ? undefined : String(balance)}>
    {unlimited ? t("settings.quota.credits.unlimited") : formattedBalance}</span></>;
  return <div className="quota-credits">
    {quotaDetails("quota-codex-credits", details, t("settings.quota.credits.title"), summary, <>
      {overage && <div>{t("settings.quota.credits.overage")}</div>}
      {approxMessages != null && <div>{t("settings.quota.credits.approxMessages", { count: approxMessages })}</div>}
      <div>{t("settings.quota.resetCredits.count")}: <span data-testid="reset-credit-count">{resetCreditCount ?? "—"}</span>
        {usableNow != null && <> · {t("settings.quota.resetCredits.usableNow", { count: usableNow })}</>}</div>
    </>)}
  </div>;
}
