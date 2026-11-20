import { fetchApi } from "../../lib/api-core";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT } from "../../lib/lanSession";
import { SwitchAccountButton } from "./SwitchAccountButton";
import type { QuotaWindow, QuotaResponse } from "./quotaTypes";
import { CodexCredits } from "./CodexCredits";
import { ResetCreditsPanel } from "./ResetCreditsPanel";
import { GrokCouponsPanel } from "./GrokCouponsPanel";
import { grokCouponsTransport } from "./grokCouponsTransport";
import { resetCreditsTransport } from "./resetCreditsTransport";

function barColor(pct: number): string {
  if (pct > 80) return "var(--red)";
  if (pct > 50) return "var(--amber)";
  return "var(--blue)";
}

function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function QuotaBar({ window: w }: { window: QuotaWindow }) {
  const { t } = useI18n();
  const reset = formatReset(w.resetsAt);
  const label = w.label === "5h" || w.label === "7d" || w.label === "30d" || w.label === "weekly"
    ? t(`settings.quota.window.${w.label}`) : t("settings.quota.window.other", { label: w.label ?? "—" });
  return (
    <div className="quota-bar">
      <span className="quota-bar__label">{label}</span>
      <div className="quota-bar__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={w.percent === null ? undefined : Math.max(0, Math.min(w.percent, 100))}>
        <div
          className="quota-bar__fill"
          style={{ width: `${w.percent === null ? 0 : Math.max(0, Math.min(w.percent, 100))}%`, background: barColor(w.percent ?? 0) }}
        />
      </div>
      <span className="quota-bar__pct">{w.percent === null ? "—" : `${w.percent}%`}</span>
      {reset && <span className="quota-bar__reset">{reset}</span>}
    </div>
  );
}

/** NovelAI percent is remaining charge; resetsAt is the next 1% recharge ETA. */
function ChargeBar({ window: w }: { window: QuotaWindow }) {
  const { t } = useI18n();
  const percent = w.percent === null ? null : Math.max(0, Math.min(w.percent, 100));
  const color = (percent ?? 0) > 50 ? "var(--blue)" : (percent ?? 0) >= 20 ? "var(--amber)" : "var(--red)";
  const minutes = w.resetsAt === null
    ? null
    : Math.max(0, Math.ceil((Date.parse(w.resetsAt) - Date.now()) / 60_000));
  return (
    <div className="quota-bar quota-bar--charge">
      <span className="quota-bar__label">{t("settings.quota.naiBattery")}</span>
      <div
        className="quota-bar__track"
        role="meter"
        aria-label={t("settings.quota.naiBattery")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div className="quota-bar__fill" style={{ width: `${percent ?? 0}%`, background: color }} />
      </div>
      <span className="quota-bar__pct">{w.percent === null ? "—" : `${w.percent}%`}</span>
      {minutes !== null && Number.isFinite(minutes) && (
        <span className="quota-bar__reset">{t("settings.quota.naiNextPercent", { minutes })}</span>
      )}
    </div>
  );
}

/** Shared quota fetch — call once in the parent and pass results down. */
export function useQuotaData() {
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshQuota = useCallback(() => {
    setLoading(true);
    fetchApi("/api/quota")
      .then((r) => r.json() as Promise<QuotaResponse>)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isLanSessionLocked()) return;
    const timer = setTimeout(() => { stop(); refreshQuota(); }, 1500);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    };
    window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    return stop;
  }, [refreshQuota]);

  return { data, loading, refreshQuota };
}

type QuotaBlockProps = {
  data: QuotaResponse | null;
  loading: boolean;
  onRefresh: () => void;
};

/** NovelAI token quota: battery charge and Anlas are separate balances. */
export function NaiQuota({ data, loading }: Pick<QuotaBlockProps, "data" | "loading">) {
  const { t } = useI18n();
  const result = data?.nai;
  const nai = result?.nai;
  const battery = result?.windows.find((w) => w.label === "v5-battery");
  const message = loading ? t("common.loading")
    : result?.authenticated === false ? t("settings.quota.naiNotConfigured")
    : !result || result.error ? t("settings.quota.fetchError")
    : !nai ? t("settings.quota.noData") : null;
  if (message || !nai) {
    return (
      <div className="quota-card">
        <span className={loading ? "quota-card__loading" : "quota-card__hint"}>
          {message ?? t("settings.quota.noData")}
        </span>
      </div>
    );
  }
  return (
    <div className="quota-card">
      <div className="quota-card__header">
        <span className="quota-card__account">{result?.account?.plan}</span>
        {nai.isNegative && (
          <span className="provider-chip provider-chip--warn">{t("settings.quota.naiNegative")}</span>
        )}
      </div>
      {nai.meter === "missing" || !battery ? (
        <span className="quota-card__hint">{t("settings.quota.naiMeterMissing")}</span>
      ) : (
        <>
          <ChargeBar window={battery} />
          {battery.percent === 0 && nai.anlasFixed + nai.anlasPurchased > 0 && (
            <p className="quota-card__hint">{t("settings.quota.naiAnlasFallback")}</p>
          )}
        </>
      )}
      <p className="quota-card__anlas">
        {t("settings.quota.naiAnlas")}: {nai.anlasFixed} + {nai.anlasPurchased}
      </p>
    </div>
  );
}

