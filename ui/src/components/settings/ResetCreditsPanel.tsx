import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Toggle } from "../controls";
import type { QuotaTranslate } from "./CodexCredits";

export interface ResetOperation {
  operationId?: string; operation_id?: string; state: string; unknownOrigin?: string; unknown_origin?: string | null;
}
export interface ResetList {
  accountRef: string;
  credits: Array<{ id?: string; title?: string | null; status?: string | null; expiresAt?: string | null }>;
  availableCount?: number | null;
  complete?: boolean;
}
export interface ResetCreditsTransport {
  getOperations(): Promise<ResetOperation[]>;
  list?(): Promise<ResetList>;
  redeem(accountRef: string): Promise<void | { result?: { outcome?: string }; outcome?: string }>;
  acknowledge?(id: string): Promise<unknown>;
  getSettings?(): Promise<ResetSettings>;
  saveSettings?(settings: ResetSettings): Promise<ResetSettings>;
}
export interface ResetSettings { enabled: boolean; leadMinutes: number; accountRef: string | null }
const unresolved = (op: ResetOperation) => ["claimed", "sending", "unknown"].includes(op.state);
const operationId = (op: ResetOperation) => op.operationId ?? op.operation_id ?? "";
const shortRef = (value: string) => value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
const outcomeKeys: Record<string, string> = { reset: "success", nothing_to_reset: "nothingToReset",
  no_credit: "noCredit", already_redeemed: "alreadyRedeemed", unknown: "unknown", IDENTITY_CHANGED: "identityChanged" };