/** Codex rate-limit block — lives inside the GPT OAuth provider card. */
export function CodexQuota({ data, loading, onRefresh }: QuotaBlockProps) {
  const { t, locale } = useI18n();
  const codex = data?.codex;
  const hasCodexWindows = codex?.windows && codex.windows.length > 0;
  const accountLine = codex?.account
    ? [codex.account.email, codex.account.plan].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="quota-card">
      {accountLine ? (
        <div className="quota-card__header">
          <span className="quota-card__account">{accountLine}</span>
        </div>
      ) : null}
      {loading ? (
        <span className="quota-card__loading">{t("common.loading")}</span>
      ) : hasCodexWindows ? (
        codex!.windows.map((w, index) => <QuotaBar key={w.id ?? `${w.label}-${index}`} window={w} />)
      ) : codex?.authenticated === false ? (
        <span className="quota-card__hint">{t("settings.quota.codexNotLoggedIn")}</span>
      ) : codex?.error ? (
        <span className="quota-card__hint">{t("settings.quota.fetchError")}</span>
      ) : (
        <span className="quota-card__hint">{t("settings.quota.noData")}</span>
      )}
      {codex && !codex.error && codex.authenticated !== false && <>
        <CodexCredits locale={locale} balance={codex.credits?.balance ?? null} unlimited={codex.credits?.unlimited}
          overage={codex.credits?.overage} approxMessages={codex.credits?.approxMessages}
          resetCreditCount={codex.resetCredits?.availableCount ?? null}
          usableNow={codex.resetCredits?.applicableAvailableCount ?? null} t={t} />
        <ResetCreditsPanel accountRef={codex.accountRef} availableCount={codex.resetCredits?.availableCount}
          applicableAvailableCount={codex.resetCredits?.applicableAvailableCount} transport={resetCreditsTransport} t={t} onRefresh={onRefresh} />
        {codex.upsell?.buyReset && <a target="_blank" rel="noopener noreferrer" href="https://chatgpt.com/codex/purchase/reset">{t("settings.quota.upsell.buyReset")}</a>}
        {codex.upsell?.viewUsage && <a target="_blank" rel="noopener noreferrer" href="https://chatgpt.com/settings/usage">{t("settings.quota.upsell.viewUsage")}</a>}
      </>}
      <SwitchAccountButton provider="codex" onComplete={onRefresh} />
    </div>
  );
}

/** Grok quota block — lives inside the Grok provider card. */
export function GrokQuota({ data, loading, onRefresh }: QuotaBlockProps) {
  const { t } = useI18n();
  const grok = data?.grok;
  const hasGrokWindows = grok?.windows && grok.windows.length > 0;
  const grokAccountLine = grok?.account
    ? [grok.account.email, grok.account.plan].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="quota-card">
      {grokAccountLine || grok?.billing ? (
        <div className="quota-card__header" style={{ display: "flex", alignItems: "center" }}>
          {grokAccountLine && <span className="quota-card__account">{grokAccountLine}</span>}
          {grok?.billing && (
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-dim, #888)", whiteSpace: "nowrap" }}>
              ${grok.billing.usedUsd.toFixed(1)}/${grok.billing.limitUsd}
            </span>
          )}
        </div>
      ) : null}
      {loading ? (
        <span className="quota-card__loading">{t("common.loading")}</span>
      ) : hasGrokWindows ? (
        grok!.windows.map((w, index) => <QuotaBar key={w.id ?? `${w.label}-${index}`} window={w} />)
      ) : grok?.authenticated === false ? (
        <span className="quota-card__hint">{t("settings.quota.codexNotLoggedIn")}</span>
      ) : (
        <a
          href="https://grok.com/?_s=usage"
          target="_blank"
          rel="noopener noreferrer"
          className="settings-action-btn"
        >
          {t("settings.quota.grokUsageLink")}
        </a>
      )}
      {grok?.source && <p className="quota-card__hint">{t(`settings.quota.grokSource.${grok.source}`)}</p>}
      {grok?.source === "grok-cli" && <p className="quota-card__hint">{t("settings.quota.grokSource.accountMayDiffer")}</p>}
      {grok?.productUsage?.map((row, index) => <p key={`${row.product}-${index}`}>{row.product}: {row.percent}%</p>)}
      {grok?.prepaidBalance !== undefined && <p>{t("settings.quota.grokCoupons.prepaidBalance")}: {grok.prepaidBalance}</p>}
      <GrokCouponsPanel transport={grokCouponsTransport} t={t} onRefresh={onRefresh} />
      <SwitchAccountButton provider="grok" onComplete={onRefresh} />
    </div>
  );
}