export function trapKey(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
  if (!buttons.length) { event.preventDefault(); return; }
  const first = buttons[0]!; const last = buttons[buttons.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function operationRows(ops: ResetOperation[], busy: boolean, t: QuotaTranslate, acknowledge: (id: string) => void) {
  return ops.filter(unresolved).map((op) => <div key={operationId(op)}>
    <p>{operationId(op)} · {op.state}</p>
    {op.state === "unknown" && <><p>{t("settings.quota.acknowledge.explanation")}</p>
      {(op.unknownOrigin ?? op.unknown_origin) === "recovered" && <p>{t("settings.quota.acknowledge.blocked")}</p>}
      <button type="button" disabled={busy} onClick={() => acknowledge(operationId(op))}>
        {t("settings.quota.acknowledge.action")}</button></>}
  </div>);
}

function creditRows(list: ResetList | null, t: QuotaTranslate) {
  if (list && list.credits.length === 0) return <p className="settings-row__microcopy">{t("settings.quota.resetCredits.empty")}</p>;
  return list && <ul>{list.credits.map((credit, index) => <li key={credit.id ?? index}>
    {credit.title ?? credit.status ?? "—"} {credit.expiresAt && t("settings.quota.resetCredits.expires", { date: credit.expiresAt })}
  </li>)}</ul>;
}

type PanelProps = {
  transport: ResetCreditsTransport; t?: QuotaTranslate; onRefresh?: () => void;
  accountRef?: string; accountEmail?: string | null;
  availableCount?: number | null; applicableAvailableCount?: number | null;
};
export function ResetCreditsPanel({ transport, t = (key) => key, onRefresh, accountRef, accountEmail, availableCount, applicableAvailableCount }: PanelProps) {
  const [settings, setSettings] = useState<ResetSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [ops, setOps] = useState<ResetOperation[]>([]);
  const [dialog, setDialog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [list, setList] = useState<ResetList | null>(null);
  const [listError, setListError] = useState(false);
  const usableCount = applicableAvailableCount === undefined ? availableCount : applicableAvailableCount;
  const noUsableCredits = usableCount == null || usableCount <= 0;
  const [opsLoaded, setOpsLoaded] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const displayedRef = useRef(accountRef); displayedRef.current = accountRef;
  const accountChanged = () => { setDialog(null); setMessage("identityChanged"); onRefresh?.(); };
  const refreshOps = () => transport.getOperations().then((data) => { setOps(data); setOpsLoaded(true); })
    .catch(() => { setOpsLoaded(false); setMessage("loadError"); });
  useEffect(() => { void transport.getOperations().then((data) => { setOps(data); setOpsLoaded(true); })
    .catch(() => { setOpsLoaded(false); setMessage("loadError"); }); }, [transport]);
  useEffect(() => { if (transport.getSettings) void transport.getSettings().then(setSettings).catch(() => setMessage("loadError")); }, [transport]);
  const saveSettings = async (next: ResetSettings) => {
    if (!transport.saveSettings || !displayedRef.current || settingsBusy || !Number.isInteger(next.leadMinutes) || next.leadMinutes < 1 || next.leadMinutes > 60) return;
    setSettingsBusy(true);
    try { setSettings(await transport.saveSettings({ ...next, accountRef: displayedRef.current })); } catch (error) { if ((error as { code?: string }).code === "IDENTITY_CHANGED") accountChanged(); else setMessage("loadError"); } finally { setSettingsBusy(false); }
  };
  const confirm = async () => {
    if (inFlight.current || !dialog) return;
    inFlight.current = true;
    setBusy(true); setMessage("redeeming");
    try {
      if (!transport.list) throw new Error("RESET_LIST_UNAVAILABLE");
      const latest = await transport.list();
      if (!dialog || !displayedRef.current || latest.accountRef !== dialog || dialog !== displayedRef.current) { accountChanged(); return; }
      const result = await transport.redeem(dialog);
      setMessage(outcomeKeys[result?.result?.outcome ?? result?.outcome ?? "unknown"] ?? "unknown");
      onRefresh?.();
    } catch (error) {
      if ((error as { code?: string }).code === "IDENTITY_CHANGED") accountChanged(); else setMessage("unknown");
    } finally { inFlight.current = false; setBusy(false); setDialog(null); void refreshOps(); trigger.current?.focus(); }
  };
  const acknowledge = async (id: string) => {
    if (!transport.acknowledge || busy) return;
    setBusy(true);
    try { await transport.acknowledge(id); await refreshOps(); }
    catch { setMessage("ackBlocked"); } finally { setBusy(false); }
  };
  return <div className="quota-reset">
    <button type="button" className="settings-action-btn" ref={trigger} disabled={busy || !opsLoaded || ops.some(unresolved) || noUsableCredits} onClick={() => {
      if (!transport.list) return;
      const clickedRef = displayedRef.current;
      setBusy(true); void transport.list().then(data => {
        if (!clickedRef || data.accountRef !== clickedRef || displayedRef.current !== clickedRef) { accountChanged(); return; }
        setList(data); setMessage(""); setDialog(data.accountRef);
      })
        .catch(() => setListError(true)).finally(() => setBusy(false));
    }}>
      {t("settings.quota.redeem.action")}</button>
    {noUsableCredits && <p className="settings-row__microcopy">{t(usableCount == null ? "settings.quota.redeem.creditUnknown" : "settings.quota.redeem.noCredit")}</p>}
    <button type="button" className="settings-action-btn" onClick={() => {
      setList(null); setListError(false);
      if (transport.list) void transport.list().then(setList).catch(() => setListError(true));
    }}>{t("settings.quota.resetCredits.list")}</button>
    {listError && <p role="alert" className="settings-row__microcopy">{t("settings.quota.resetCredits.loadError")}</p>}
    {list?.complete === false && <p role="status" className="settings-row__microcopy">{t("settings.quota.resetCredits.partial")}</p>}
    {creditRows(list, t)}
    {settings && <fieldset disabled={settingsBusy}><legend>{t("settings.quota.autoRedeem.title")}</legend>
      <article className="settings-row">
        <div className="settings-row__copy"><h4>{t("settings.quota.autoRedeem.enable")}</h4>
          <p className="settings-row__microcopy">{t("settings.quota.autoRedeem.warning")}</p>
          <p className="settings-row__microcopy">{t("settings.quota.autoRedeem.account", { account: settings.accountRef ?? "—" })}</p></div>
        <div className="settings-row__control"><Toggle checked={settings.enabled && !!accountRef && settings.accountRef === accountRef} disabled={settingsBusy || !accountRef}
          ariaLabel={t("settings.quota.autoRedeem.enable")} onChange={enabled => { void saveSettings({ ...settings, enabled }); }} /></div>
      </article>
      <article className="settings-row">
        <div className="settings-row__copy"><label htmlFor="reset-lead-minutes">{t("settings.quota.autoRedeem.lead")}</label></div>
        <div className="settings-row__control"><input id="reset-lead-minutes" className="custom-size-input" type="number" min={1} max={60} disabled={!accountRef || (settings.enabled && settings.accountRef !== accountRef)} defaultValue={settings.leadMinutes} key={settings.leadMinutes}
          onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 60) void saveSettings({ ...settings, enabled: settings.enabled && settings.accountRef === accountRef, leadMinutes: value }); else event.target.value = String(settings.leadMinutes); }} /></div>
      </article>
    </fieldset>}
    {operationRows(ops, busy, t, (id) => { void acknowledge(id); })}
    <div role="status" aria-live="polite">{message && t(message === "ackBlocked" ? "settings.quota.acknowledge.blocked" : `settings.quota.redeem.${message}`)}</div>
    {dialog && <div className="quota-reset__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="reset-confirm-title"
      className="quota-reset__dialog" onKeyDown={(event) => trapKey(event, () => { if (!busy) { setDialog(null); trigger.current?.focus(); } })}>
      <p id="reset-confirm-title">{t("settings.quota.redeem.confirm")}</p>
      <p>{accountEmail && <>{accountEmail} · </>}{shortRef(dialog)}</p>
      <button type="button" disabled={busy} ref={(node) => { node?.focus(); }} onClick={() => { setDialog(null); trigger.current?.focus(); }}>{t("settings.quota.redeem.cancel")}</button>
      <button type="button" disabled={busy} onClick={() => { void confirm(); }}>{t("settings.quota.redeem.action")}</button>
    </div></div>}
  </div>;
}
